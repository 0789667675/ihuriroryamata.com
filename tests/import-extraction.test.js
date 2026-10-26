const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');

const {
  MAX_ROWS,
  extractCsv,
  extractFile,
  extractSpreadsheet,
} = require('../lib/imports/server-extraction.js');

const buildWorkbook = (rows, extraSheet = null) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Farmers');
  if (extraSheet) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(extraSheet), 'Extra');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const buildPdf = () => new Promise((resolve, reject) => {
  const document = new PDFDocument({ size: 'A4' });
  const chunks = [];
  document.on('data', (chunk) => chunks.push(chunk));
  document.on('error', reject);
  document.on('end', () => resolve(Buffer.concat(chunks)));
  document.fontSize(12);
  document.text('Name', 50, 50);
  document.text('Morning', 200, 50);
  document.text('Evening', 300, 50);
  document.text('MUKAMANA Alice', 50, 75);
  document.text('5.5', 200, 75);
  document.text('3.5', 300, 75);
  document.end();
});

test('spreadsheet extraction reads the first sheet and reports truncation metadata', () => {
  const result = extractSpreadsheet(buildWorkbook([
    ['Name', 'Phone', 'Center'],
    ['MUKAMANA Alice', '0788000001', 'Kimironko'],
    ['UWASE Bea', '', ''],
  ], [['Should not be read']]));

  assert.equal(result.kind, 'table');
  assert.equal(result.sheetName, 'Farmers');
  assert.equal(result.sheetCount, 2);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows, [
    ['Name', 'Phone', 'Center'],
    ['MUKAMANA Alice', '0788000001', 'Kimironko'],
    ['UWASE Bea', '', ''],
  ]);

  const oversized = [[`Farmer ${0}`, '0788000000']];
  for (let index = 1; index <= MAX_ROWS; index += 1) oversized.push([`Farmer ${index}`, '0788000000']);
  const large = extractSpreadsheet(buildWorkbook(oversized));
  assert.equal(large.truncated, true);
  assert.equal(large.rows.length, MAX_ROWS);
});

test('CSV extraction handles quoted commas, escaped quotes, blank lines and truncation flags', () => {
  const csv = '\uFEFFName,Phone,Center\r\n"MUKAMANA, Alice",0788000001,Kimironko\r\n"UWASE ""Bea""",,\r\n\r\n';
  const result = extractCsv(Buffer.from(csv, 'utf8'));
  assert.equal(result.kind, 'table');
  assert.equal(result.sheetCount, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.rows, [
    ['Name', 'Phone', 'Center'],
    ['MUKAMANA, Alice', '0788000001', 'Kimironko'],
    ['UWASE "Bea"', '', ''],
  ]);
});

test('PDF extraction reads positioned text lines and reports page metadata', async () => {
  const buffer = await buildPdf();
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  const result = await extractFile({ buffer, name: 'farmers.pdf', mimeType: 'application/pdf' });
  assert.equal(result.kind, 'text');
  assert.equal(result.pageCount, 1);
  assert.equal(result.truncated, false);
  assert.match(result.text, /MUKAMANA Alice/);
  assert.match(result.text, /5\.5/);
  assert.match(result.text, /3\.5/);
});

test('unsupported and damaged files return controlled errors', async () => {
  assert.equal(await extractFile({ buffer: Buffer.from('hello'), name: 'list.bin', mimeType: 'application/octet-stream' }), null);
  await assert.rejects(
    () => extractFile({ buffer: Buffer.from('PK\u0003\u0004garbage'), name: 'farmers.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    (error) => error.code === 'FILE_INVALID' && error.statusCode === 422
  );
});
