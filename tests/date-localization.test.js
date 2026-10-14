const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dayName,
  formatDateLabel,
  formatMonthName,
  getMonthNames,
  getLanguageDateLocale,
} = require('../lib/i18n/date-format.js');

test('Kinyarwanda month names are explicitly localized', () => {
  const months = getMonthNames('rw');
  assert.deepEqual(months, [
    'Mutarama',
    'Gashyantare',
    'Werurwe',
    'Mata',
    'Gicurasi',
    'Kamena',
    'Nyakanga',
    'Kanama',
    'Nzeri',
    'Ukwakira',
    'Ugushyingo',
    'Ukuboza',
  ]);
  assert.equal(formatMonthName('rw', 10), 'Ukwakira');
  assert.equal(formatMonthName('rw', 12), 'Ukuboza');
});

test('English month names are explicitly localized', () => {
  const months = getMonthNames('en');
  assert.deepEqual(months.slice(0, 3), ['January', 'February', 'March']);
  assert.equal(formatMonthName('en', 5), 'May');
  assert.equal(formatMonthName('en', 12), 'December');
  assert.equal(getLanguageDateLocale('en'), 'en-GB');
});

test('localized date labels use the correct language names for weekdays and months', () => {
  const rwLabel = formatDateLabel('2026-10-15', 'rw', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const enLabel = formatDateLabel('2026-10-15', 'en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  assert.ok(rwLabel.includes('Ku wa kane'));
  assert.ok(rwLabel.includes('Ukwakira'));
  assert.ok(rwLabel.includes('2026'));

  assert.ok(enLabel.includes('Thursday'));
  assert.ok(enLabel.includes('October'));
  assert.ok(enLabel.includes('2026'));

  assert.equal(dayName(new Date('2026-10-15T00:00:00Z'), 'rw'), 'Ku wa kane');
  assert.equal(dayName(new Date('2026-10-15T00:00:00Z'), 'en'), 'Thursday');
});
