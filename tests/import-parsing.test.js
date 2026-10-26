const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectHeader,
  groupWordsIntoLines,
  linesToRows,
  mapRows,
  parseTextRows,
  positionalMapping,
} = require('../lib/imports/text-parsing.js');
const {
  parseNotebookPage,
  parseQuantityToken,
  tokenMatchesDate,
} = require('../lib/imports/notebook.js');
const {
  buildFarmerIndex,
  findImportDuplicates,
  matchFarmer,
} = require('../lib/imports/farmer-matching.js');

test('pasted CSV/TSV preserves quoted values and maps recognized headers', () => {
  const rows = parseTextRows('\uFEFFName,Phone,National ID,Account,Center,Cow type\r\n"MUKAMANA, Alice",0788000000,1199000000000000,ACC-1,Kimironko,Friesian\r\nUWASE Bea,,,ACC-2,,');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'MUKAMANA, Alice');
  assert.equal(rows[1][1], '0788000000');

  const detected = detectHeader(rows);
  assert.equal(detected.hasHeader, true);
  assert.deepEqual(detected.mapping, {
    name: 0,
    phone: 1,
    nationalId: 2,
    accountNumber: 3,
    collectionCenter: 4,
    cowType: 5,
  });

  const records = mapRows(rows, detected.mapping, 1);
  assert.deepEqual(records[0], {
    name: 'MUKAMANA, Alice',
    phone: '0788000000',
    nationalId: '1199000000000000',
    accountNumber: 'ACC-1',
    collectionCenter: 'Kimironko',
    cowType: 'Friesian',
  });
  assert.equal(records[1].name, 'UWASE Bea');
  assert.equal(records[1].phone, '');

  const tabs = parseTextRows('Izina\tTelefone\nMUKAMANA Alice\t0788123456');
  assert.deepEqual(tabs, [['Izina', 'Telefone'], ['MUKAMANA Alice', '0788123456']]);
  assert.equal(positionalMapping(2).phone, 1);
});

test('plain paste and OCR lines become reviewable columns without inventing values', () => {
  assert.deepEqual(parseTextRows('MUKAMANA Alice\nUWASE Bea'), [['MUKAMANA Alice'], ['UWASE Bea']]);
  assert.deepEqual(parseTextRows('MUKAMANA Alice  0788000000   ACC-1'), [['MUKAMANA Alice', '0788000000', 'ACC-1']]);

  const lines = groupWordsIntoLines([
    { text: 'MUKAMANA', x: 10, y: 21, width: 70, height: 14, confidence: 0.96 },
    { text: 'Alice', x: 86, y: 20, width: 34, height: 14, confidence: 0.9 },
    { text: '12', x: 410, y: 22, width: 15, height: 14, confidence: 0.94 },
    { text: 'UWASE', x: 10, y: 55, width: 58, height: 14, confidence: 0.95 },
    { text: 'Bea', x: 74, y: 56, width: 30, height: 14, confidence: 0.92 },
    { text: '8.5', x: 410, y: 54, width: 24, height: 14, confidence: 0.93 },
  ]);
  assert.equal(lines.length, 2);
  const rows = linesToRows(lines);
  assert.deepEqual(rows[0], ['MUKAMANA Alice', '12']);
  assert.deepEqual(rows[1], ['UWASE Bea', '8.5']);
});

test('notebook OCR selects only the chosen date column', () => {
  const words = [
    { text: 'Izina', x: 10, y: 10, width: 45, height: 14, confidence: 0.98 },
    { text: '2026-10-24', x: 220, y: 10, width: 82, height: 14, confidence: 0.98 },
    { text: '2026-10-25', x: 320, y: 10, width: 82, height: 14, confidence: 0.98 },
    { text: '2026-10-26', x: 420, y: 10, width: 82, height: 14, confidence: 0.98 },
    { text: 'MUKAMANA', x: 10, y: 40, width: 72, height: 14, confidence: 0.97 },
    { text: 'Alice', x: 88, y: 40, width: 36, height: 14, confidence: 0.96 },
    { text: '10', x: 240, y: 40, width: 16, height: 14, confidence: 0.95 },
    { text: '12', x: 340, y: 40, width: 16, height: 14, confidence: 0.95 },
    { text: '14', x: 440, y: 40, width: 16, height: 14, confidence: 0.95 },
  ];
  const parsed = parseNotebookPage({ words, targetDate: '2026-10-25' });
  assert.equal(parsed.dateColumnFound, true);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].name, 'MUKAMANA Alice');
  assert.equal(parsed.entries[0].quantity, 12);
  assert.equal(parsed.entries[0].status, 'ok');
  assert.equal(parsed.entries[0].rowNumber, 1);

  const otherDate = parseNotebookPage({ words, targetDate: '2026-10-26' });
  assert.equal(otherDate.entries[0].quantity, 14);
});

test('notebook OCR keeps rows and flags ambiguity instead of guessing a date or quantity', () => {
  // Two quantities but no recognizable date header: neither column can be
  // selected safely, so the row must remain reviewable and ambiguous.
  const words = [
    { text: 'MUKAMANA', x: 10, y: 20, width: 72, height: 14, confidence: 0.95 },
    { text: 'Alice', x: 88, y: 20, width: 36, height: 14, confidence: 0.95 },
    { text: '12', x: 250, y: 20, width: 16, height: 14, confidence: 0.95 },
    { text: '14', x: 350, y: 20, width: 16, height: 14, confidence: 0.95 },
  ];
  const parsed = parseNotebookPage({ words, targetDate: '2026-10-25' });
  assert.equal(parsed.dateColumnFound, false);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].quantity, null);
  assert.equal(parsed.entries[0].status, 'ambiguous');

  // A data quantity that happens to equal the target day must not be mistaken
  // for a date header and must not cause the row to be dropped.
  const dayNumberWords = [
    { text: 'Izina', x: 10, y: 10, width: 45, height: 14, confidence: 0.98 },
    { text: 'MUKAMANA', x: 10, y: 40, width: 72, height: 14, confidence: 0.97 },
    { text: '25', x: 260, y: 40, width: 16, height: 14, confidence: 0.95 },
  ];
  const dayNumber = parseNotebookPage({ words: dayNumberWords, targetDate: '2026-10-25' });
  assert.equal(dayNumber.dateColumnFound, false);
  assert.equal(dayNumber.entries.length, 1);
  assert.equal(dayNumber.entries[0].quantity, 25);
  assert.equal(dayNumber.entries[0].status, 'uncertain');
});

test('notebook quantity and date parsing rejects malformed values', () => {
  assert.deepEqual(parseQuantityToken('12.5 L'), { value: 12.5, status: 'ok', raw: '12.5 L' });
  assert.deepEqual(parseQuantityToken('12,5'), { value: 12.5, status: 'ok', raw: '12,5' });
  assert.equal(parseQuantityToken('l2').status, 'unreadable');
  assert.equal(parseQuantityToken('0').status, 'unreadable');
  assert.deepEqual(parseQuantityToken(''), { value: null, status: 'empty', raw: '' });
  assert.equal(tokenMatchesDate('25/10/2026', { year: 2026, month: 10, day: 25 }), true);
  assert.equal(tokenMatchesDate('2026-10-25', { year: 2026, month: 10, day: 25 }), true);
  assert.equal(tokenMatchesDate('25/11/2026', { year: 2026, month: 10, day: 25 }), false);
});

test('farmer matching auto-selects only an unambiguous exact match', () => {
  const farmers = [
    { id: 1, name: 'MUKAMANA Alice', phone: '0788000001', nationalId: 'NID-1', accountNumber: 'ACC-1' },
    { id: 2, name: 'MUKAMANA Alice', phone: '0788000002', nationalId: 'NID-2', accountNumber: 'ACC-2' },
    { id: 3, name: 'UWASE Beatrice', phone: '0788000003', nationalId: 'NID-3', accountNumber: 'ACC-3' },
  ];
  const index = buildFarmerIndex(farmers);

  const duplicateName = matchFarmer({ name: 'MUKAMANA Alice' }, index);
  assert.equal(duplicateName.status, 'ambiguous');
  assert.equal(duplicateName.farmerId, null);
  assert.equal(duplicateName.reason, 'name-duplicate');

  const byNationalId = matchFarmer({ name: 'Unknown', nationalId: 'NID-3' }, index);
  assert.equal(byNationalId.status, 'exact');
  assert.equal(byNationalId.farmerId, 3);
  assert.equal(byNationalId.matchedField, 'nationalId');

  const byPhone = matchFarmer({ name: 'Unknown', phone: '+250 788 000 002' }, index);
  assert.equal(byPhone.status, 'exact');
  assert.equal(byPhone.farmerId, 2);
  assert.equal(byPhone.matchedField, 'phone');

  const fuzzy = matchFarmer({ name: 'UWASE Beatrize' }, index);
  assert.equal(fuzzy.status, 'possible');
  assert.equal(fuzzy.farmerId, null);
  assert.ok(fuzzy.candidates.some((farmer) => farmer.id === 3));

  assert.equal(matchFarmer({ name: '' }, index).status, 'invalid');
  assert.equal(matchFarmer({ name: 'UNRELATED NAME' }, index).status, 'none');
});

test('within-file duplicate detection covers national ID, account, phone and name', () => {
  const flags = findImportDuplicates([
    { rowNumber: 1, name: 'Alice', nationalId: 'NID-1', accountNumber: 'ACC-1', phone: '0788000001' },
    { rowNumber: 2, name: 'Bob', nationalId: 'NID-1' },
    { rowNumber: 3, name: 'Carol', accountNumber: 'ACC-1' },
    { rowNumber: 4, name: 'Diane', phone: '+250788000001' },
    { rowNumber: 5, name: 'Alice' },
    { rowNumber: 6, name: 'Eve' },
  ]);
  assert.equal(flags[1].duplicateOf, 1);
  assert.equal(flags[1].duplicateField, 'nationalId');
  assert.equal(flags[2].duplicateOf, 1);
  assert.equal(flags[2].duplicateField, 'accountNumber');
  assert.equal(flags[3].duplicateOf, 1);
  assert.equal(flags[3].duplicateField, 'phone');
  assert.equal(flags[4].nameDuplicateOf, 1);
  assert.equal(flags[5].duplicateOf, null);
  assert.equal(flags[5].nameDuplicateOf, null);
});
