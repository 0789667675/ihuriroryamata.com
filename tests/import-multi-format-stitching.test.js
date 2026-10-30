const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const {
  SUMMARY_ROW_PATTERN,
  isSummaryRow,
  extractSummaryChecksum,
  stripSummaryRows,
  headerField,
} = require('../lib/imports/text-parsing.js');

const {
  interpretColumns,
} = require('../lib/imports/semantic-mapping.js');

const {
  extractSpreadsheet,
  extractCsv,
} = require('../lib/imports/server-extraction.js');

const {
  stitchNotebookMultiDay,
  stitchNotebookPages,
} = require('../lib/imports/notebook.js');

const { normalizeFarmerInput } = require('../lib/services/farmer-service.js');

test('summary row detection identifies TOTAL, IGITERANYO, SUBTOTAL, SOUS-TOTAL, SUM, YOSE HAMWE', () => {
  assert.equal(SUMMARY_ROW_PATTERN.test('TOTAL'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('TOTAL YOSE'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('IGITERANYO'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('IGITERANYO CYOSE'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('SUBTOTAL'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('SOUS-TOTAL'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('SOUS TOTAL'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('SUM'), true);
  assert.equal(SUMMARY_ROW_PATTERN.test('YOSE HAMWE'), true);

  // Normal farmer names must not trigger summary pattern
  assert.equal(SUMMARY_ROW_PATTERN.test('MUKAMANA Alice'), false);
  assert.equal(SUMMARY_ROW_PATTERN.test('HABIMANA Jean'), false);
  assert.equal(SUMMARY_ROW_PATTERN.test('KAGABO Emmanuel'), false);
});

test('stripSummaryRows detects bottom summary row, strips it, and extracts checksum', () => {
  const table = [
    ['No.', 'Amazina', 'Litiro', 'Amafaranga'],
    ['1', 'MUKAMANA Alice', '25.5', '10200'],
    ['2', 'HABIMANA Jean', '30.0', '12000'],
    ['', 'IGITERANYO CYOSE', '55.5', '22200'],
  ];

  const { rows, strippedRows, checksum } = stripSummaryRows(table, table[0]);
  assert.equal(rows.length, 3);
  assert.equal(strippedRows.length, 1);
  assert.equal(rows[1][1], 'MUKAMANA Alice');
  assert.equal(rows[2][1], 'HABIMANA Jean');
  assert.ok(checksum);
  assert.equal(checksum.checksumLiters, 55.5);
  assert.equal(checksum.checksumGross, 22200);
});

test('server extraction auto-strips summary rows and extracts checksum from XLSX and CSV', async () => {
  const rows = [
    ['No.', 'Amazina', 'Telefone', 'Litiro'],
    ['1', 'MUKAMANA Alice', '0788111222', '50.0'],
    ['2', 'HABIMANA Jean', '0788333444', '75.0'],
    ['', 'TOTAL', '', '125.0'],
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const sheetResult = await extractSpreadsheet(buffer, 'test.xlsx');
  assert.equal(sheetResult.rows.length, 3); // Header + 2 farmers (TOTAL stripped)
  assert.equal(sheetResult.checksum.checksumLiters, 125);

  const csvContent = 'No.,Amazina,Telefone,Litiro\n1,MUKAMANA Alice,0788111222,50.0\n2,HABIMANA Jean,0788333444,75.0\n,IGITERANYO,,125.0';
  const csvResult = await extractCsv(Buffer.from(csvContent, 'utf-8'), 'test.csv');
  assert.equal(csvResult.rows.length, 3);
  assert.equal(csvResult.checksum.checksumLiters, 125);
});

test('semantic mapping correctly recognizes printed Gicumbi SACCO sheet columns', () => {
  const headers = [
    'No.',
    'Amazina',
    'Indangamuntu',
    'Telefone',
    'Nimero ya Konti',
    'Litiro',
    'Asigaye',
  ];

  const interpreted = interpretColumns(headers);
  const map = {};
  interpreted.forEach((col) => {
    map[col.heading] = col.field;
  });

  assert.equal(map['No.'], 'farmerNumber');
  assert.equal(map['Amazina'], 'name');
  assert.equal(map['Indangamuntu'], 'nationalId');
  assert.equal(map['Telefone'], 'phone');
  assert.equal(map['Nimero ya Konti'], 'accountNumber');
  assert.equal(map['Litiro'], 'volume');
  assert.equal(map['Asigaye'], 'netPayable');
});

test('multi-photo left/right page stitching aligns by #farmerNumber and name, merging daily columns', () => {
  // Left page: Days 2026-10-01 to 2026-10-02
  const leftPage = Object.assign([
    {
      rowNumber: 1,
      farmerNumber: 1,
      detectedName: 'MUKAMANA Alice',
      nameRaw: '#001 MUKAMANA Alice',
      sublineMetadata: { phone: '0788111222', nationalId: null, accountNumber: null },
      dailyVolumes: {
        '2026-10-01': { morning: 10, evening: 5, total: 15, raw: '10/5', status: 'ok' },
        '2026-10-02': { morning: 12, evening: 6, total: 18, raw: '12/6', status: 'ok' },
      },
      totalPeriodLiters: 33,
    },
    {
      rowNumber: 2,
      farmerNumber: 2,
      detectedName: 'HABIMANA Jean',
      nameRaw: '#002 HABIMANA Jean',
      sublineMetadata: { phone: null, nationalId: null, accountNumber: null },
      dailyVolumes: {
        '2026-10-01': { morning: 8, evening: 4, total: 12, raw: '8/4', status: 'ok' },
        '2026-10-02': { morning: 9, evening: 5, total: 14, raw: '9/5', status: 'ok' },
      },
      totalPeriodLiters: 26,
    },
  ], {
    multiDay: true,
    dates: ['2026-10-01', '2026-10-02'],
    columns: [
      { isoDate: '2026-10-01', raw: '1', x: 200, confidence: 0.95 },
      { isoDate: '2026-10-02', raw: '2', x: 280, confidence: 0.95 },
    ],
    checksum: { checksumLiters: 59 },
  });

  // Right page: Days 2026-10-16 to 2026-10-17
  const rightPage = Object.assign([
    {
      rowNumber: 1,
      farmerNumber: 1,
      detectedName: 'MUKAMANA Alice',
      nameRaw: '#001 MUKAMANA Alice',
      sublineMetadata: { phone: '0788111222', nationalId: null, accountNumber: null },
      dailyVolumes: {
        '2026-10-16': { morning: 15, evening: 8, total: 23, raw: '15/8', status: 'ok' },
        '2026-10-17': { morning: 14, evening: 7, total: 21, raw: '14/7', status: 'ok' },
      },
      totalPeriodLiters: 44,
    },
    {
      rowNumber: 2,
      farmerNumber: 2,
      detectedName: 'HABIMANA Jean',
      nameRaw: '#002 HABIMANA Jean',
      sublineMetadata: { phone: null, nationalId: null, accountNumber: null },
      dailyVolumes: {
        '2026-10-16': { morning: 10, evening: 6, total: 16, raw: '10/6', status: 'ok' },
        '2026-10-17': { morning: 11, evening: 5, total: 16, raw: '11/5', status: 'ok' },
      },
      totalPeriodLiters: 32,
    },
    {
      rowNumber: 3,
      farmerNumber: null,
      detectedName: 'IGITERANYO CYOSE',
      nameRaw: 'IGITERANYO CYOSE',
      sublineMetadata: { phone: null, nationalId: null, accountNumber: null },
      dailyVolumes: {
        '2026-10-16': { morning: 25, evening: 14, total: 39, raw: '25/14', status: 'ok' },
        '2026-10-17': { morning: 25, evening: 12, total: 37, raw: '25/12', status: 'ok' },
      },
      totalPeriodLiters: 76,
    },
  ], {
    multiDay: true,
    dates: ['2026-10-16', '2026-10-17'],
    columns: [
      { isoDate: '2026-10-16', raw: '16', x: 200, confidence: 0.95 },
      { isoDate: '2026-10-17', raw: '17', x: 280, confidence: 0.95 },
    ],
    checksum: { checksumLiters: 76 },
  });

  const stitched = stitchNotebookMultiDay(leftPage, rightPage);

  // Stitched dates should include both left and right dates sorted
  assert.deepEqual(stitched.dates, ['2026-10-01', '2026-10-02', '2026-10-16', '2026-10-17']);

  // Summary row 'IGITERANYO CYOSE' must be excluded from farmer rows
  assert.equal(stitched.length, 2);

  // Farmer 1 (Alice) must have all 4 daily quantities merged
  const alice = stitched.find((r) => r.farmerNumber === 1);
  assert.ok(alice);
  assert.equal(alice.detectedName, 'MUKAMANA Alice');
  assert.equal(alice.dailyVolumes['2026-10-01'].morning, 10);
  assert.equal(alice.dailyVolumes['2026-10-02'].morning, 12);
  assert.equal(alice.dailyVolumes['2026-10-16'].morning, 15);
  assert.equal(alice.dailyVolumes['2026-10-17'].morning, 14);
  assert.equal(alice.totalPeriodLiters, 33 + 44);

  // Farmer 2 (Jean) must have all 4 daily quantities merged
  const jean = stitched.find((r) => r.farmerNumber === 2);
  assert.ok(jean);
  assert.equal(jean.detectedName, 'HABIMANA Jean');
  assert.equal(jean.dailyVolumes['2026-10-01'].morning, 8);
  assert.equal(jean.dailyVolumes['2026-10-17'].evening, 5);
  assert.equal(jean.totalPeriodLiters, 26 + 32);

  // Checksum should be preserved
  assert.ok(stitched.checksum);
});

test('normalizeFarmerInput supports farmerNumber without breaking defaults', () => {
  const withNumber = normalizeFarmerInput({
    name: 'MUKAMANA Alice',
    farmerNumber: '42',
    collectionCenter: 'Gicumbi',
  });
  assert.equal(withNumber.farmerNumber, 42);

  const withoutNumber = normalizeFarmerInput({
    name: 'HABIMANA Jean',
    collectionCenter: 'Gicumbi',
  });
  assert.equal(withoutNumber.farmerNumber, undefined);

  const withExplicitNull = normalizeFarmerInput({
    name: 'HABIMANA Jean',
    farmerNumber: null,
    collectionCenter: 'Gicumbi',
  });
  assert.equal(withExplicitNull.farmerNumber, null);
});
