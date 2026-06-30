import { extractAll, mergeToProfiles, project, parseConfig } from './engine.js';

// --- Sample inputs (same fixtures the CLI ships under samples/ada) ---
const SAMPLES = {
  csv:
    'Name,Email,Mobile Number,Current Company,Title,Location,Skills,LinkedIn,Years of Experience\n' +
    '"Lovelace, Ada",Ada@AnalyticalEngine.io,ext. 4421,Analytical Engines Ltd,Principal Engineer,"London, United Kingdom","JS; PostgreSQL; k8s; Distributed Systems",linkedin.com/in/adalovelace,12',
  ats: JSON.stringify(
    {
      applicant: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        primary_email: 'ada@analyticalengine.io',
        alternate_emails: ['ada.lovelace@gmail.com'],
        mobile: '0044 20 7946 0958',
        current_title: 'Principal Software Engineer',
        current_employer: 'Analytical Engines',
        location: { city: 'London', country: 'UK' },
        tags: ['JavaScript', 'TypeScript', 'PostgreSQL', 'Kubernetes', 'Distributed Systems'],
        social_links: { github: 'https://github.com/adalovelace', linkedin: 'https://www.linkedin.com/in/adalovelace' },
        work_history: [
          { org: 'Analytical Engines Ltd', role: 'Principal Engineer', from: '2019-03', to: 'present', notes: 'Leads the distributed compute team.' },
          { org: 'Babbage Systems', role: 'Senior Engineer', from: 'March 2014', to: 'Feb 2019' },
        ],
        schools: [{ name: 'University of London', qualification: 'BSc', major: 'Mathematics', graduated: 2010 }],
      },
    },
    null,
    2,
  ),
  github: JSON.stringify(
    {
      user: {
        login: 'adalovelace',
        name: 'Ada Lovelace',
        bio: 'Principal engineer. Distributed systems & numerical computing.',
        company: '@AnalyticalEngines',
        blog: 'https://ada.dev',
        location: 'London, UK',
        html_url: 'https://github.com/adalovelace',
        twitter_username: 'ada_codes',
      },
      repos: [
        { name: 'analytical-engine', languages: { 'C++': 90000, Python: 24000 }, fork: false },
        { name: 'weaving', language: 'TypeScript', fork: false },
        { name: 'forked', language: 'Go', fork: true },
      ],
    },
    null,
    2,
  ),
  notes:
    'Recruiter screen — strong systems background.\n' +
    'Email: ada.lovelace@gmail.com\n' +
    'Phone: +44 20 7946 0958\n' +
    'Currently Principal Engineer at Analytical Engines.\n' +
    'Skills: Python, mentoring, distributed systems\n' +
    'Portfolio: https://ada.dev\n' +
    '12 years experience. Open to relocation.',
};

// --- Output config presets ---
const PRESETS = {
  'Default schema (no projection)': null,
  'Recruiter card (remap + normalize + confidence)': {
    fields: [
      { path: 'full_name', type: 'string', required: true },
      { path: 'primary_email', from: 'emails[0]', type: 'string', required: true },
      { path: 'phone', from: 'phones[0]', type: 'string', normalize: 'E164' },
      { path: 'country', from: 'location.country', type: 'string', normalize: 'country' },
      { path: 'skills', from: 'skills[].name', type: 'string[]', normalize: 'canonical' },
    ],
    include_confidence: true,
    on_missing: 'null',
  },
  'ATS sync (provenance on, omit missing)': {
    fields: [
      { path: 'candidate_id', type: 'string', required: true },
      { path: 'name', from: 'full_name', type: 'string', required: true },
      { path: 'emails', type: 'string[]' },
      { path: 'github', from: 'links.github', type: 'string' },
      { path: 'current_role', from: 'experience[0].title', type: 'string' },
      { path: 'current_company', from: 'experience[0].company', type: 'string' },
    ],
    include_provenance: true,
    on_missing: 'omit',
  },
  'Contact minimal': {
    fields: [
      { path: 'name', from: 'full_name', type: 'string', required: true },
      { path: 'email', from: 'emails[0]', type: 'string' },
      { path: 'phone', from: 'phones[0]', type: 'string' },
    ],
    on_missing: 'null',
  },
};

const $ = (id) => document.getElementById(id);

function init() {
  $('csv').value = SAMPLES.csv;
  $('ats').value = SAMPLES.ats;
  $('github').value = SAMPLES.github;
  $('notes').value = SAMPLES.notes;

  const preset = $('preset');
  for (const name of Object.keys(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    preset.appendChild(opt);
  }
  preset.value = 'Recruiter card (remap + normalize + confidence)';
  loadPresetIntoConfig();

  preset.addEventListener('change', () => {
    loadPresetIntoConfig();
    run();
  });
  $('run').addEventListener('click', run);
  run();
}

function loadPresetIntoConfig() {
  const cfg = PRESETS[$('preset').value];
  $('config').value = cfg ? JSON.stringify(cfg, null, 2) : '';
}

function gatherSources() {
  const map = [
    ['csv', 'csv', 'recruiter.csv'],
    ['ats', 'ats_json', 'ats.json'],
    ['github', 'github', 'github.json'],
    ['notes', 'notes', 'notes.txt'],
  ];
  const sources = [];
  for (const [id, type, name] of map) {
    const content = $(id).value.trim();
    if (content) sources.push({ type, name, content });
  }
  return sources;
}

function run() {
  const status = $('status');
  try {
    const sources = gatherSources();
    const resolved = mergeToProfiles(extractAll(sources));
    const canonical = resolved.map((r) => r.profile);
    $('canonical').innerHTML = highlight(canonical.length === 1 ? canonical[0] : canonical);

    const configText = $('config').value.trim();
    if (configText) {
      const config = parseConfig(JSON.parse(configText));
      const projected = resolved.map((r) => project(r, config));
      $('projected').innerHTML = highlight(projected.length === 1 ? projected[0] : projected);
      $('proj-hint').textContent = `reshaped & validated against the config's schema (${config.fields.length} fields)`;
      renderConfidence(projected[0]);
    } else {
      $('projected').innerHTML = `<span class="null">— no projection — the default schema is shown on the left —</span>`;
      $('proj-hint').textContent = 'pick a preset or write a config to reshape the output';
      renderConfidence(null);
    }

    const notes = [...new Set(resolved.flatMap((r) => r.notes))];
    $('diagnostics').innerHTML = notes.length
      ? `<div class="d">diagnostics (${notes.length}) — honestly-empty, not hidden:</div>` +
        notes.map((n) => `<div class="d">• ${escapeHtml(n)}</div>`).join('')
      : '';

    status.textContent = `✓ ${sources.length} source(s) → ${resolved.length} profile(s)`;
    status.className = 'status ok';
  } catch (err) {
    $('projected').innerHTML = `<span class="err">${escapeHtml(String(err && err.message ? err.message : err))}</span>`;
    status.textContent = '✗ ' + (err && err.message ? err.message : 'error');
    status.className = 'status err';
    renderConfidence(null);
  }
}

// --- confidence bar visualization ---
function renderConfidence(record) {
  const panel = $('confidence-panel');
  const bars = $('confidence-bars');
  const conf = record && typeof record.confidence === 'object' && record.confidence !== null ? record.confidence : null;
  if (!conf) {
    panel.hidden = true;
    bars.innerHTML = '';
    return;
  }
  const rows = [];
  const add = (label, value, isOverall) => {
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    rows.push(
      `<div class="label ${isOverall ? 'overall' : ''}">${escapeHtml(label)}</div>` +
        `<div class="track"><div class="fill ${isOverall ? 'overall' : ''}" style="width:${pct}%"></div></div>` +
        `<div class="val">${value.toFixed(3)}</div>`,
    );
  };
  for (const [k, v] of Object.entries(conf)) {
    if (typeof v === 'number') add(k, v, false);
    else if (Array.isArray(v) && v.length) add(`${k} (avg of ${v.length})`, v.reduce((a, b) => a + b, 0) / v.length, false);
  }
  if (typeof record.overall_confidence === 'number') add('overall_confidence', record.overall_confidence, true);
  bars.innerHTML = rows.join('');
  panel.hidden = false;
}

// --- tiny JSON syntax highlighter ---
function highlight(obj) {
  const json = JSON.stringify(obj, null, 2);
  return escapeHtml(json).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'num';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'key' : 'str';
      else if (/true|false/.test(match)) cls = 'bool';
      else if (/null/.test(match)) cls = 'null';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

init();
