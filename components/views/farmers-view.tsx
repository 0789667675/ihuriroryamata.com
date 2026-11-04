'use client';

import { Fragment, useRef, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  ChevronDown,
  Edit3,
  GitMerge,
  History,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';
import { getImportCopy } from '@/lib/i18n/import-copy';
import { formatPublicCopy, type PublicCopyKey } from '@/lib/i18n/public-copy';

type Farmer = {
  id: number;
  name: string;
  location: string | null;
  phone: string | null;
  nationalId: string | null;
  accountNumber: string | null;
  collectionCenter: string | null;
  cowType: string | null;
  collectorUserId?: number | null;
  farmerNumber?: number | null;
};

type FarmerPage = { data: Farmer[]; nextCursor: string | null; hasMore: boolean; pageSize: number };
type Center = { id: number; name: string };
type CollectorAssignment = { collector_user_id: number; collector_name: string; collector_account_number: string | null; abacunda_count: number };
type FarmerFormValues = { name: string; collectionCenterId: string; phone: string; nationalId: string; accountNumber: string; cowType: string; collectorUserId: string };
type FarmerField = { key: string; required: boolean };

type FarmersViewProps = {
  t: (key: PublicCopyKey) => string;
  language: 'rw' | 'en';
  isCollector: boolean;
  isDairy: boolean;
  centers: Center[];
  selectedCenter: string;
  onSelectCenter: (centerId: string) => void;
  collectorOwnedCenters: Center[];
  collectorAssignments: CollectorAssignment[];
  collectorAssignmentsLoading: boolean;
  farmerPage: FarmerPage | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchValue: string;
  onSearch: () => void;
  farmerCenter: string;
  setFarmerCenter: (value: string) => void;
  collectorFilter: string;
  setCollectorFilter: (value: string) => void;
  sortBy: '' | 'name' | 'nationalId' | 'collectionCenter';
  sortDirection: 'asc' | 'desc';
  onSort: (field: 'name' | 'nationalId' | 'collectionCenter' | null, direction?: 'asc' | 'desc') => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
  onCreate: () => void;
  onOpenBatchCreate: () => void;
  onImport: () => void;
  onOpenHistory: (farmer: Farmer) => void;
  onOpenIfishi: (farmer: Farmer) => void;
  onEdit: (farmer: Farmer) => void;
  onMerge: (farmer: Farmer) => void;
  onDelete: (farmer: Farmer) => void;
  collectorName: (collectorUserId?: number | null) => string;
  formatFarmerNumber: (value?: number | null) => string;
  selectedFarmerIds: Set<number>;
  onToggleFarmer: (id: number) => void;
  inlineNumberFarmerId: number | null;
  inlineFarmerNumber: string;
  inlineNumberSaving: boolean;
  onStartFarmerNumberEdit: (id: number, current?: number | null) => void;
  onCancelFarmerNumberEdit: () => void;
  onChangeFarmerNumber: (value: string) => void;
  onSaveFarmerNumber: (id: number, current?: number | null) => void;
  inlineEditingFarmerId: number | null;
  inlineFarmerPhone: string;
  onStartPhoneEdit: (farmer: Farmer) => void;
  onCancelPhoneEdit: () => void;
  onChangePhone: (value: string) => void;
  onSavePhone: (farmer: Farmer) => void;
  showCenterSetup?: ReactNode;
  collectorManagement?: ReactNode;
  fields: FarmerField[];
  busy: boolean;
  createOpen: boolean;
  onCloseCreate: () => void;
  createError: string;
  createForm: FarmerFormValues;
  onChangeCreateField: (key: keyof FarmerFormValues, value: string) => void;
  onSubmitCreate: (event: FormEvent<HTMLFormElement>) => void;
  editingFarmer: Farmer | null;
  onCloseEdit: () => void;
  editForm: FarmerFormValues & { farmerNumber: string };
  onChangeEditField: (key: keyof (FarmerFormValues & { farmerNumber: string }), value: string) => void;
  onSubmitEdit: (event: FormEvent<HTMLFormElement>) => void;
};

export function FarmersView({
  t,
  language,
  isCollector,
  isDairy,
  centers,
  selectedCenter,
  onSelectCenter,
  collectorOwnedCenters,
  collectorAssignments,
  collectorAssignmentsLoading,
  farmerPage,
  loading,
  error,
  onRetry,
  searchQuery,
  setSearchQuery,
  searchValue,
  onSearch,
  farmerCenter,
  setFarmerCenter,
  collectorFilter,
  setCollectorFilter,
  sortBy,
  sortDirection,
  onSort,
  onClearFilters,
  onLoadMore,
  onCreate,
  onOpenBatchCreate,
  onImport,
  onOpenHistory,
  onOpenIfishi,
  onEdit,
  onMerge,
  onDelete,
  collectorName,
  formatFarmerNumber,
  selectedFarmerIds,
  onToggleFarmer,
  inlineNumberFarmerId,
  inlineFarmerNumber,
  inlineNumberSaving,
  onStartFarmerNumberEdit,
  onCancelFarmerNumberEdit,
  onChangeFarmerNumber,
  onSaveFarmerNumber,
  inlineEditingFarmerId,
  inlineFarmerPhone,
  onStartPhoneEdit,
  onCancelPhoneEdit,
  onChangePhone,
  onSavePhone,
  showCenterSetup,
  collectorManagement,
  fields,
  busy,
  createOpen,
  onCloseCreate,
  createError,
  createForm,
  onChangeCreateField,
  onSubmitCreate,
  editingFarmer,
  onCloseEdit,
  editForm,
  onChangeEditField,
  onSubmitEdit,
}: FarmersViewProps) {
  const cancelledNumberEditRef = useRef<number | null>(null);
  const cancelledPhoneEditRef = useRef<number | null>(null);
  const activeCenterName = centers.find((center) => String(center.id) === selectedCenter)?.name || centers[0]?.name || '';
  const isFiltered = Boolean(searchValue || farmerCenter || collectorFilter);
  const renderCenterField = (field: FarmerField, form: FarmerFormValues, update: (key: keyof FarmerFormValues, value: string) => void) => (
    isCollector ? <>
      {collectorOwnedCenters.length > 1 ? <label>{t('columnLocation')}<select aria-label={t('columnLocation')} value={form.collectionCenterId} onChange={(event) => update('collectionCenterId', event.target.value)} required={field.required} disabled={!collectorOwnedCenters.length}><option value="">{t('selectCenter')}</option>{collectorOwnedCenters.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null}
      {!collectorOwnedCenters.length ? <p className="muted-note" role="status">{t('farmerNoCenters')}</p> : null}
    </> : isDairy ? <>
      {centers.length > 1 ? <label>{t('activeIkigo')}<input readOnly value={centers.find((center) => String(center.id) === selectedCenter)?.name || ''} required={field.required} /></label> : null}
      {!centers.length ? <p className="muted-note" role="status">{t('farmerNoCenters')}</p> : null}
    </> : centers.length > 1 ? <label>{t('columnCenter')}<select value={form.collectionCenterId} onChange={(event) => update('collectionCenterId', event.target.value)} required={field.required}><option value="">{t('selectCenter')}</option>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null
  );

  const renderFarmerFields = (form: FarmerFormValues, update: (key: keyof FarmerFormValues, value: string) => void) => fields.map((field) => {
    switch (field.key) {
      case 'name': return <label key="name">{t('fullName')}<input autoComplete="name" required={field.required} value={form.name} onChange={(event) => update('name', event.target.value)} /></label>;
      case 'phone': return <label key="phone">{t('columnPhone')}<input type="tel" inputMode="tel" autoComplete="tel" maxLength={50} required={field.required} value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label>;
      case 'nationalId': return <label key="nationalId">{t('columnNationalId')}<input required={field.required} value={form.nationalId} onChange={(event) => update('nationalId', event.target.value)} /></label>;
      case 'accountNumber': return <label key="accountNumber">{t('accountNumber')}<input required={field.required} value={form.accountNumber} onChange={(event) => update('accountNumber', event.target.value)} /></label>;
      case 'collectionCenter': return <Fragment key="collectionCenter">{renderCenterField(field, form, update)}</Fragment>;
      default: return null;
    }
  });

  return (
    <div className="screen-grid farmers-view">
      {showCenterSetup}
      <section className="panel panel-wide farmers-directory">
        <WorkspacePageHeader
          eyebrow={isDairy ? t('dashboardCenter') : t('directory')}
          title={t('navFarmers')}
          description={activeCenterName || undefined}
          primaryAction={
            <div className="workspace-header-actions">
              <button type="button" className="button button-primary small-button" onClick={onCreate} disabled={Boolean((isCollector || isDairy) && !selectedCenter)}><Plus size={15} aria-hidden="true" />{t('farmersAdd')}</button>
              <button type="button" className="button button-secondary small-button" onClick={onOpenBatchCreate} disabled={Boolean((isCollector || isDairy) && !selectedCenter)}>{language === 'en' ? 'Add many' : 'Ongeramo benshi'}</button>
            </div>
          }
          secondaryActions={isCollector || isDairy ? [<button key="import-farmers" type="button" className="button button-secondary small-button" onClick={onImport} disabled={!centers.length}><Upload size={15} aria-hidden="true" />{getImportCopy(language, 'openFarmerImport')}</button>] : []}
        />

        <div className="farmers-toolbar">
          <form className="search-form farmers-search-form" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
            <Search size={17} aria-hidden="true" />
            <input aria-label={t('farmersSearchPlaceholder')} placeholder={t('farmersSearchPlaceholder')} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
            <button type="submit" className="button button-secondary">{t('search')}</button>
          </form>
          {isDairy ? centers.length > 1 ? <label className="farmer-filter-field">{t('activeIkigo')}<select value={selectedCenter} onChange={(event) => onSelectCenter(event.target.value)}>{centers.map((center) => <option key={center.id} value={String(center.id)}>{center.name}</option>)}</select></label> : null
            : centers.length > 1 ? <label className="farmer-filter-field">{t('allCenters')}<select value={farmerCenter} onChange={(event) => setFarmerCenter(event.target.value)}><option value="">{t('allCenters')}</option>{centers.map((center) => <option key={center.id} value={center.name}>{center.name}</option>)}</select></label> : null}
          {!isCollector && collectorAssignments.length ? <label className="farmer-filter-field">{t('assignedCollectors')}<select value={collectorFilter} onChange={(event) => setCollectorFilter(event.target.value)}><option value="">{t('allCollectors')}</option>{collectorAssignments.map((assignment) => <option key={assignment.collector_user_id} value={String(assignment.collector_user_id)}>{assignment.collector_name}</option>)}</select></label> : null}
          <label className="farmer-filter-field farmer-sort-mobile">{t('sort')}<select aria-label={t('sort')} value={sortBy ? `${sortBy}:${sortDirection}` : ''} onChange={(event) => {
            const [field, direction] = event.target.value.split(':');
            if (['name', 'nationalId', 'collectionCenter'].includes(field) && ['asc', 'desc'].includes(direction)) onSort(field as 'name' | 'nationalId' | 'collectionCenter', direction as 'asc' | 'desc');
            else if (!field) onSort(null);
          }}>
            <option value="">{t('sort')}</option><option value="name:asc">{t('columnName')} ↑</option><option value="name:desc">{t('columnName')} ↓</option><option value="nationalId:asc">{t('accountNationalId')} ↑</option><option value="nationalId:desc">{t('accountNationalId')} ↓</option><option value="collectionCenter:asc">{t('columnCenter')} ↑</option><option value="collectionCenter:desc">{t('columnCenter')} ↓</option>
          </select></label>
          {isFiltered ? <button type="button" className="button button-secondary small-button" onClick={onClearFilters}>{t('milkClearSearch')}</button> : null}
        </div>

        <div className="farmers-summary" aria-live="polite">
          <span>{farmerPage ? formatPublicCopy(language, 'farmersFound', 'Farmers found: {count}', { count: farmerPage.data.length }) : t('dashboardLoading')}</span>
          {!isDairy && !isCollector && collectorAssignments.length ? <span>{formatPublicCopy(language, 'collectorsFound', 'Collectors found: {count}', { count: collectorAssignments.length })}</span> : null}
          {loading ? <span className="loading-indicator" role="status" aria-label={t('dashboardLoading')} /> : null}
          {collectorAssignmentsLoading ? <span className="loading-indicator" role="status" aria-label={t('dashboardLoading')} /> : null}
        </div>

        {collectorManagement}
        {error ? <div className="farmers-error" role="alert"><span>{error}</span><button type="button" className="button button-secondary small-button" onClick={onRetry}>{t('tryAgain')}</button></div> : null}

        {farmerPage?.data.length ? <>
          <div className="table-scroll farmers-desktop-table"><table><thead><tr>
            <th className="farmer-number-column">{t('farmerNumberShort')}</th>
            <th aria-sort={sortBy === 'name' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => onSort('name')}>{t('columnName')}{sortBy === 'name' ? sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}</button></th>
            <th>{t('columnPhone')}</th>
            <th aria-sort={sortBy === 'nationalId' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => onSort('nationalId')}>{t('accountNationalId')}{sortBy === 'nationalId' ? sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}</button></th>
            <th aria-sort={sortBy === 'collectionCenter' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="farmer-sort-button" onClick={() => onSort('collectionCenter')}>{t('columnCenter')}{sortBy === 'collectionCenter' ? sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" />}</button></th>
            <th>{t('assignedCollectors')}</th>
            <th className="farmer-actions-heading">{t('actions')}</th>
          </tr></thead><tbody>{farmerPage.data.map((farmer) => <tr key={farmer.id} className="farmer-directory-row">
            <td className="farmer-number-cell"><div className="farmer-number-control"><input type="checkbox" className="farmer-row-checkbox" checked={selectedFarmerIds.has(farmer.id)} onChange={() => onToggleFarmer(farmer.id)} aria-label={language === 'en' ? `Select ${farmer.name}` : `Hitamo ${farmer.name}`} />
              {inlineNumberFarmerId === farmer.id ? <input type="number" min="1" step="1" className="table-input font-mono farmer-number-input" autoFocus disabled={inlineNumberSaving} value={inlineFarmerNumber} onChange={(event) => onChangeFarmerNumber(event.target.value)} onBlur={() => { if (cancelledNumberEditRef.current === farmer.id) { cancelledNumberEditRef.current = null; return; } onSaveFarmerNumber(farmer.id, farmer.farmerNumber); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelledNumberEditRef.current = farmer.id; onCancelFarmerNumberEdit(); } }} aria-label={t('farmerNumberShort')} />
                : <button type="button" className="farmer-number-badge font-mono" title={language === 'en' ? 'Edit farmer number' : 'Hindura nimero y’umworozi'} onClick={() => onStartFarmerNumberEdit(farmer.id, farmer.farmerNumber)}>{formatFarmerNumber(farmer.farmerNumber) || '—'}</button>}</div></td>
            <td className="strong-cell"><b>{farmer.name}</b>{farmer.location ? <small className="farmer-row-detail">{farmer.location}</small> : null}</td>
            <td>{inlineEditingFarmerId === farmer.id ? <input type="tel" inputMode="tel" className="table-input farmer-phone-input" autoFocus value={inlineFarmerPhone} onChange={(event) => onChangePhone(event.target.value)} onBlur={() => { if (cancelledPhoneEditRef.current === farmer.id) { cancelledPhoneEditRef.current = null; return; } onSavePhone(farmer); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelledPhoneEditRef.current = farmer.id; onCancelPhoneEdit(); } }} aria-label={t('columnPhone')} /> : <button type="button" className="farmer-phone-value" onClick={() => onStartPhoneEdit(farmer)} aria-label={language === 'en' ? `Edit phone for ${farmer.name}` : `Hindura telefone ya ${farmer.name}`}>{farmer.phone || '—'}</button>}</td>
            <td className="font-mono">{farmer.nationalId || '—'}</td>
            <td>{farmer.collectionCenter || '—'}</td>
            <td>{farmer.collectorUserId ? collectorName(farmer.collectorUserId) : '—'}</td>
            <td><div className="farmer-row-actions">
              <button type="button" className="icon-button" title={t('viewFarmerHistory')} aria-label={`${t('viewFarmerHistory')}: ${farmer.name}`} onClick={() => onOpenHistory(farmer)}><History size={16} aria-hidden="true" /></button>
              <button type="button" className="icon-button" title={t('navIfishi')} aria-label={`${t('navIfishi')}: ${farmer.name}`} onClick={() => onOpenIfishi(farmer)}><BookOpen size={16} aria-hidden="true" /></button>
              <button type="button" className="icon-button" title={t('edit')} aria-label={`${t('edit')}: ${farmer.name}`} onClick={() => onEdit(farmer)}><Edit3 size={16} aria-hidden="true" /></button>
              {isCollector ? <button type="button" className="icon-button" title={language === 'en' ? 'Merge duplicate farmer' : 'Huza umworozi w’impimbano'} aria-label={`${language === 'en' ? 'Merge' : 'Huza'}: ${farmer.name}`} onClick={() => onMerge(farmer)}><GitMerge size={16} aria-hidden="true" /></button> : null}
              <button type="button" className="icon-button danger-text" title={t('delete')} aria-label={`${t('delete')}: ${farmer.name}`} onClick={() => onDelete(farmer)}><Trash2 size={16} aria-hidden="true" /></button>
            </div></td>
          </tr>)}</tbody></table></div>

          <div className="farmer-mobile-list">{farmerPage.data.map((farmer) => <article className="farmer-mobile-card" key={farmer.id}>
            <header><div className="farmer-card-identity"><input type="checkbox" className="farmer-row-checkbox" checked={selectedFarmerIds.has(farmer.id)} onChange={() => onToggleFarmer(farmer.id)} aria-label={language === 'en' ? `Select ${farmer.name}` : `Hitamo ${farmer.name}`} />{inlineNumberFarmerId === farmer.id ? <input type="number" min="1" step="1" className="table-input font-mono farmer-number-input" autoFocus disabled={inlineNumberSaving} value={inlineFarmerNumber} onChange={(event) => onChangeFarmerNumber(event.target.value)} onBlur={() => { if (cancelledNumberEditRef.current === farmer.id) { cancelledNumberEditRef.current = null; return; } onSaveFarmerNumber(farmer.id, farmer.farmerNumber); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelledNumberEditRef.current = farmer.id; onCancelFarmerNumberEdit(); } }} aria-label={t('farmerNumberShort')} /> : <button type="button" className="farmer-number-badge font-mono" onClick={() => onStartFarmerNumberEdit(farmer.id, farmer.farmerNumber)} aria-label={language === 'en' ? `Edit number for ${farmer.name}` : `Hindura nimero ya ${farmer.name}`}>{formatFarmerNumber(farmer.farmerNumber) || '—'}</button>}<b>{farmer.name}</b></div></header>
            <dl><div><dt>{t('columnLocation')}</dt><dd>{farmer.location || '—'}</dd></div><div><dt>{t('columnPhone')}</dt><dd>{farmer.phone || '—'}</dd></div><div><dt>{t('columnNationalId')}</dt><dd className="font-mono">{farmer.nationalId || '—'}</dd></div><div><dt>{t('columnCenter')}</dt><dd>{farmer.collectionCenter || '—'}</dd></div>{farmer.collectorUserId ? <div><dt>{t('assignedCollectors')}</dt><dd>{collectorName(farmer.collectorUserId)}</dd></div> : null}</dl>
            <footer>
              <button type="button" className="button button-secondary small-button" aria-label={`${t('viewFarmerHistory')}: ${farmer.name}`} onClick={() => onOpenHistory(farmer)}><History size={14} aria-hidden="true" />{t('viewFarmerHistory')}</button>
              <button type="button" className="button button-secondary small-button" aria-label={`${t('navIfishi')}: ${farmer.name}`} onClick={() => onOpenIfishi(farmer)}><BookOpen size={14} aria-hidden="true" />{t('navIfishi')}</button>
              <button type="button" className="button button-secondary small-button" aria-label={`${t('edit')}: ${farmer.name}`} onClick={() => onEdit(farmer)}><Edit3 size={14} aria-hidden="true" />{t('edit')}</button>
              {isCollector ? <button type="button" className="button button-secondary small-button" aria-label={`${language === 'en' ? 'Merge' : 'Huza'}: ${farmer.name}`} onClick={() => onMerge(farmer)}><GitMerge size={14} aria-hidden="true" />{language === 'en' ? 'Merge' : 'Huza'}</button> : null}
              <button type="button" className="button button-secondary small-button danger-text" aria-label={`${t('delete')}: ${farmer.name}`} onClick={() => onDelete(farmer)}><Trash2 size={14} aria-hidden="true" />{t('delete')}</button>
            </footer>
          </article>)}</div>
        </> : error ? <div className="farmers-empty-state" role="alert"><Users size={20} aria-hidden="true" /><div><b>{t('farmersLoadErrorTitle')}</b><p>{error}</p></div><button type="button" className="button button-secondary small-button" onClick={onRetry}>{t('tryAgain')}</button></div>
          : loading || !farmerPage ? <div className="farmers-empty-state" role="status"><span className="loading-indicator" /><span>{t('dashboardLoading')}</span></div>
            : <div className="farmers-empty-state" role="status"><Users size={20} aria-hidden="true" /><div><b>{t('farmersEmptyTitle')}</b><p>{t('farmersEmptyBody')}</p></div>{isFiltered ? <button type="button" className="button button-secondary small-button" onClick={onClearFilters}>{t('milkClearSearch')}</button> : <button type="button" className="button button-primary small-button" onClick={onCreate}><Plus size={15} aria-hidden="true" />{t('farmersAdd')}</button>}</div>}
        {farmerPage?.hasMore ? <div className="panel-footer"><button type="button" className="button button-secondary" onClick={onLoadMore} disabled={loading}>{loading ? t('wait') : t('milkLoadMore')} <ChevronDown size={16} aria-hidden="true" /></button></div> : null}
      </section>

      {createOpen ? <Modal ariaLabel={t('farmersAdd')} onClose={onCloseCreate} dismissible={!busy}>
        <div className="panel-heading"><div><span className="eyebrow">{t('newRecord')}</span><h2>{t('farmersAdd')}</h2></div><button type="button" className="icon-button" onClick={onCloseCreate} disabled={busy} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack compact farmer-form" onSubmit={onSubmitCreate}>
          {renderFarmerFields(createForm, onChangeCreateField)}
          {createError ? <p className="form-error" role="alert">{createError}</p> : null}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCloseCreate} disabled={busy}>{t('cancel')}</button><button className="button button-primary" disabled={busy || ((isCollector || isDairy) && !selectedCenter)}><Plus size={16} aria-hidden="true" />{busy ? t('wait') : t('farmersAdd')}</button></div>
        </form>
      </Modal> : null}

      {editingFarmer ? <Modal ariaLabel={`${t('edit')} ${editingFarmer.name}`} onClose={onCloseEdit} dismissible={!busy}>
        <div className="panel-heading"><h2>{t('edit')} {editingFarmer.name}</h2><button type="button" className="icon-button" onClick={onCloseEdit} disabled={busy} aria-label={t('cancel')}><X size={18} aria-hidden="true" /></button></div>
        <form className="form-stack farmer-form" onSubmit={onSubmitEdit}>
          <label>{language === 'en' ? 'Farmer Number (#)' : "Nimero y'Umworozi (#)"}<input type="number" min="1" step="1" required value={editForm.farmerNumber} onChange={(event) => onChangeEditField('farmerNumber', event.target.value)} /></label>
          {renderFarmerFields(editForm, onChangeEditField)}
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCloseEdit}>{t('cancel')}</button><button className="button button-primary" disabled={busy}>{t('saveChanges')}</button></div>
        </form>
      </Modal> : null}
    </div>
  );
}