/**
 * Server-only extraction for uploaded spreadsheets, CSV/text, and text PDFs.
 * Everything runs in memory; callers must never write the source bytes to disk.
 */

const MAX_ROWS = 1000;
const MAX_COLUMNS = 30;
const MAX_CELL_LENGTH = 300;
const MAX_PDF_PAGES = 30;

const cleanCell = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CELL_LENGTH);

const trimRows = (rows) => rows
  .slice(0, MAX_ROWS)
  .map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLUMNS).map(cleanCell) : []))
  .filter((row) => row.some(Boolean));

const extractSpreadsheet = (buffer) => {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
    sheetRows: MAX_ROWS + 1,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw Object.assign(new Error('The spreadsheet has no worksheets.'), { code: 'FILE_EMPTY', statusCode: 422 });
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  return {
    kind: 'table',
    rows: trimRows(rows),
    truncated: rows.length > MAX_ROWS,
    sheetName,
    sheetCount: workbook.SheetNames.length,
  };
};

const extractPdf = async (buffer) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_PDF_PAGES); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items || [])
        .filter((item) => item && typeof item.str === 'string' && item.str.trim())
        .map((item) => ({
          text: item.str,
          x: Number(item.transform?.[4]) || 0,
          y: Number(item.transform?.[5]) || 0,
          width: Number(item.width) || 0,
          height: Math.abs(Number(item.height) || Number(item.transform?.[3]) || 0),
        }));
      if (!items.length) {
        pages.push('');
        continue;
      }
      const heights = items.map((item) => item.height).filter((height) => height > 0).sort((a, b) => a - b);
      const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
      const tolerance = Math.max(2, medianHeight * 0.45);
      const lines = [];
      for (const item of items) {
        let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
        if (!line) {
          line = { y: item.y, items: [] };
          lines.push(line);
        }
        line.items.push(item);
      }
      const textLines = lines
        .sort((a, b) => b.y - a.y)
        .map((line) => {
          const sorted = line.items.sort((a, b) => a.x - b.x);
          let text = '';
          let previousEnd = null;
          for (const item of sorted) {
            if (previousEnd !== null) {
              const gap = item.x - previousEnd;
              text += gap > medianHeight * 0.9 ? '\t' : ' ';
            }
            text += item.text;
            previousEnd = item.x + item.width;
          }
          return text.trim();
        })
        .filter(Boolean);
      pages.push(textLines.join('\n'));
    }
  } finally {
    await document.destroy().catch(() => {});
  }
  const text = pages.filter(Boolean).join('\n');
  if (text.replace(/\s+/g, '').length < 10) {
    throw Object.assign(new Error('This PDF has no extractable text. Upload page photos for OCR or export the list as CSV/Excel.'), {
      code: 'PDF_NO_TEXT',
      statusCode: 422,
    });
  }
  return {
    kind: 'text',
    text,
    pages: pages.length,
    pageCount: document.numPages,
    truncated: document.numPages > pages.length,
  };
};

const detectCsvDelimiter = (text) => {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === '\n') {
      if (counts[','] > 0 || counts[';'] > 0 || counts['\t'] > 0) break;
    } else if (!quoted && (char === ',' || char === ';' || char === '\t')) {
      counts[char] += 1;
    }
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
};

const extractCsv = (buffer) => {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const delimiter = detectCsvDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return { kind: 'table', rows: trimRows(rows), truncated: rows.length > MAX_ROWS, sheetCount: 1 };
};

const invalidFileError = () => {
  const error = new Error('The file could not be read. Check that it is not damaged and try again.');
  error.code = 'FILE_INVALID';
  error.statusCode = 422;
  return error;
};

const extractFile = async ({ buffer, name, mimeType }) => {
  const lowerName = String(name || '').toLowerCase();
  const isPdf = buffer.subarray(0, 5).toString('ascii') === '%PDF-' || lowerName.endsWith('.pdf');
  const isSpreadsheet = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
    || String(mimeType || '').includes('spreadsheetml') || String(mimeType || '').includes('ms-excel');
  try {
    if (isPdf) return await extractPdf(buffer);
    if (isSpreadsheet) return extractSpreadsheet(buffer);
    if (lowerName.endsWith('.csv') || lowerName.endsWith('.txt') || String(mimeType || '').startsWith('text/')) {
      return extractCsv(buffer);
    }
    return null;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw invalidFileError();
  }
};

module.exports = {
  MAX_ROWS,
  MAX_COLUMNS,
  MAX_CELL_LENGTH,
  MAX_PDF_PAGES,
  cleanCell,
  trimRows,
  extractSpreadsheet,
  extractPdf,
  extractCsv,
  extractFile,
};
