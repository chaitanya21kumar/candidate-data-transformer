/** Barrel for the pure, deterministic normalizers. */
export { normalizeEmail } from './email.js';
export { normalizeName, nameKey } from './name.js';
export { normalizeUrl, classifyUrl, githubUsername } from './url.js';
export type { LinkKind } from './url.js';
export { normalizePhone } from './phone.js';
export { normalizeMonth, normalizeEndDate, extractYear } from './date.js';
export { normalizeCountry } from './country.js';
export { normalizeSkill } from './skills.js';
export type { NormalizedSkill } from './skills.js';
