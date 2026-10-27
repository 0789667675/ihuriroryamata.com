const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHeading,
  interpretHeading,
  interpretColumns,
  assessValueFitForColumn,
  detectColumnMisalignment,
} = require('../lib/imports/semantic-mapping.js');
const {
  defaultFieldConfig,
  resolveFieldConfig,
  enabledFields,
  requiredFields,
  assessFieldValue,
  fieldLimit,
} = require('../lib/imports/farmer-field-config.js');

const headingCases = [
  ['NO', 'farmerNumber', 'high'],
  ['No', 'farmerNumber', 'high'],
  ['nambara y\'umworozi', 'farmerNumber', 'high'],
  ['AMAZINA', 'name', 'high'],
  ['amazina y\'umworozi', 'name', 'high'],
  ['AMAZINA YOMBI', 'name', 'high'],
  ['AMAZINA YOMBI Y\'UMWOROZI', 'name', 'high'],
  ['Izina', 'name', 'high'],
  ['Full name', 'name', 'high'],
  ['INDANGAMUNTU', 'nationalId', 'high'],
  ['Nomero y\'indangamuntu', 'nationalId', 'high'],
  ['NOMERO Y\'INDANGAMUNTU', 'nationalId', 'high'],
  ['ID', 'nationalId', 'high'],
  ['Id number', 'nationalId', 'high'],
  ['NID', 'nationalId', 'high'],
  ['TELEPHONE', 'phone', 'high'],
  ['Telefone', 'phone', 'high'],
  ['TEL', 'phone', 'high'],
  ['Phone', 'phone', 'high'],
  ['Phone number', 'phone', 'high'],
  ['mobile', 'phone', 'high'],
  ['NO YA KONTI', 'accountNumber', 'high'],
  ['Numero ya konti', 'accountNumber', 'high'],
  ['NOMERO YA KONTI', 'accountNumber', 'high'],
  ['KONTI', 'accountNumber', 'high'],
  ['Account', 'accountNumber', 'high'],
  ['Account number', 'accountNumber', 'high'],
  ['acct number', 'accountNumber', 'high'],
  ['cow type', 'cowType', 'high'],
  ['Ubwoko bw\'inka', 'cowType', 'high'],
  ['Friesian', null, 'none'],
];

test('interprets Kinyarwanda and English headings semantically, not positionally', () => {
  for (const [heading, expectedField, expectedConfidence] of headingCases) {
    const result = interpretHeading(heading);
    assert.equal(result.field, expectedField, `${heading}: expected field ${expectedField}, got ${result.field}`);
    assert.equal(result.confidence, expectedConfidence, `${heading}: expected confidence ${expectedConfidence}`);
  }
});

test('normalizes case, accents, apostrophes, spaces and punctuation', () => {
  const variations = [
    'Amazina Y\'umworozi',
    'amazina  y   umworozi',
    'AMAZINA-YUMWOROZI',
    'amAZina,Y,UMWOROZI.',
  ];
  for (const variation of variations) {
    assert.equal(interpretHeading(variation).field, 'name', variation);
  }

  const idVariations = [
    "Nomero Y'Indangamuntu",
    'NOMERO  Y\'INDANGAMUNTU',
    'indangamuntu.',
  ];
  for (const variation of idVariations) {
    assert.equal(interpretHeading(variation).field, 'nationalId', variation);
  }
});

test('OCR confusions are resolved with reduced confidence instead of wrong guesses', () => {
  const idResult = interpretHeading('INDANGAMUNT0');
  assert.equal(idResult.field, null);
  assert.equal(idResult.confidence, 'none');

  const phoneResult = interpretHeading('TELEF0NE');
  assert.equal(phoneResult.field, 'phone');
  assert.equal(phoneResult.confidence, 'medium');
  assert.equal(phoneResult.ocrConfusion, true);
});

test('generic short headings stay ambiguous and are not silently guessed', () => {
  const numero = interpretHeading('numero');
  assert.equal(numero.field, null);
  assert.equal(numero.confidence, 'low');
  assert.ok(numero.ambiguous);
  assert.ok(numero.candidates.some((candidate) => candidate.field === 'phone'));
  assert.ok(numero.candidates.some((candidate) => candidate.field === 'accountNumber'));

  const unknown = interpretHeading('KUBERAMO');
  assert.equal(unknown.field, null);
  assert.equal(unknown.confidence, 'none');
  assert.equal(unknown.reasons.includes('no-semantic-match'), true);
});

test('interprets every column in document order without positional shifting', () => {
  const columns = ['NO', 'AMAZINA', 'TELEPHONE'];
  const interpreted = interpretColumns(columns);
  assert.equal(interpreted.length, 3);
  assert.equal(interpreted[0].field, 'farmerNumber');
  assert.equal(interpreted[1].field, 'name');
  assert.equal(interpreted[2].field, 'phone');

  // Missing national ID column: nothing is assigned to it, no shifting.
  const incomplete = ['NO', 'AMAZINA YOMBI Y\'UMWOROZI', 'TELEPHONE'];
  const incompleteInterpreted = interpretColumns(incomplete);
  assert.equal(incompleteInterpreted[0].field, 'farmerNumber');
  assert.equal(incompleteInterpreted[1].field, 'name');
  assert.equal(incompleteInterpreted[2].field, 'phone');
  assert.equal(incompleteInterpreted.find((c) => c.field === 'nationalId'), undefined);
});

test('excluded columns can be left unmapped without shifting other values', () => {
  const columns = ['NO', 'AMAZINA', 'TELEPHONE', 'COW TYPE', 'NO YA KONTI'];
  const interpreted = interpretColumns(columns);
  const cowType = interpreted.find((c) => c.heading === 'COW TYPE');
  assert.equal(cowType.field, 'cowType');
  // The importer presents Exclude as a target; nothing forces Cow Type into a farmer field.
  assert.ok(interpreted.some((c) => c.field === 'accountNumber'));
});

test('semantic cross-checks flag heading/value mismatches', () => {
  const nameColumn = assessValueFitForColumn('name', '0788123456');
  assert.equal(nameColumn.fit, 'suspect');
  assert.ok(nameColumn.warnings.some((w) => w.code === 'VALUE_LOOKS_NUMERIC'));

  const phoneColumn = assessValueFitForColumn('phone', 'HATEGEKIMANA Sylvestre');
  assert.equal(phoneColumn.fit, 'suspect');
  assert.ok(phoneColumn.warnings.some((w) => w.code === 'VALUE_NOT_PHONE'));

  const idColumn = assessValueFitForColumn('nationalId', 'HATEGEKIMANA');
  assert.equal(idColumn.fit, 'poor');
  assert.ok(idColumn.warnings.some((w) => w.code === 'VALUE_NOT_NATIONAL_ID'));

  const goodName = assessValueFitForColumn('name', 'HATEGEKIMANA Sylvestre');
  assert.equal(goodName.fit, 'good');
});

test('column misalignment detection flags columns whose values belong elsewhere', () => {
  const columns = [
    { index: 0, heading: 'AMAZINA', field: 'name', confidence: 'high' },
    { index: 1, heading: 'TELEPHONE', field: 'phone', confidence: 'high' },
  ];
  const rows = [
    { values: { name: '0788123456', phone: 'HATEGEKIMANA' } },
    { values: { name: '0788123457', phone: 'UMURINDA' } },
    { values: { name: '0788123458', phone: 'MUKUNZI' } },
  ];
  const flags = detectColumnMisalignment(columns, rows);
  assert.equal(flags.length, 2);
  assert.equal(flags[0].columnIndex, 0);
  assert.ok(flags[0].suspects.includes('phone'));
  assert.equal(flags[1].columnIndex, 1);
  assert.ok(flags[1].suspects.includes('name'));
});

test('national id column containing names is flagged', () => {
  const columns = [
    { index: 0, heading: 'INDANGAMUNTU', field: 'nationalId', confidence: 'high' },
  ];
  const rows = [
    { values: { nationalId: 'HATEGEKIMANA' } },
    { values: { nationalId: 'UMURINDA' } },
  ];
  const flags = detectColumnMisalignment(columns, rows);
  assert.equal(flags.length, 1);
  assert.ok(flags[0].suspects.includes('name'));
});

test('no misalignment when values match their headings', () => {
  const columns = [
    { index: 0, heading: 'AMAZINA', field: 'name', confidence: 'high' },
    { index: 1, heading: 'TELEPHONE', field: 'phone', confidence: 'high' },
  ];
  const rows = [
    { values: { name: 'HATEGEKIMANA', phone: '0788123456' } },
    { values: { name: 'UMURINDA', phone: '0788123457' } },
  ];
  assert.deepEqual(detectColumnMisalignment(columns, rows), []);
});

test('field configuration defaults match the supported farmer model', () => {
  const config = defaultFieldConfig();
  const byKey = new Map(config.map((field) => [field.key, field]));
  assert.equal(byKey.get('name').enabled, true);
  assert.equal(byKey.get('name').required, true);
  assert.equal(byKey.get('phone').required, false);
  assert.equal(byKey.get('nationalId').required, false);
  assert.equal(byKey.get('cowType').required, false);
  assert.equal(byKey.get('farmerNumber').system, true);
});

test('resolveFieldConfig applies per-owner overrides without altering system fields', () => {
  const config = resolveFieldConfig([
    { fieldKey: 'cowType', enabled: false, required: false, sortOrder: 9 },
    { fieldKey: 'phone', enabled: true, required: true, sortOrder: 1 },
  ]);
  const byKey = new Map(config.map((field) => [field.key, field]));
  assert.equal(byKey.get('cowType').enabled, false);
  assert.equal(byKey.get('phone').required, true);
  assert.equal(byKey.get('farmerNumber').enabled, true);
  assert.equal(byKey.get('farmerNumber').system, true);

  const enabled = enabledFields(config);
  assert.ok(!enabled.some((field) => field.key === 'cowType'));
  const names = enabled.map((field) => field.key);
  assert.equal(names.indexOf('phone') < names.indexOf('nationalId'), true, 'display order is honored');
});

test('requiredFields returns only enabled required fields', () => {
  const config = resolveFieldConfig([
    { fieldKey: 'name', enabled: true, required: true, sortOrder: 1 },
    { fieldKey: 'phone', enabled: false, required: true, sortOrder: 2 },
  ]);
  assert.deepEqual(requiredFields(config).map((field) => field.key), ['name']);
});

test('field length limits mirror database columns', () => {
  assert.equal(fieldLimit('name'), 255);
  assert.equal(fieldLimit('phone'), 50);
  assert.equal(fieldLimit('nationalId'), 50);
  assert.equal(fieldLimit('accountNumber'), 255);
  assert.equal(fieldLimit('cowType'), 255);
});

test('assessFieldValue validates phone, ID and account shapes', () => {
  assert.equal(assessFieldValue('phone', '+250 788 123 456').fit, 'good');
  assert.equal(assessFieldValue('phone', 'HATEGEKIMANA').fit, 'suspect');
  assert.equal(assessFieldValue('phone', '123').fit, 'poor');

  assert.equal(assessFieldValue('nationalId', '1198000000000000').fit, 'good');
  assert.equal(assessFieldValue('nationalId', 'HATEGEKIMANA').fit, 'poor');

  assert.equal(assessFieldValue('accountNumber', 'ACC-12345').fit, 'good');
  assert.equal(assessFieldValue('accountNumber', 'AB').fit, 'poor');

  const longName = assessFieldValue('name', 'A'.repeat(300));
  assert.equal(longName.fit, 'poor');
  assert.ok(longName.warnings.some((w) => w.code === 'VALUE_TOO_LONG'));
});
