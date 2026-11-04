'use client';

import { GitMerge, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

type FarmerOption = { id: number; name: string; farmerNumber?: number | null };
type MilkConflict = {
  sourceRecordId: number;
  targetRecordId: number;
  date: string;
  source: { morning: number; evening: number; valid: number; status: string; price: number; transportRate: number; sessionId: number | null };
  target: { morning: number; evening: number; valid: number; status: string; price: number; transportRate: number; sessionId: number | null };
};
type MergePreview = {
  source: { id: number; name: string; counts: Record<string, number> };
  target: { id: number; name: string; counts: Record<string, number> };
  milkConflicts: MilkConflict[];
  settlementReferenceConflicts: Array<{ sourceId: number; targetId: number; paymentType: string; paymentReference: string }>;
};

type Props = {
  open: boolean;
  source: FarmerOption | null;
  candidates: FarmerOption[];
  targetId: string;
  preview: MergePreview | null;
  loading: boolean;
  saving: boolean;
  error: string;
  reason: string;
  confirmation: string;
  resolutions: Record<string, string>;
  language: 'rw' | 'en';
  onTargetChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  onResolutionChange: (key: string, action: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function FarmerMergeDialog({
  open, source, candidates, targetId, preview, loading, saving, error, reason, confirmation, resolutions, language,
  onTargetChange, onReasonChange, onConfirmationChange, onResolutionChange, onClose, onSubmit,
}: Props) {
  if (!open || !source) return null;
  const en = language === 'en';
  const unresolved = preview?.milkConflicts.some((conflict) => !resolutions[`${conflict.sourceRecordId}:${conflict.targetRecordId}`]);
  const canMerge = Boolean(preview && targetId && reason.trim().length >= 5 && confirmation.trim() === source.name
    && !loading && !saving && !unresolved && preview.settlementReferenceConflicts.length === 0);
  const volume = (record: MilkConflict['source']) => `${record.morning} + ${record.evening} L; ${record.valid} L valid; ${record.status}; ${record.price} RWF/L; ${record.transportRate} RWF/L transport`;

  return (
    <Modal ariaLabel={en ? 'Merge duplicate farmer' : 'Huza aborozi'} className="modal-panel-wide" onClose={onClose} dismissible={!saving}>
      <div className="panel-heading">
        <div><span className="eyebrow">{en ? 'Source farmer' : 'Umworozi usibwa'}</span><h2>{source.name}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label={en ? 'Cancel' : 'Kureka'}><X size={18} aria-hidden="true" /></button>
      </div>
      <label>{en ? 'Canonical farmer to keep' : 'Umworozi ukomeza kubaho'}
        <select value={targetId} onChange={(event) => onTargetChange(event.target.value)} required disabled={saving}>
          <option value="">{en ? 'Select existing farmer' : 'Hitamo umworozi uriho'}</option>
          {candidates.filter((farmer) => farmer.id !== source.id).map((farmer) => <option key={farmer.id} value={String(farmer.id)}>{farmer.name}{farmer.farmerNumber ? ` · #${farmer.farmerNumber}` : ''}</option>)}
        </select>
      </label>
      {preview ? <>
        <p className="muted-note">{en ? `Source: ${preview.source.name} · Canonical: ${preview.target.name}` : `Usibwa: ${preview.source.name} · Usigara: ${preview.target.name}`}</p>
        {preview.settlementReferenceConflicts.length ? <div className="form-error" role="alert">{en ? 'Settlement references collide. Resolve these financial records before merging.' : 'Imibare y’ubwishyu irahura. Banza ukemure ubwo bwishyu.'}</div> : null}
        {preview.milkConflicts.length ? <section className="merge-conflict-list" aria-label={en ? 'Same-day milk record conflicts' : 'Amata yanditswe ku itariki imwe'}>
          <h3>{en ? 'Choose the physical delivery record to keep' : 'Hitamo inyandiko y’amata igomba kuguma'}</h3>
          {preview.milkConflicts.map((conflict) => {
            const key = `${conflict.sourceRecordId}:${conflict.targetRecordId}`;
            return <fieldset className="merge-conflict-row" key={key}>
              <legend>{conflict.date}</legend>
              <p>{preview.source.name}: {volume(conflict.source)}</p>
              <p>{preview.target.name}: {volume(conflict.target)}</p>
              <label><input type="radio" name={`merge-${key}`} checked={resolutions[key] === 'keep_source'} onChange={() => onResolutionChange(key, 'keep_source')} />{en ? 'Keep source delivery' : 'Gumana amata y’umworozi usibwa'}</label>
              <label><input type="radio" name={`merge-${key}`} checked={resolutions[key] === 'keep_target'} onChange={() => onResolutionChange(key, 'keep_target')} />{en ? 'Keep canonical delivery' : 'Gumana amata y’umworozi ukomeza'}</label>
              <label><input type="radio" name={`merge-${key}`} checked={resolutions[key] === 'combine'} onChange={() => onResolutionChange(key, 'combine')} />{en ? 'Both are distinct deliveries; combine totals' : 'Ni amata atandukanye; ateranyirize hamwe'}</label>
            </fieldset>;
          })}
        </section> : <p className="muted-note">{en ? 'No same-day milk record conflicts were found.' : 'Nta mata ahura ku itariki imwe yabonetse.'}</p>}
      </> : null}
      <label>{en ? 'Merge reason' : 'Impamvu yo guhuza'}<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => onReasonChange(event.target.value)} /></label>
      <label>{en ? `Type source farmer name: ${source.name}` : `Andika izina ry’umworozi usibwa: ${source.name}`}<input autoComplete="off" value={confirmation} onChange={(event) => onConfirmationChange(event.target.value)} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>{en ? 'Cancel' : 'Kureka'}</button>
        <button type="button" className="button button-primary" onClick={onSubmit} disabled={!canMerge} aria-busy={saving}><GitMerge size={16} aria-hidden="true" />{saving ? (en ? 'Merging…' : 'Birimo guhuza…') : (en ? 'Merge farmers' : 'Huza aborozi')}</button>
      </div>
    </Modal>
  );
}