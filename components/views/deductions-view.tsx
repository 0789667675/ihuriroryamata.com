'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Check, ChevronDown, CircleDollarSign, Eye, Pencil, Plus, Search, X } from 'lucide-react';
import { Modal } from '../ui/modal';
import { WorkspacePageHeader } from '../ui/workspace-page-header';
import { getAccountingDate } from '@/lib/utils/accounting-period';

export type DeductionGroupSummary = {
  farmerId: number;
  farmerName: string | null;
  deductionCount: number;
  activeDeductionCount: number;
  clearedDeductionCount: number;
  totalActiveDeductionAmount: number;
  totalClearedDeductionAmount: number;
  mostRecentDeductionDate: string | null;
};

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

type FarmerOption = {
  id: number;
  name: string;
  phone?: string | null;
  nationalId?: string | null;
};

type Props = {
  groups: DeductionGroupSummary[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchValue: string;
  onSearchSubmit: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onResetFilters: () => void;
  sortBy: 'date' | 'farmerName' | 'amount';
  sortDirection: 'asc' | 'desc';
  onSortChange: (field: 'date' | 'farmerName' | 'amount', direction: 'asc' | 'desc') => void;
  onInspectFarmer: (group: DeductionGroupSummary) => void;
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
  onOpenBatchCreate: () => void;
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
  groups,
  loading,
  hasMore,
  onLoadMore,
  searchQuery,
  setSearchQuery,
  searchValue,
  onSearchSubmit,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  onResetFilters,
  sortBy,
  sortDirection,
  onSortChange,
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
  onOpenBatchCreate,
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
  const [createForm, setCreateForm] = useState({ farmerId: '', amount: '', type: 'Other', date: today(), reason: '', notes: '' });
  const [editDraft, setEditDraft] = useState<null | { id: number; farmerId: number; amount: string; type: string; date: string; reason: string; notes: string; status: string }>(null);
  const [submitError, setSubmitError] = useState('');
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const formCanSubmit = useMemo(() => Boolean(createForm.farmerId && createForm.amount && createForm.date), [createForm]);
  const filterActive = Boolean(searchValue || typeFilter || statusFilter || sortBy !== 'date' || sortDirection !== 'desc');

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

  const sortableHeader = (field: 'date' | 'farmerName' | 'amount', label: string) => {
    const active = sortBy === field;
    const Icon = active ? (sortDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <button type="button" className="farmer-sort-button" aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => {
        const direction = active ? (sortDirection === 'asc' ? 'desc' : 'asc') : field === 'date' ? 'desc' : 'asc';
        onSortChange(field, direction);
      }}>
        {label}
        <Icon size={13} aria-hidden="true" />
      </button>
    );
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

  return (
    <div className="screen-grid deductions-view">
      <section className="panel panel-wide deduction-screen-panel">
        <WorkspacePageHeader
          eyebrow={t('dashboardToday')}
          title={t('deductionsRecent')}
          description={t('dashboardAccounting')}
          primaryAction={(
            <div className="workspace-header-actions">
              <button type="button" className="button button-primary small-button" onClick={onOpenCreate}>
                <Plus size={15} aria-hidden="true" />
                {t('deductionsAdd')}
              </button>
              <button type="button" className="button button-secondary small-button" onClick={onOpenBatchCreate}>
                {t('deductionsAdd').includes('Add') ? 'Add many' : 'Ongera byinshi'}
              </button>
            </div>
          )}
        />

        <div className={`deduction-toolbar-shell${filtersOpen ? ' is-open' : ''}`}>
          <div className="toolbar deduction-list-controls">
            <form className={['search', 'form', 'deduction-search-form'].join('-')} onSubmit={(event) => { event.preventDefault(); onSearchSubmit(searchQuery.trim()); }}>
              <Search size={17} aria-hidden="true" />
              <input aria-label={t('milkSearchLabel')} placeholder={t('deductionsSearch')} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <button type="submit" className="button button-secondary">{t('search')}</button>
            </form>

            <div className="deduction-toolbar-compact-actions">
              <label className="deduction-filter-field">
                <span>{t('deductionsType')}</span>
                <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}>
                  <option value="">{t('allStatuses')}</option>
                  <option value="Advance">Advance</option>
                  <option value="Umwenda">Umwenda</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="deduction-filter-field">
                <span>{t('deductionsStatus')}</span>
                <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
                  <option value="">{t('allStatuses')}</option>
                  <option value="Active">Active</option>
                  <option value="Cleared">Cleared</option>
                </select>
              </label>

              <div className="deduction-sort-field" role="group" aria-label={t('deductionsSort')}>
                {sortableHeader('date', t('deductionsSortDate'))}
                {sortableHeader('farmerName', t('deductionsSortFarmer'))}
                {sortableHeader('amount', t('deductionsSortAmount'))}
              </div>
            </div>

            {filterActive ? (
              <button type="button" className="button button-secondary small-button" onClick={onResetFilters}>{t('milkClearSearch')}</button>
            ) : null}
          </div>

          <button type="button" className="button button-secondary deduction-mobile-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            {filtersOpen ? t('milkClearSearch') : t('deductionsFilters')}
          </button>
        </div>

        {loading && groups.length ? <div className="deduction-refresh-state" role="status"><span className="loading-indicator" />{t('dashboardLoading')}</div> : null}

        {loading && !groups.length ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{t('dashboardLoading')}</div> : groups.length ? (
          <>
            <div className="deduction-table-shell">
              <table className="deduction-table" aria-label={t('deductionsRecent')}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t('deductionsFarmer')}</th>
                    <th scope="col">{t('deductionsDate')}</th>
                    <th scope="col">{t('deductionsType')}</th>
                    <th scope="col">{t('deductionsSortAmount')}</th>
                    <th scope="col">{t('deductionsStatus')}</th>
                    <th scope="col">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group, index) => {
                    const groupStatus = group.activeDeductionCount > 0 && group.clearedDeductionCount > 0 ? 'Mixed' : group.activeDeductionCount > 0 ? 'Active' : 'Cleared';
                    const groupType = group.activeDeductionCount > 0 && group.clearedDeductionCount > 0 ? 'Mixed' : (group.activeDeductionCount > 0 ? 'Active Deduction' : 'Cleared Deduction');
                    const groupAmount = group.activeDeductionCount > 0 ? group.totalActiveDeductionAmount : group.totalClearedDeductionAmount;
                    return (
                      <tr key={group.farmerId}>
                        <td>{index + 1}</td>
                        <td><span className="deduction-farmer-name">{group.farmerName || `Farmer #${group.farmerId}`}</span></td>
                        <td>{formatDate(group.mostRecentDeductionDate)}</td>
                        <td>{groupType}</td>
                        <td className="deduction-table-amount">{money(groupAmount)} RWF</td>
                        <td><span className={`status-pill deduction-status-${groupStatus.toLowerCase()}`}>{groupStatus}</span></td>
                        <td><button type="button" className="button button-secondary small-button" onClick={() => onInspectFarmer(group)}>{t('viewFarmerHistory')}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="deduction-mobile-list" aria-label={t('deductionsRecent')}>
              {groups.map((group, index) => {
                const groupStatus = group.activeDeductionCount > 0 && group.clearedDeductionCount > 0 ? 'Mixed' : group.activeDeductionCount > 0 ? 'Active' : 'Cleared';
                const groupType = group.activeDeductionCount > 0 && group.clearedDeductionCount > 0 ? 'Mixed' : (group.activeDeductionCount > 0 ? 'Active Deduction' : 'Cleared Deduction');
                const groupAmount = group.activeDeductionCount > 0 ? group.totalActiveDeductionAmount : group.totalClearedDeductionAmount;
                return (
                  <article className="deduction-mobile-card" key={group.farmerId}>
                    <header>
                      <div>
                        <small>#{index + 1}</small>
                        <b>{group.farmerName || `Farmer #${group.farmerId}`}</b>
                      </div>
                      <strong>{money(groupAmount)} RWF</strong>
                    </header>
                    <p>
                      <span>{groupType}</span>
                      <span className="deduction-mobile-divider">•</span>
                      <span>{formatDate(group.mostRecentDeductionDate)}</span>
                    </p>
                    <div className="deduction-mobile-meta">
                      <span className={`status-pill deduction-status-${groupStatus.toLowerCase()}`}>{groupStatus}</span>
                      <button type="button" className="button button-secondary small-button" onClick={() => onInspectFarmer(group)}>{t('viewFarmerHistory')}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : loading ? <div className="workspace-empty workspace-loading" role="status"><span className="loading-indicator" />{t('dashboardLoading')}</div> : (
          <div className="workspace-empty" role="status">
            <span className="workspace-empty-icon"><CircleDollarSign size={21} aria-hidden="true" /></span>
            <div>
              <b>{t('deductionsEmptyTitle')}</b>
              <p>{filterActive ? t('deductionsNoMatches') : t('deductionsEmptyBody')}</p>
              {filterActive ? <button type="button" className="button button-secondary small-button" onClick={onResetFilters}>{t('milkClearSearch')}</button> : null}
            </div>
          </div>
        )}

        {hasMore ? <div className="panel-footer"><button type="button" className="button button-secondary" onClick={onLoadMore} disabled={loading}>{loading ? t('wait') : t('deductionsLoadOlder')} <ChevronDown size={16} /></button></div> : null}
      </section>

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
                <option value="Advance">Advance</option>
                <option value="Umwenda">Umwenda</option>
                <option value="Other">Other</option>
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
                <option value="Advance">Advance</option>
                <option value="Umwenda">Umwenda</option>
                <option value="Other">Other</option>
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
