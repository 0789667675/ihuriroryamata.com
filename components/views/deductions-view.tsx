'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, CircleDollarSign, Eye, Pencil, Plus, Search, Settings2, Users, X } from 'lucide-react';
import { Modal } from '../ui/modal';
import { WorkspacePageHeader } from '../ui/workspace-page-header';
import { getAccountingDate } from '@/lib/utils/accounting-period';
import { getHalfMonthDateRange, getMonthDateRange } from '@/lib/utils/accounting-period';

export type DeductionHistoryItem = {
  id: number;
  farmerId: number;
  farmerName?: string | null;
  amount: number;
  type: string;
  date: string;
  reason: string | null;
  notes: string | null;
  status: string;
};

export type FarmerPeriodLedgerRow = {
  farmerId: number;
  farmerNumber: number | null;
  farmerName: string | null;
  periodStart: string;
  periodEnd: string;
  deductionAmount: number;
  configuredDeductionCount: number;
  recoveredAmount: number;
  remainingBalance: number;
  previousDebt: number;
  outstandingDebt: number;
  debtRepaidInPeriod: number;
  status: 'DEDUCTED' | 'NOT_DEDUCTED' | 'PARTIALLY_DEDUCTED' | 'OUTSTANDING_DEBT';
};

export type FarmerPeriodLedgerSummary = {
  farmersListed: number;
  farmersWithDeductions: number;
  farmersWithoutDeductions: number;
  totalNewDeductions: number;
  previousOutstandingDebt: number;
  debtRecovered: number;
  remainingDebt: number;
};

export type DeductionConfiguration = {
  id: number;
  name: string;
  description: string | null;
  amountPerFarmer: number;
  type: string;
  eligibilityMode: 'ALL' | 'SELECTED';
  eligibleFarmerIds: number[];
  frequency: 'PERIOD' | 'MONTHLY' | 'ONE_TIME';
  effectiveStartDate: string;
  executionMode: 'MANUAL';
  isActive: boolean;
};

type FarmerOption = {
  id: number;
  name: string;
  phone?: string | null;
  nationalId?: string | null;
};

type Props = {
  ledgerRows: FarmerPeriodLedgerRow[];
  ledgerSummary: FarmerPeriodLedgerSummary | null;
  ledgerLoading: boolean;
  ledgerHasMore: boolean;
  ledgerSearch: string;
  onLedgerSearchChange: (value: string) => void;
  ledgerStatus: FarmerPeriodLedgerRow['status'] | 'ALL';
  onLedgerStatusChange: (value: FarmerPeriodLedgerRow['status'] | 'ALL') => void;
  onLedgerConfigurationChange: (configurationId: number | null) => void;
  periodStart: string;
  periodEnd: string;
  onPeriodChange: (start: string, end: string) => void;
  onLoadLedger: (cursor?: string | null, append?: boolean) => Promise<void>;
  onLoadAllEligible: () => Promise<FarmerPeriodLedgerRow[]>;
  configurations: DeductionConfiguration[];
  configurationsLoading: boolean;
  onLoadConfigurations: () => Promise<void>;
  onSaveConfiguration: (input: Omit<DeductionConfiguration, 'id' | 'executionMode'>, id?: number) => Promise<DeductionConfiguration>;
  onApplyConfiguredBatch: (input: { configurationId: number; farmerIds: number[]; periodStart: string; periodEnd: string }) => Promise<{ succeeded: number; duplicates: number; succeededFarmerIds: number[]; duplicateFarmerIds: number[]; failures: Array<{ farmerId: number; reason: string }> }>;
  onInspectFarmer: (farmer: { farmerId: number; farmerName: string | null }) => void;
  inspectorOpen: boolean;
  inspectorFarmerName: string | null;
  inspectorRows: DeductionHistoryItem[];
  inspectorLoading: boolean;
  inspectorHasMore: boolean;
  inspectorError: string;
  onCloseInspector: () => void;
  onLoadHistoryMore: () => void;
  onEditDeduction: (row: DeductionHistoryItem) => Promise<void>;
  onClearDeduction: (row: DeductionHistoryItem) => Promise<void>;
  onOpenCreate: () => void;
  onAddDeduction: (input: { farmerId: string; amount: string; type: string; date: string; reason: string; notes: string }) => Promise<void>;
  createOpen: boolean;
  onCloseCreate: () => void;
  deductionFarmers: FarmerOption[];
  deductionFarmerSearch: string;
  setDeductionFarmerSearch: (value: string) => void;
  onLoadDeductionFarmers: (search?: string) => Promise<void>;
  createBusy: boolean;
  createError: string;
  t: (key: string) => string;
};

const money = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0));
const today = () => getAccountingDate();

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
};

export function DeductionView({
  ledgerRows,
  ledgerSummary,
  ledgerLoading,
  ledgerHasMore,
  ledgerSearch,
  onLedgerSearchChange,
  ledgerStatus,
  onLedgerStatusChange,
  onLedgerConfigurationChange,
  periodStart,
  periodEnd,
  onPeriodChange,
  onLoadLedger,
  onLoadAllEligible,
  configurations,
  configurationsLoading,
  onLoadConfigurations,
  onSaveConfiguration,
  onApplyConfiguredBatch,
  onInspectFarmer,
  inspectorOpen,
  inspectorFarmerName,
  inspectorRows,
  inspectorLoading,
  inspectorHasMore,
  inspectorError,
  onCloseInspector,
  onLoadHistoryMore,
  onEditDeduction,
  onClearDeduction,
  onOpenCreate,
  onAddDeduction,
  createOpen,
  onCloseCreate,
  deductionFarmers,
  deductionFarmerSearch,
  setDeductionFarmerSearch,
  onLoadDeductionFarmers,
  createBusy,
  createError,
  t,
}: Props) {
  const [selectedFarmerIds, setSelectedFarmerIds] = useState<number[]>([]);
  const [selectedConfigurationId, setSelectedConfigurationId] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [configurationDraft, setConfigurationDraft] = useState({
    id: 0,
    name: '',
    description: '',
    amountPerFarmer: '',
    type: 'Other',
    eligibilityMode: 'ALL' as 'ALL' | 'SELECTED',
    eligibleFarmerIds: [] as number[],
    frequency: 'PERIOD' as 'PERIOD' | 'MONTHLY' | 'ONE_TIME',
    effectiveStartDate: periodStart,
    isActive: true,
  });
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState<null | { succeeded: number; duplicates: number; succeededFarmers: Array<{ id: number; name: string }>; duplicateFarmers: Array<{ id: number; name: string }>; failures: Array<{ farmerId: number; reason: string }> }>(null);
  const [allEligibleLoading, setAllEligibleLoading] = useState(false);
  const [createForm, setCreateForm] = useState({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
  const [editDraft, setEditDraft] = useState<null | { id: number; farmerId: number; amount: string; type: string; date: string; reason: string; notes: string; status: string }>(null);
  const [submitError, setSubmitError] = useState('');
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);

  const formCanSubmit = useMemo(() => Boolean(createForm.farmerId && createForm.amount && createForm.date), [createForm]);
  const selectedConfiguration = configurations.find((configuration) => String(configuration.id) === selectedConfigurationId) || null;
  const isEligibleForConfiguration = (row: FarmerPeriodLedgerRow) => !selectedConfiguration
    || selectedConfiguration.eligibilityMode === 'ALL'
    || selectedConfiguration.eligibleFarmerIds.includes(row.farmerId);
  const isRowSelectable = (row: FarmerPeriodLedgerRow) => row.configuredDeductionCount === 0 && isEligibleForConfiguration(row);
  const eligibleRows = ledgerRows.filter(isRowSelectable);
  const selectedRows = ledgerRows.filter((row) => selectedFarmerIds.includes(row.farmerId));
  const previewTotal = selectedConfiguration ? selectedConfiguration.amountPerFarmer * selectedFarmerIds.length : 0;
  const deductionSummary = ledgerSummary ? [
    { label: 'deductionSummaryFarmers', value: String(ledgerSummary.farmersListed) },
    { label: 'deductionSummaryWithDeductions', value: String(ledgerSummary.farmersWithDeductions) },
    { label: 'deductionSummaryWithoutDeductions', value: String(ledgerSummary.farmersWithoutDeductions) },
    { label: 'deductionSummaryNewTotal', value: `${money(ledgerSummary.totalNewDeductions)} RWF` },
    { label: 'deductionSummaryOutstandingDebt', value: `${money(ledgerSummary.previousOutstandingDebt)} RWF` },
    { label: 'deductionSummaryRecovered', value: `${money(ledgerSummary.debtRecovered)} RWF` },
    { label: 'deductionSummaryRemainingDebt', value: `${money(ledgerSummary.remainingDebt)} RWF` },
  ] : [];
  const periodMonth = periodStart.slice(0, 7);
  const halfMonth = Number(periodStart.slice(8, 10)) >= 16 ? 'second-half' : 'first-half';
  const [periodYear, periodMonthNumber] = periodMonth.split('-').map(Number);
  const fullMonthRange = getMonthDateRange(periodYear, periodMonthNumber);

  const changePeriod = (month: string, half: 'first-half' | 'second-half') => {
    const [year, monthNumber] = month.split('-').map(Number);
    const range = getHalfMonthDateRange(year, monthNumber, half);
    setSelectedFarmerIds([]);
    onPeriodChange(range.startDate, range.endDate);
  };

  const toggleFarmer = (farmerId: number) => setSelectedFarmerIds((current) => current.includes(farmerId)
    ? current.filter((id) => id !== farmerId)
    : [...current, farmerId]);

  const selectVisibleEligible = () => setSelectedFarmerIds((current) => {
    const visibleIds = eligibleRows.map((row) => row.farmerId);
    return visibleIds.every((id) => current.includes(id))
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])];
  });

  const selectAllEligible = async () => {
    setAllEligibleLoading(true);
    setBatchError('');
    try {
      const allRows = await onLoadAllEligible();
      setSelectedFarmerIds(allRows.filter(isRowSelectable).map((row) => row.farmerId));
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Failed to load eligible farmers.');
    } finally {
      setAllEligibleLoading(false);
    }
  };

  const applyBatch = async () => {
    if (!selectedConfiguration || !selectedFarmerIds.length || batchBusy) return;
    setBatchBusy(true);
    setBatchError('');
    try {
      const selectedNames = new Map(selectedRows.map((row) => [row.farmerId, row.farmerName || `Farmer #${row.farmerId}`]));
      const result = await onApplyConfiguredBatch({
        configurationId: selectedConfiguration.id,
        farmerIds: selectedFarmerIds,
        periodStart,
        periodEnd,
      });
      setBatchResult({
        succeeded: result.succeeded,
        duplicates: result.duplicates,
        succeededFarmers: result.succeededFarmerIds.map((id) => ({ id, name: selectedNames.get(id) || `Farmer #${id}` })),
        duplicateFarmers: result.duplicateFarmerIds.map((id) => ({ id, name: selectedNames.get(id) || `Farmer #${id}` })),
        failures: result.failures,
      });
      setSelectedFarmerIds(result.failures.map((failure) => failure.farmerId));
      if (!result.failures.length) setBatchOpen(false);
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Failed to apply deduction batch.');
    } finally {
      setBatchBusy(false);
    }
  };

  const startConfiguration = (configuration?: DeductionConfiguration, eligibleFarmerId?: number) => {
    if (eligibleFarmerId) setSelectedFarmerIds([eligibleFarmerId]);
    setConfigurationDraft(configuration ? {
      id: configuration.id,
      name: configuration.name,
      description: configuration.description || '',
      amountPerFarmer: String(configuration.amountPerFarmer),
      type: configuration.type,
      eligibilityMode: configuration.eligibilityMode,
      eligibleFarmerIds: configuration.eligibleFarmerIds,
      frequency: configuration.frequency,
      effectiveStartDate: configuration.effectiveStartDate,
      isActive: configuration.isActive,
    } : {
      id: 0,
      name: eligibleFarmerId ? `${t('deductionIndividualConfiguration')} #${eligibleFarmerId}` : '',
      description: '',
      amountPerFarmer: '',
      type: 'Other',
      eligibilityMode: eligibleFarmerId ? 'SELECTED' : 'ALL',
      eligibleFarmerIds: eligibleFarmerId ? [eligibleFarmerId] : [],
      frequency: 'PERIOD',
      effectiveStartDate: periodStart,
      isActive: true,
    });
    setConfigurationOpen(true);
  };

  const saveConfiguration = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const saved = await onSaveConfiguration({
        name: configurationDraft.name,
        description: configurationDraft.description || null,
        amountPerFarmer: Number(configurationDraft.amountPerFarmer),
        type: configurationDraft.type,
        eligibilityMode: configurationDraft.eligibilityMode,
        eligibleFarmerIds: configurationDraft.eligibleFarmerIds,
        frequency: configurationDraft.frequency,
        effectiveStartDate: configurationDraft.effectiveStartDate,
        isActive: configurationDraft.isActive,
      }, configurationDraft.id || undefined);
      setSelectedConfigurationId(String(saved.id));
      onLedgerConfigurationChange(saved.id);
      setConfigurationOpen(false);
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Failed to save deduction configuration.');
    }
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError('');
    try {
      await onAddDeduction(createForm);
      setCreateForm({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
      onCloseCreate();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to save deduction.');
    }
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editDraft) return;
    setSubmitError('');
    setPendingActionId(editDraft.id);
    try {
      await onEditDeduction({
        id: editDraft.id,
        farmerId: editDraft.farmerId,
        amount: Number(editDraft.amount),
        type: editDraft.type,
        date: editDraft.date,
        reason: editDraft.reason || null,
        notes: editDraft.notes || null,
        status: editDraft.status,
      });
      setEditDraft(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to update deduction.');
    } finally {
      setPendingActionId(null);
    }
  };

  const clearHistory = async (row: DeductionHistoryItem) => {
    setSubmitError('');
    setPendingActionId(row.id);
    try {
      await onClearDeduction(row);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to clear deduction.');
    } finally {
      setPendingActionId(null);
    }
  };

  const inspectLedgerFarmer = (row: FarmerPeriodLedgerRow) => onInspectFarmer({
    farmerId: row.farmerId,
    farmerName: row.farmerName,
  });

  return (
    <div className="screen-grid deductions-view">
      <section className="panel panel-wide deduction-ledger-panel">
        <WorkspacePageHeader
          eyebrow={t('dashboardAccounting')}
          title={t('deductionControlCenter')}
          description={`${formatDate(periodStart)} – ${formatDate(periodEnd)}`}
          primaryAction={(
            <div className="workspace-header-actions">
              <button type="button" className="button button-secondary small-button" onClick={() => { void onLoadConfigurations(); startConfiguration(); }}>
                <Settings2 size={15} aria-hidden="true" />{t('deductionConfigure')}
              </button>
              <button type="button" className="button button-primary small-button" onClick={onOpenCreate}>
                <Plus size={15} aria-hidden="true" />{t('deductionsAdd')}
              </button>
            </div>
          )}
        />
        <div className="toolbar deduction-period-toolbar">
          <label>{t('ukweziMonth')}<input type="month" value={periodMonth} onChange={(event) => changePeriod(event.target.value, halfMonth)} /></label>
          <div className="timeline-scrubber" role="radiogroup" aria-label={t('ukweziPeriod')}>
            <button type="button" role="radio" aria-checked={halfMonth === 'first-half'} className={`timeline-scrubber-pill${halfMonth === 'first-half' ? ' is-active' : ''}`} onClick={() => changePeriod(periodMonth, 'first-half')}>1–15</button>
            <button type="button" role="radio" aria-checked={halfMonth === 'second-half'} className={`timeline-scrubber-pill${halfMonth === 'second-half' ? ' is-active' : ''}`} onClick={() => changePeriod(periodMonth, 'second-half')}>16–{fullMonthRange.endDate.slice(-2)}</button>
          </div>
          <label className="deduction-ledger-search"><span>{t('deductionsSearch')}</span><span className="settlement-search-control"><Search size={16} aria-hidden="true" /><input type="search" value={ledgerSearch} onChange={(event) => { setSelectedFarmerIds([]); onLedgerSearchChange(event.target.value); }} /></span></label>
        </div>

        {deductionSummary.length ? <div className="deduction-summary-grid" aria-label={t('deductionPeriod')}>
          {deductionSummary.map((item, index) => <div className={index === 0 ? 'deduction-summary-count' : undefined} key={item.label}>
            <span>{t(item.label)}</span>
            <b>{item.value}</b>
          </div>)}
        </div> : null}

        <div className="settlement-tabs deduction-ledger-tabs" role="tablist" aria-label={t('deductionFarmerFilters')}>
          {([
            ['ALL', 'deductionFilterAll'],
            ['DEDUCTED', 'deductionFilterDeducted'],
            ['NOT_DEDUCTED', 'deductionFilterNotDeducted'],
            ['PARTIALLY_DEDUCTED', 'deductionFilterPartial'],
            ['OUTSTANDING_DEBT', 'deductionFilterDebt'],
          ] as const).map(([status, label]) => (
            <button key={status} type="button" role="tab" aria-selected={ledgerStatus === status} className={`settlement-tab-button${ledgerStatus === status ? ' is-active' : ''}`} onClick={() => { setSelectedFarmerIds([]); onLedgerStatusChange(status); }}>
              {t(label)}{ledgerStatus === status ? ` (${ledgerRows.length})` : ''}
            </button>
          ))}
        </div>

        <div className="deduction-batch-toolbar">
          <div className="workspace-header-actions">
            <button type="button" className="button button-secondary small-button" onClick={selectVisibleEligible} disabled={!eligibleRows.length}>
              <Users size={15} aria-hidden="true" />{t('deductionSelectVisible')}
            </button>
            <button type="button" className="button button-secondary small-button" onClick={() => void selectAllEligible()} disabled={allEligibleLoading}>
              {allEligibleLoading ? t('wait') : t('deductionSelectAllEligible')}
            </button>
          </div>
          <span className="count-label">{t('deductionSelectedCount').replace('{count}', String(selectedFarmerIds.length))}</span>
          <label className="deduction-configuration-select"><span>{t('deductionConfiguration')}</span><select value={selectedConfigurationId} onChange={(event) => {
            const nextId = event.target.value;
            const nextConfiguration = configurations.find((configuration) => String(configuration.id) === nextId);
            setSelectedFarmerIds([]);
            setSelectedConfigurationId(nextId);
            onLedgerConfigurationChange(nextId ? Number(nextId) : null);
            if (nextConfiguration?.eligibilityMode === 'SELECTED') {
              setSelectedFarmerIds((current) => current.filter((id) => nextConfiguration.eligibleFarmerIds.includes(id)));
            }
          }}>
            <option value="">{configurationsLoading ? t('dashboardLoading') : t('deductionSelectConfiguration')}</option>
            {configurations.filter((configuration) => configuration.isActive).map((configuration) => <option key={configuration.id} value={String(configuration.id)}>{configuration.name} · {money(configuration.amountPerFarmer)} RWF</option>)}
          </select></label>
          <button type="button" className="button button-primary small-button" onClick={() => { setBatchError(''); setBatchResult(null); setBatchOpen(true); }} disabled={!selectedFarmerIds.length || !selectedConfiguration || batchBusy}>
            {t('deductionPreviewBatch')}
          </button>
        </div>
        {batchError ? <p className="form-error" role="alert">{batchError}</p> : null}
        {batchResult ? <div className="workspace-empty" role="status"><b>{t('deductionBatchResults').replace('{succeeded}', String(batchResult.succeeded)).replace('{duplicates}', String(batchResult.duplicates))}</b>{batchResult.succeededFarmers.length ? <p>{t('deductionBatchSucceededList')}: {batchResult.succeededFarmers.map((farmer) => farmer.name).join(', ')}</p> : null}{batchResult.duplicateFarmers.length ? <p>{t('deductionBatchDuplicateList')}: {batchResult.duplicateFarmers.map((farmer) => farmer.name).join(', ')}</p> : null}{batchResult.failures.length ? <ul>{batchResult.failures.map((failure) => <li key={failure.farmerId}>#{failure.farmerId}: {failure.reason}</li>)}</ul> : null}</div> : null}

        {ledgerLoading && !ledgerRows.length ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{t('dashboardLoading')}</div> : ledgerRows.length ? <>
          <div className="table-scroll deduction-ledger-table-wrap"><table className="deduction-ledger-table"><thead><tr>
            <th><span className="sr-only">{t('deductionSelectFarmer')}</span></th><th>{t('deductionsFarmer')}</th><th>{t('deductionSummaryNewTotal')}</th><th>{t('deductionPreviousDebt')}</th><th>{t('deductionSummaryRecovered')}</th><th>{t('deductionSummaryRemainingDebt')}</th><th>{t('deductionsStatus')}</th><th>{t('actions')}</th>
          </tr></thead><tbody>
            {ledgerRows.map((row) => <tr key={row.farmerId}>
              <td>{isRowSelectable(row) ? <input type="checkbox" checked={selectedFarmerIds.includes(row.farmerId)} onChange={() => toggleFarmer(row.farmerId)} aria-label={t('deductionSelectFarmer').replace('{name}', row.farmerName || String(row.farmerId))} /> : null}</td>
              <td><b>{row.farmerName || `Farmer #${row.farmerId}`}</b><small className="block-muted">{t('farmerNumber')} {row.farmerNumber ?? row.farmerId}</small></td>
              <td>{money(row.deductionAmount)} RWF</td><td>{money(row.previousDebt)} RWF</td><td>{money(row.debtRepaidInPeriod)} RWF</td><td>{money(row.remainingBalance)} RWF</td>
              <td><span className={`status-pill deduction-status-${row.status.toLowerCase().replaceAll('_', '-')}`}>{t(({ DEDUCTED: 'deductionFilterDeducted', NOT_DEDUCTED: 'deductionFilterNotDeducted', PARTIALLY_DEDUCTED: 'deductionFilterPartial', OUTSTANDING_DEBT: 'deductionFilterDebt' } as const)[row.status])}</span></td>
              <td><div className="deduction-row-actions">
                <button type="button" className="icon-button" onClick={() => inspectLedgerFarmer(row)} aria-label={t('viewFarmerHistory')} title={t('viewFarmerHistory')}><Eye size={16} aria-hidden="true" /></button>
                <button type="button" className="button button-secondary small-button" onClick={() => startConfiguration(undefined, row.farmerId)}>{t('deductionDifferentAmount')}</button>
              </div></td>
            </tr>)}
          </tbody></table></div>
          <div className="deduction-mobile-list">{ledgerRows.map((row) => <article className="deduction-mobile-card" key={`ledger-${row.farmerId}`}>
            <header><div className="deduction-mobile-identity">{isRowSelectable(row) ? <input type="checkbox" checked={selectedFarmerIds.includes(row.farmerId)} onChange={() => toggleFarmer(row.farmerId)} aria-label={t('deductionSelectFarmer').replace('{name}', row.farmerName || String(row.farmerId))} /> : null}<span className="deduction-row-number">#{row.farmerNumber ?? row.farmerId}</span><b>{row.farmerName || `Farmer #${row.farmerId}`}</b></div><strong>{money(row.deductionAmount)} RWF</strong></header>
            <p><span className={`status-pill deduction-status-${row.status.toLowerCase().replaceAll('_', '-')}`}>{t(({ DEDUCTED: 'deductionFilterDeducted', NOT_DEDUCTED: 'deductionFilterNotDeducted', PARTIALLY_DEDUCTED: 'deductionFilterPartial', OUTSTANDING_DEBT: 'deductionFilterDebt' } as const)[row.status])}</span></p>
            <details className="deduction-row-breakdown"><summary>{t('deductionDetails')}</summary><dl>
              <div><dt>{t('deductionSummaryNewTotal')}</dt><dd>{money(row.deductionAmount)} RWF</dd></div>
              <div><dt>{t('deductionPreviousDebt')}</dt><dd>{money(row.previousDebt)} RWF</dd></div>
              <div><dt>{t('deductionSummaryRecovered')}</dt><dd>{money(row.debtRepaidInPeriod)} RWF</dd></div>
              <div><dt>{t('deductionSummaryRemainingDebt')}</dt><dd>{money(row.remainingBalance)} RWF</dd></div>
            </dl></details>
            <div className="deduction-mobile-meta">
              <button type="button" className="button button-secondary small-button" onClick={() => inspectLedgerFarmer(row)}>{t('viewFarmerHistory')}</button>
              <button type="button" className="button button-secondary small-button" onClick={() => startConfiguration(undefined, row.farmerId)}>{t('deductionDifferentAmount')}</button>
            </div>
          </article>)}</div>
          {ledgerHasMore ? <div className="panel-footer"><button type="button" className="button button-secondary" onClick={() => void onLoadLedger(null, true)} disabled={ledgerLoading}>{ledgerLoading ? t('wait') : t('deductionsLoadOlder')} <ChevronDown size={16} /></button></div> : null}
        </> : !ledgerLoading ? <div className="workspace-empty" role="status"><b>{t('deductionNoFarmers')}</b></div> : null}

        <details className="deduction-configurations">
          <summary><span><Settings2 size={16} aria-hidden="true" />{t('deductionConfiguration')}</span><span className="count-label">{configurations.length}</span></summary>
          <div className="deduction-configuration-list">
            {configurations.map((configuration) => <article key={configuration.id} className="deduction-configuration-row">
              <div><b>{configuration.name}</b><p>{configuration.description || '—'}</p><small>{money(configuration.amountPerFarmer)} RWF · {t(configuration.frequency === 'MONTHLY' ? 'deductionFrequencyMonthly' : configuration.frequency === 'ONE_TIME' ? 'deductionFrequencyOnce' : 'deductionFrequencyPeriod')} · {t('deductionEffectiveDate')}: {formatDate(configuration.effectiveStartDate)} · {configuration.isActive ? t('deductionActive') : t('deductionInactive')} · {t('deductionManualOnly')}</small></div>
              <button type="button" className="icon-button" onClick={() => startConfiguration(configuration)} aria-label={t('edit')}><Pencil size={15} aria-hidden="true" /></button>
            </article>)}
            {!configurations.length ? <p className="muted-note">{t('deductionNoConfigurations')}</p> : null}
          </div>
        </details>
      </section>

      {batchOpen ? <Modal ariaLabel={t('deductionPreviewBatch')} onClose={() => setBatchOpen(false)} dismissible={!batchBusy} className="modal-panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{t('deductionManualOnly')}</span><h2>{t('deductionPreviewBatch')}</h2></div><button type="button" className="icon-button" onClick={() => setBatchOpen(false)} disabled={batchBusy} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        {selectedConfiguration ? <>
          <div className="metric-strip report-summary">
            <div><span>{t('deductionPeriod')}</span><b>{formatDate(periodStart)} – {formatDate(periodEnd)}</b></div>
            <div><span>{t('deductionConfiguration')}</span><b>{selectedConfiguration.name}</b></div>
            <div><span>{t('deductionAmountPerFarmer')}</span><b>{money(selectedConfiguration.amountPerFarmer)} RWF</b></div>
            <div><span>{t('deductionSelectedFarmers')}</span><b>{selectedFarmerIds.length}</b></div>
            <div><span>{t('deductionBatchTotal')}</span><b>{money(previewTotal)} RWF</b></div>
          </div>
          <p className="muted-note">{t('deductionBatchConfirmation')}</p>
          <div className="deduction-batch-preview-list" role="list" aria-label={t('deductionSelectedFarmers')}>
            {selectedRows.map((row) => <label key={row.farmerId} role="listitem" className="deduction-batch-preview-row">
              <input type="checkbox" checked onChange={() => toggleFarmer(row.farmerId)} aria-label={t('deductionExcludeFarmer').replace('{name}', row.farmerName || String(row.farmerId))} />
              <span>{row.farmerName || `Farmer #${row.farmerId}`} · #{row.farmerNumber ?? row.farmerId}</span>
              <b>{money(selectedConfiguration.amountPerFarmer)} RWF</b>
            </label>)}
            {selectedFarmerIds.filter((id) => !selectedRows.some((row) => row.farmerId === id)).map((id) => <label key={id} role="listitem" className="deduction-batch-preview-row">
              <input type="checkbox" checked onChange={() => toggleFarmer(id)} aria-label={t('deductionExcludeFarmer').replace('{name}', `Farmer #${id}`)} />
              <span>Farmer #{id}</span>
              <b>{money(selectedConfiguration.amountPerFarmer)} RWF</b>
            </label>)}
          </div>
        </> : null}
        {batchError ? <p className="form-error" role="alert">{batchError}</p> : null}
        {batchResult ? <div className="workspace-empty" role="status"><b>{t('deductionBatchResults').replace('{succeeded}', String(batchResult.succeeded)).replace('{duplicates}', String(batchResult.duplicates))}</b>{batchResult.succeededFarmers.length ? <p>{t('deductionBatchSucceededList')}: {batchResult.succeededFarmers.map((farmer) => farmer.name).join(', ')}</p> : null}{batchResult.duplicateFarmers.length ? <p>{t('deductionBatchDuplicateList')}: {batchResult.duplicateFarmers.map((farmer) => farmer.name).join(', ')}</p> : null}{batchResult.failures.length ? <ul>{batchResult.failures.map((failure) => <li key={failure.farmerId}>#{failure.farmerId}: {failure.reason}</li>)}</ul> : null}</div> : null}
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setBatchOpen(false)} disabled={batchBusy}>{t('cancel')}</button><button type="button" className="button button-primary" onClick={() => void applyBatch()} disabled={batchBusy || !selectedConfiguration || !selectedFarmerIds.length}>{batchBusy ? t('wait') : t('deductionConfirmBatch')}</button></div>
      </Modal> : null}

      {configurationOpen ? <Modal ariaLabel={t('deductionConfigure')} onClose={() => setConfigurationOpen(false)} dismissible className="modal-panel-wide">
        <div className="panel-heading"><div><span className="eyebrow">{t('deductionManualOnly')}</span><h2>{configurationDraft.id ? t('deductionEditConfiguration') : t('deductionNewConfiguration')}</h2></div><button type="button" className="icon-button" onClick={() => setConfigurationOpen(false)} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack compact" onSubmit={(event) => void saveConfiguration(event)}>
          <label>{t('deductionName')}<input required maxLength={120} value={configurationDraft.name} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
          <label>{t('deductionDescription')}<textarea rows={2} maxLength={2000} value={configurationDraft.description} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
          <div className="toolbar"><label>{t('deductionAmountPerFarmer')}<input required type="number" min="0.01" step="0.01" value={configurationDraft.amountPerFarmer} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, amountPerFarmer: event.target.value }))} /></label><label>{t('deductionsType')}<select value={configurationDraft.type} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, type: event.target.value }))}><option value="Igipande">{t('deductionTypeIgipande')}</option><option value="Advance">{t('deductionTypeAdvance')}</option><option value="Umwenda">{t('deductionTypeDebt')}</option><option value="Other">{t('deductionTypeOther')}</option></select></label></div>
          <div className="toolbar"><label>{t('deductionFrequency')}<select value={configurationDraft.frequency} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, frequency: event.target.value as typeof draft.frequency }))}><option value="PERIOD">{t('deductionFrequencyPeriod')}</option><option value="MONTHLY">{t('deductionFrequencyMonthly')}</option><option value="ONE_TIME">{t('deductionFrequencyOnce')}</option></select></label><label>{t('deductionEffectiveDate')}<input type="date" required value={configurationDraft.effectiveStartDate} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, effectiveStartDate: event.target.value }))} /></label></div>
          <label>{t('deductionEligibility')}<select value={configurationDraft.eligibilityMode} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, eligibilityMode: event.target.value as 'ALL' | 'SELECTED', eligibleFarmerIds: [] }))}><option value="ALL">{t('deductionEligibilityAll')}</option><option value="SELECTED">{t('deductionEligibilitySelected')}</option></select></label>
          {configurationDraft.eligibilityMode === 'SELECTED' ? <>
            <label>{t('deductionSearchEligible')}<input type="search" value={deductionFarmerSearch} onChange={(event) => { setDeductionFarmerSearch(event.target.value); void onLoadDeductionFarmers(event.target.value); }} /></label>
            <label>{t('deductionEligibleFarmers')}<select multiple size={6} value={configurationDraft.eligibleFarmerIds.map(String)} onFocus={() => { void onLoadDeductionFarmers(deductionFarmerSearch); }} onChange={(event) => {
              const visibleIds = new Set(deductionFarmers.map((farmer) => farmer.id));
              const selectedVisibleIds = Array.from(event.target.selectedOptions).map((option) => Number(option.value));
              setConfigurationDraft((draft) => ({ ...draft, eligibleFarmerIds: [...draft.eligibleFarmerIds.filter((id) => !visibleIds.has(id)), ...selectedVisibleIds] }));
            }}>{deductionFarmers.map((farmer) => <option key={farmer.id} value={String(farmer.id)}>{farmer.name} · #{(farmer as any).farmerNumber ?? farmer.id}</option>)}</select></label>
          </> : null}
          <label className="checkbox-row"><input type="checkbox" checked={configurationDraft.isActive} onChange={(event) => setConfigurationDraft((draft) => ({ ...draft, isActive: event.target.checked }))} />{t('deductionActive')}</label>
          <p className="muted-note">{t('deductionConfigManualNotice')}</p>
          {batchError ? <p className="form-error" role="alert">{batchError}</p> : null}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setConfigurationOpen(false)}>{t('cancel')}</button><button type="submit" className="button button-primary">{t('saveChanges')}</button></div>
        </form>
      </Modal> : null}

      {createOpen ? (
        <Modal ariaLabel={t('deductionsAdd')} onClose={onCloseCreate} dismissible={!createBusy}>
          <div className="panel-heading">
            <div><span className="eyebrow">{t('dashboardAccounting')}</span><h2>{t('deductionsAdd')}</h2></div>
            <button type="button" className="icon-button" onClick={onCloseCreate} disabled={createBusy} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button>
          </div>
          <form className="form-stack compact" onSubmit={submitCreate}>
            <label>
              {t('deductionsSearch')}
              <input type="search" placeholder={t('deductionsSearch')} value={deductionFarmerSearch} onChange={(event) => {
                const next = event.target.value;
                setDeductionFarmerSearch(next);
                void onLoadDeductionFarmers(next);
              }} />
            </label>
            <label>
              {t('deductionsFarmer')}
              <select required value={createForm.farmerId} onChange={(event) => setCreateForm((current) => ({ ...current, farmerId: event.target.value }))}>
                <option value="">{t('deductionsFarmer')}</option>
                {deductionFarmers.map((farmer) => <option key={farmer.id} value={String(farmer.id)}>{farmer.name}</option>)}
              </select>
            </label>
            <label>
              {t('deductionsAmount')}
              <input required type="number" min="0.01" step="0.01" value={createForm.amount} onChange={(event) => setCreateForm((current) => ({ ...current, amount: event.target.value }))} />
            </label>
            <label>
              {t('deductionsType')}
              <select value={createForm.type} onChange={(event) => setCreateForm((current) => ({ ...current, type: event.target.value }))}>
                <option value="Igipande">{t('deductionTypeIgipande')}</option>
                <option value="Advance">{t('deductionTypeAdvance')}</option>
                <option value="Umwenda">{t('deductionTypeDebt')}</option>
                <option value="Other">{t('deductionTypeOther')}</option>
              </select>
            </label>
            <label>
              {t('deductionsDate')}
              <input type="date" required value={createForm.date} onChange={(event) => setCreateForm((current) => ({ ...current, date: event.target.value }))} />
            </label>
            <label>
              {t('deductionsReason')}
              <input value={createForm.reason} onChange={(event) => setCreateForm((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <label>
              {t('deductionsNotes')}
              <textarea rows={3} value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            {submitError || createError ? <p className="form-error" role="alert">{submitError || createError}</p> : null}
            <div className="form-actions">
              <button type="button" className="button button-secondary" onClick={onCloseCreate} disabled={createBusy}>{t('cancel')}</button>
              <button className="button button-primary" disabled={createBusy || !formCanSubmit}>{createBusy ? t('wait') : t('deductionsAdd')}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {inspectorOpen ? (
        <Modal ariaLabel={inspectorFarmerName || 'Farmer deductions'} onClose={onCloseInspector} className="modal-panel-wide deduction-inspector-modal" dismissible>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{t('deductionsFarmer')}</span>
              <h2>{inspectorFarmerName || 'Farmer'}</h2>
            </div>
            <button type="button" className="icon-button" onClick={onCloseInspector} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button>
          </div>

          {inspectorError ? <p className="form-error" role="alert">{inspectorError}</p> : null}

          {inspectorLoading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{t('dashboardLoading')}</div> : null}

          {!inspectorLoading && !inspectorRows.length ? <div className="workspace-empty" role="status"><span className="workspace-empty-icon"><CircleDollarSign size={21} aria-hidden="true" /></span><b>{t('deductionsEmptyTitle')}</b></div> : null}

          {inspectorRows.length ? (
            <div className="deduction-history-list">
              {inspectorRows.map((row) => (
                <article className="deduction-history-item" key={row.id}>
                  <div className="deduction-history-row-main">
                    <div>
                      <small>{formatDate(row.date)}</small>
                      <strong>{money(row.amount)} RWF</strong>
                    </div>
                    <div className="deduction-history-meta">
                      <span>{row.type}</span>
                      <span className="status-pill">{row.status}</span>
                    </div>
                  </div>
                  <p><b>{t('deductionsReason')}</b>: {row.reason || '—'}</p>
                  <p><b>{t('deductionsNotes')}</b>: {row.notes || '—'}</p>
                  <div className="deduction-history-actions">
                    <button type="button" className="button button-secondary small-button" onClick={() => setEditDraft({ id: row.id, farmerId: row.farmerId, amount: String(row.amount), type: row.type, date: row.date, reason: row.reason || '', notes: row.notes || '', status: row.status })}><Pencil size={14} aria-hidden="true" />{t('edit')}</button>
                    {row.status === 'Active' ? <button type="button" className="button button-secondary small-button" onClick={() => void clearHistory(row)} disabled={pendingActionId === row.id}><Check size={14} aria-hidden="true" />{pendingActionId === row.id ? t('wait') : t('deductionsClear')}</button> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {inspectorHasMore ? <div className="panel-footer"><button type="button" className="button button-secondary" onClick={onLoadHistoryMore} disabled={inspectorLoading}>{inspectorLoading ? t('wait') : t('deductionsLoadOlder')} <ChevronDown size={16} /></button></div> : null}
        </Modal>
      ) : null}

      {editDraft ? (
        <Modal ariaLabel={t('edit')} onClose={() => setEditDraft(null)} className="modal-panel-wide" dismissible>
          <div className="panel-heading">
            <div><span className="eyebrow">{t('auditLog')}</span><h2>{t('edit')}</h2></div>
            <button type="button" className="icon-button" onClick={() => setEditDraft(null)} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button>
          </div>
          <form className="form-stack compact" onSubmit={saveEdit}>
            <label>
              {t('deductionsAmount')}
              <input type="number" min="0.01" step="0.01" value={editDraft.amount} onChange={(event) => setEditDraft((current) => current ? { ...current, amount: event.target.value } : current)} />
            </label>
            <label>
              {t('deductionsType')}
              <select value={editDraft.type} onChange={(event) => setEditDraft((current) => current ? { ...current, type: event.target.value } : current)}>
                <option value="Igipande">{t('deductionTypeIgipande')}</option>
                <option value="Advance">{t('deductionTypeAdvance')}</option>
                <option value="Umwenda">{t('deductionTypeDebt')}</option>
                <option value="Other">{t('deductionTypeOther')}</option>
              </select>
            </label>
            <label>
              {t('deductionsDate')}
              <input type="date" value={editDraft.date} onChange={(event) => setEditDraft((current) => current ? { ...current, date: event.target.value } : current)} />
            </label>
            <label>
              {t('deductionsReason')}
              <input value={editDraft.reason} onChange={(event) => setEditDraft((current) => current ? { ...current, reason: event.target.value } : current)} />
            </label>
            <label>
              {t('deductionsNotes')}
              <textarea rows={3} value={editDraft.notes} onChange={(event) => setEditDraft((current) => current ? { ...current, notes: event.target.value } : current)} />
            </label>
            <label>
              {t('deductionsStatus')}
              <select value={editDraft.status} onChange={(event) => setEditDraft((current) => current ? { ...current, status: event.target.value } : current)}>
                <option value="Active">Active</option>
                <option value="Cleared">Cleared</option>
              </select>
            </label>
            {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
            <div className="form-actions">
              <button type="button" className="button button-secondary" onClick={() => setEditDraft(null)}>{t('cancel')}</button>
              <button className="button button-primary" type="submit" disabled={pendingActionId === editDraft.id}>{pendingActionId === editDraft.id ? t('wait') : t('saveChanges')}</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
