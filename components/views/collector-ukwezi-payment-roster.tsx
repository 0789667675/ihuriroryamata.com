import { useMemo, useState } from 'react';
import { filterUkweziPaymentRows, paginateUkweziPaymentRows } from '@/lib/utils/ukwezi-payment-search.js';
import { formatMilkVolume } from '@/lib/utils/milk-volume-format.js';

type PaymentRow = {
  farmerId: number;
  farmerName: string;
  nationalId: string | null;
  phone: string | null;
  accountNumber: string | null;
  validLiters: number;
  pricePerLiter: number | null;
  grossAmount: number | null;
  transportAmount: number | null;
  otherDeductions: number | null;
  ejohezaAmount: number | null;
  totalDeductions: number | null;
  openingDebt: number | null;
  debtRecovered: number | null;
  closingDebt: number | null;
  signedNet: number | null;
  payable: number | null;
};

type Props = {
  accountRows: PaymentRow[];
  ownerRows: PaymentRow[];
  ownerName: string;
  ownerAccountNumber: string | null;
  ownerAmount: number | null;
  totalDistributed: number | null;
  signedFarmerNetBalance: number | null;
  negativeFarmerNetBalance: number | null;
  negativeFarmerCount: number | null;
  confirmedPayments: number;
  centerName: string | null;
  language: string;
  t: (key: string) => string;
};

type PageSize = 25 | 50 | 100;
type PaymentTotals = {
  validLiters: number;
  grossAmount: number | null;
  transportAmount: number | null;
  otherDeductions: number | null;
  ejohezaAmount: number | null;
  totalDeductions: number | null;
  payable: number | null;
};
type PaymentPage = {
  rows: PaymentRow[];
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRows: number;
  startIndex: number;
  start: number;
  end: number;
};

const formatMoney = (value: number | null, language: string) => value === null
  ? '—'
  : new Intl.NumberFormat(language === 'rw' ? 'rw-RW' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const formatVolume = formatMilkVolume;
const compareFarmerNames = (left: PaymentRow, right: PaymentRow) => left.farmerName.trim()
  .localeCompare(right.farmerName.trim(), 'en', { sensitivity: 'base' });
const sumPaymentField = (rows: PaymentRow[], field: keyof PaymentRow) => rows.every((row) => row[field] !== null)
  ? rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)
  : null;
const getPaymentTotals = (rows: PaymentRow[]): PaymentTotals => ({
  validLiters: sumPaymentField(rows, 'validLiters') || 0,
  grossAmount: sumPaymentField(rows, 'grossAmount'),
  transportAmount: sumPaymentField(rows, 'transportAmount'),
  otherDeductions: sumPaymentField(rows, 'otherDeductions'),
  ejohezaAmount: sumPaymentField(rows, 'ejohezaAmount'),
  totalDeductions: sumPaymentField(rows, 'totalDeductions'),
  payable: sumPaymentField(rows, 'payable'),
});
const columnClass = (key: string) => key === 'number'
  ? 'ukwezi-payment-index'
  : key === 'name'
    ? 'ukwezi-payment-name'
    : ['nationalId', 'phone', 'accountNumber'].includes(key)
      ? 'ukwezi-payment-nowrap'
      : 'ukwezi-payment-numeric';

export function CollectorUkweziPaymentRoster({
  accountRows,
  ownerRows,
  ownerName,
  ownerAccountNumber,
  ownerAmount,
  totalDistributed,
  signedFarmerNetBalance,
  negativeFarmerNetBalance,
  negativeFarmerCount,
  confirmedPayments,
  centerName,
  language,
  t,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [accountPage, setAccountPage] = useState(1);
  const [ownerPage, setOwnerPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState<PageSize>(25);
  const [ownerPageSize, setOwnerPageSize] = useState<PageSize>(25);
  const filteredAccountRows = useMemo(
    () => filterUkweziPaymentRows([...accountRows].sort(compareFarmerNames), searchQuery),
    [accountRows, searchQuery],
  );
  const filteredOwnerRows = useMemo(
    () => filterUkweziPaymentRows([...ownerRows].sort(compareFarmerNames), searchQuery),
    [ownerRows, searchQuery],
  );
  const accountPagination = paginateUkweziPaymentRows(filteredAccountRows, accountPage, accountPageSize);
  const ownerPagination = paginateUkweziPaymentRows(filteredOwnerRows, ownerPage, ownerPageSize);
  const accountTotals = useMemo(() => getPaymentTotals(accountRows), [accountRows]);
  const ownerTotals = useMemo(() => getPaymentTotals(ownerRows), [ownerRows]);
  const matchingFarmerCount = filteredAccountRows.length + filteredOwnerRows.length;
  const totalFarmerCount = accountRows.length + ownerRows.length;
  const columns = [
    { key: 'number', label: t('ukweziColNumber'), width: 54 },
    { key: 'name', label: t('ukweziColFarmerName'), width: 260 },
    { key: 'nationalId', label: t('ukweziColNationalId'), width: 160 },
    { key: 'phone', label: t('ukweziColPhone'), width: 135 },
    { key: 'accountNumber', label: t('ukweziColAccountNumber'), width: 200 },
    { key: 'liters', label: t('ukweziColMilkLiters'), width: 96 },
    { key: 'price', label: t('ukweziColPricePerLiter'), width: 112 },
    { key: 'gross', label: t('ukweziColGrossAmount'), width: 130 },
    { key: 'transport', label: t('ukweziColTransport'), width: 130 },
    { key: 'otherDeductions', label: t('ukweziColIgipandeOther'), width: 145 },
    { key: 'ejoheza', label: t('ukweziColEjoheza'), width: 120 },
    { key: 'totalDeductions', label: t('ukweziColTotalDeductions'), width: 150 },
    { key: 'payable', label: t('ukweziColFarmerPaid'), width: 150 },
  ];
  const cellValues = (row: PaymentRow, index: number) => [
    String(index + 1), row.farmerName, row.nationalId || '—', row.phone || '—', row.accountNumber || '—',
    formatVolume(row.validLiters),
    row.pricePerLiter === null ? '—' : `${formatMoney(row.pricePerLiter, language)} RWF/L`,
    row.grossAmount === null ? '—' : `${formatMoney(row.grossAmount, language)} RWF`,
    row.transportAmount === null ? '—' : `${formatMoney(row.transportAmount, language)} RWF`,
    row.otherDeductions === null ? '—' : `${formatMoney(row.otherDeductions, language)} RWF`,
    row.ejohezaAmount === null ? '—' : `${formatMoney(row.ejohezaAmount, language)} RWF`,
    row.totalDeductions === null ? '—' : `${formatMoney(row.totalDeductions, language)} RWF`,
    row.payable === null ? '—' : `${formatMoney(row.payable, language)} RWF`,
  ];
  const renderTable = (
    rows: PaymentRow[],
    includeAccount: boolean,
    label: string,
    pagination: PaymentPage,
    totals: PaymentTotals,
    setPage: (page: number) => void,
    pageSize: PageSize,
    setPageSize: (pageSize: PageSize) => void,
  ) => (
    <section className="ukwezi-payment-group" aria-label={label}>
      <header className="ukwezi-payment-group-heading">
        <h3>{label}</h3>
        <span>{language === 'rw' ? `Aborozi ${pagination.start}–${pagination.end} muri ${pagination.totalRows}` : `Farmers ${pagination.start}–${pagination.end} of ${pagination.totalRows}`}</span>
      </header>
      {!includeAccount ? <p>{t('unaccountedFarmersNotice')}</p> : null}
      {rows.length ? <>
        <p className="ukwezi-payment-scroll-note">{t('ukweziHorizontalScroll')}</p>
        <div className="table-scroll ukwezi-settlement-table ukwezi-payment-desktop">
          <table>
            <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
            <thead><tr>{columns.map((column) => <th key={column.key} className={columnClass(column.key)} scope="col">{column.label}</th>)}</tr></thead>
            <tbody>{pagination.rows.map((row, rowIndex) => <tr key={row.farmerId}>{cellValues(row, pagination.startIndex + rowIndex).map((value, index) => <td key={columns[index].key} className={columnClass(columns[index].key)}>{value}</td>)}</tr>)}</tbody>
            <tfoot><tr>
              <th colSpan={5}>{t('grandTotal')}</th>
              <td>{formatVolume(totals.validLiters)}</td>
              <td>{totals.grossAmount === null || !totals.validLiters ? '—' : `${formatMoney(totals.grossAmount / totals.validLiters, language)} RWF/L`}</td>
              <td>{formatMoney(totals.grossAmount, language)} RWF</td>
              <td>{formatMoney(totals.transportAmount, language)} RWF</td>
              <td>{formatMoney(totals.otherDeductions, language)} RWF</td>
              <td>{formatMoney(totals.ejohezaAmount, language)} RWF</td>
              <td>{formatMoney(totals.totalDeductions, language)} RWF</td>
              <td>{formatMoney(totals.payable, language)} RWF</td>
            </tr></tfoot>
          </table>
        </div>
        <div className="ukwezi-mobile-list ukwezi-payment-mobile">
          {pagination.rows.map((row, index) => <article className="ukwezi-mobile-card" key={`mobile-${row.farmerId}`}>
            <header><b>{pagination.startIndex + index + 1}. {row.farmerName}</b><strong>{row.payable === null ? '—' : `${formatMoney(row.payable, language)} RWF`}</strong></header>
            <dl>
              {columns.slice(2).map((column, valueIndex) => <div key={column.key}><dt>{column.label}</dt><dd>{cellValues(row, index)[valueIndex + 2]}</dd></div>)}
            </dl>
          </article>)}
          <section className="ukwezi-payment-mobile-total" aria-label={`${label} ${t('grandTotal')}`}>
            <b>{t('grandTotal')}</b>
            <dl>
              <div><dt>{t('ukweziColMilkLiters')}</dt><dd>{formatVolume(totals.validLiters)}</dd></div>
              <div><dt>{t('ukweziColGrossAmount')}</dt><dd>{formatMoney(totals.grossAmount, language)} RWF</dd></div>
              <div><dt>{t('ukweziColTransport')}</dt><dd>{formatMoney(totals.transportAmount, language)} RWF</dd></div>
              <div><dt>{t('ukweziColIgipandeOther')}</dt><dd>{formatMoney(totals.otherDeductions, language)} RWF</dd></div>
              <div><dt>{t('ukweziColEjoheza')}</dt><dd>{formatMoney(totals.ejohezaAmount, language)} RWF</dd></div>
              <div><dt>{t('ukweziColTotalDeductions')}</dt><dd>{formatMoney(totals.totalDeductions, language)} RWF</dd></div>
              <div><dt>{t('ukweziPaymentAmount')}</dt><dd>{formatMoney(totals.payable, language)} RWF</dd></div>
            </dl>
          </section>
        </div>
        <nav className="ukwezi-payment-pagination" aria-label={`${label} pagination`}>
          <label>
            <span>{language === 'rw' ? 'Aborozi kuri paji' : 'Farmers per page'}</span>
            <select value={pageSize} onChange={(event) => {
              setPageSize(Number(event.target.value) as PageSize);
              setPage(1);
            }}>
              {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="ukwezi-payment-pagination-controls">
            <button type="button" className="button button-secondary" disabled={pagination.currentPage <= 1} onClick={() => setPage(pagination.currentPage - 1)}>
              {language === 'rw' ? 'Banza' : 'Previous'}
            </button>
            <span>{language === 'rw' ? `Paji ${pagination.currentPage} muri ${pagination.totalPages}` : `Page ${pagination.currentPage} of ${pagination.totalPages}`}</span>
            <button type="button" className="button button-secondary" disabled={pagination.currentPage >= pagination.totalPages} onClick={() => setPage(pagination.currentPage + 1)}>
              {language === 'rw' ? 'Ibikurikira' : 'Next'}
            </button>
          </div>
        </nav>
      </> : <p className="muted-note" role={searchQuery.trim() ? 'status' : undefined}>
        {searchQuery.trim() ? t('ukweziSearchNoResults') : '—'}
      </p>}
    </section>
  );

  return (
    <section className="ukwezi-payment-roster" aria-label={t('ukweziPayable')}>
      <h2>{t('ukweziFarmersToPay')}</h2>
      {centerName ? <p className="ukwezi-payment-center">{t('ukweziCenter')}: {centerName}</p> : null}
      <p className="ukwezi-payment-instruction-note">{t('ukweziPaymentInstructionNote').replace('{amount}', `${formatMoney(confirmedPayments, language)} RWF`)}</p>
      <label className="ukwezi-payment-search">
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setAccountPage(1);
            setOwnerPage(1);
          }}
          placeholder={t('ukweziSearchPlaceholder')}
          aria-label={t('ukweziSearchPlaceholder')}
        />
      </label>
      <p className="ukwezi-payment-search-count" aria-live="polite">
        {t('ukweziSearchResults').replace('{matching}', String(matchingFarmerCount)).replace('{total}', String(totalFarmerCount))}
      </p>
      {renderTable(filteredAccountRows, true, t('accountRoutedLabel'), accountPagination, accountTotals, setAccountPage, accountPageSize, setAccountPageSize)}
      {renderTable(filteredOwnerRows, false, t('ownerListRoutedLabel'), ownerPagination, ownerTotals, setOwnerPage, ownerPageSize, setOwnerPageSize)}
      <section className="ukwezi-payment-reconciliation" aria-label={t('ukweziVerificationDifference')}>
        <div><span>{t('accountRoutedLabel')}</span><strong>{formatMoney(accountTotals.payable, language)} RWF</strong></div>
        <div><span>{t('ukweziOwnerAccount')}</span><strong>{formatMoney(ownerAmount, language)} RWF</strong></div>
        <div className="ukwezi-payment-distributed"><span>{t('ukweziTotalDistributed')}</span><strong>{formatMoney(totalDistributed, language)} RWF</strong></div>
        <div><span>{t('ukweziFarmerSignedNet')}</span><strong>{formatMoney(signedFarmerNetBalance, language)} RWF</strong></div>
      </section>
      {accountRows.some((row) => row.openingDebt !== null || row.debtRecovered !== null || row.closingDebt !== null)
        || ownerRows.some((row) => row.openingDebt !== null || row.debtRecovered !== null || row.closingDebt !== null) ? (
        <section className="ukwezi-debt-recovery" aria-label={t('ukweziDebtRecoveryTitle')}>
          <h3>{t('ukweziDebtRecoveryTitle')}</h3>
          <p>{t('ukweziDebtRecoveryNote')}</p>
          {[{ rows: accountPagination.rows, label: t('accountRoutedLabel') }, { rows: ownerPagination.rows, label: t('ownerListRoutedLabel') }].map(({ rows, label }) => {
            const debtRows = rows.filter((row) => row.openingDebt !== null || row.debtRecovered !== null || row.closingDebt !== null);
            return debtRows.length ? <div className="ukwezi-debt-group" key={label}>
              <h4>{label}</h4>
              <div className="ukwezi-debt-desktop table-scroll">
                <table><thead><tr>
                  <th>{t('ukweziColFarmerName')}</th>
                  <th>{t('ukweziDebtOpening')}</th>
                  <th>{t('ukweziDebtRecovered')}</th>
                  <th>{t('ukweziDebtClosing')}</th>
                </tr></thead><tbody>{debtRows.map((row) => <tr key={row.farmerId}>
                  <th scope="row">{row.farmerName}</th>
                  <td>{formatMoney(row.openingDebt, language)} RWF</td>
                  <td>{formatMoney(row.debtRecovered, language)} RWF</td>
                  <td>{formatMoney(row.closingDebt, language)} RWF</td>
                </tr>)}</tbody></table>
              </div>
              <div className="ukwezi-debt-mobile">{debtRows.map((row) => <article key={row.farmerId}>
                <b>{row.farmerName}</b>
                <dl>
                  <div><dt>{t('ukweziDebtOpening')}</dt><dd>{formatMoney(row.openingDebt, language)} RWF</dd></div>
                  <div><dt>{t('ukweziDebtRecovered')}</dt><dd>{formatMoney(row.debtRecovered, language)} RWF</dd></div>
                  <div><dt>{t('ukweziDebtClosing')}</dt><dd>{formatMoney(row.closingDebt, language)} RWF</dd></div>
                </dl>
              </article>)}</div>
            </div> : null;
          })}
        </section>
      ) : null}
      {negativeFarmerCount ? <section className="ukwezi-negative-farmer-balance" role="note">
        <b>{t('ukweziNegativeNetTitle')}</b>
        <p>{t('ukweziNegativeNetNotice').replace('{count}', String(negativeFarmerCount)).replace('{amount}', `${formatMoney(negativeFarmerNetBalance, language)} RWF`)}</p>
      </section> : null}
      <p className="ukwezi-ejoheza-note">{t('ukweziEjohezaNoRecords')}</p>
      <section className="ukwezi-owner-payment" aria-label={t('ukweziOwnerAccount')}>
        <h3>{t('ukweziOwnerAccount')}</h3>
        <div className="ukwezi-owner-payment-row">
          <b>{ownerName}</b>
          <span>{ownerAccountNumber || '—'}</span>
          <strong>{formatMoney(ownerAmount, language)} RWF</strong>
        </div>
      </section>
    </section>
  );
}