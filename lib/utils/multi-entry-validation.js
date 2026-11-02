const VALID_DEDUCTION_TYPES = ['Advance', 'Umwenda', 'Other'];
const VALID_DEDUCTION_STATUSES = ['Active', 'Cleared'];

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim());
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${String(value)}T00:00:00Z`));

function validateFarmerBatchRows(rows, { requireCenter = false } = {}) {
  const valid = [];
  const errors = [];

  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row, index) => {
    const entry = row || {};
    const name = normalizeText(entry.name);
    const collectionCenterId = normalizeText(entry.collectionCenterId);
    const phone = normalizeText(entry.phone);
    const nationalId = normalizeText(entry.nationalId);
    const accountNumber = normalizeText(entry.accountNumber);
    const cowType = normalizeText(entry.cowType);
    const collectorUserId = normalizeText(entry.collectorUserId);

    if (!name) {
      errors.push({ index, field: 'name', message: `Row ${index + 1}: Farmer name is required.` });
      return;
    }

    if (requireCenter && !collectionCenterId) {
      errors.push({ index, field: 'collectionCenterId', message: `Row ${index + 1}: Collection center is required.` });
      return;
    }

    valid.push({
      name,
      phone,
      nationalId,
      accountNumber,
      cowType,
      collectionCenterId,
      collectorUserId,
    });
  });

  return { valid, errors };
}

function validateDeductionBatchRows(rows) {
  const valid = [];
  const errors = [];
  let total = 0;

  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row, index) => {
    const entry = row || {};
    const amountRaw = entry.amount;
    const date = normalizeText(entry.date);
    const type = normalizeText(entry.type || 'Other');
    const status = normalizeText(entry.status || 'Active');
    const reason = normalizeText(entry.reason || '');
    const notes = normalizeText(entry.notes || '');
    const amount = Number(amountRaw);

    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ index, field: 'amount', message: `Row ${index + 1}: amount must be a positive number.` });
      return;
    }

    if (!date || !isIsoDate(date)) {
      errors.push({ index, field: 'date', message: `Row ${index + 1}: date must be a valid YYYY-MM-DD value.` });
      return;
    }

    if (!VALID_DEDUCTION_TYPES.includes(type)) {
      errors.push({ index, field: 'type', message: `Row ${index + 1}: type must be one of ${VALID_DEDUCTION_TYPES.join(', ')}.` });
      return;
    }

    if (!VALID_DEDUCTION_STATUSES.includes(status)) {
      errors.push({ index, field: 'status', message: `Row ${index + 1}: status must be one of ${VALID_DEDUCTION_STATUSES.join(', ')}.` });
      return;
    }

    const normalized = {
      amount,
      date,
      type,
      status,
      reason,
      notes,
    };
    valid.push(normalized);
    total += amount;
  });

  return { valid, errors, total };
}

module.exports = {
  VALID_DEDUCTION_TYPES,
  VALID_DEDUCTION_STATUSES,
  isIsoDate,
  validateFarmerBatchRows,
  validateDeductionBatchRows,
};
