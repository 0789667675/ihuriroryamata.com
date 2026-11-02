'use client';

import { useRef, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  History,
  Milk,
  Plus,
  Save,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';
import { getImportCopy } from '@/lib/i18n/import-copy';
import type { PublicCopyKey } from '@/lib/i18n/public-copy';

type MilkViewMode = 'matrix' | 'daily';
type DeliveryStatus = 'delivered' | 'missing';
type MilkQuality = 'accepted' | 'tested' | 'rejected';

export type MilkRecordRow = {
  farmerId: number;
  farmerName: string;
  farmerNumber?: number | null;
  phone?: string;
  nationalId?: string;
  collectionCenter?: string | null;
  collectorUserId?: number | null;
  collectorName?: string | null;
  recordId?: number;
  volumeMorning: number;
  volumeEvening: number;
  totalVolume: number;
  amount: number;
  status?: string;
  delivered?: boolean;
  deliveryStatus?: DeliveryStatus;
  abacundaCount?: number;
  presentCount?: number;
};

export type DailyMilkSummary = {
  totalFarmers: number;
  presentCount: number;
  missedCount: number;
  expectedCount: number;
  deliveredCount: number;
  missingCount: number;
  deliveryRate: number;
  totalMorning: number;
  totalEvening: number;
  totalVolume: number;
  totalAmount: number;
  pricePerLiter: number;
  transportRate: number;
};

type Center = { id: number; name: string };
type Collector = { collector_user_id: number; collector_name: string };

type MilkRecordsViewProps = {
  t: (key: PublicCopyKey) => string;
  language: 'rw' | 'en';
  isCollector: boolean;
  isDairy: boolean;
  dateLabel: string;
  currentPeriod: string;
  today: string;
  collectionDate: string;
  onDateChange: (date: string) => void;
  centers: Center[];
  selectedCenter: string;
  onCenterChange: (centerId: string) => void;
  collectors: Collector[];
  viewMode: MilkViewMode;
  onViewModeChange: (mode: MilkViewMode) => void;
  matrixContent: ReactNode;
  dailyRows: MilkRecordRow[];
  summary: DailyMilkSummary;
  loading: boolean;
  error: string;
  onRetry: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  session: 'all' | 'morning' | 'evening';
  onSessionChange: (session: 'all' | 'morning' | 'evening') => void;
  deliveryFilter: 'all' | 'delivered' | 'missing';
  onDeliveryFilterChange: (status: 'all' | 'delivered' | 'missing') => void;
  collectorFilter: string;
  onCollectorFilterChange: (collectorId: string) => void;
  sortBy: '' | 'farmerName' | 'totalVolume';
  sortDirection: 'asc' | 'desc';
  onSortByChange: (sortBy: '' | 'farmerName' | 'totalVolume') => void;
  onSortDirectionChange: (direction: 'asc' | 'desc') => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  busy: boolean;
  volumes: Record<number, { morning: string; evening: string }>;
  onVolumeChange: (farmerId: number, session: 'morning' | 'evening', value: string) => void;
  onSave: (row: MilkRecordRow) => void;
  recentlySaved: (farmerId: number) => boolean;
  inlineNumberFarmerId: number | null;
  inlineFarmerNumber: string;
  inlineNumberSaving: boolean;
  onStartFarmerNumberEdit: (farmerId: number, current?: number | null) => void;
  onChangeFarmerNumber: (value: string) => void;
  onSaveFarmerNumber: (farmerId: number, current?: number | null) => void;
  onCancelFarmerNumberEdit: () => void;
  qualities: Record<number, MilkQuality>;
  onQualityChange: (farmerId: number) => void;
  onOpenIfishi: (farmerId: number, farmerName: string) => void;
  onOpenHistory: (row: MilkRecordRow) => void;
  onOpenLossEvent: () => void;
  onOpenScanner: () => void;
  quickAddOpen: boolean;
  onQuickAddOpenChange: (open: boolean) => void;
  quickAddName: string;
  onQuickAddNameChange: (value: string) => void;
  quickAddPhone: string;
  onQuickAddPhoneChange: (value: string) => void;
  quickAddMorning: string;
  onQuickAddMorningChange: (value: string) => void;
  quickAddBusy: boolean;
  onQuickAddSubmit: () => void;
  ownerMilkVolume: number | null;
  onOpenOwnerIfishi: () => void;
  ownerHistoryOpen: boolean;
  onToggleOwnerHistory: () => void;
  ownerHistoryContent?: ReactNode;
  ownerEntryDialog?: ReactNode;
  ifishiDialog?: ReactNode;
  farmerNumberLabel: (value?: number | null) => string;
  collectorLabel: (row: MilkRecordRow) => string;
  formatLiters: (value: number) => string;
};

export function MilkRecordsView({
  t,
  language,
  isCollector,
  isDairy,
  dateLabel,
  currentPeriod,
  today,
  collectionDate,
  onDateChange,
  centers,
  selectedCenter,
  onCenterChange,
  collectors,
  viewMode,
  onViewModeChange,
  matrixContent,
  dailyRows,
  summary,
  loading,
  error,
  onRetry,
  search,
  onSearchChange,
  session,
  onSessionChange,
  deliveryFilter,
  onDeliveryFilterChange,
  collectorFilter,
  onCollectorFilterChange,
  sortBy,
  sortDirection,
  onSortByChange,
  onSortDirectionChange,
  pageSize,
  onPageSizeChange,
  hasMore,
  onLoadMore,
  busy,
  inlineNumberFarmerId,
  inlineFarmerNumber,
  inlineNumberSaving,
  onStartFarmerNumberEdit,
  onChangeFarmerNumber,
  onSaveFarmerNumber,
  onCancelFarmerNumberEdit,
  volumes,
  onVolumeChange,
  onSave,
  recentlySaved,
  qualities,
  onQualityChange,
  onOpenIfishi,
  onOpenHistory,
  onOpenLossEvent,
  onOpenScanner,
  quickAddOpen,
  onQuickAddOpenChange,
  quickAddName,
  onQuickAddNameChange,
  quickAddPhone,
  onQuickAddPhoneChange,
  quickAddMorning,
  onQuickAddMorningChange,
  quickAddBusy,
  onQuickAddSubmit,
  ownerMilkVolume,
  onOpenOwnerIfishi,
  ownerHistoryOpen,
  onToggleOwnerHistory,
  ownerHistoryContent,
  ownerEntryDialog,
  ifishiDialog,
  farmerNumberLabel,
  collectorLabel,
  formatLiters,
}: MilkRecordsViewProps) {
  const cancelledNumberEditRef = useRef<number | null>(null);
  const hasFilters = Boolean(search.trim() || session !== 'all' || deliveryFilter !== 'all' || collectorFilter);
  const dailyPageSize = pageSize;
  const statusLabel = (row: MilkRecordRow) => row.deliveryStatus === 'delivered'
    ? t('deliveryStatusDelivered')
    : row.status === 'cancelled' ? t('deliveryStatusCancelled') : t('deliveryStatusMissing');
  const statusClass = (row: MilkRecordRow) => row.deliveryStatus === 'delivered'
    ? 'is-delivered'
    : row.status === 'cancelled' ? 'is-cancelled' : 'is-missing';
  const entryState = (row: MilkRecordRow) => {
    const rowVolumes = volumes[row.farmerId] || { morning: '', evening: '' };
    const unchanged = Number(rowVolumes.morning || 0) === Number(row.volumeMorning || 0)
      && Number(rowVolumes.evening || 0) === Number(row.volumeEvening || 0);
    return row.recordId && unchanged ? 'saved' : 'unsaved';
  };
  const volumeInput = (row: MilkRecordRow, period: 'morning' | 'evening') => <input
    id={`milk-input-${row.farmerId}-${period}`}
    className="table-input"
    type="number"
    min="0"
    step="0.01"
    inputMode="decimal"
    aria-label={`${row.farmerName} ${t(period === 'morning' ? 'dashboardMorning' : 'dashboardEvening').toLocaleLowerCase()} volume`}
    value={volumes[row.farmerId]?.[period] ?? ''}
    onChange={(event) => onVolumeChange(row.farmerId, period, event.target.value)}
    onKeyDown={(event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (period === 'morning') {
        document.getElementById(`milk-input-${row.farmerId}-evening`)?.focus();
        return;
      }
      const currentIndex = dailyRows.findIndex((item) => item.farmerId === row.farmerId);
      const nextRow = currentIndex >= 0 ? dailyRows[currentIndex + 1] : undefined;
      if (nextRow) document.getElementById(`milk-input-${nextRow.farmerId}-morning`)?.focus();
    }}
  />;
  const missingRows = dailyRows.filter((row) => row.deliveryStatus === 'missing');
  const resetFilters = () => {
    onSearchChange('');
    onSessionChange('all');
    onDeliveryFilterChange('all');
    onCollectorFilterChange('');
  };
  const primaryAction = isCollector ? <button type="button" className="button button-primary small-button" onClick={() => onQuickAddOpenChange(!quickAddOpen)}>
    <Plus size={15} aria-hidden="true" />{language === 'en' ? 'Quick-add farmer' : 'Ongeraho umworozi'}
  </button> : undefined;
  const secondaryActions = [
    <button key="milk-scanner" type="button" className="button button-secondary small-button" onClick={onOpenScanner}>
      <Upload size={15} aria-hidden="true" />{getImportCopy(language, 'openMilkScanner')}
    </button>,
  ];

  return (
    <section className="panel milk-workspace">
      <div className="milk-workspace-header">
        <WorkspacePageHeader eyebrow={t('navMilk')} title={t('milkEntries')} description={`${dateLabel} · ${currentPeriod}`} primaryAction={primaryAction} secondaryActions={secondaryActions} />
        <div className="milk-view-mode-toggle" role="tablist" aria-label={t('milkEntries')}>
          <button type="button" role="tab" aria-selected={viewMode === 'matrix'} className={`button ${viewMode === 'matrix' ? 'button-primary' : 'button-secondary'}`} onClick={() => onViewModeChange('matrix')}>
            <span aria-hidden="true">📋</span>{language === 'en' ? 'Milk notebook' : "Ikaye y'amata"}
          </button>
          <button type="button" role="tab" aria-selected={viewMode === 'daily'} className={`button ${viewMode === 'daily' ? 'button-primary' : 'button-secondary'}`} onClick={() => onViewModeChange('daily')}>
            <CalendarDays size={16} aria-hidden="true" />{language === 'en' ? 'Daily records' : 'Amata y’umunsi'}
          </button>
        </div>
      </div>

      {viewMode === 'matrix' ? matrixContent : <>
        {isCollector ? <section className="panel owner-account-panel milk-owner-context">
          <div className="panel-heading"><div><span className="eyebrow">{t('ownerIfishiTitle')} / {t('account')}</span><h2>{language === 'en' ? 'Owner milk record' : 'Amata ya nyirayo'}</h2></div><Milk size={19} aria-hidden="true" /></div>
          <div className="metric-strip milk-summary owner-account-summary"><div><span>{t('ownerIfishiOwnerMilk')}</span><b>{ownerMilkVolume === null ? '—' : `${formatLiters(ownerMilkVolume)} L`}</b></div></div>
          <div className="owner-ifishi-actions">
            <button type="button" className="button button-primary small-button owner-ifishi-action" aria-haspopup="dialog" onClick={onOpenOwnerIfishi}><Plus size={15} aria-hidden="true" />{t('ownerIfishiTitle')}</button>
            <button type="button" className="text-button owner-ifishi-history-toggle" aria-expanded={ownerHistoryOpen} onClick={onToggleOwnerHistory}>{t(ownerHistoryOpen ? 'ownerIfishiHideHistory' : 'ownerIfishiViewHistory')}<ChevronDown size={15} aria-hidden="true" /></button>
          </div>
        </section> : null}
        {isCollector && ownerHistoryOpen ? ownerHistoryContent : null}

        <div className="milk-entry-controls">
          <div className="milk-toolbar">
            <label><span>{t('milkCollectionDate')}</span><input type="date" value={collectionDate} onChange={(event) => onDateChange(event.target.value)} /></label>
            <button type="button" className="button button-secondary small-button milk-today-button" onClick={() => onDateChange(today)}>{t('dashboardToday')}</button>
            {centers.length ? <label><span>{isDairy ? t('activeIkigo') : t('dashboardCenter')}</span><select value={selectedCenter} onChange={(event) => onCenterChange(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}
          </div>
          <div className="milk-session-context"><span>{t('milkCollectionWindow')}</span><b>{t('dashboardMorning')} <i /> {t('dashboardEvening')}</b></div>
        </div>

        <div className="milk-record-tools">
          <label className="milk-search-field"><span>{t('milkSearchLabel')}</span><span className="milk-search-control"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t('milkSearchLabel')} placeholder={t('milkSearchPlaceholder')} value={search} onChange={(event) => onSearchChange(event.target.value)} />{search ? <button type="button" className="icon-button milk-search-clear" aria-label={t('milkClearSearch')} title={t('milkClearSearch')} onClick={() => onSearchChange('')}><X size={16} aria-hidden="true" /></button> : null}</span></label>
          <label><span>{t('milkSessionFilter')}</span><select value={session} onChange={(event) => onSessionChange(event.target.value as typeof session)}><option value="all">{t('milkSessionAll')}</option><option value="morning">{t('milkSessionMorning')}</option><option value="evening">{t('milkSessionEvening')}</option></select></label>
          <label><span>{t('deliveryFilterLabel')}</span><select aria-label={t('deliveryFilterLabel')} value={deliveryFilter} onChange={(event) => onDeliveryFilterChange(event.target.value as typeof deliveryFilter)}><option value="all">{t('deliveryFilterAll')}</option><option value="delivered">{t('deliveryFilterDelivered')}</option><option value="missing">{t('deliveryFilterMissing')}</option></select></label>
          {isDairy ? <label><span>{t('assignedCollector')}</span><select aria-label={t('assignedCollector')} value={collectorFilter} onChange={(event) => onCollectorFilterChange(event.target.value)}><option value="">{t('allCollectors')}</option>{collectors.map((collector) => <option key={collector.collector_user_id} value={String(collector.collector_user_id)}>{collector.collector_name}</option>)}</select></label> : null}
          <label className="milk-sort-mobile"><span>{t('sort')}</span><select value={sortBy ? `${sortBy}:${sortDirection}` : ''} onChange={(event) => {
            const [field, direction] = event.target.value.split(':');
            if (['farmerName', 'totalVolume'].includes(field) && ['asc', 'desc'].includes(direction)) {
              onSortByChange(field as typeof sortBy);
              onSortDirectionChange(direction as typeof sortDirection);
            } else if (!field) onSortByChange('');
          }}>
            <option value="">{t('sort')}</option><option value="farmerName:asc">{t(isDairy ? 'milkAbacunda' : 'milkFarmer')} ↑</option><option value="farmerName:desc">{t(isDairy ? 'milkAbacunda' : 'milkFarmer')} ↓</option><option value="totalVolume:asc">{t('milkTotal')} ↑</option><option value="totalVolume:desc">{t('milkTotal')} ↓</option>
          </select></label>
          <label><span>{t('milkPageSize')}</span><select value={dailyPageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
          {isCollector ? <button type="button" className="button button-secondary small-button" onClick={onOpenLossEvent}><Plus size={15} aria-hidden="true" />{t('recordLossEvent')}</button> : null}
          {hasFilters ? <button type="button" className="button button-secondary small-button" onClick={resetFilters}><X size={15} aria-hidden="true" />{t('milkClearSearch')}</button> : null}
        </div>

        {!loading && !error ? <>
          <div className="metric-strip delivery-reconciliation" aria-label={t('deliveryFilterLabel')}>
            <div><span>{t('deliveryExpectedFarmers')}</span><b><AnimatedCounter value={summary.expectedCount} className="tabular-nums" /></b></div>
            <div><span>{t('deliveryDeliveredFarmers')}</span><b><AnimatedCounter value={summary.deliveredCount} className="tabular-nums" /></b></div>
            <div><span>{t('deliveryMissingFarmers')}</span><b><AnimatedCounter value={summary.missingCount} className="tabular-nums" /></b></div>
            <div><span>{t('deliveryRate')}</span><b><AnimatedCounter value={summary.deliveryRate} suffix="%" className="tabular-nums" /></b></div>
          </div>
          <div className="metric-strip milk-summary"><div><span>{t('dashboardCollected')}</span><b><AnimatedCounter value={summary.totalVolume} formatter={formatLiters} suffix=" L" className="tabular-nums" /></b></div><div><span>{t('dashboardMorning')}</span><b><AnimatedCounter value={summary.totalMorning} formatter={formatLiters} suffix=" L" className="tabular-nums" /></b></div><div><span>{t('dashboardEvening')}</span><b><AnimatedCounter value={summary.totalEvening} formatter={formatLiters} suffix=" L" className="tabular-nums" /></b></div></div>
        </> : null}

        {isCollector && quickAddOpen ? <form className="milk-quick-add-panel" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onQuickAddSubmit(); }}>
          <div><label>{t('fullName')}<input autoFocus value={quickAddName} onChange={(event) => onQuickAddNameChange(event.target.value)} required /></label><label>{t('columnPhone')}<input type="tel" inputMode="tel" value={quickAddPhone} onChange={(event) => onQuickAddPhoneChange(event.target.value)} /></label><label>{t('dashboardMorning')} · L<input type="number" min="0" step="0.01" value={quickAddMorning} onChange={(event) => onQuickAddMorningChange(event.target.value)} /></label></div>
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => onQuickAddOpenChange(false)} disabled={quickAddBusy}>{t('cancel')}</button><button type="submit" className="button button-primary" disabled={quickAddBusy || !quickAddName.trim()}><Check size={15} aria-hidden="true" />{quickAddBusy ? t('wait') : t('saveChanges')}</button></div>
        </form> : null}

        {missingRows.length && !loading && !error ? <section className="missing-farmers-panel" aria-label={t('deliveryMissingTitle')}>
          <div className="missing-farmers-heading"><div><b>{t('deliveryMissingTitle')}</b><small>{t('deliveryMissingHint')}</small></div><span>{summary.missingCount}</span></div>
          <ul>{missingRows.map((row) => <li key={row.farmerId}><span><b>{farmerNumberLabel(row.farmerNumber)} — {row.farmerName}</b><small>{[row.phone, collectorLabel(row)].filter(Boolean).join(' · ') || '—'}</small></span><button type="button" className="text-button" onClick={() => onOpenHistory(row)}>{t('viewFarmerHistory')}</button></li>)}</ul>
          {deliveryFilter !== 'missing' ? <button type="button" className="text-button missing-farmers-all" onClick={() => { onDeliveryFilterChange('missing'); onPageSizeChange(100); }}>{t('deliveryFilterMissing')} · {summary.missingCount}<ArrowRight size={14} aria-hidden="true" /></button> : null}
        </section> : null}

        <div className="panel-heading milk-record-list-heading"><div><span className="eyebrow">{selectedCenter ? centers.find((center) => String(center.id) === selectedCenter)?.name : t('navMilk')}</span><h2>{language === 'en' ? 'Milk collection' : "Ikusanya ry'Amata"}</h2></div><span className="count-label">{t('milkResultsCount')}: {dailyRows.length} / {summary.totalFarmers}</span></div>
        {isDairy && !selectedCenter ? centers.length ? <div className="workspace-empty" role="status"><b>{t('selectCenterToView')}</b><p>{t('selectCenterToViewHint')}</p></div> : <div className="workspace-empty" role="status"><b>{t('noActiveIkigo')}</b></div>
          : loading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{t('loadingDailyMilk')}</div>
            : error ? <div className="workspace-empty" role="alert"><b>{error}</b><button type="button" className="button button-secondary small-button" onClick={onRetry}>{t('retry')}</button></div>
              : dailyRows.length ? <>
                <div className="table-scroll milk-desktop-list"><table className="milk-desktop-table"><thead><tr>
                  <th className="farmer-number-column">{t('farmerNumberShort')}</th>
                  <th aria-sort={sortBy === 'farmerName' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => { if (sortBy === 'farmerName') onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc'); else { onSortByChange('farmerName'); onSortDirectionChange('asc'); } }}>{t(isDairy ? 'milkAbacunda' : 'milkFarmer')}{sortBy === 'farmerName' ? sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}</button></th>
                  <th>{t('assignedCollector')}</th><th>{t('dashboardMorning')} · L</th><th>{t('dashboardEvening')} · L</th>
                  <th aria-sort={sortBy === 'totalVolume' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => { if (sortBy === 'totalVolume') onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc'); else { onSortByChange('totalVolume'); onSortDirectionChange('asc'); } }}>{t('milkTotal')}{sortBy === 'totalVolume' ? sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}</button></th>
                  <th>{t('deliveryFilterLabel')}</th><th className="milk-actions-heading">{t('actions')}</th>
                </tr></thead><tbody>
                  {dailyRows.map((row) => <tr key={row.farmerId} className={recentlySaved(row.farmerId) ? 'row-just-saved' : undefined}>
                    <td className="farmer-number-cell">{inlineNumberFarmerId === row.farmerId ? <input type="number" min="1" step="1" className="table-input font-mono milk-farmer-number-input" autoFocus disabled={inlineNumberSaving} value={inlineFarmerNumber} onChange={(event) => onChangeFarmerNumber(event.target.value)} onBlur={() => { if (cancelledNumberEditRef.current === row.farmerId) { cancelledNumberEditRef.current = null; return; } onSaveFarmerNumber(row.farmerId, row.farmerNumber); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelledNumberEditRef.current = row.farmerId; onCancelFarmerNumberEdit(); } }} aria-label={t('farmerNumberShort')} /> : <button type="button" className="farmer-number-badge font-mono" title={language === 'en' ? 'Edit farmer number' : 'Hindura nimero y’umworozi'} onClick={() => onStartFarmerNumberEdit(row.farmerId, row.farmerNumber)}>{farmerNumberLabel(row.farmerNumber)}</button>}</td>
                    <td className="strong-cell"><b>{row.farmerName}</b><small className="farmer-row-detail">{row.phone || '—'}</small></td>
                    <td>{collectorLabel(row)}</td><td>{volumeInput(row, 'morning')}</td>
                    <td className="milk-evening-cell"><div>{volumeInput(row, 'evening')}{isCollector ? <button type="button" className={`quality-pill ${qualities[row.farmerId] || 'accepted'}`} title={language === 'en' ? 'Toggle quality: Accepted, Tested, Rejected' : 'Hindura ubuziranenge: Byemewe, Bipimwe, Byanzwe'} aria-label={`${row.farmerName}: ${language === 'en' ? 'milk quality' : 'ubuziranenge bw’amata'}`} onClick={() => onQualityChange(row.farmerId)}>{qualities[row.farmerId] === 'rejected' ? (language === 'en' ? 'Rejected' : 'Yanzwe') : qualities[row.farmerId] === 'tested' ? (language === 'en' ? 'Tested' : 'Igipimo') : (language === 'en' ? 'Accepted' : 'Yemewe')}</button> : null}</div></td>
                    <td><b className="font-mono tabular-nums milk-row-total">{formatLiters(row.totalVolume)} L</b></td><td><span className={`delivery-status-pill ${statusClass(row)}`}>{statusLabel(row)}</span></td>
                    <td><div className="milk-row-actions milk-record-actions">
                      <button type="button" className="icon-button" title={t('viewFarmerHistory')} aria-label={`${t('viewFarmerHistory')}: ${row.farmerName}`} onClick={() => onOpenHistory(row)}><History size={16} aria-hidden="true" /></button>
                      <button type="button" className="icon-button" title={t('navIfishi')} aria-label={`${t('navIfishi')}: ${row.farmerName}`} onClick={() => onOpenIfishi(row.farmerId, row.farmerName)}><BookOpen size={16} aria-hidden="true" /></button>
                      <span className="milk-entry-state-label">{t(entryState(row) === 'saved' ? 'milkSaved' : 'milkUnsaved')}</span>
                      <button type="button" className="button button-secondary small-button" onClick={() => onSave(row)} disabled={busy} title={t(entryState(row) === 'saved' ? 'milkSaved' : 'milkSave')}>{entryState(row) === 'saved' ? <Check size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{t(entryState(row) === 'saved' ? 'milkSaved' : 'milkSave')}</button>
                    </div></td>
                  </tr>)}
                </tbody></table></div>

                <div className="milk-mobile-list">{dailyRows.map((row) => <article className={`milk-entry-card ${recentlySaved(row.farmerId) ? 'row-just-saved' : ''}`} key={row.farmerId}>
                  <header><div className="milk-card-identity">{inlineNumberFarmerId === row.farmerId ? <input type="number" min="1" step="1" className="table-input font-mono milk-farmer-number-input" autoFocus disabled={inlineNumberSaving} value={inlineFarmerNumber} onChange={(event) => onChangeFarmerNumber(event.target.value)} onBlur={() => { if (cancelledNumberEditRef.current === row.farmerId) { cancelledNumberEditRef.current = null; return; } onSaveFarmerNumber(row.farmerId, row.farmerNumber); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelledNumberEditRef.current = row.farmerId; onCancelFarmerNumberEdit(); } }} aria-label={t('farmerNumberShort')} /> : <button type="button" className="farmer-number-badge font-mono" title={language === 'en' ? 'Edit farmer number' : 'Hindura nimero y’umworozi'} onClick={() => onStartFarmerNumberEdit(row.farmerId, row.farmerNumber)}>{farmerNumberLabel(row.farmerNumber)}</button>}<b>{row.farmerName}</b><small>{[row.phone, collectorLabel(row)].filter(Boolean).join(' · ') || row.collectionCenter || '—'}</small></div><span className={`delivery-status-pill ${statusClass(row)}`}>{statusLabel(row)}</span></header>
                  <div className="milk-entry-inputs"><label><span>{t('dashboardMorning')} · L</span>{volumeInput(row, 'morning')}</label><label><span>{t('dashboardEvening')} · L</span>{volumeInput(row, 'evening')}</label></div>
                  <div className="milk-mobile-total"><span>{t('milkTotal')}</span><b>{formatLiters(row.totalVolume)} L</b>{isCollector ? <button type="button" className={`quality-pill ${qualities[row.farmerId] || 'accepted'}`} onClick={() => onQualityChange(row.farmerId)}>{qualities[row.farmerId] === 'rejected' ? (language === 'en' ? 'Rejected' : 'Yanzwe') : qualities[row.farmerId] === 'tested' ? (language === 'en' ? 'Tested' : 'Igipimo') : (language === 'en' ? 'Accepted' : 'Yemewe')}</button> : null}</div>
                  <footer><span className="milk-mobile-save-state">{t(entryState(row) === 'saved' ? 'milkSaved' : 'milkUnsaved')}</span><button type="button" className="button button-secondary small-button" onClick={() => onOpenHistory(row)}><History size={14} aria-hidden="true" />{t('viewFarmerHistory')}</button><button type="button" className="button button-secondary small-button" onClick={() => onOpenIfishi(row.farmerId, row.farmerName)}><BookOpen size={14} aria-hidden="true" />{t('navIfishi')}</button><button type="button" className="button button-primary small-button" onClick={() => onSave(row)} disabled={busy}>{t(entryState(row) === 'saved' ? 'milkSaved' : 'milkSave')}</button></footer>
                </article>)}</div>
              </> : <div className="milk-empty-state" role="status"><span className="milk-empty-icon"><Milk size={22} aria-hidden="true" /></span><div><b>{hasFilters ? t('milkSearchNoResultsTitle') : language === 'en' ? 'No milk recorded yet today' : 'Nta mata arandikwa uyu munsi'}</b><p>{hasFilters ? t('milkSearchNoResultsBody') : language === 'en' ? 'No delivery has been entered for this collection date. Add your first delivery below.' : 'Nta mukamo wanditswe kuri iyi tariki. Tangira wandike amata ya mbere.'}</p></div>{hasFilters ? <button type="button" className="button button-secondary small-button" onClick={resetFilters}><X size={15} aria-hidden="true" />{t('milkClearSearch')}</button> : isCollector ? <button type="button" className="button button-primary small-button" onClick={onOpenOwnerIfishi}><Plus size={15} aria-hidden="true" />{language === 'en' ? 'Add owner milk' : 'Ongeramo amata ya nyirayo'}</button> : null}</div>}
        {hasMore ? <div className="panel-footer"><button type="button" className="button button-secondary" onClick={onLoadMore} disabled={loading}>{loading ? t('wait') : t('milkLoadMore')} <ChevronDown size={16} aria-hidden="true" /></button></div> : null}
      </>}
      {ownerEntryDialog}
      {ifishiDialog}
    </section>
  );
}