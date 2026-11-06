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

/**
 * @template {UkweziSearchablePaymentRow} T
 * @param {T[]} rows
 * @param {number} [page]
 * @param {number} [pageSize]
 * @returns {{ rows: T[], currentPage: number, totalPages: number, pageSize: number, totalRows: number, startIndex: number, start: number, end: number }}
 */
const paginateUkweziPaymentRows = (rows, page = 1, pageSize = 25) => {
  const validPageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 25;
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / validPageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Math.floor(Number(page) || 1)));
  const startIndex = (currentPage - 1) * validPageSize;

  return {
    rows: rows.slice(startIndex, startIndex + validPageSize),
    currentPage,
    totalPages,
    pageSize: validPageSize,
    totalRows,
    startIndex,
    start: totalRows ? startIndex + 1 : 0,
    end: Math.min(startIndex + validPageSize, totalRows),
  };
};

module.exports = { filterUkweziPaymentRows, paginateUkweziPaymentRows };
