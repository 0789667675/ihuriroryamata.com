'use client';

import type { KeyboardEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { ImportStatus } from '@/components/imports/import-ui';
import type { ImportCopyKey } from '@/lib/i18n/import-copy';
import type { ImportFarmer } from '@/lib/imports/client-api';
import type { MultiDayAssessment, MultiDayRowDraft } from '@/lib/imports/multi-day';

type Translate = (key: ImportCopyKey, params?: Record<string, string | number>) => string;

const formatNumber = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

const farmerNumberBadge = (farmer?: ImportFarmer | null) => (
  farmer?.farmerNumber ? `#${String(farmer.farmerNumber).padStart(3, '0')}` : ''
);

const dayHeading = (isoDate: string, language: string) => `${language === 'rw' ? 'Umunsi' : 'Day'} ${Number(isoDate.slice(8, 10))}`;

const isEditableCell = (input: HTMLInputElement) => (
  !input.disabled &&
  !input.readOnly &&
  !input.closest('[hidden], [inert], [aria-hidden="true"]') &&
  input.getClientRects().length > 0
);

const navigateMatrix = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  const { key, currentTarget } = event;
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Enter'].includes(key)) return;

  event.preventDefault();
  const table = currentTarget.closest('table');
  if (!table) return;

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const tableRows = Array.from(table.tBodies[0]?.rows || []);
    const currentRowIndex = tableRows.indexOf(currentTarget.closest('tr') as HTMLTableRowElement);
    const rowStep = key === 'ArrowDown' ? 1 : -1;
    for (let rowIndex = currentRowIndex + rowStep; rowIndex >= 0 && rowIndex < tableRows.length; rowIndex += rowStep) {
      const target = Array.from(tableRows[rowIndex].querySelectorAll<HTMLInputElement>('input[type="number"]'))
        .find((input) => input.dataset.dayIndex === currentTarget.dataset.dayIndex && input.dataset.session === currentTarget.dataset.session && isEditableCell(input));
      if (target) {
        target.focus();
        return;
      }
    }
    return;
  }

  const editableInputs = Array.from(table.querySelectorAll<HTMLInputElement>('tbody input[type="number"]')).filter(isEditableCell);
  const currentIndex = editableInputs.indexOf(currentTarget);
  const step = key === 'ArrowLeft' ? -1 : 1;
  editableInputs[currentIndex + step]?.focus();
};

/**
 * Compact Multi-Day Review Matrix:
 * # | Farmer | Day N… | Total Liters | Status
 * Each day cell edits morning / evening litres inline.
 */
export function MultiDayReviewMatrix({
  language,
  t,
  rows,
  assessments,
  dates,
  farmerById,
  farmerOptions,
  disabled,
  creatingUid,
  createError,
  onToggleInclude,
  onChooseFarmer,
  onCreateFarmer,
  onEditCell,
  onConfirmRow,
}: {
  language: string;
  t: Translate;
  rows: MultiDayRowDraft[];
  assessments: MultiDayAssessment[];
  dates: string[];
  farmerById: Map<number, ImportFarmer>;
  farmerOptions: (row: MultiDayRowDraft) => ImportFarmer[];
  disabled: boolean;
  creatingUid: number | null;
  createError: { uid: number; message: string } | null;
  onToggleInclude: (uid: number, include: boolean) => void;
  onChooseFarmer: (row: MultiDayRowDraft, value: string) => void;
  onCreateFarmer: (row: MultiDayRowDraft) => void;
  onEditCell: (uid: number, date: string, field: 'morning' | 'evening', value: string) => void;
  onConfirmRow: (uid: number) => void;
}) {
  const statusLabel = (status: MultiDayAssessment['status']) => {
    if (status === 'matched') return t('matched');
    if (status === 'review') return t('reviewBadge');
    if (status === 'needsMatch') return t('needsMatch');
    if (status === 'invalid') return t('invalid');
    return t('excluded');
  };
  const morningLabel = language === 'rw' ? 'Ijoro' : 'AM';
  const eveningLabel = language === 'rw' ? 'Nimugoroba' : 'PM';

  return <div className="table-scroll import-review-table import-multiday-table"><table>
    <thead>
      <tr>
        <th style={{ width: 50 }}>#</th>
        <th>{language === 'rw' ? 'Umworozi' : 'Farmer'}</th>
        {dates.map((date) => <th key={date} className="multiday-day-head" title={date}>{dayHeading(date, language)}<small>{date.slice(8)}/{date.slice(5, 7)}</small></th>)}
        <th>{language === 'rw' ? 'Litiro zose' : 'Total Liters'}</th>
        <th>{t('status')}</th>
      </tr>
    </thead>
    <tbody>{rows.map((row, index) => {
      const assessed = assessments[index];
      const farmer = row.farmerId ? farmerById.get(Number(row.farmerId)) : null;
      const needsConfirm = Object.values(assessed.cells).some((cell) => cell.state === 'review');
      return <tr key={row.uid} className={assessed.status === 'invalid' ? 'import-row-blocked' : assessed.status === 'review' || assessed.status === 'needsMatch' ? 'import-row-warning' : ''}>
        <td>
          <label className="import-row-number-label">
            <input type="checkbox" aria-label={`${t('include')} ${row.rowNumber}`} checked={row.include} disabled={disabled} onChange={(event) => onToggleInclude(row.uid, event.target.checked)} />
            <span>{row.rowNumber}</span>
          </label>
        </td>
        <td className="import-ocr-name">
          <div className="farmer-match-cell">
            {farmer
              ? <div className="matched-farmer-info"><b>{farmer.name} <span className="farmer-badge-id">{farmerNumberBadge(farmer)}</span></b>{row.nameText && row.nameText !== farmer.name ? <small>OCR: {row.nameText}</small> : null}</div>
              : <div className="unmatched-farmer-info"><b>{row.nameText || '—'}</b>{row.farmerNumber ? <small>#{String(row.farmerNumber).padStart(3, '0')}</small> : null}</div>}
            <div className="farmer-select-row">
              <select value={row.farmerId} onChange={(event) => onChooseFarmer(row, event.target.value)} disabled={disabled} aria-label={t('selectFarmer')}>
                <option value="">{t('selectFarmer')}</option>
                {farmerOptions(row).map((f) => <option key={f.id} value={f.id}>{f.name}{f.farmerNumber ? ` ${farmerNumberBadge(f)}` : ''}</option>)}
                <option value="__all__">{t('showAllFarmers')}</option>
              </select>
              {!row.farmerId ? <button type="button" className="button button-secondary small-button" disabled={disabled || creatingUid !== null} onClick={() => onCreateFarmer(row)}>
                <Plus size={12} aria-hidden="true" /> {creatingUid === row.uid ? t('savingFarmer') : (language === 'rw' ? 'Andika umworozi mushya' : 'Create New Farmer')}
              </button> : null}
            </div>
            {createError?.uid === row.uid ? <small className="text-danger" role="alert">{createError.message}</small> : null}
          </div>
        </td>
        {dates.map((date, dayIndex) => {
          const cell = row.days[date];
          const state = assessed.cells[date]?.state || 'empty';
          return <td key={date} className={`multiday-cell multiday-cell-${state}`}>
            <div className="multiday-cell-inputs">
              <label><span>{morningLabel}</span><input type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={cell?.morning ?? ''} disabled={disabled || !row.include} aria-label={`${row.nameText || row.rowNumber} ${date} ${morningLabel}`} data-day-index={dayIndex} data-session="morning" onFocus={(event) => event.currentTarget.select()} onKeyDown={navigateMatrix} onChange={(event) => onEditCell(row.uid, date, 'morning', event.target.value)} /></label>
              <label><span>{eveningLabel}</span><input type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={cell?.evening ?? ''} disabled={disabled || !row.include} aria-label={`${row.nameText || row.rowNumber} ${date} ${eveningLabel}`} data-day-index={dayIndex} data-session="evening" onFocus={(event) => event.currentTarget.select()} onKeyDown={navigateMatrix} onChange={(event) => onEditCell(row.uid, date, 'evening', event.target.value)} /></label>
            </div>
            {state === 'existing' ? <small>{language === 'rw' ? 'Yamaze kwandikwa' : 'Already recorded'}</small> : null}
            {cell?.raw && state !== 'record' && state !== 'empty' ? <small title={cell.raw}>OCR: {cell.raw}</small> : null}
          </td>;
        })}
        <td>
          <b className="multiday-total">{formatNumber(assessed.totalLiters)} L</b>
          {assessed.checksumStatus === 'verified' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>
              <Check size={12} /> {language === 'rw' ? 'Yemejwe' : 'Verified'}
            </span>
          ) : assessed.checksumStatus === 'mismatch' ? (
            <div style={{ fontSize: '0.75rem', color: '#d97706', fontWeight: 500, marginTop: 2 }}>
              ⚠️ {language === 'rw' ? `Total idahuye (${assessed.recordedTotal} L)` : `Mismatch (${assessed.recordedTotal} L)`}
            </div>
          ) : null}
        </td>
        <td className="import-status-cell">
          <ImportStatus status={assessed.status} label={statusLabel(assessed.status)} />
          {needsConfirm ? <button type="button" className="button button-secondary small-button" disabled={disabled} onClick={() => onConfirmRow(row.uid)}><Check size={12} aria-hidden="true" /> {t('confirmRow')}</button> : null}
        </td>
      </tr>;
    })}</tbody>
  </table></div>;
}
