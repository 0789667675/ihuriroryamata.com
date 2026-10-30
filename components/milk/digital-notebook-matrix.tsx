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

export type MatrixDayEntry = {
  morning: string;
  evening: string;
  total?: number;
  recordId?: number;
};

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

  const [farmers, setFarmers] = useState<MatrixFarmer[]>([]);
  const [matrixData, setMatrixData] = useState<Record<number, Record<string, MatrixDayEntry>>>({});
  const [expectedTotals, setExpectedTotals] = useState<Record<number, number | null>>({});
  const [centerPrice, setCenterPrice] = useState<number>(400);
  const [centerName, setCenterName] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
        year: String(year),
        month: String(month),
        periodType,
        collectionCenterId: String(centerId),
      });
      const res = await fetch(`/api/milk/batch-matrix?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to load notebook matrix data.');
      }
      const data = await res.json();

      const rawFarmers: MatrixFarmer[] = Array.isArray(data.farmers) ? data.farmers : [];
      setFarmers(rawFarmers);

      const newMatrix: Record<number, Record<string, MatrixDayEntry>> = {};
      const newExpected: Record<number, number | null> = {};

      for (const f of rawFarmers) {
        newMatrix[f.farmerId] = f.days || {};
        newExpected[f.farmerId] = f.expectedTotal ?? null;
      }

      setMatrixData(newMatrix);
      setExpectedTotals(newExpected);
      if (data.center?.pricePerLiter) {
        setCenterPrice(Number(data.center.pricePerLiter));
      }
      if (data.center?.name) {
        setCenterName(data.center.name);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || (language === 'rw' ? 'Gufungura ikaye byanze.' : 'Failed to load notebook matrix.'),
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, periodType, centerId, language]);

  useEffect(() => {
    loadMatrixData();
  }, [loadMatrixData]);

  // Handle cell volume change
  const handleCellChange = (farmerId: number, day: number, session: 'morning' | 'evening', value: string) => {
    const dayStr = String(day);
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
  };

  // Cell keyboard navigation
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    farmerIndex: number,
    farmerId: number,
    dayIndex: number,
    day: number,
    session: 'morning' | 'evening'
  ) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (session === 'morning') {
        // Focus evening of same day
        const nextId = `cell-${farmerId}-${day}-evening`;
        document.getElementById(nextId)?.focus();
      } else {
        // Evening -> next day morning
        if (dayIndex + 1 < days.length) {
          const nextDay = days[dayIndex + 1];
          const nextId = `cell-${farmerId}-${nextDay}-morning`;
          document.getElementById(nextId)?.focus();
        } else if (farmerIndex + 1 < filteredFarmers.length) {
          // Last day of period -> morning of next farmer
          const nextFarmer = filteredFarmers[farmerIndex + 1];
          const firstDay = days[0];
          const nextId = `cell-${nextFarmer.farmerId}-${firstDay}-morning`;
          document.getElementById(nextId)?.focus();
        }
      }
    } else if (e.key === 'ArrowDown') {
      if (farmerIndex + 1 < filteredFarmers.length) {
        e.preventDefault();
        const nextFarmer = filteredFarmers[farmerIndex + 1];
        const nextId = `cell-${nextFarmer.farmerId}-${day}-${session}`;
        document.getElementById(nextId)?.focus();
      }
    } else if (e.key === 'ArrowUp') {
      if (farmerIndex > 0) {
        e.preventDefault();
        const prevFarmer = filteredFarmers[farmerIndex - 1];
        const prevId = `cell-${prevFarmer.farmerId}-${day}-${session}`;
        document.getElementById(prevId)?.focus();
      }
    }
  };

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

  // Save all 15 days batch
  const handleSaveAll = async () => {
    if (saving) return;
    setSaving(true);
    setStatusMessage(null);

    try {
      const entriesPayload = farmers.map((f) => ({
        farmerId: f.farmerId,
        days: matrixData[f.farmerId] || {},
      }));

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

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.message || 'Failed to save batch matrix.');
      }

      setStatusMessage({
        type: 'success',
        text:
          language === 'rw'
            ? `✓ Byabitswe neza! Iminsi 15 yemejwe: litiro ${result.totalVolume?.toLocaleString() || summary.totalLiters} L.`
            : `✓ Saved successfully! 15 days confirmed: ${result.totalVolume?.toLocaleString() || summary.totalLiters} L.`,
      });

      if (onSaveSuccess) {
        onSaveSuccess();
      }
      // Reload fresh data from database
      await loadMatrixData();
    } catch (err: any) {
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
        <div className="matrix-actions-bar">
          <div className="matrix-search-box">
            <Search size={16} className="matrix-search-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder={language === 'rw' ? 'Shakisha umworozi cyangwa #001...' : 'Search farmer or #001...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="matrix-search-input"
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
          </div>

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
      {statusMessage && (
        <div className={`matrix-status-banner ${statusMessage.type === 'error' ? 'is-error' : 'is-success'}`}>
          <span>{statusMessage.text}</span>
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
            <table className="matrix-table" aria-label="Ikaye y'Amata Matrix">
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
                          <span className="matrix-farmer-code font-mono">{codeLabel}</span>
                          <span className="matrix-farmer-name" title={farmer.farmerName}>
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

                        return (
                          <React.Fragment key={`cell-${farmer.farmerId}-${d}`}>
                            {/* Morning Cell */}
                            <td className={`matrix-input-cell morning-cell ${dayHasMilk ? 'has-milk' : ''}`}>
                              <input
                                id={`cell-${farmer.farmerId}-${d}-morning`}
                                type="text"
                                inputMode="decimal"
                                className="matrix-cell-input"
                                value={morningVal}
                                placeholder="—"
                                onChange={(e) => handleCellChange(farmer.farmerId, d, 'morning', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, fIdx, farmer.farmerId, dIdx, d, 'morning')}
                                aria-label={`${farmer.farmerName} umunsi ${d} igitondo`}
                              />
                            </td>

                            {/* Evening Cell */}
                            <td className={`matrix-input-cell evening-cell ${dayHasMilk ? 'has-milk' : ''}`}>
                              <input
                                id={`cell-${farmer.farmerId}-${d}-evening`}
                                type="text"
                                inputMode="decimal"
                                className="matrix-cell-input"
                                value={eveningVal}
                                placeholder="—"
                                onChange={(e) => handleCellChange(farmer.farmerId, d, 'evening', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, fIdx, farmer.farmerId, dIdx, d, 'evening')}
                                aria-label={`${farmer.farmerName} umunsi ${d} nimugoroba`}
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
            disabled={saving || loading || filteredFarmers.length === 0}
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>{language === 'rw' ? 'Birimo kubikwa...' : 'Saving All...'}</span>
              </>
            ) : (
              <>
                <Save size={18} aria-hidden="true" />
                <span>{language === 'rw' ? 'Bika Byose Rimwe (Iminsi 15)' : 'Save All 15 Days'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
