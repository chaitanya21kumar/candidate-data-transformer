/**
 * Skill canonicalization.
 *
 * A curated alias dictionary folds the many ways people write the same skill ("js",
 * "JavaScript", "ECMAScript") onto one canonical name ("JavaScript"). This is what lets
 * the same skill from a CSV, a resume, and a GitHub language list de-duplicate and
 * corroborate into a single, confidence-boosted entry.
 *
 * Unknown skills are NOT dropped (that would lose real signal) and NOT invented into
 * something they aren't — they pass through cleaned, flagged `canonical: false`, and
 * carry slightly lower confidence downstream. The dictionary is intentionally small and
 * readable; extending it is a one-line change with no code impact.
 */

/** canonical name -> aliases (all matched case-insensitively). */
const SKILL_DICTIONARY: Record<string, string[]> = {
  JavaScript: ['js', 'ecmascript', 'java script', 'java-script'],
  TypeScript: ['ts'],
  Python: ['py', 'python3', 'python 3'],
  Java: [],
  'C++': ['cpp', 'cplusplus', 'c plus plus'],
  'C#': ['csharp', 'c sharp'],
  C: ['c lang', 'c language'],
  Go: ['golang'],
  Rust: [],
  Ruby: [],
  PHP: [],
  Swift: [],
  Kotlin: [],
  Scala: [],
  SQL: [],
  Solidity: [],
  R: [],
  Bash: ['shell', 'shell scripting', 'sh'],
  HTML: ['html5'],
  CSS: ['css3'],
  Sass: ['scss'],

  React: ['reactjs', 'react.js'],
  'Next.js': ['nextjs', 'next js', 'next'],
  'Vue.js': ['vue', 'vuejs', 'vue.js'],
  Angular: ['angularjs', 'angular.js'],
  Svelte: ['sveltejs'],
  Redux: [],
  'Tailwind CSS': ['tailwind', 'tailwindcss'],
  'Node.js': ['node', 'nodejs', 'node js'],
  'Express.js': ['express', 'expressjs'],
  Django: [],
  Flask: [],
  FastAPI: ['fast api'],
  Spring: ['spring boot', 'springboot'],
  'Ruby on Rails': ['rails', 'ror'],
  '.NET': ['dotnet', 'dot net', 'asp.net', 'aspnet'],
  GraphQL: ['graph ql'],

  PostgreSQL: ['postgres', 'postgre', 'psql', 'postgresql'],
  MySQL: ['my sql'],
  MongoDB: ['mongo'],
  Redis: [],
  SQLite: [],
  Elasticsearch: ['elastic search', 'elastic'],
  Cassandra: [],
  DynamoDB: ['dynamo db', 'dynamo'],
  Firebase: ['firestore'],
  Supabase: [],

  AWS: ['amazon web services'],
  GCP: ['google cloud', 'google cloud platform'],
  Azure: ['microsoft azure'],
  Docker: [],
  Kubernetes: ['k8s', 'kube'],
  Terraform: [],
  Ansible: [],
  Jenkins: [],
  'GitHub Actions': ['gh actions'],
  'CI/CD': ['cicd', 'ci cd', 'continuous integration', 'continuous delivery'],

  'Machine Learning': ['ml'],
  'Deep Learning': ['dl'],
  NLP: ['natural language processing'],
  'Computer Vision': ['cv'],
  TensorFlow: ['tensor flow', 'tf'],
  PyTorch: ['torch'],
  'scikit-learn': ['sklearn', 'scikit learn', 'sci-kit learn'],
  Pandas: [],
  NumPy: ['numpy'],
  Keras: [],
  LangChain: ['lang chain'],

  Git: [],
  Linux: [],
  REST: ['rest api', 'restful', 'restful api'],
  gRPC: ['grpc'],
  Kafka: ['apache kafka'],
  RabbitMQ: ['rabbit mq'],
  Celery: [],
};

/** alias (folded) -> canonical name, built once from the dictionary. */
const LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(SKILL_DICTIONARY)) {
    map.set(fold(canonical), canonical);
    for (const alias of aliases) map.set(fold(alias), canonical);
  }
  return map;
})();

export interface NormalizedSkill {
  name: string;
  /** True if it matched the canonical dictionary; false for a cleaned pass-through. */
  canonical: boolean;
}

export function normalizeSkill(input: unknown): NormalizedSkill | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').trim();
  if (cleaned.length === 0) return null;

  const folded = fold(cleaned);
  const direct = LOOKUP.get(folded);
  if (direct) return { name: direct, canonical: true };

  // Retry after stripping a trailing version token ("react 18", "java 17").
  const deversioned = folded.replace(/\s+v?\d+(\.\d+)*$/, '').trim();
  if (deversioned !== folded) {
    const hit = LOOKUP.get(deversioned);
    if (hit) return { name: hit, canonical: true };
  }

  // Unknown skill: keep it, cleaned, but flag as non-canonical.
  return { name: cleaned, canonical: false };
}

/** Fold a skill string to a comparison key: lowercase, collapse spaces, trim. */
function fold(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
