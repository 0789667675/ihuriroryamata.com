'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

export function ImportFrame({
  title,
  eyebrow,
  description,
  busy,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return <Modal ariaLabel={title} className="modal-panel-wide import-modal" dismissible={!busy} onClose={onClose}>
    <header className="panel-heading import-modal-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p className="import-subtitle">{description}</p>
      </div>
      <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">
        <X size={18} aria-hidden="true" />
      </button>
    </header>
    <div className="import-modal-body">{children}</div>
    {footer ? <footer className="import-modal-footer">{footer}</footer> : null}
  </Modal>;
}

export function ImportSteps({ steps, active }: { steps: string[]; active: number }) {
  return <ol className="import-steps" aria-label="Import steps">
    {steps.map((step, index) => <li key={step} className={index === active ? 'active' : index < active ? 'done' : ''} aria-current={index === active ? 'step' : undefined}>
      <span>{index + 1}</span>{step}
    </li>)}
  </ol>;
}

export function ImportNotice({ tone = 'info', children, role = 'status' }: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return <div className={`import-notice import-notice-${tone}`} role={role}>{children}</div>;
}

export function ImportProgress({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="import-progress" role="status" aria-live="polite">
    <div className="import-progress-label"><span>{label}</span><b>{percent}%</b></div>
    <div className="import-progress-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
  </div>;
}

const STATUS_TONE: Record<string, string> = {
  ready: 'success',
  matched: 'success',
  created: 'success',
  exact: 'success',
  possible: 'warning',
  review: 'warning',
  uncertain: 'warning',
  ambiguous: 'warning',
  needsMatch: 'danger',
  needs_match: 'danger',
  unmatched: 'danger',
  unreadable: 'danger',
  invalid: 'danger',
  failed: 'danger',
  duplicate: 'danger',
  conflict: 'danger',
  existing: 'danger',
  excluded: 'muted',
};

export function ImportStatus({ status, label }: { status: string; label: string }) {
  return <span className={`import-status import-status-${STATUS_TONE[status] || 'info'}`}>{label}</span>;
}

export function ImportPager({
  page,
  pages,
  onChange,
  previousLabel,
  nextLabel,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  previousLabel: string;
  nextLabel: string;
}) {
  if (pages <= 1) return null;
  return <div className="import-pager">
    <button type="button" className="button button-secondary small-button" disabled={page <= 0} onClick={() => onChange(page - 1)}>{previousLabel}</button>
    <span>{page + 1} / {pages}</span>
    <button type="button" className="button button-secondary small-button" disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>{nextLabel}</button>
  </div>;
}
