import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES, DEFAULT_LOCALE, keys, t, setLocale, getLocale, isLocale, fmtInt, normalizeLocale } from '../../src/i18n.js';

const HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

test('every locale defines the same keys (PRD 8.5)', () => {
  const base = keys(DEFAULT_LOCALE);
  for (const loc of LOCALES) {
    assert.deepEqual(keys(loc), base, `${loc} key set differs from ${DEFAULT_LOCALE}`);
  }
  assert.ok(base.length > 40, `only ${base.length} strings`);
});

test('placeholders match across locales', () => {
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const key of keys(DEFAULT_LOCALE)) {
    setLocale(DEFAULT_LOCALE);
    const reference = holes(t(key));
    for (const loc of LOCALES) {
      setLocale(loc);
      assert.equal(holes(t(key)), reference, `${loc}/${key} placeholders differ`);
    }
  }
  setLocale(DEFAULT_LOCALE);
});

test('only the English sub-labels may be empty', () => {
  for (const loc of LOCALES) {
    setLocale(loc);
    for (const key of keys(loc)) {
      const value = t(key);
      assert.equal(typeof value, 'string', `${loc}/${key}`);
      if (value === '') {
        assert.equal(loc, 'en-US', `${loc}/${key} is empty`);
        assert.ok(key.endsWith('.short'), `${loc}/${key} is empty`);
      }
    }
  }
  setLocale(DEFAULT_LOCALE);
});

test('en-US is a translation, not a copy of zh-CN', () => {
  // Identical in both languages by design: a unit symbol and the endonyms.
  const same = new Set(['hud.unit', 'lang.name.zh-CN', 'lang.name.en-US']);
  setLocale(DEFAULT_LOCALE);
  const zh = Object.fromEntries(keys(DEFAULT_LOCALE).map((k) => [k, t(k)]));
  setLocale('en-US');
  const copied = keys('en-US').filter((k) => !same.has(k) && t(k) === zh[k] && t(k) !== '');
  assert.deepEqual(copied, [], `en-US still carries the zh-CN text for: ${copied.join(', ')}`);
  setLocale(DEFAULT_LOCALE);
});

test('every key referenced by the markup exists', () => {
  const used = new Set();
  for (const m of HTML.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 20, `only ${used.size} keys wired into index.html`);
  for (const loc of LOCALES) {
    const defined = new Set(keys(loc));
    for (const key of used) assert.ok(defined.has(key), `${loc} is missing "${key}"`);
  }
});

test('t() interpolates and falls back to the key', () => {
  setLocale('zh-CN');
  assert.equal(t('a11y.hearts', { hp: 2, max: 3 }), '生命 2/3');
  setLocale('en-US');
  assert.equal(t('a11y.hearts', { hp: 1, max: 4 }), 'Health 1/4');
  assert.equal(t('a11y.hearts', { hp: 1 }), 'Health 1/{max}');
  assert.equal(t('nope.missing'), 'nope.missing');
  setLocale('zh-CN');
});

test('unknown locales are rejected', () => {
  assert.equal(isLocale('fr-FR'), false);
  assert.equal(setLocale('fr-FR'), false);
  assert.equal(getLocale(), 'zh-CN');
  assert.equal(setLocale('en-US'), true);
  assert.equal(getLocale(), 'en-US');
  setLocale('zh-CN');
});

test('short and regional language tags normalize', () => {
  assert.equal(normalizeLocale('en'), 'en-US');
  assert.equal(normalizeLocale('EN-us'), 'en-US');
  assert.equal(normalizeLocale('en-GB'), 'en-US');
  assert.equal(normalizeLocale('zh'), 'zh-CN');
  assert.equal(normalizeLocale('zh-hans'), 'zh-CN');
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('fr'), null);
  assert.equal(normalizeLocale(''), null);
  assert.equal(normalizeLocale(null), null);
});

test('dynamic keys resolve in every locale', () => {
  // These are built at runtime (template literals), so the markup scan above
  // cannot see them; a typo here would ship a raw key to the screen.
  for (const loc of LOCALES) {
    setLocale(loc);
    for (const id of ['easy', 'normal', 'hard']) {
      for (const suffix of ['', '.code', '.short']) {
        const key = `diff.${id}${suffix}`;
        assert.notEqual(t(key), key, `${loc} is missing ${key}`);
      }
    }
    for (const key of ['a11y.hearts', 'toast.diff', 'toast.lang', 'toast.milestone']) {
      assert.notEqual(t(key, { name: 'x', hp: 1, max: 2, m: 3 }), key, `${loc} is missing ${key}`);
    }
  }
  setLocale(DEFAULT_LOCALE);
});

test('numbers follow the locale', () => {
  setLocale('en-US');
  assert.equal(fmtInt(1234), '1,234');
  assert.equal(fmtInt(0), '0');
  setLocale('zh-CN');
  assert.equal(fmtInt(1234), '1,234');
  assert.equal(fmtInt('42'), '42');
  assert.equal(fmtInt(undefined), '0');
});
