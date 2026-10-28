/**
 * Pure helpers for the Multi-Day OCR register review matrix.
 *
 * Business dates are always the physical register column dates; nothing here
 * ever substitutes the scan date. Cells that carry no litres (blank, '-', 'X')
 * are skipped because the milk pipeline rejects zero-litre records.
 */

const NEEDS_CONFIRMATION = new Set(['uncertain', 'ambiguous', 'unreadable']);

const parseLitres = (value) => {
  const text = String(value ?? '').replace(',', '.').trim();
  if (!text) return { value: 0, present: false, invalid: false };
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(text)) return { value: 0, present: true, invalid: true };
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) return { value: 0, present: true, invalid: true };
  return { value: parsed, present: true, invalid: false };
};

const round2 = (value) => Math.round(value * 100) / 100;

const toCellText = (value) => (value === null || value === undefined || Number(value) === 0 ? '' : String(value));

/**
 * Converts one extractNotebookMultiDay row into an editable draft whose cells
 * are keyed by register ISO date.
 */
const buildMultiDayDraftDays = (extractedRow, dates) => {
  const days = {};
  for (const date of dates) {
    const cell = extractedRow.dailyVolumes?.[date];
    const status = cell?.status || 'unreadable';
    const hasTotal = cell && cell.total !== null && cell.total !== undefined;
    days[date] = {
      morning: hasTotal ? toCellText(cell.morning) : '',
      evening: hasTotal ? toCellText(cell.evening) : '',
      raw: cell?.raw || '',
      status,
      // Zero markers (-, X) are an affirmative "no delivery"; blanks are not.
      verified: status === 'ok' && hasTotal,
    };
  }
  return days;
};

/**
 * Assesses one matrix row against the selected dates and the farmer/day
 * duplicate lookup { 'YYYY-MM-DD': Set<farmerId> }.
 */
const assessMultiDayRow = (row, { dates, recordedByDate = {} }) => {
  const cells = {};
  let totalLiters = 0;
  let hasInvalid = false;
  let hasReview = false;
  let recordCount = 0;
  let existingCount = 0;
  const farmerId = row.farmerId ? Number(row.farmerId) : null;

  for (const date of dates) {
    const cell = row.days?.[date] || { morning: '', evening: '', status: 'unreadable', verified: false, raw: '' };
    const morning = parseLitres(cell.morning);
    const evening = parseLitres(cell.evening);
    const total = round2(morning.value + evening.value);
    let state = 'empty';
    if (morning.invalid || evening.invalid) {
      state = 'invalid';
      hasInvalid = true;
    } else if (total > 0) {
      if (farmerId && recordedByDate[date]?.has(farmerId)) {
        state = 'existing';
        existingCount += 1;
      } else if (!cell.verified && NEEDS_CONFIRMATION.has(cell.status)) {
        state = 'review';
        hasReview = true;
      } else {
        state = 'record';
        recordCount += 1;
        totalLiters = round2(totalLiters + total);
      }
    } else if (!cell.verified && (cell.status === 'unreadable' || cell.status === 'ambiguous')) {
      state = 'review';
      hasReview = true;
    }
    cells[date] = { morning: morning.value, evening: evening.value, total, state };
  }

  let status = 'matched';
  if (!row.include) status = 'excluded';
  else if (!farmerId) status = 'needsMatch';
  else if (hasInvalid) status = 'invalid';
  else if (hasReview) status = 'review';

  return {
    status,
    cells,
    totalLiters,
    recordCount,
    existingCount,
    blocking: Boolean(row.include) && status !== 'matched',
  };
};

/**
 * Builds the POST /api/milk/import payload entries. Each entry carries its own
 * register column date; only cells in the `record` state are sent.
 */
const buildMultiDayEntries = (rows, assessments) => {
  const entries = [];
  rows.forEach((row, index) => {
    const assessed = assessments[index];
    if (!row.include || !assessed || assessed.status !== 'matched') return;
    for (const [date, cell] of Object.entries(assessed.cells)) {
      if (cell.state !== 'record') continue;
      const original = row.days?.[date];
      entries.push({
        rowNumber: row.rowNumber,
        farmerId: Number(row.farmerId),
        date,
        volumeMorning: cell.morning,
        volumeEvening: cell.evening,
        ocrDetectedName: row.nameText || row.rawText || null,
        ocrDetectedLiters: original?.raw || null,
        confirmedLiters: cell.total,
      });
    }
  });
  return entries;
};

/** Splits entries into server-sized chunks, each with a stable idempotency key. */
const chunkMultiDayEntries = (entries, batchKey, size = 400) => {
  const chunks = [];
  for (let offset = 0; offset < entries.length; offset += size) {
    chunks.push({
      batchKey: offset === 0 ? batchKey : `${batchKey}_p${offset / size}`,
      entries: entries.slice(offset, offset + size),
    });
  }
  return chunks;
};

module.exports = {
  parseLitres,
  buildMultiDayDraftDays,
  assessMultiDayRow,
  buildMultiDayEntries,
  chunkMultiDayEntries,
};
