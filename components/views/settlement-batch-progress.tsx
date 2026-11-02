'use client';

import { RotateCcw } from 'lucide-react';
import { formatPublicCopy, type PublicCopyKey } from '@/lib/i18n/public-copy';

export type SettlementBatchRecord = {
  farmerId: number;
  farmerName: string;
  amount: number;
};

export type SettlementBatchFailure = SettlementBatchRecord & {
  reason: string;
  retryable: boolean;
};

export type SettlementBatchState = {
  selectedCount: number;
  processedCount: number;
  confirmedCount: number;
  failures: SettlementBatchFailure[];
  complete: boolean;
};

type Props = {
  progress: SettlementBatchState;
  language: 'rw' | 'en';
  t: (key: PublicCopyKey) => string;
  formatMoney: (value: number) => string;
  retrying: boolean;
  onRetry: (records: SettlementBatchRecord[]) => void;
};

export function SettlementBatchProgress({ progress, language, t, formatMoney, retrying, onRetry }: Props) {
  const retryableFailures = progress.failures.filter((failure) => failure.retryable);

  return (
    <section className="settlement-batch-progress" role="status" aria-live="polite" aria-busy={!progress.complete}>
      <div className="settlement-batch-progress-heading">
        <div>
          <span className="eyebrow">{t('settlementsBatchProgress')}</span>
          <p>{formatPublicCopy(language, 'settlementsBatchSummary', 'Selected {selected}; processed {processed}; confirmed {confirmed}; failed {failed}.', {
            selected: progress.selectedCount,
            processed: progress.processedCount,
            confirmed: progress.confirmedCount,
            failed: progress.failures.length,
          })}</p>
        </div>
        {progress.complete ? <b className={progress.failures.length ? 'settlement-batch-status is-partial' : 'settlement-batch-status is-complete'}>
          {t(progress.failures.length ? 'settlementsBatchAttention' : 'settlementsBatchComplete')}
        </b> : <span className="loading-indicator" aria-label={t('dashboardLoading')} />}
      </div>
      {progress.failures.length ? <ul className="settlement-batch-failures">
        {progress.failures.map((failure) => <li key={failure.farmerId}>
          <div><b>{failure.farmerName}</b><span>{formatMoney(failure.amount)} RWF</span></div>
          <p>{failure.reason}</p>
          <small>{t(failure.retryable ? 'settlementsRetryable' : 'settlementsNotRetryable')}</small>
        </li>)}
      </ul> : null}
      {retryableFailures.length ? <button type="button" className="button button-secondary small-button settlement-batch-retry" onClick={() => onRetry(retryableFailures)} disabled={retrying || !progress.complete}>
        <RotateCcw size={15} aria-hidden="true" />
        {formatPublicCopy(language, 'settlementsRetryFailed', 'Retry eligible failed ({count})', { count: retryableFailures.length })}
      </button> : null}
    </section>
  );
}