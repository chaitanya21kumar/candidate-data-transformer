import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  normalizeName,
  nameKey,
  normalizePhone,
  normalizeMonth,
  normalizeEndDate,
  extractYear,
  normalizeCountry,
  normalizeSkill,
  normalizeUrl,
  classifyUrl,
  githubUsername,
} from '../src/core/normalize/index.js';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  ADA@Example.COM ')).toBe('ada@example.com');
  });
  it('strips mailto: and angle brackets', () => {
    expect(normalizeEmail('mailto:a@b.io')).toBe('a@b.io');
    expect(normalizeEmail('<a@b.io>')).toBe('a@b.io');
  });
  it('rejects non-emails (honestly-empty)', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('normalizeName', () => {
  it('collapses whitespace and strips wrapping punctuation', () => {
    expect(normalizeName('  Ada   Lovelace, ')).toBe('Ada Lovelace');
    expect(normalizeName('"Ada Lovelace"')).toBe('Ada Lovelace');
  });
  it('title-cases all-caps but preserves mixed-case surnames', () => {
    expect(normalizeName('ADA LOVELACE')).toBe('Ada Lovelace');
    expect(normalizeName('Ronald McDonald')).toBe('Ronald McDonald');
    expect(normalizeName("CONNOR O'BRIEN")).toBe("Connor O'Brien");
  });
  it('rejects non-names', () => {
    expect(normalizeName('a@b.com')).toBeNull();
    expect(normalizeName('http://x.com')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('12345')).toBeNull();
  });
  it('nameKey folds diacritics, case and punctuation for matching', () => {
    expect(nameKey('Renée Müller')).toBe('renee muller');
    expect(nameKey('  Ada  Lovelace, ')).toBe('ada lovelace');
    expect(nameKey('ADA LOVELACE')).toBe('ada lovelace');
  });
});

describe('normalizePhone', () => {
  it('parses international numbers to E.164', () => {
    expect(normalizePhone('+91 96507 62045')).toBe('+919650762045');
    expect(normalizePhone('00 44 20 7946 0958')).toBe('+442079460958');
  });
  it('strips a tel: scheme and ignores extensions', () => {
    expect(normalizePhone('tel:+919650762045')).toBe('+919650762045');
    expect(normalizePhone('+1 (415) 555-0150 x23', 'US')).toBe('+14155550150');
  });
  it('resolves a local number only with a country hint', () => {
    expect(normalizePhone('9650762045', 'IN')).toBe('+919650762045');
  });
  it('refuses to guess a country for a bare local number', () => {
    expect(normalizePhone('9650762045')).toBeNull();
  });
  it('returns null for garbage rather than a wrong number', () => {
    expect(normalizePhone('call me maybe')).toBeNull();
    expect(normalizePhone('+1 555')).toBeNull(); // too short to be valid
    expect(normalizePhone('')).toBeNull();
  });
});

describe('date normalization', () => {
  it('normalizes many month formats to YYYY-MM', () => {
    expect(normalizeMonth('2024-3')).toBe('2024-03');
    expect(normalizeMonth('2024-03-15')).toBe('2024-03');
    expect(normalizeMonth('March 2024')).toBe('2024-03');
    expect(normalizeMonth('mar 2024')).toBe('2024-03');
    expect(normalizeMonth('03/2024')).toBe('2024-03');
  });
  it('never invents a month from a year-only value', () => {
    expect(normalizeMonth('2021')).toBeNull();
    expect(normalizeMonth('garbage')).toBeNull();
    expect(normalizeMonth('2024-13')).toBeNull();
  });
  it('maps ongoing markers to "present"', () => {
    expect(normalizeEndDate('Present')).toBe('present');
    expect(normalizeEndDate('current')).toBe('present');
    expect(normalizeEndDate('2024-06')).toBe('2024-06');
  });
  it('extracts a plausible year', () => {
    expect(extractYear('Class of 2027')).toBe(2027);
    expect(extractYear(2025)).toBe(2025);
    expect(extractYear('no year here')).toBeNull();
    expect(extractYear('1850')).toBeNull();
  });
});

describe('normalizeCountry', () => {
  it('handles informal aliases', () => {
    expect(normalizeCountry('UK')).toBe('GB');
    expect(normalizeCountry('England')).toBe('GB');
    expect(normalizeCountry('USA')).toBe('US');
    expect(normalizeCountry('U.S.')).toBe('US');
  });
  it('handles codes and official names', () => {
    expect(normalizeCountry('in')).toBe('IN');
    expect(normalizeCountry('IND')).toBe('IN');
    expect(normalizeCountry('Germany')).toBe('DE');
  });
  it('returns null for unknown countries', () => {
    expect(normalizeCountry('Atlantis')).toBeNull();
    expect(normalizeCountry('')).toBeNull();
  });
});

describe('normalizeSkill', () => {
  it('canonicalizes known aliases', () => {
    expect(normalizeSkill('JS')).toEqual({ name: 'JavaScript', canonical: true });
    expect(normalizeSkill('node.js.')).toEqual({ name: 'Node.js', canonical: true });
    expect(normalizeSkill('  postgres ')).toEqual({ name: 'PostgreSQL', canonical: true });
    expect(normalizeSkill('k8s')).toEqual({ name: 'Kubernetes', canonical: true });
  });
  it('strips trailing version tokens', () => {
    expect(normalizeSkill('React 18')).toEqual({ name: 'React', canonical: true });
    expect(normalizeSkill('Python 3')).toEqual({ name: 'Python', canonical: true });
  });
  it('keeps unknown skills as non-canonical pass-through (never dropped/invented)', () => {
    expect(normalizeSkill('Photoshop')).toEqual({ name: 'Photoshop', canonical: false });
    expect(normalizeSkill('')).toBeNull();
  });
});

describe('url normalization', () => {
  it('canonicalizes bare and tracked URLs', () => {
    expect(normalizeUrl('github.com/ada/')).toBe('https://github.com/ada');
    expect(normalizeUrl('https://www.linkedin.com/in/ada?utm=x')).toBe(
      'https://linkedin.com/in/ada',
    );
  });
  it('classifies link kinds', () => {
    expect(classifyUrl('https://linkedin.com/in/ada')).toBe('linkedin');
    expect(classifyUrl('https://github.com/ada')).toBe('github');
    expect(classifyUrl('https://ada.github.io')).toBe('portfolio');
    expect(classifyUrl('https://twitter.com/ada')).toBe('other');
  });
  it('extracts github usernames and ignores reserved routes', () => {
    expect(githubUsername('https://github.com/Ada-Lovelace')).toBe('ada-lovelace');
    expect(githubUsername('https://github.com/orgs/acme')).toBeNull();
    expect(githubUsername('https://gitlab.com/ada')).toBeNull();
  });
  it('returns null for unparseable input', () => {
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});
