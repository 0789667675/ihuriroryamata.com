'use client';

import { AlertTriangle, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

type DeletionImpact = {
  farmer: { name: string; farmerNumber?: number | null };
  counts: Record<string, number>;
  affectedPeriods: Array<{ start: string; end: string }>;
  settledPaymentEvidence: { settlements: unknown[]; farmerPayments: Array<{ count: number; amount: number }>; debtRepayments: unknown[]; igipandeRecoveries: unknown[]; deductionBatchItems: Array<{ recovered_amount?: number }> };
};

type Props = {
  open: boolean;
  language: 'rw' | 'en';
  impact: DeletionImpact | null;
  loading: boolean;
  error: string;
  reason: string;
  confirmationName: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onConfirmationNameChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

const labels = {
  rw: {
    title: 'Gusiba burundu umworozi',
    loading: 'Turimo kureba amakuru yose azagerwaho…',
    records: 'Amakuru azakurwaho mu ibaruramari rikora',
    milk: 'Inyandiko z’amata',
    losses: 'Ibyatakaye mu mata',
    corrections: 'Inyandiko z’amata zahinduwe',
    deductions: 'Ibyakuweho',
    payments: 'Ubwishyu bw’umworozi',
    settlements: 'Ubwishyu bwemejwe',
    debts: 'Imyenda',
    repayments: 'Kwishyura imyenda',
    igipande: 'Igipande n’amafaranga yakoreshejwe mu kwishyura',
    batches: 'Ibyakuweho mu byiciro',
    notifications: 'Imenyesha',
    periods: 'Ibihe bya Ukwezi bizongera kubarwa',
    paid: 'Amafaranga yishyuwe azabikwa mu bubiko bw’ubugenzuzi kugira ngo yemezwe mu mateka.',
    reason: 'Impamvu yo gusiba',
    typeName: 'Andika izina ry’umworozi kugira ngo wemeze',
    confirm: 'Siba burundu',
    cancel: 'Kureka',
    noRecords: 'Nta mateka y’ubucuruzi ahujwe n’uyu mworozi.',
  },
  en: {
    title: 'Permanently delete farmer',
    loading: 'Checking all related records…',
    records: 'Records removed from active accounting',
    milk: 'Milk records',
    losses: 'Milk losses',
    corrections: 'Milk corrections',
    deductions: 'Deductions',
    payments: 'Farmer payments',
    settlements: 'Settlements',
    debts: 'Debt ledgers',
    repayments: 'Debt repayments',
    igipande: 'Igipande contributions and recoveries',
    batches: 'Batched deductions',
    notifications: 'Notifications',
    periods: 'Ukwezi periods to recalculate',
    paid: 'Evidence of actual payments will be preserved in the administrative archive.',
    reason: 'Reason for deletion',
    typeName: 'Type the farmer name to confirm',
    confirm: 'Delete permanently',
    cancel: 'Cancel',
    noRecords: 'No linked business history was found for this farmer.',
  },
} as const;

const rows = [
  ['milkRecords', 'milk'],
  ['milkLosses', 'losses'],
  ['milkCorrections', 'corrections'],
  ['deductions', 'deductions'],
  ['farmerPayments', 'payments'],
  ['settlements', 'settlements'],
  ['debtLedgers', 'debts'],
  ['debtRepayments', 'repayments'],
  ['igipandeContributions', 'igipande'],
  ['deductionBatchItems', 'batches'],
  ['notifications', 'notifications'],
] as const;

export function FarmerDeletionDialog({
  open,
  language,
  impact,
  loading,
  error,
  reason,
  confirmationName,
  busy,
  onReasonChange,
  onConfirmationNameChange,
  onClose,
  onConfirm,
}: Props) {
  if (!open) return null;
  const copy = labels[language];
  const paidEvidenceCount = impact
    ? impact.settledPaymentEvidence.settlements.length
      + impact.settledPaymentEvidence.farmerPayments.reduce((total, item) => total + item.count, 0)
      + impact.settledPaymentEvidence.debtRepayments.length
      + impact.settledPaymentEvidence.igipandeRecoveries.length
      + impact.settledPaymentEvidence.deductionBatchItems.filter((item) => Number(item.recovered_amount) > 0).length
    : 0;
  const canDelete = Boolean(impact && reason.trim().length >= 5
    && confirmationName.trim() === impact.farmer.name && !busy && !loading);

  return (
    <Modal ariaLabel={copy.title} className="modal-panel-wide" onClose={onClose} dismissible={!busy}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{impact?.farmer.farmerNumber ? `#${impact.farmer.farmerNumber}` : 'Aborozi'}</span>
          <h2>{copy.title}: {impact?.farmer.name || '…'}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label={copy.cancel}><X size={18} aria-hidden="true" /></button>
      </div>
      {loading || !impact ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{copy.loading}</div> : <>
        <section className="settlement-reconciliation" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{copy.records}</span>
        </section>
        <dl className="farmer-deletion-impact">
          {rows.map(([key, label]) => <div key={key}><dt>{copy[label]}</dt><dd>{Number(impact.counts[key] || 0)}</dd></div>)}
        </dl>
        {impact.affectedPeriods.length ? <section className="panel">
          <b>{copy.periods}</b>
          <ul>{impact.affectedPeriods.map((period) => <li key={`${period.start}-${period.end}`}>{period.start} – {period.end}</li>)}</ul>
        </section> : <p className="muted-note">{copy.noRecords}</p>}
        {paidEvidenceCount ? <p className="muted-note" role="note">{copy.paid} ({paidEvidenceCount})</p> : null}
        <form className="form-stack compact" onSubmit={(event) => { event.preventDefault(); if (canDelete) onConfirm(); }}>
          <label>{copy.reason}<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => onReasonChange(event.target.value)} /></label>
          <label>{copy.typeName}<input required autoComplete="off" value={confirmationName} onChange={(event) => onConfirmationNameChange(event.target.value)} /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>{copy.cancel}</button>
            <button type="submit" className="button button-danger" disabled={!canDelete} aria-busy={busy}><Trash2 size={16} aria-hidden="true" />{copy.confirm}</button>
          </div>
        </form>
      </>}
    </Modal>
  );
}