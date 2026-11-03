'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Milk,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  applyMatrixDraft,
  createMatrixDraftKey,
  readMatrixDraft,
  writeMatrixDraft,
} from '@/lib/milk-matrix-draft.js';

export type MatrixDayEntry = {
  morning: string;
  evening: string;
  total?: number;
  recordId?: number;
};

type MatrixDraftEntries = Record<
  string,
  Record<string, Partial<Pick<MatrixDayEntry, 'morning' | 'evening'>>>
>;

export type MatrixFarmer = {
  farmerId: number;
  farmerNumber: number | null;
  farmerName: string;
  phone: string | null;
  collectionCenter?: string;
  days: Record<string, MatrixDayEntry>;
  totalLiters: number;
  expectedTotal?: number | null;
};

export type DigitalNotebookMatrixProps = {
  language?: 'rw' | 'en' | 'fr';
  centers?: Array<{ id: number | string; name: string }>;
  selectedCenterId?: string | number;
  onCenterChange?: (centerId: string) => void;
  onOpenScanner?: () => void;
  onSaveSuccess?: () => void;
};

type MatrixFarmerRowProps = {
  farmer: MatrixFarmer;
  farmerIndex: number;
  days: number[];
  month: number;
  entries: Record<string, MatrixDayEntry>;
  rowTotal: number;
  expectedTotal: number | null | undefined;
  pendingDays: MatrixDraftEntries[string];
  saveFailed: boolean;
  language: 'rw' | 'en' | 'fr';
  saving: boolean;
  draftNeedsRestore: boolean;
  onCellChange: (farmerId: number, day: number, session: 'morning' | 'evening', value: string) => void;
  onCellKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

const MatrixFarmerRow = React.memo(function MatrixFarmerRow({
  farmer,
  farmerIndex,
  days,
  month,
  entries,
  rowTotal,
  expectedTotal,
  pendingDays,
  saveFailed,
  language,
  saving,
  draftNeedsRestore,
  onCellChange,
  onCellKeyDown,
}: MatrixFarmerRowProps) {
  const hasMismatch = typeof expectedTotal === 'number' && Math.abs(rowTotal - expectedTotal) >= 0.05;
  const isVerified = typeof expectedTotal === 'number' && Math.abs(rowTotal - expectedTotal) < 0.05 && expectedTotal > 0;
  const codeLabel = farmer.farmerNumber
    ? `#${String(farmer.farmerNumber).padStart(3, '0')}`
    : `#${String(farmerIndex + 1).padStart(3, '0')}`;

  return (
    <tr className="matrix-row">
      <td className="matrix-sticky-col matrix-farmer-cell">
        <div className="matrix-farmer-info">
          <span className="matrix-farmer-code font-mono" style={{ fontSize: '0.75rem', padding: '2px 4px' }}>{codeLabel}</span>
          <span className="matrix-farmer-name" title={farmer.farmerName} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {farmer.farmerName}
          </span>
        </div>
      </td>
      {days.map((day, dayIndex) => {
        const cellData = entries[String(day)] || { morning: '', evening: '' };
        const morningValue = cellData.morning ?? '';
        const eveningValue = cellData.evening ?? '';
        const dayHasMilk = Number(morningValue) > 0 || Number(eveningValue) > 0;
        const morningUnsaved = pendingDays?.[String(day)]?.morning !== undefined;
        const eveningUnsaved = pendingDays?.[String(day)]?.evening !== undefined;

        return (
          <React.Fragment key={`cell-${farmer.farmerId}-${day}`}>
            <td className={`matrix-input-cell morning-cell ${dayHasMilk ? 'has-milk' : ''}`}>
              <input
                id={`cell-${farmer.farmerId}-${day}-morning`}
                type="text"
                inputMode="decimal"
                className={`matrix-cell-input ${morningUnsaved ? 'is-unsaved' : ''}`}
                data-farmer-index={farmerIndex}
                data-day-index={dayIndex}
                data-session="morning"
                value={morningValue}
                placeholder="—"
                disabled={saving || draftNeedsRestore}
                title={morningUnsaved ? (saveFailed ? 'Save failed — unsaved' : 'Unsaved') : undefined}
                style={morningUnsaved ? {
                  borderColor: saveFailed ? '#dc2626' : '#d97706',
                  boxShadow: `0 0 0 1px ${saveFailed ? '#dc2626' : '#d97706'}`,
                } : undefined}
                onChange={(event) => onCellChange(farmer.farmerId, day, 'morning', event.target.value)}
                onKeyDown={onCellKeyDown}
                aria-label={`${farmer.farmerName} umunsi ${day} igitondo${morningUnsaved ? (saveFailed ? ' — Save failed, unsaved' : ' — Unsaved') : ''}`}
              />
            </td>
            <td className={`matrix-input-cell evening-cell ${dayHasMilk ? 'has-milk' : ''}`}>
              <input
                id={`cell-${farmer.farmerId}-${day}-evening`}
                type="text"
                inputMode="decimal"
                className={`matrix-cell-input ${eveningUnsaved ? 'is-unsaved' : ''}`}
                data-farmer-index={farmerIndex}
                data-day-index={dayIndex}
                data-session="evening"
                value={eveningValue}
                placeholder="—"
                disabled={saving || draftNeedsRestore}
                title={eveningUnsaved ? (saveFailed ? 'Save failed — unsaved' : 'Unsaved') : undefined}
                style={eveningUnsaved ? {
                  borderColor: saveFailed ? '#dc2626' : '#d97706',
                  boxShadow: `0 0 0 1px ${saveFailed ? '#dc2626' : '#d97706'}`,
                } : undefined}
                onChange={(event) => onCellChange(farmer.farmerId, day, 'evening', event.target.value)}
                onKeyDown={onCellKeyDown}
                aria-label={`${farmer.farmerName} umunsi ${day} nimugoroba${eveningUnsaved ? (saveFailed ? ' — Save failed, unsaved' : ' — Unsaved') : ''}`}
              />
            </td>
          </React.Fragment>
        );
      })}
      <td className="matrix-total-cell">
        <div className="matrix-total-display">
          <b className="font-mono text-base">{rowTotal.toLocaleString()} L</b>
          {isVerified ? (
            <span className="matrix-badge-verified" title="Igiteranyo gihuye n'icyari cyitezwe">
              <Check size={12} /> {language === 'rw' ? 'Yuzuye' : 'Matched'}
            </span>
          ) : hasMismatch ? (
            <span className="matrix-badge-mismatch" title={`Cyitezwe: ${expectedTotal} L, Kibonetse: ${rowTotal} L`}>
              ⚠️ {rowTotal < (expectedTotal || 0) ? `-${((expectedTotal || 0) - rowTotal).toFixed(1)} L` : `+${(rowTotal - (expectedTotal || 0)).toFixed(1)} L`}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
});

export function DigitalNotebookMatrix({
  language = 'rw',
  centers = [],
  selectedCenterId,
  onCenterChange,
  onOpenScanner,
  onSaveSuccess,
}: DigitalNotebookMatrixProps) {
  const now = new Date();
  const currentDay = now.getUTCDate();

  // State
  const [year, setYear] = useState<number>(now.getUTCFullYear());
  const [month, setMonth] = useState<number>(now.getUTCMonth() + 1);
  const [periodType, setPeriodType] = useState<'first-half' | 'second-half'>(
    currentDay > 15 ? 'second-half' : 'first-half'
  );
  const [centerId, setCenterId] = useState<string | number>(
    selectedCenterId || (centers[0]?.id ?? 1)
  );
  const draftStorageKey = useMemo(
    () => createMatrixDraftKey({ centerId, year, month, periodType }),
    [centerId, year, month, periodType]
  );

  const [farmers, setFarmers] = useState<MatrixFarmer[]>([]);
  const [matrixData, setMatrixData] = useState<Record<number, Record<string, MatrixDayEntry>>>({});
  const [pendingDraft, setPendingDraft] = useState<MatrixDraftEntries>({});
  const [draftNeedsRestore, setDraftNeedsRestore] = useState<boolean>(false);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState<boolean>(false);
  const [saveConfirmed, setSaveConfirmed] = useState<boolean>(false);
  const [expectedTotals, setExpectedTotals] = useState<Record<number, number | null>>({});
  const [centerPrice, setCenterPrice] = useState<number>(400);
  const [centerName, setCenterName] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const pendingDraftRef = useRef<MatrixDraftEntries>({});
  const serverMatrixDataRef = useRef<Record<number, Record<string, MatrixDayEntry>>>({});
  const draftNeedsRestoreRef = useRef<boolean>(false);
  const matrixTableRef = useRef<HTMLTableElement>(null);

  // Sync centerId when selectedCenterId prop changes
  useEffect(() => {
    if (selectedCenterId) {
      setCenterId(selectedCenterId);
    }
  }, [selectedCenterId]);

  // Determine period days
  const lastDayOfMonth = useMemo(() => new Date(Date.UTC(year, month, 0)).getUTCDate(), [year, month]);
  const startDay = periodType === 'second-half' ? 16 : 1;
  const endDay = periodType === 'second-half' ? lastDayOfMonth : 15;
  const days = useMemo(() => {
    const list: number[] = [];
    for (let d = startDay; d <= endDay; d += 1) {
      list.push(d);
    }
    return list;
  }, [startDay, endDay]);

  // Load batch matrix data from API
  const loadMatrixData = useCallback(async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const params = new URLSearchParams({
        month: String(month),
        year: String(year),
        periodType,
      });
      if (centerId && String(centerId).trim() !== '' && String(centerId) !== '0') {
        params.append('centerId', String(centerId));
        params.append('collectionCenterId', String(centerId));
      }

      const res = await fetch(`/api/milk/batch-matrix?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.message || errJson.details || `Server returned ${res.status}`);
      }
      const data = await res.json();

      const rawFarmers: MatrixFarmer[] = (Array.isArray(data.farmers) ? data.farmers : []).map((f: any) => ({
        farmerId: Number(f.farmerId ?? f.id),
        farmerNumber: f.farmerNumber ?? f.farmer_number ? Number(f.farmerNumber ?? f.farmer_number) : null,
        farmerName: f.farmerName || f.names || f.name || `Umworozi #${f.id || f.farmerId}`,
        phone: f.phone || null,
        collectionCenter: f.collectionCenter || f.collection_center || '',
        days: f.days || {},
        totalLiters: Number(f.totalLiters || 0),
        expectedTotal: f.expectedTotal !== undefined ? f.expectedTotal : null,
      }));
      setFarmers(rawFarmers);

      const newMatrix: Record<number, Record<string, MatrixDayEntry>> = {};
      const newExpected: Record<number, number | null> = {};

      for (const f of rawFarmers) {
        const fid = f.farmerId;
        if (data.matrix && data.matrix[fid]) {
          const dayEntries: Record<string, MatrixDayEntry> = {};
          for (const [d, vals] of Object.entries<any>(data.matrix[fid])) {
            dayEntries[String(d)] = {
              morning: vals && vals.morning > 0 ? String(vals.morning) : '',
              evening: vals && vals.evening > 0 ? String(vals.evening) : '',
              total: Number(vals?.total || 0),
              recordId: vals?.recordId,
            };
          }
          newMatrix[fid] = dayEntries;
        } else {
          newMatrix[fid] = f.days || {};
        }
        newExpected[fid] = f.expectedTotal ?? null;
      }

      serverMatrixDataRef.current = newMatrix;
      setMatrixData(
        draftNeedsRestoreRef.current
          ? newMatrix
          : applyMatrixDraft(newMatrix, pendingDraftRef.current)
      );
      setExpectedTotals(newExpected);
      if (data.center?.pricePerLiter) {
        setCenterPrice(Number(data.center.pricePerLiter));
      }
      if (data.center?.name) {
        setCenterName(data.center.name);
      }
    } catch (err: any) {
      console.error('Matrix load failure:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || (language === 'rw' ? "Ntibyakunze gufata amakuru y'ikaye." : 'Failed to load notebook matrix data.'),
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, periodType, centerId, language]);

  useEffect(() => {
    loadMatrixData();
  }, [loadMatrixData]);

  useEffect(() => {
    pendingDraftRef.current = {};
    draftNeedsRestoreRef.current = false;
    setPendingDraft({});
    setDraftNeedsRestore(false);
    setDraftStorageError(null);
    setSaveFailed(false);
    setSaveConfirmed(false);

    try {
      const savedDraft = readMatrixDraft(window.localStorage, draftStorageKey);
      if (savedDraft) {
        pendingDraftRef.current = savedDraft;
        draftNeedsRestoreRef.current = true;
        setPendingDraft(savedDraft);
        setDraftNeedsRestore(true);
      }
    } catch (error) {
      console.error('Milk matrix draft load failure:', error);
      draftNeedsRestoreRef.current = true;
      setDraftNeedsRestore(true);
      setDraftStorageError(
        language === 'rw'
          ? 'Draft ntishoboye gusomwa muri browser. Ntizahanaguwe.'
          : 'The local draft could not be read. It has not been discarded.'
      );
    }
  }, [draftStorageKey, language]);

  const persistDraft = (entries: MatrixDraftEntries) => {
    try {
      writeMatrixDraft(window.localStorage, draftStorageKey, entries);
      setDraftStorageError(null);
    } catch (error) {
      console.error('Milk matrix draft save failure:', error);
      setDraftStorageError(
        language === 'rw'
          ? 'Draft ntishoboye kubikwa muri browser. Ongera ugerageze.'
          : 'The local draft could not be saved in this browser. Please try again.'
      );
    }
  };

  // Handle cell volume change
  const handleCellChange = useCallback((farmerId: number, day: number, session: 'morning' | 'evening', value: string) => {
    const dayStr = String(day);
    const farmerKey = String(farmerId);
    const nextDraft: MatrixDraftEntries = { ...pendingDraftRef.current };
    const farmerDraft = { ...(nextDraft[farmerKey] || {}) };
    const dayDraft = { ...(farmerDraft[dayStr] || {}) };
    const serverValue = serverMatrixDataRef.current[farmerId]?.[dayStr]?.[session] ?? '';
    if (value === serverValue) delete dayDraft[session];
    else dayDraft[session] = value;
    if (Object.keys(dayDraft).length) farmerDraft[dayStr] = dayDraft;
    else delete farmerDraft[dayStr];
    if (Object.keys(farmerDraft).length) nextDraft[farmerKey] = farmerDraft;
    else delete nextDraft[farmerKey];
    pendingDraftRef.current = nextDraft;
    setPendingDraft(nextDraft);
    if (saveFailed) setStatusMessage(null);
    setSaveFailed(false);
    setSaveConfirmed(false);
    persistDraft(nextDraft);

    setMatrixData((prev) => {
      const farmerDays = prev[farmerId] || {};
      const currentCell = farmerDays[dayStr] || { morning: '', evening: '' };
      return {
        ...prev,
        [farmerId]: {
          ...farmerDays,
          [dayStr]: {
            ...currentCell,
            [session]: value,
          },
        },
      };
    });
  }, [draftStorageKey, language, saveFailed]);

  // Cell keyboard navigation
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
    e.preventDefault();

    const table = matrixTableRef.current;
    if (!table) return;
    const allCells = Array.from(table.querySelectorAll<HTMLInputElement>('.matrix-cell-input'));
    const editableCells = allCells.filter((cell) => !cell.disabled && !cell.readOnly && cell.getAttribute('aria-readonly') !== 'true');
    const currentCell = e.currentTarget;
    const currentIndex = editableCells.indexOf(currentCell);
    if (currentIndex < 0) return;

    let target: HTMLInputElement | undefined;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const currentFarmerIndex = Number(currentCell.dataset.farmerIndex);
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      target = editableCells
        .filter((cell) =>
          cell.dataset.dayIndex === currentCell.dataset.dayIndex
          && cell.dataset.session === currentCell.dataset.session
          && (Number(cell.dataset.farmerIndex) - currentFarmerIndex) * direction > 0
        )
        .sort((a, b) =>
          Math.abs(Number(a.dataset.farmerIndex) - currentFarmerIndex)
          - Math.abs(Number(b.dataset.farmerIndex) - currentFarmerIndex)
        )[0];
    } else {
      const direction = e.key === 'ArrowLeft' ? -1 : 1;
      target = editableCells[currentIndex + direction];
    }

    if (target) {
      target.focus();
      if (target.value.trim() !== '' && Number.isFinite(Number(target.value))) target.select();
    }
  }, []);

  // Calculate row total liters
  const calculateRowTotal = useCallback(
    (farmerId: number) => {
      const farmerDays = matrixData[farmerId] || {};
      let sum = 0;
      for (const d of days) {
        const entry = farmerDays[String(d)];
        if (entry) {
          const m = Number(entry.morning) || 0;
          const ev = Number(entry.evening) || 0;
          sum += m + ev;
        }
      }
      return Math.round(sum * 100) / 100;
    },
    [matrixData, days]
  );

  // Filter farmers by search query
  const filteredFarmers = useMemo(() => {
    if (!searchQuery.trim()) return farmers;
    const q = searchQuery.toLowerCase().trim();
    return farmers.filter((f) => {
      const numMatch = f.farmerNumber ? String(f.farmerNumber).includes(q) : false;
      const nameMatch = f.farmerName.toLowerCase().includes(q);
      const phoneMatch = f.phone ? f.phone.includes(q) : false;
      return numMatch || nameMatch || phoneMatch;
    });
  }, [farmers, searchQuery]);

  // Summary statistics
  const summary = useMemo(() => {
    let activeCount = 0;
    let totalLiters = 0;
    for (const f of farmers) {
      const rowSum = calculateRowTotal(f.farmerId);
      if (rowSum > 0) {
        activeCount += 1;
        totalLiters += rowSum;
      }
    }
    totalLiters = Math.round(totalLiters * 100) / 100;
    const grandValue = Math.round(totalLiters * centerPrice);
    return {
      activeCount,
      totalFarmers: farmers.length,
      totalLiters,
      grandValue,
    };
  }, [farmers, calculateRowTotal, centerPrice]);

  const pendingCellCount = useMemo(
    () =>
      Object.values(pendingDraft).reduce(
        (total, farmerDays) =>
          total +
          Object.values(farmerDays).reduce(
            (dayTotal, sessions) =>
              dayTotal + Number(sessions.morning !== undefined) + Number(sessions.evening !== undefined),
            0
          ),
        0
      ),
    [pendingDraft]
  );

  const handleRestoreDraft = () => {
    if (pendingCellCount === 0) {
      setDraftStorageError(
        language === 'rw'
          ? 'Nta makuru ashoboye kugarurwa muri iyi draft.'
          : 'No entries could be restored from this draft.'
      );
      return;
    }
    setMatrixData((current) => applyMatrixDraft(current, pendingDraftRef.current));
    draftNeedsRestoreRef.current = false;
    setDraftNeedsRestore(false);
    setSaveFailed(false);
  };

  const handleDiscardDraft = () => {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch (error) {
      console.error('Milk matrix draft discard failure:', error);
      setDraftStorageError(
        language === 'rw'
          ? 'Draft ntiyashoboye gusibwa. Ongera ugerageze.'
          : 'The local draft could not be discarded. Please try again.'
      );
      return;
    }
    pendingDraftRef.current = {};
    draftNeedsRestoreRef.current = false;
    setPendingDraft({});
    setDraftNeedsRestore(false);
    setDraftStorageError(null);
    setSaveFailed(false);
    setSaveConfirmed(false);
    setMatrixData(serverMatrixDataRef.current);
  };

  // Save all 15 days batch
  const handleSaveAll = async () => {
    if (saving || draftNeedsRestore) return;
    const editedDraft = pendingDraftRef.current;
    const entriesPayload = Object.entries(editedDraft).map(([farmerId, editedDays]) => {
      const currentDays = matrixData[Number(farmerId)] || {};
      const daysToSave = Object.fromEntries(Object.keys(editedDays).map((day) => {
        const current = currentDays[day] || { morning: '', evening: '' };
        return [day, { morning: current.morning ?? '', evening: current.evening ?? '' }];
      }));
      return { farmerId: Number(farmerId), days: daysToSave };
    }).filter((entry) => Object.keys(entry.days).length > 0);
    const submittedDayCount = entriesPayload.reduce((total, entry) => total + Object.keys(entry.days).length, 0);
    if (submittedDayCount === 0) return;

    setSaving(true);
    setStatusMessage(null);
    setSaveConfirmed(false);

    try {
      const res = await fetch('/api/milk/batch-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          collectionCenterId: Number(centerId),
          year,
          month,
          periodType,
          entries: entriesPayload,
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success !== true || Number(result.savedCount) !== submittedDayCount) {
        throw new Error(result.message || 'Failed to save batch matrix.');
      }

      pendingDraftRef.current = {};
      draftNeedsRestoreRef.current = false;
      setPendingDraft({});
      setDraftNeedsRestore(false);
      setSaveFailed(false);
      setSaveConfirmed(true);
      try {
        writeMatrixDraft(window.localStorage, draftStorageKey, {});
        setDraftStorageError(null);
      } catch (error) {
        console.error('Milk matrix draft cleanup failure:', error);
        setDraftStorageError(
          language === 'rw'
            ? 'Byabitswe kuri server, ariko draft yo muri browser ntiyashoboye gusibwa.'
            : 'Saved on the server, but the browser draft could not be cleared.'
        );
      }

      setStatusMessage({
        type: 'success',
        text:
          language === 'rw'
            ? `✓ Byabitswe neza! Iminsi ${submittedDayCount} y'aborozi yemejwe. Igiteranyo cy'iki gihe: ${summary.totalLiters.toLocaleString()} L.`
            : `✓ Saved successfully! ${submittedDayCount} farmer-day entr${submittedDayCount === 1 ? 'y' : 'ies'} confirmed. Period total: ${summary.totalLiters.toLocaleString()} L.`,
      });

      if (onSaveSuccess) {
        onSaveSuccess();
      }
      // Reload fresh data from database
      await loadMatrixData();
    } catch (err: any) {
      setSaveFailed(true);
      setSaveConfirmed(false);
      setStatusMessage({
        type: 'error',
        text: err.message || (language === 'rw' ? 'Kubika byanze. Ongera ugerageze.' : 'Failed to save. Try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  // Month names
  const monthLabels: Record<number, { rw: string; en: string }> = {
    1: { rw: 'Mutarama (Ukwa 1)', en: 'January' },
    2: { rw: 'Gashyantare (Ukwa 2)', en: 'February' },
    3: { rw: 'Werurwe (Ukwa 3)', en: 'March' },
    4: { rw: 'Mata (Ukwa 4)', en: 'April' },
    5: { rw: 'Gicurasi (Ukwa 5)', en: 'May' },
    6: { rw: 'Kamena (Ukwa 6)', en: 'June' },
    7: { rw: 'Nyakanga (Ukwa 7)', en: 'July' },
    8: { rw: 'Kanama (Ukwa 8)', en: 'August' },
    9: { rw: 'Nzeli (Ukwa 9)', en: 'September' },
    10: { rw: 'Ukwakira (Ukwa 10)', en: 'October' },
    11: { rw: 'Ugushyingo (Ukwa 11)', en: 'November' },
    12: { rw: 'Ukuboza (Ukwa 12)', en: 'December' },
  };

  return (
    <div className="digital-notebook-matrix-container">
      {/* Top Controls Bar */}
      <div className="matrix-topbar">
        <div className="matrix-period-controls">
          {/* Half-Month Period Toggle */}
          <div className="matrix-toggle-group" role="radiogroup" aria-label="Igihe cy'ikaye">
            <button
              type="button"
              className={`matrix-toggle-button ${periodType === 'first-half' ? 'active' : ''}`}
              onClick={() => setPeriodType('first-half')}
              disabled={loading || saving}
            >
              <CalendarDays size={16} aria-hidden="true" />
              <span>{language === 'rw' ? 'Igice cya 1: Iminsi 1–15' : 'Part 1: Days 1–15'}</span>
            </button>
            <button
              type="button"
              className={`matrix-toggle-button ${periodType === 'second-half' ? 'active' : ''}`}
              onClick={() => setPeriodType('second-half')}
              disabled={loading || saving}
            >
              <CalendarDays size={16} aria-hidden="true" />
              <span>{language === 'rw' ? `Igice cya 2: Iminsi 16–${lastDayOfMonth}` : `Part 2: Days 16–${lastDayOfMonth}`}</span>
            </button>
          </div>

          {/* Month & Year Selectors */}
          <div className="matrix-date-selectors">
            <select
              className="matrix-select"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              disabled={loading || saving}
              aria-label="Ukwezi"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={m}>
                  {language === 'rw' ? monthLabels[m]?.rw : monthLabels[m]?.en}
                </option>
              ))}
            </select>

            <select
              className="matrix-select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={loading || saving}
              aria-label="Umwaka"
            >
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            {centers.length > 1 && (
              <select
                className="matrix-select"
                value={centerId}
                onChange={(e) => {
                  setCenterId(e.target.value);
                  if (onCenterChange) onCenterChange(e.target.value);
                }}
                disabled={loading || saving}
                aria-label="Ikigo cy'ikusanyirizo"
              >
                {centers.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Search and Action Bar */}

      <div className="matrix-search-box" style={{ width: '100%', marginBottom: 12 }}>
        <Search size={16} className="matrix-search-icon" aria-hidden="true" />
        <input
          type="text"
          placeholder={language === 'rw' ? 'Shakisha umworozi cyangwa #001...' : 'Search farmer or #001...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="matrix-search-input"
          style={{ width: '100%' }}
        />
        {searchQuery && (
          <button
            type="button"
            className="matrix-clear-button"
            onClick={() => setSearchQuery('')}
            aria-label="Siba ishakisha"
          >
            <X size={14} />
          </button>
        )}
      </div><div className="matrix-actions-bar" style={{ display: 'none' }}>


          <button
            type="button"
            className="matrix-refresh-button"
            onClick={loadMatrixData}
            disabled={loading || saving}
            title={language === 'rw' ? 'Vugurura amakuru' : 'Refresh data'}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>

          {onOpenScanner && (
            <button
              type="button"
              className="matrix-scanner-trigger-button"
              onClick={onOpenScanner}
              disabled={loading || saving}
            >
              <Sparkles size={16} aria-hidden="true" />
              <span>{language === 'rw' ? "📷 Fata Ifoto y'Ikaye (OCR)" : "📷 Scan Notebook (OCR)"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification Banner */}
      {draftNeedsRestore ? (
        <div className="matrix-status-banner is-error" role="status">
          <div className="matrix-status-content-wrap">
            <span>
              {language === 'rw'
                ? 'Draft y’amata itarabikwa irahari kuri iki gihe.'
                : 'A local draft exists for this period.'}
            </span>
            <button type="button" className="matrix-retry-link" onClick={handleRestoreDraft} disabled={loading}>
              <span>{language === 'rw' ? 'Subizamo ibyanditswe (Restore unsaved entries)' : 'Restore unsaved entries'}</span>
            </button>
            <button type="button" className="matrix-retry-link" onClick={handleDiscardDraft}>
              <span>{language === 'rw' ? 'Siba draft (Discard draft)' : 'Discard draft'}</span>
            </button>
            {draftStorageError && <span role="alert">{draftStorageError}</span>}
          </div>
        </div>
      ) : pendingCellCount > 0 ? (
        <div className={`matrix-status-banner ${saveFailed ? 'is-error' : 'is-success'}`} role="status" aria-live="polite">
          <span>
            {saveFailed
              ? language === 'rw'
                ? `Kubika byanze. ${pendingCellCount} byanditswe biracyabitswe muri draft.`
                : `Save failed. ${pendingCellCount} edited value(s) remain unsaved in the local draft.`
              : language === 'rw'
                ? `${pendingCellCount} bitarabikwa`
                : `${pendingCellCount} unsaved value(s)`}
          </span>
          {draftStorageError && <span role="alert">{draftStorageError}</span>}
        </div>
      ) : saveConfirmed ? (
        <div className="matrix-status-banner is-success" role="status" aria-live="polite">
          {language === 'rw' ? 'Byabitswe kuri server.' : 'Saved on the server.'}
        </div>
      ) : null}

      {statusMessage && (
        <div className={`matrix-status-banner ${statusMessage.type === 'error' ? 'is-error' : 'is-success'}`} role="alert">
          <div className="matrix-status-content-wrap">
            <span>{statusMessage.text}</span>
            {statusMessage.type === 'error' && (
              <button
                type="button"
                className="matrix-retry-link"
                onClick={saveFailed ? handleSaveAll : loadMatrixData}
                disabled={loading || saving}
              >
                <RefreshCw size={12} className={loading || saving ? 'animate-spin' : ''} />
                <span>
                  {saveFailed
                    ? language === 'rw' ? 'Ongera ubike' : 'Retry save'
                    : language === 'rw' ? 'Ongera ugerageze' : 'Retry'}
                </span>
              </button>
            )}
          </div>
          <button
            type="button"
            className="matrix-banner-dismiss"
            onClick={() => setStatusMessage(null)}
            aria-label="Funga ubutumwa"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Table Scrollport */}
      <div className="matrix-table-wrapper">
        {loading ? (
          <div className="matrix-loading-overlay">
            <Loader2 size={32} className="animate-spin text-[#1681ab]" />
            <p>{language === 'rw' ? "Ikaye y'amata irimo gukururwa..." : 'Loading digital milk notebook...'}</p>
          </div>
        ) : filteredFarmers.length === 0 ? (
          <div className="matrix-empty-state">
            <Milk size={36} className="text-[#1681ab] opacity-60" />
            <b>{language === 'rw' ? 'Nta mworozi wabonetse' : 'No farmers found'}</b>
            <p>
              {searchQuery
                ? language === 'rw'
                  ? 'Nta mworozi uhuye n’ibyo ushaka.'
                  : 'No farmers match your search query.'
                : language === 'rw'
                ? 'Banza wandike aborozi muri sisitemu kugira ngo utangire kuzuza ikaye.'
                : 'Add farmers to the directory first to start recording notebook deliveries.'}
            </p>
          </div>
        ) : (
          <div className="matrix-table-scroll">
            <table ref={matrixTableRef} className="matrix-table" aria-label="Ikaye y'Amata Matrix">
              <thead>
                <tr className="matrix-header-row-primary">
                  {/* Sticky Frozen Top-Left Header */}
                  <th className="matrix-sticky-col matrix-col-header-farmer" rowSpan={2}>
                    <div className="matrix-header-farmer-title">
                      <span>#</span>
                      <span>{language === 'rw' ? 'Umworozi' : 'Farmer Name'}</span>
                    </div>
                  </th>

                  {/* 15 Daily Columns Headers */}
                  {days.map((d) => (
                    <th key={d} colSpan={2} className="matrix-day-header">
                      <div className="matrix-day-header-content">
                        <b>{language === 'rw' ? `Umunsi ${d}` : `Day ${d}`}</b>
                        <small>{String(d).padStart(2, '0')}/{String(month).padStart(2, '0')}</small>
                      </div>
                    </th>
                  ))}

                  {/* Total Column Header */}
                  <th className="matrix-col-header-total" rowSpan={2}>
                    <div className="matrix-total-header-content">
                      <span>= {language === 'rw' ? 'Igiteranyo' : 'Total'}</span>
                      <small>(L)</small>
                    </div>
                  </th>
                </tr>

                {/* Subheader: Morning (Igitondo) & Evening (Nimugoroba) per day */}
                <tr className="matrix-header-row-secondary">
                  {days.map((d) => (
                    <React.Fragment key={`sub-${d}`}>
                      <th className="matrix-subcol-morning" title={language === 'rw' ? 'Igitondo' : 'Morning'}>
                        {language === 'rw' ? 'Igi' : 'AM'}
                      </th>
                      <th className="matrix-subcol-evening" title={language === 'rw' ? 'Nimugoroba' : 'Evening'}>
                        {language === 'rw' ? 'Nimu' : 'PM'}
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredFarmers.map((farmer, fIdx) => {
                  const rowTotal = calculateRowTotal(farmer.farmerId);
                  const expected = expectedTotals[farmer.farmerId];
                  const hasMismatch = typeof expected === 'number' && Math.abs(rowTotal - expected) >= 0.05;
                  const isVerified = typeof expected === 'number' && Math.abs(rowTotal - expected) < 0.05 && expected > 0;
                  const codeLabel = farmer.farmerNumber
                    ? `#${String(farmer.farmerNumber).padStart(3, '0')}`
                    : `#${String(fIdx + 1).padStart(3, '0')}`;

                  return (
                    <tr key={farmer.farmerId} className="matrix-row">
                      {/* Sticky Left Column: #001 monospace + Farmer Name */}
                      <td className="matrix-sticky-col matrix-farmer-cell">
                        <div className="matrix-farmer-info">
      <span className="matrix-farmer-code font-mono" style={{ fontSize: '0.75rem', padding: '2px 4px' }}>{codeLabel}</span>
      <span className="matrix-farmer-name" title={farmer.farmerName} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {farmer.farmerName}
      </span>
  </div>
                      </td>

                      {/* 15 Daily Columns: Morning + Evening Inputs */}
                      {days.map((d, dIdx) => {
                        const cellData = matrixData[farmer.farmerId]?.[String(d)] || { morning: '', evening: '' };
                        const morningVal = cellData.morning ?? '';
                        const eveningVal = cellData.evening ?? '';
                        const dayHasMilk = Number(morningVal) > 0 || Number(eveningVal) > 0;
                        const morningUnsaved = pendingDraft[String(farmer.farmerId)]?.[String(d)]?.morning !== undefined;
                        const eveningUnsaved = pendingDraft[String(farmer.farmerId)]?.[String(d)]?.evening !== undefined;

                        return (
                          <React.Fragment key={`cell-${farmer.farmerId}-${d}`}>
                            {/* Morning Cell */}
                            <td className={`matrix-input-cell morning-cell ${dayHasMilk ? 'has-milk' : ''}`}>
                              <input
                                id={`cell-${farmer.farmerId}-${d}-morning`}
                                type="text"
                                inputMode="decimal"
                                className={`matrix-cell-input ${morningUnsaved ? 'is-unsaved' : ''}`}
                                data-farmer-index={fIdx}
                                data-day-index={dIdx}
                                data-session="morning"
                                value={morningVal}
                                placeholder="—"
                                disabled={saving || draftNeedsRestore}
                                title={morningUnsaved ? (saveFailed ? 'Save failed — unsaved' : 'Unsaved') : undefined}
                                style={morningUnsaved ? {
                                  borderColor: saveFailed ? '#dc2626' : '#d97706',
                                  boxShadow: `0 0 0 1px ${saveFailed ? '#dc2626' : '#d97706'}`,
                                } : undefined}
                                onChange={(e) => handleCellChange(farmer.farmerId, d, 'morning', e.target.value)}
                                onKeyDown={handleCellKeyDown}
                                aria-label={`${farmer.farmerName} umunsi ${d} igitondo${morningUnsaved ? (saveFailed ? ' — Save failed, unsaved' : ' — Unsaved') : ''}`}
                              />
                            </td>

                            {/* Evening Cell */}
                            <td className={`matrix-input-cell evening-cell ${dayHasMilk ? 'has-milk' : ''}`}>
                              <input
                                id={`cell-${farmer.farmerId}-${d}-evening`}
                                type="text"
                                inputMode="decimal"
                                className={`matrix-cell-input ${eveningUnsaved ? 'is-unsaved' : ''}`}
                                data-farmer-index={fIdx}
                                data-day-index={dIdx}
                                data-session="evening"
                                value={eveningVal}
                                placeholder="—"
                                disabled={saving || draftNeedsRestore}
                                title={eveningUnsaved ? (saveFailed ? 'Save failed — unsaved' : 'Unsaved') : undefined}
                                style={eveningUnsaved ? {
                                  borderColor: saveFailed ? '#dc2626' : '#d97706',
                                  boxShadow: `0 0 0 1px ${saveFailed ? '#dc2626' : '#d97706'}`,
                                } : undefined}
                                onChange={(e) => handleCellChange(farmer.farmerId, d, 'evening', e.target.value)}
                                onKeyDown={handleCellKeyDown}
                                aria-label={`${farmer.farmerName} umunsi ${d} nimugoroba${eveningUnsaved ? (saveFailed ? ' — Save failed, unsaved' : ' — Unsaved') : ''}`}
                              />
                            </td>
                          </React.Fragment>
                        );
                      })}

                      {/* Live Row Total Column */}
                      <td className="matrix-total-cell">
                        <div className="matrix-total-display">
                          <b className="font-mono text-base">{rowTotal.toLocaleString()} L</b>
                          {isVerified ? (
                            <span className="matrix-badge-verified" title="Igiteranyo gihuye n'icyari cyitezwe">
                              <Check size={12} /> {language === 'rw' ? 'Yuzuye' : 'Matched'}
                            </span>
                          ) : hasMismatch ? (
                            <span className="matrix-badge-mismatch" title={`Cyitezwe: ${expected} L, Kibonetse: ${rowTotal} L`}>
                              ⚠️ {rowTotal < (expected || 0) ? `-${((expected || 0) - rowTotal).toFixed(1)} L` : `+${(rowTotal - (expected || 0)).toFixed(1)} L`}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sticky Bottom Summary Bar */}
      <div className="matrix-bottom-summary-bar">
        <div className="matrix-summary-stats">
          <div className="matrix-stat-item">
            <span className="matrix-stat-label">{language === 'rw' ? 'Aborozi batanze amata' : 'Active Farmers'}:</span>
            <b className="matrix-stat-value font-mono">
              {summary.activeCount} / {summary.totalFarmers}
            </b>
          </div>

          <div className="matrix-stat-divider" />

          <div className="matrix-stat-item">
            <span className="matrix-stat-label">{language === 'rw' ? "Litiro z'iki gice" : 'Period Volume'}:</span>
            <b className="matrix-stat-value font-mono text-[#0b5d7e]">
              {summary.totalLiters.toLocaleString()} L
            </b>
          </div>

          <div className="matrix-stat-divider" />

          <div className="matrix-stat-item">
            <span className="matrix-stat-label">{language === 'rw' ? 'Agaciro kose' : 'Grand Value'}:</span>
            <b className="matrix-stat-value font-mono text-[#1681ab]">
              {summary.grandValue.toLocaleString()} RWF
            </b>
            <small className="matrix-stat-sub">({centerPrice} RWF/L)</small>
          </div>
        </div>

        <div className="matrix-save-action">
          <button
            type="button"
            className="matrix-save-all-button"
            onClick={handleSaveAll}
            disabled={saving || loading || draftNeedsRestore || pendingCellCount === 0 || filteredFarmers.length === 0}
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>{language === 'rw' ? 'Birimo kubikwa...' : 'Saving All...'}</span>
              </>
            ) : (
              <>
                <Save size={18} aria-hidden="true" />
                <span>{language === 'rw' ? 'Bika Byose Rimwe (Save All 15 Days)' : 'Save All 15 Days'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
