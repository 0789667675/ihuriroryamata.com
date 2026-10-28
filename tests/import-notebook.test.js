const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectNotebookDateColumns,
  detectNotebookPageMonthYear,
  extractNotebookEntries,
  parseNotebookPage,
  parseDateToken,
  parseQuantityToken,
  splitFarmerNumberAndName,
  extractSublineMetadata,
  normalizeQuantityString,
  correctNumericOcrConfusion,
} = require('../lib/imports/notebook.js');
const {
  buildFarmerIndex,
  matchFarmer,
} = require('../lib/imports/farmer-matching.js');

test('detectNotebookDateColumns identifies all date columns in register table', () => {
  const words = [
    { text: 'Izina', x: 20, y: 15, width: 50, height: 16, confidence: 0.99 },
    { text: '26/10/2026', x: 200, y: 15, width: 75, height: 16, confidence: 0.98 },
    { text: '27/10/2026', x: 320, y: 15, width: 75, height: 16, confidence: 0.97 },
    { text: '28/10/2026', x: 440, y: 15, width: 75, height: 16, confidence: 0.96 },
  ];

  const columns = detectNotebookDateColumns(words, '2026-10');
  assert.equal(columns.length, 3);
  assert.deepEqual(columns.map((col) => col.isoDate), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.deepEqual(columns.map((col) => col.raw), ['26/10/2026', '27/10/2026', '28/10/2026']);
  assert.equal(columns[1].isoDate, '2026-10-27');
  assert.equal(columns[1].raw, '27/10/2026');
  assert.equal(columns[1].confidence, 0.97);
  assert.equal(columns[1].x, 320 + 75 / 2);
});

test('detectNotebookPageMonthYear extracts month and year headers', () => {
  // UKWEZI KWA 10/2026
  const words1 = [
    { text: 'UKWEZI', x: 20, y: 10, width: 60, height: 16 },
    { text: 'KWA', x: 85, y: 10, width: 40, height: 16 },
    { text: '10/2026', x: 130, y: 10, width: 60, height: 16 },
  ];
  assert.deepEqual(detectNotebookPageMonthYear(words1), { year: 2026, month: 10 });

  // October 2026
  const words2 = [
    { text: 'October', x: 20, y: 10, width: 60, height: 16 },
    { text: '2026', x: 85, y: 10, width: 40, height: 16 },
  ];
  assert.deepEqual(detectNotebookPageMonthYear(words2), { year: 2026, month: 10 });

  // Ukwakira 2026
  const words3 = [
    { text: 'Ukwakira', x: 20, y: 10, width: 70, height: 16 },
    { text: '2026', x: 95, y: 10, width: 40, height: 16 },
  ];
  assert.deepEqual(detectNotebookPageMonthYear(words3), { year: 2026, month: 10 });
});

test('detectNotebookDateColumns automatically uses page month/year for day column numbers (1..31)', () => {
  const words = [
    // Page Header
    { text: 'UKWEZI', x: 20, y: 5, width: 50, height: 14 },
    { text: 'KWA', x: 75, y: 5, width: 35, height: 14 },
    { text: '10/2026', x: 115, y: 5, width: 60, height: 14 },

    // Table Header
    { text: 'Izina', x: 20, y: 25, width: 45, height: 14 },
    { text: '26', x: 200, y: 25, width: 20, height: 14, confidence: 0.95 },
    { text: '27', x: 300, y: 25, width: 20, height: 14, confidence: 0.96 },
    { text: '28', x: 400, y: 25, width: 20, height: 14, confidence: 0.97 },
  ];

  const columns = detectNotebookDateColumns(words);
  assert.equal(columns.length, 3);
  assert.deepEqual(columns.map((c) => c.isoDate), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.deepEqual(columns.map((c) => c.raw), ['26', '27', '28']);
});

test('splitFarmerNumberAndName splits digits glued to names and separate number tokens', () => {
  // Glued number and name: '1NIYONSABA'
  const glued = splitFarmerNumberAndName({ text: '1NIYONSABA', x: 10, y: 40, width: 80, height: 14 });
  assert.equal(glued.farmerNumber, 1);
  assert.equal(glued.nameWords[0].text, 'NIYONSABA');

  // Glued number with period: '14.KAYITARE'
  const gluedPeriod = splitFarmerNumberAndName({ text: '14.KAYITARE', x: 10, y: 40, width: 90, height: 14 });
  assert.equal(gluedPeriod.farmerNumber, 14);
  assert.equal(gluedPeriod.nameWords[0].text, 'KAYITARE');

  // Glued number with hashtag: '#02MUKAMANA'
  const gluedHash = splitFarmerNumberAndName({ text: '#02MUKAMANA', x: 10, y: 40, width: 90, height: 14 });
  assert.equal(gluedHash.farmerNumber, 2);
  assert.equal(gluedHash.nameWords[0].text, 'MUKAMANA');

  // Separate number token: '1', 'NIYONSABA'
  const separate = splitFarmerNumberAndName(
    { text: '1', x: 10, y: 40, width: 15, height: 14 },
    [{ text: 'NIYONSABA', x: 30, y: 40, width: 70, height: 14 }]
  );
  assert.equal(separate.farmerNumber, 1);
  assert.equal(separate.nameWords[0].text, 'NIYONSABA');

  // Name without number: 'NIYONSABA'
  const plain = splitFarmerNumberAndName({ text: 'NIYONSABA', x: 10, y: 40, width: 70, height: 14 });
  assert.equal(plain.farmerNumber, null);
  assert.equal(plain.nameWords[0].text, 'NIYONSABA');
});

test('extractSublineMetadata captures phone, national ID, and account numbers beneath names', () => {
  // Phone
  const metaPhone = extractSublineMetadata('0788123456');
  assert.ok(metaPhone);
  assert.equal(metaPhone.phone, '0788123456');

  // National ID
  const metaNid = extractSublineMetadata('1199880012345678');
  assert.ok(metaNid);
  assert.equal(metaNid.nationalId, '1199880012345678');

  // Labeled Account Number
  const metaAcc = extractSublineMetadata('Acc: 00123-4567');
  assert.ok(metaAcc);
  assert.equal(metaAcc.accountNumber, '00123-4567');

  // Labeled ID
  const metaLabeledId = extractSublineMetadata('ID: 1199880012345678');
  assert.ok(metaLabeledId);
  assert.equal(metaLabeledId.nationalId, '1199880012345678');
});

test('sub-line metadata is attached to previous farmer entry without creating extra delivery rows', () => {
  const words = [
    // Header
    { text: 'Izina', x: 20, y: 15, width: 50, height: 16, confidence: 0.98 },
    { text: '27/10/2026', x: 250, y: 15, width: 75, height: 16, confidence: 0.98 },

    // Farmer 1 (y = 45)
    { text: '1NIYONSABA', x: 20, y: 45, width: 80, height: 14, confidence: 0.95 },
    { text: 'Jean', x: 105, y: 45, width: 35, height: 14, confidence: 0.95 },
    { text: '10', x: 280, y: 45, width: 20, height: 14, confidence: 0.96 },

    // Sub-line for Farmer 1: Phone number (y = 60, no letters or quantities)
    { text: '0788123456', x: 20, y: 60, width: 70, height: 12, confidence: 0.94 },

    // Farmer 2 (y = 80)
    { text: '2MUKAMANA', x: 20, y: 80, width: 80, height: 14, confidence: 0.95 },
    { text: 'Alice', x: 105, y: 80, width: 35, height: 14, confidence: 0.95 },
    { text: '8', x: 280, y: 80, width: 15, height: 14, confidence: 0.96 },
  ];

  const parsed = parseNotebookPage({ words, targetDate: '2026-10-27' });
  assert.equal(parsed.entries.length, 2);

  const f1 = parsed.entries[0];
  assert.equal(f1.farmerNumber, 1);
  assert.equal(f1.name, 'NIYONSABA Jean');
  assert.equal(f1.quantity, 10);
  assert.equal(f1.detectedPhone, '0788123456');

  const f2 = parsed.entries[1];
  assert.equal(f2.farmerNumber, 2);
  assert.equal(f2.name, 'MUKAMANA Alice');
  assert.equal(f2.quantity, 8);
});

test('parseQuantityToken decodes decimals, vulgar fractions, half-litre shorthand, OCR confusions, and zero markers', () => {
  // Comma decimals
  assert.deepEqual(parseQuantityToken('2,5'), { value: 2.5, status: 'ok', raw: '2,5' });
  assert.deepEqual(parseQuantityToken('12,5 L'), { value: 12.5, status: 'ok', raw: '12,5 L' });

  // Vulgar fractions
  assert.deepEqual(parseQuantityToken('2½'), { value: 2.5, status: 'ok', raw: '2½' });
  assert.deepEqual(parseQuantityToken('½'), { value: 0.5, status: 'ok', raw: '½' });
  assert.deepEqual(parseQuantityToken('1/2'), { value: 0.5, status: 'ok', raw: '1/2' });
  assert.deepEqual(parseQuantityToken('2 1/2'), { value: 2.5, status: 'ok', raw: '2 1/2' });

  // Half-litre shorthands
  assert.deepEqual(parseQuantityToken('1^'), { value: 1.5, status: 'ok', raw: '1^' });
  assert.deepEqual(parseQuantityToken("1'"), { value: 1.5, status: 'ok', raw: "1'" });
  assert.deepEqual(parseQuantityToken("2'"), { value: 2.5, status: 'ok', raw: "2'" });
  assert.deepEqual(parseQuantityToken('2^'), { value: 2.5, status: 'ok', raw: '2^' });
  assert.deepEqual(parseQuantityToken('10^'), { value: 10.5, status: 'ok', raw: '10^' });

  // OCR confusion corrections
  assert.equal(correctNumericOcrConfusion('l.5'), '1.5');
  assert.equal(correctNumericOcrConfusion('I.5'), '1.5');
  assert.equal(correctNumericOcrConfusion('Z.5'), '2.5');
  assert.equal(correctNumericOcrConfusion('1O'), '10');
  assert.equal(correctNumericOcrConfusion('1S'), '15');
  assert.equal(correctNumericOcrConfusion('1B'), '18');

  // Missed / Zero-delivery markers
  assert.deepEqual(parseQuantityToken('-'), { value: 0, status: 'ok', raw: '-', isZeroMarker: true });
  assert.deepEqual(parseQuantityToken('—'), { value: 0, status: 'ok', raw: '—', isZeroMarker: true });
  assert.deepEqual(parseQuantityToken('X'), { value: 0, status: 'ok', raw: 'X', isZeroMarker: true });
  assert.deepEqual(parseQuantityToken('x'), { value: 0, status: 'ok', raw: 'x', isZeroMarker: true });

  // Row subtotals / Totals at end of row
  assert.equal(parseQuantityToken('= 30').status, 'subtotal');
  assert.equal(parseQuantityToken(') 63').status, 'subtotal');
  assert.equal(parseQuantityToken('Tot: 30').status, 'subtotal');
  assert.equal(parseQuantityToken('Total 45').status, 'subtotal');
});

test('dual-session stacked numbers or slash cells separate morning and evening', () => {
  // Cell with slash: '3/2'
  const morning = parseQuantityToken('3/2', 'morning');
  assert.equal(morning.value, 3);
  assert.equal(morning.morningValue, 3);
  assert.equal(morning.eveningValue, 2);

  const evening = parseQuantityToken('3/2', 'evening');
  assert.equal(evening.value, 2);

  const total = parseQuantityToken('3/2');
  assert.equal(total.value, 5);

  // Vertically stacked dual sessions under same column
  const words = [
    { text: 'Izina', x: 20, y: 15, width: 50, height: 16, confidence: 0.98 },
    { text: '27/10/2026', x: 250, y: 15, width: 75, height: 16, confidence: 0.98 },

    // Farmer 1 with morning (y = 40) and evening (y = 52)
    { text: '1NIYONSABA', x: 20, y: 45, width: 80, height: 14, confidence: 0.95 },
    { text: '4', x: 280, y: 40, width: 15, height: 10, confidence: 0.95 },
    { text: '3', x: 280, y: 52, width: 15, height: 10, confidence: 0.95 },
  ];

  const morningParsed = parseNotebookPage({ words, targetDate: '2026-10-27', session: 'morning' });
  assert.equal(morningParsed.entries[0].quantity, 4);

  const eveningParsed = parseNotebookPage({ words, targetDate: '2026-10-27', session: 'evening' });
  assert.equal(eveningParsed.entries[0].quantity, 3);
});

test('multi-column register extracts 10 L for Farmer A and 9 L for Farmer B when 27/10/2026 is selected', () => {
  const words = [
    // Header Line (y = 15)
    { text: 'Izina ry Umworozi', x: 20, y: 15, width: 120, height: 16, confidence: 0.98 },
    { text: '26/10/2026', x: 200, y: 15, width: 70, height: 16, confidence: 0.97 },
    { text: '27/10/2026', x: 320, y: 15, width: 70, height: 16, confidence: 0.98 },
    { text: '28/10/2026', x: 440, y: 15, width: 70, height: 16, confidence: 0.97 },

    // Row 1: Farmer A (MUKAMANA Alice) (y = 45)
    { text: '1', x: 10, y: 45, width: 10, height: 14, confidence: 0.99 },
    { text: 'MUKAMANA', x: 25, y: 45, width: 65, height: 14, confidence: 0.96 },
    { text: 'Alice', x: 95, y: 45, width: 35, height: 14, confidence: 0.95 },
    { text: '8', x: 230, y: 45, width: 15, height: 14, confidence: 0.94 },
    { text: '10', x: 350, y: 45, width: 15, height: 14, confidence: 0.95 },
    { text: '12', x: 470, y: 45, width: 15, height: 14, confidence: 0.94 },

    // Row 2: Farmer B (UWASE Beatrice) (y = 75)
    { text: '2', x: 10, y: 75, width: 10, height: 14, confidence: 0.99 },
    { text: 'UWASE', x: 25, y: 75, width: 55, height: 14, confidence: 0.96 },
    { text: 'Beatrice', x: 85, y: 75, width: 50, height: 14, confidence: 0.95 },
    { text: '7', x: 230, y: 75, width: 15, height: 14, confidence: 0.93 },
    { text: '9', x: 350, y: 75, width: 15, height: 14, confidence: 0.95 },
    { text: '11', x: 470, y: 75, width: 15, height: 14, confidence: 0.94 },
  ];

  const result = extractNotebookEntries(words, '27/10/2026');

  assert.equal(result.dateColumnFound, true);
  assert.equal(result.businessDate, '2026-10-27');
  assert.equal(result.length, 2);

  const farmerA = result[0];
  assert.equal(farmerA.name, 'MUKAMANA Alice');
  assert.equal(farmerA.quantity, 10);
  assert.equal(farmerA.status, 'ok');
  assert.equal(farmerA.businessDate, '2026-10-27');

  const farmerB = result[1];
  assert.equal(farmerB.name, 'UWASE Beatrice');
  assert.equal(farmerB.quantity, 9);
  assert.equal(farmerB.status, 'ok');
  assert.equal(farmerB.businessDate, '2026-10-27');

  const col26 = extractNotebookEntries(words, '2026-10-26');
  assert.equal(col26.businessDate, '2026-10-26');
  assert.equal(col26[0].quantity, 8);
  assert.equal(col26[1].quantity, 7);

  const col28 = extractNotebookEntries(words, '2026-10-28');
  assert.equal(col28.businessDate, '2026-10-28');
  assert.equal(col28[0].quantity, 12);
  assert.equal(col28[1].quantity, 11);
});

test('never silently guesses a date column when date header cannot be reliably established', () => {
  const words = [
    { text: 'MUKAMANA Alice', x: 20, y: 40, width: 100, height: 14, confidence: 0.95 },
    { text: '10', x: 250, y: 40, width: 15, height: 14, confidence: 0.95 },
    { text: '12', x: 350, y: 40, width: 15, height: 14, confidence: 0.95 },
  ];

  const columns = detectNotebookDateColumns(words);
  assert.equal(columns.length, 0);

  const result = extractNotebookEntries(words, '2026-10-27');
  assert.equal(result.dateColumnFound, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'ambiguous');
  assert.equal(result[0].quantity, null);
  assert.equal(result[0].dateRequiresConfirmation, true);
});

test('uncertain quantities and unmatched farmers require confirmation before committing', () => {
  const farmers = [
    { id: 1, name: 'MUKAMANA Alice', phone: '0788000001' },
    { id: 2, name: 'UWASE Beatrice', phone: '0788000002' },
  ];
  const index = buildFarmerIndex(farmers);

  const exact = matchFarmer({ name: 'MUKAMANA Alice' }, index);
  assert.equal(exact.status, 'exact');
  assert.equal(exact.farmerId, 1);

  const unknown = matchFarmer({ name: 'KAGABO Jean' }, index);
  assert.equal(unknown.status, 'none');
  assert.equal(unknown.farmerId, null);

  const words = [
    { text: 'Izina', x: 20, y: 15, width: 45, height: 16, confidence: 0.98 },
    { text: '27/10/2026', x: 250, y: 15, width: 75, height: 16, confidence: 0.98 },
    { text: 'MUKAMANA Alice', x: 20, y: 45, width: 100, height: 14, confidence: 0.95 },
    { text: '7? L', x: 280, y: 45, width: 25, height: 14, confidence: 0.5 },
  ];

  const parsed = parseNotebookPage({ words, targetDate: '2026-10-27' });
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].status, 'unreadable');
  assert.equal(parsed.entries[0].quantity, null);
  assert.equal(parsed.entries[0].quantityRaw, '7?');
});

test('parseDateToken formats diverse date representations to ISO business dates', () => {
  assert.deepEqual(parseDateToken('26/10/2026'), { year: 2026, month: 10, day: 26, isoDate: '2026-10-26' });
  assert.deepEqual(parseDateToken('27-10-2026'), { year: 2026, month: 10, day: 27, isoDate: '2026-10-27' });
  assert.deepEqual(parseDateToken('2026-10-28'), { year: 2026, month: 10, day: 28, isoDate: '2026-10-28' });
  assert.deepEqual(parseDateToken('29/10', '2026-10'), { year: 2026, month: 10, day: 29, isoDate: '2026-10-29' });
  assert.deepEqual(parseDateToken('30', '2026-10'), { year: 2026, month: 10, day: 30, isoDate: '2026-10-30' });
  assert.equal(parseDateToken('not-a-date'), null);
});
