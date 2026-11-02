'use client';

import { formatDateLabel } from '@/lib/i18n/date-format';
import type { PublicCopyKey } from '@/lib/i18n/public-copy';

export type SettlementHistoryRecord = {
  id: number;
  settlementId?: number;
  farmerId?: number;
  farmerName?: string | null;
  amount: number;
  status: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  approvedAt?: string | null;
  confirmedAt?: string | null;
  confirmedBy?: number | null;
};

type Props = {
  records: SettlementHistoryRecord[];
  language: 'rw' | 'en';
  loading: boolean;
  error: string;
  t: (key: PublicCopyKey) => string;
  formatMoney: (value: number) => string;
  onRetry: () => void;
};

export function FarmerSettlementHistory({ records, language, loading, error, t, formatMoney, onRetry }: Props) {
  const dateTime = (value?: string | null) => value
    ? formatDateLabel(value, language, { day: 'numeric', month: 'short', year: 'numeric', time: 'short' })
    : '—';
  const period = (record: SettlementHistoryRecord) => record.periodStart && record.periodEnd
    ? `${record.periodStart} – ${record.periodEnd}`
    : '—';
  const statusLabel = (status: string) => {
    const keys: Record<string, PublicCopyKey> = {
      PENDING: 'settlementsStatusPending',
      APPROVED: 'settlementsStatusApproved',
      CONFIRMED: 'settlementsStatusConfirmed',
      REJECTED: 'settlementsStatusRejected',
      PARTIALLY_SETTLED: 'settlementsStatusPartiallySettled',
      SETTLED: 'settlementsStatusSettled',
    };
    return keys[status] ? t(keys[status]) : status;
  };

  return (
    <section className="farmer-financial-history" aria-labelledby="farmer-financial-history-title">
      <div className="panel-heading">
        <div><span className="eyebrow">{t('dashboardAccounting')}</span><h3 id="farmer-financial-history-title">{t('settlementsPaymentHistory')}</h3></div>
        <span className="count-label">{records.length}</span>
      </div>
      {error ? <div className="workspace-empty" role="alert"><b>{error}</b><button type="button" className="button button-secondary small-button" onClick={onRetry}>{t('tryAgain')}</button></div> : null}
      {loading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{t('dashboardLoading')}</div> : null}
      {!loading && !error && records.length ? <>
        <div className="table-scroll farmer-financial-history-desktop"><table><thead><tr>
          <th>{t('settlementsApprovedPayment')}</th><th>{t('settlementsPeriod')}</th><th>{t('settlementsStatus')}</th><th>{t('settlementsApprovedAt')}</th><th>{t('settlementsConfirmedAt')}</th>
        </tr></thead><tbody>{records.map((record) => <tr key={record.id}>
          <td><b>{formatMoney(record.amount)} RWF</b></td><td>{period(record)}</td><td>{statusLabel(record.status)}</td><td>{dateTime(record.approvedAt)}</td>
          <td>{record.confirmedAt ? <>{dateTime(record.confirmedAt)}{record.confirmedBy ? <small className="block-muted">{t('actor')} #{record.confirmedBy}</small> : null}</> : '—'}</td>
        </tr>)}</tbody></table></div>
        <div className="farmer-financial-history-mobile">{records.map((record) => <article className="farmer-financial-history-item" key={`mobile-${record.id}`}>
          <header><strong>{formatMoney(record.amount)} RWF</strong><span className="status-pill">{statusLabel(record.status)}</span></header>
          <dl><div><dt>{t('settlementsPeriod')}</dt><dd>{period(record)}</dd></div><div><dt>{t('settlementsApprovedAt')}</dt><dd>{dateTime(record.approvedAt)}</dd></div>
            <div><dt>{t('settlementsConfirmedAt')}</dt><dd>{record.confirmedAt ? <>{dateTime(record.confirmedAt)}{record.confirmedBy ? <small>{t('actor')} #{record.confirmedBy}</small> : null}</> : '—'}</dd></div>
          </dl>
        </article>)}</div>
      </> : null}
      {!loading && !error && !records.length ? <div className="workspace-empty" role="status"><b>{t('settlementsEmptyRecords')}</b></div> : null}
    </section>
  );
}