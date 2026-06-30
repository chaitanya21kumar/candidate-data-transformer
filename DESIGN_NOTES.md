# Design Notes

In-depth rationale behind the engine — the "why" behind every decision, written so each
choice can be explained and defended. The [README](README.md) is the quick tour; this is
the deep dive.

---

## 1. Guiding principle

> **Wrong-but-confident is worse than honestly-empty.**

A bad value silently pollutes downstream hiring decisions, whereas a `null` is visibly
absent and safe. Every ambiguous decision in the engine resolves toward *not asserting*
something we cannot trace to a source. Concretely:

- A phone that does not parse to E.164 is **dropped**, not coerced or guessed.
- A date with no month is **not** promoted to `-01` (we never invent precision).
- A bare local phone number with no country code returns `null` rather than guessing `+1`.
- Entity resolution refuses to merge on weak evidence (see §4) — a false merge corrupts
  two profiles at once.
- Every emitted value carries **provenance** (source + method) and a **confidence**.

---

## 2. Architecture

```
RawSource[]  ──adapters──▶  ExtractedField[]  ──normalize──▶  NormalizedField[]
   ──resolve (union-find)──▶  clusters  ──build──▶  CanonicalProfile[]
   ──project(config)──▶  reshaped output  ──validate (dynamic Zod)──▶  JSON
```

**Stack: TypeScript (strict) + Zod.** Three reasons:

1. The canonical record and the projection are both *data shapes* — strict static types
   model them precisely, and `noUncheckedIndexedAccess` catches the array-edge bugs that
   plague data code.
2. The "validate the output against the requested schema" requirement maps perfectly onto
   **building a Zod schema at runtime from the config** and parsing the projection through
   it. The validator is *derived from the request*, not hand-written per shape.
3. One language for engine + CLI + browser UI, and a trivial static deploy.

**The core is pure and isomorphic.** Nothing under `src/core/` imports a Node-only API
(no `fs`, no `crypto`). Adapters take in-memory strings, not file paths. This is why the
same engine runs unchanged in the CLI and in the browser UI, and why it is trivially
testable. All I/O (file reading, PDF extraction) lives in `src/io/`.

---

## 3. Canonical schema & normalized formats

The internal `CanonicalProfile` *is* the assignment's default output schema — nothing
extra leaks into it. Internal-only metadata the projection needs (per-field confidence,
diagnostics) rides alongside in `ResolvedProfile`, keeping the canonical shape clean.

| Field | Normalized form | How |
|---|---|---|
| `phones` | E.164 (`+919650762045`) | `libphonenumber-js`; unparseable → dropped |
| experience `start`/`end` | `YYYY-MM` (or `present`) | hand-rolled month parser; year-only → `null` |
| `education.end_year` | 4-digit number | year extraction (1900–2100) |
| `location.country` | ISO-3166 alpha-2 | curated alias map over `i18n-iso-countries` |
| `skills[].name` | canonical names | hand-built alias dictionary |
| `emails` | lowercased, de-duped | normalize + RFC-lite validation |
| `links.*` | canonical absolute URLs | scheme-completed, host-lowercased, query-stripped |

The Zod canonical schema **enforces these formats with regexes** (E.164, alpha-2,
`YYYY-MM`). That doubles as a self-check: if a normalizer ever lets a bad value through,
validation fails loudly instead of shipping it. The schema and the hand-written type are
held in **compile-time lockstep** (`_SchemaMatchesType` in `schema/canonical.ts`).

---

## 4. Entity resolution (the subtlest part — be ready to explain this)

Records are clustered with **union-find** in **two phases** reflecting a trust hierarchy:

**Phase 1 — strong keys are authoritative.** Records sharing an `email`, E.164 `phone`,
or GitHub handle are unioned. Linking is **transitive**: if CSV~ATS share an email and
CSV~notes share a phone, all three collapse into one person. Union-find makes this near
O(n·α(n)).

**Phase 2 — `name+company` is a weak fallback, used carefully.** It exists to attach
records that have *no strong identifier of their own* (a recruiter note that only says
"Jane Doe, engineer at Acme"). The rules:

- It **never merges two records that each carry a strong identifier.** Two different
  people named "John Smith" at "Acme" with different emails stay separate.
- An un-anchored record attaches to a strong identity **only if exactly one** matches its
  name+company. If the name+company is ambiguous across multiple people, the record is
  **left unmerged** rather than guessed.

> This two-phase split was not the first design. The original unioned on *any* shared key,
> including name+company. The **scale benchmark caught it**: 1,000 distinct generated
> candidates (all with unique emails, but recycled names/companies) collapsed to 40. That
> false-merge bug is exactly the failure mode the principle in §1 warns about, so the
> resolver was rewritten to make strong identifiers authoritative. This is a good story to
> tell: a test at scale surfaced a correctness bug a small example would have hidden.

Why not fuzzy/ML record linkage? It is non-deterministic, hard to explain, and easy to get
confidently wrong. Deterministic, explainable keys fit the brief's "explainable + correct"
bar far better. (See descopes, §9.)

---

## 5. Conflict resolution & the winner policy

When a cluster has several values for one slot:

- **Single-valued slots** (name, headline, country, each link): group identical normalized
  values; combine the confidence of agreeing sources (see §6); pick the winner by
  **(confidence, breadth of agreement, source trust, value)** — a fully deterministic
  ordering. Because corroboration raises confidence, a value two sources agree on beats a
  lone higher-trust source, which is usually what you want.
- **Multi-valued slots** (emails, phones, skills, other links): **union + de-duplicate**,
  ordered by confidence so element `[0]` is the most trustworthy. That is what makes a
  projection like `"primary_email": "emails[0]"` sound. Skills de-duplicate
  **case-insensitively** while keeping the best-cased display (so "COBOL" survives but
  "distributed systems" / "Distributed Systems" collapse to one).
- **Experience/education** merge by a folded company/institution key; a bare company
  mention (e.g. GitHub's `company` field) **corroborates** an existing titled role rather
  than spawning a duplicate entry.

---

## 6. Confidence model (all in `src/core/confidence.ts`)

A single claim starts at **`source trust × method trust`**:

- *Source trust* — csv 0.90, ats 0.88, github 0.85, linkedin 0.80, resume 0.75, notes 0.55.
  Curated structured data outranks parsed prose outranks free text.
- *Method trust* — structured_field 1.0, api_field 0.97, labeled_field 0.85,
  regex_extraction 0.70, heuristic 0.60. *How* a value was obtained matters: a typed column
  is trusted more than a regex hit in prose.

**Corroboration uses noisy-OR:** `1 − Π(1 − cᵢ)` over the (per-source-max) confidences. Two
independent sources at 0.8 combine to 0.96 — agreement increases certainty, monotonically,
bounded in [0, 1]. This is principled (it is the probability that *at least one* independent
observation is right) and cheap.

**Overall confidence** is a coverage-weighted average of the identity-bearing fields that
are actually present (name and emails weighted highest). A sparse profile is not punished
below what it does know, but breadth still lifts the score.

All confidences are rounded to 4 dp so output is byte-stable across runs.

---

## 7. The configurable output (the "required twist")

The canonical record and the **projection** are strictly separate — projection only reads
the profile. A runtime config:

- selects a **subset** of fields;
- **remaps** from a canonical path via `from` — the resolver understands `a.b`, `arr[0]`,
  and `arr[].field` fan-out (`skills[].name` → `["JavaScript", …]`);
- applies **per-field normalization** (`E164`, `canonical`, `date`, `country`, `lower`/…);
- toggles **provenance** and **confidence**;
- chooses the missing-value policy: **`null` | `omit` | `error`**.

Then `buildOutputSchema(config)` constructs a **Zod schema from the field declarations**
and the projection is parsed through it before returning (`.strict()`, so a stray key is
caught too). A `required` field that ends up missing therefore fails validation — the
config's contract is enforced, not just hoped for. Confidence/provenance for a projected
value are looked up via the concrete leaf path the resolver reports, walking up to the
nearest stored key (so `skills[0].name` finds the confidence stored at `skills[0]`).

---

## 8. Determinism, robustness, scale

- **Determinism:** no timestamps or randomness in any output; every collection is sorted by
  a stable key using a **code-unit comparator** (`src/core/order.ts`), never
  `String.localeCompare` — whose order depends on the host's ICU locale and would otherwise
  make output differ between machines (verified byte-identical under the C, German and English
  locales). Source/method priorities are fixed; `candidate_id` is an FNV-1a hash of the
  strongest stable identifier (so the same person → the same id across runs and machines), and
  two indistinguishable name-only people fall back to a unique record id rather than colliding.
  CI regenerates `outputs/` and fails on any diff.
- **Robustness:** every adapter is internally defensive *and* wrapped by the registry, so a
  malformed source yields `[]` and never throws. The I/O layer skips unreadable files with a
  reason. Output validation is the final guard.
- **Scale:** O(n) extraction/normalization and near-linear union-find. The benchmark sustains
  ~20k records/s and resolves 50k records in ~2.4s on a laptop, asserting that 2N records
  collapse to exactly N profiles.

---

## 9. Assumptions & deliberate descopes (honest)

- **LinkedIn is not scraped** — no public API and scraping violates its ToS. LinkedIn URLs
  found in other sources are captured into `links.linkedin`; a `linkedin` source is treated
  as a user-provided export and parsed as free text.
- **GitHub uses a captured fixture** for the sample/CI run (deterministic, offline). The same
  adapter consumes a live `{user, repos}` payload unchanged.
- **No fuzzy/ML record linkage** — deterministic keys only (precision over recall; see §4).
- **Resume parsing is best-effort** and PDF-text only (no OCR of scanned images). DOCX is not
  extracted in this build (export to PDF/txt); PDF text extraction via `pdfjs-dist` (with line
  breaks reconstructed from EOL markers so sections parse) is tested end-to-end against a real
  PDF fixture in `tests/io-pdf.test.ts`. The committed `samples/` outputs use extracted résumé
  text so the default run stays deterministic and offline (no pdfjs in the determinism gate).
- **Location parsing is heuristic** (city/region/country split on commas); no geocoding.
- No official sample inputs were provided, so the fixtures under `samples/` are constructed
  to exercise every source type and edge case.

## 10. What I'd do next with more time

- Probabilistic record linkage as an optional, explainable scoring layer on top of the
  deterministic keys.
- Per-source, per-field trust overrides via config.
- DOCX extraction; OCR fallback for scanned resumes.
- Streaming/worker-based batch mode for very large datasets.
