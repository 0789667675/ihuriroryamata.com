const normalizeSearchText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLocaleLowerCase()
  .trim();

/**
 * @typedef {Object} UkweziSearchablePaymentRow
 * @property {number} farmerId
 * @property {string} farmerName
 * @property {string | null} nationalId
 * @property {string | null} phone
 * @property {string | null} accountNumber
 */

/**
 * @template {UkweziSearchablePaymentRow} T
 * @param {T[]} rows
 * @param {string} query
 * @returns {T[]}
 */
const filterUkweziPaymentRows = (rows, query) => {
  const search = normalizeSearchText(query);
  if (!search) return rows;
  return rows.filter((row) => [
    row.farmerId,
    row.farmerName,
    row.nationalId,
    row.phone,
    row.accountNumber,
  ].some((value) => normalizeSearchText(value).includes(search)));
};

module.exports = { filterUkweziPaymentRows };
