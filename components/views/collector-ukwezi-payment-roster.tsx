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

const formatMoney = (value: number | null, language: string) => value === null
  ? '—'
  : new Intl.NumberFormat(language === 'rw' ? 'rw-RW' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const formatVolume = (value: number, language: string) => new Intl.NumberFormat(language === 'rw' ? 'rw-RW' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

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
  const columns = [
    { key: 'number', label: t('ukweziColNumber'), width: 40 },
    { key: 'name', label: t('ukweziColFarmerName'), width: 210 },
    { key: 'nationalId', label: t('ukweziColNationalId'), width: 130 },
    { key: 'phone', label: t('ukweziColPhone'), width: 120 },
    { key: 'accountNumber', label: t('ukweziColAccountNumber'), width: 180 },
    { key: 'liters', label: t('ukweziColMilkLiters'), width: 95 },
    { key: 'price', label: t('ukweziColPricePerLiter'), width: 105 },
    { key: 'gross', label: t('ukweziColGrossAmount'), width: 125 },
    { key: 'transport', label: t('ukweziColTransport'), width: 115 },
    { key: 'otherDeductions', label: t('ukweziColIgipandeOther'), width: 140 },
    { key: 'ejoheza', label: t('ukweziColEjoheza'), width: 110 },
    { key: 'totalDeductions', label: t('ukweziColTotalDeductions'), width: 145 },
    { key: 'payable', label: t('ukweziColFarmerPaid'), width: 155 },
  ];
  const cellValues = (row: PaymentRow, index: number) => [
    String(index + 1), row.farmerName, row.nationalId || '—', row.phone || '—', row.accountNumber || '—',
    `${formatVolume(row.validLiters, language)} L`,
    row.pricePerLiter === null ? '—' : `${formatMoney(row.pricePerLiter, language)} RWF/L`,
    row.grossAmount === null ? '—' : `${formatMoney(row.grossAmount, language)} RWF`,
    row.transportAmount === null ? '—' : `${formatMoney(row.transportAmount, language)} RWF`,
    row.otherDeductions === null ? '—' : `${formatMoney(row.otherDeductions, language)} RWF`,
    row.ejohezaAmount === null ? '—' : `${formatMoney(row.ejohezaAmount, language)} RWF`,
    row.totalDeductions === null ? '—' : `${formatMoney(row.totalDeductions, language)} RWF`,
    row.payable === null ? '—' : `${formatMoney(row.payable, language)} RWF`,
  ];
  const total = (rows: PaymentRow[], field: keyof PaymentRow) => rows.every((row) => row[field] !== null)
    ? rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)
    : null;
  const renderTable = (rows: PaymentRow[], includeAccount: boolean, label: string) => (
    <section className="ukwezi-payment-group" aria-label={label}>
      <h3>{label}</h3>
      {!includeAccount ? <p>{t('unaccountedFarmersNotice')}</p> : null}
      {rows.length ? <>
        <p className="ukwezi-payment-scroll-note">{t('ukweziHorizontalScroll')}</p>
        <div className="table-scroll ukwezi-settlement-table ukwezi-payment-desktop">
          <table>
            <colgroup>{columns.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}</colgroup>
            <thead><tr>{columns.map((column, index) => <th key={column.key} className={index === 0 ? 'ukwezi-payment-index' : index === 1 ? 'ukwezi-payment-name' : undefined} scope="col">{column.label}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={row.farmerId}>{cellValues(row, rowIndex).map((value, index) => <td key={columns[index].key} className={index === 0 ? 'ukwezi-payment-index' : index === 1 ? 'ukwezi-payment-name' : undefined}>{value}</td>)}</tr>)}</tbody>
            <tfoot><tr>
              <th colSpan={5}>{t('grandTotal')}</th>
              <td>{formatVolume(total(rows, 'validLiters') || 0, language)} L</td>
              <td>{total(rows, 'grossAmount') === null || !(total(rows, 'validLiters') || 0) ? '—' : `${formatMoney(Number(total(rows, 'grossAmount')) / Number(total(rows, 'validLiters')), language)} RWF/L`}</td>
              <td>{formatMoney(total(rows, 'grossAmount'), language)} RWF</td>
              <td>{formatMoney(total(rows, 'transportAmount'), language)} RWF</td>
              <td>{formatMoney(total(rows, 'otherDeductions'), language)} RWF</td>
              <td>{formatMoney(total(rows, 'ejohezaAmount'), language)} RWF</td>
              <td>{formatMoney(total(rows, 'totalDeductions'), language)} RWF</td>
              <td>{formatMoney(total(rows, 'payable'), language)} RWF</td>
            </tr></tfoot>
          </table>
        </div>
        <div className="ukwezi-mobile-list ukwezi-payment-mobile">
          {rows.map((row, index) => <article className="ukwezi-mobile-card" key={`mobile-${row.farmerId}`}>
            <header><b>{index + 1}. {row.farmerName}</b><strong>{row.payable === null ? '—' : `${formatMoney(row.payable, language)} RWF`}</strong></header>
            <dl>
              {columns.slice(2).map((column, valueIndex) => <div key={column.key}><dt>{column.label}</dt><dd>{cellValues(row, index)[valueIndex + 2]}</dd></div>)}
            </dl>
          </article>)}
          <section className="ukwezi-payment-mobile-total" aria-label={`${label} ${t('grandTotal')}`}>
            <b>{t('grandTotal')}</b>
            <dl>
              <div><dt>{t('ukweziColMilkLiters')}</dt><dd>{formatVolume(total(rows, 'validLiters') || 0, language)} L</dd></div>
              <div><dt>{t('ukweziColGrossAmount')}</dt><dd>{formatMoney(total(rows, 'grossAmount'), language)} RWF</dd></div>
              <div><dt>{t('ukweziColTransport')}</dt><dd>{formatMoney(total(rows, 'transportAmount'), language)} RWF</dd></div>
              <div><dt>{t('ukweziColIgipandeOther')}</dt><dd>{formatMoney(total(rows, 'otherDeductions'), language)} RWF</dd></div>
              <div><dt>{t('ukweziColEjoheza')}</dt><dd>{formatMoney(total(rows, 'ejohezaAmount'), language)} RWF</dd></div>
              <div><dt>{t('ukweziColTotalDeductions')}</dt><dd>{formatMoney(total(rows, 'totalDeductions'), language)} RWF</dd></div>
              <div><dt>{t('ukweziPaymentAmount')}</dt><dd>{formatMoney(total(rows, 'payable'), language)} RWF</dd></div>
            </dl>
          </section>
        </div>
      </> : <p className="muted-note">—</p>}
    </section>
  );

  return (
    <section className="ukwezi-payment-roster" aria-label={t('ukweziPayable')}>
      <h2>{t('ukweziFarmersToPay')}</h2>
      {centerName ? <p className="ukwezi-payment-center">{t('ukweziCenter')}: {centerName}</p> : null}
      <p className="ukwezi-payment-instruction-note">{t('ukweziPaymentInstructionNote').replace('{amount}', `${formatMoney(confirmedPayments, language)} RWF`)}</p>
      {renderTable(accountRows, true, t('accountRoutedLabel'))}
      {renderTable(ownerRows, false, t('ownerListRoutedLabel'))}
      <section className="ukwezi-payment-reconciliation" aria-label={t('ukweziVerificationDifference')}>
        <div><span>{t('accountRoutedLabel')}</span><strong>{formatMoney(total(accountRows, 'payable'), language)} RWF</strong></div>
        <div><span>{t('ukweziOwnerAccount')}</span><strong>{formatMoney(ownerAmount, language)} RWF</strong></div>
        <div className="ukwezi-payment-distributed"><span>{t('ukweziTotalDistributed')}</span><strong>{formatMoney(totalDistributed, language)} RWF</strong></div>
        <div><span>{t('ukweziFarmerSignedNet')}</span><strong>{formatMoney(signedFarmerNetBalance, language)} RWF</strong></div>
      </section>
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