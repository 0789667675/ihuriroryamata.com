'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, FileSpreadsheet, FileText, Image as ImageIcon, Upload, X } from 'lucide-react';
import { ImportFrame, ImportNotice, ImportPager, ImportProgress, ImportStatus, ImportSteps } from '@/components/imports/import-ui';
import { getImportCopy, type ImportCopyKey } from '@/lib/i18n/import-copy';
import type { PublicLanguage } from '@/lib/i18n/public-copy';
import {
  IMPORT_MAX_FILE_BYTES,
  isCsvFile,
  isImageFile,
  isPdfFile,
  isSpreadsheetFile,
  prepareImageForOcr,
  readTextFile,
} from '@/lib/imports/client-files';
import { loadImportFarmers, postJson, type ImportFarmer } from '@/lib/imports/client-api';
import { buildFarmerIndex, farmerLabel, findImportDuplicates, matchFarmer } from '@/lib/imports/farmer-matching';
import {
  detectHeader,
  groupWordsIntoLines,
  linesToRows,
  mapHeaderRow,
  mapRows,
  parseTextRows,
  positionalMapping,
} from '@/lib/imports/text-parsing';

type CenterOption = { id: number | string; name: string; owner_user_id?: number };
type Account = { id: number; accountType: string };

type BaseRow = {
  uid: number;
  rowNumber: number;
  name: string;
  phone: string;
  nationalId: string;
  accountNumber: string;
  cowType: string;
  centerId: string;
  centerText: string;
  include: boolean;
};

type MatchResult = {
  status: 'exact' | 'ambiguous' | 'possible' | 'none' | 'invalid';
  farmerId: number | null;
  farmer: ImportFarmer | null;
  candidates: ImportFarmer[];
  matchedField?: string;
  reason?: string;
};

type AssessedRow = BaseRow & {
  status: 'ready' | 'possible' | 'duplicate' | 'invalid' | 'excluded';
  match: MatchResult;
  duplicateOf: number | null;
  duplicateField: string | null;
  nameDuplicateOf: number | null;
  blocking: boolean;
  lockedDuplicate: boolean;
  detail: string;
};

type ServerRowResult = {
  rowNumber: number;
  status: string;
  farmerId?: number;
  errorCode?: string;
  message?: string;
};

type Mapping = Record<string, number | ''>;
type Step = 0 | 1 | 2 | 3;

const FIELD_KEYS = ['name', 'phone', 'nationalId', 'accountNumber', 'collectionCenter', 'cowType'] as const;
const FIELD_COPY: Record<(typeof FIELD_KEYS)[number], ImportCopyKey> = {
  name: 'name',
  phone: 'phone',
  nationalId: 'nationalId',
  accountNumber: 'accountNumber',
  collectionCenter: 'center',
  cowType: 'cowType',
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const fileErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code?: string }).code || '');
  return '';
};

const centerIdOf = (center: CenterOption) => String(center.id);

export function FarmerBulkImportModal({
  onClose,
  onCompleted,
  centers,
  selectedCenterId,
  user,
  language,
}: {
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
  centers: CenterOption[];
  selectedCenterId: string;
  user: Account;
  language: PublicLanguage;
}) {
  const t = useCallback((key: ImportCopyKey, params?: Record<string, string | number>) => getImportCopy(language, key, params), [language]);
  const availableCenters = useMemo(() => centers.filter((center) => user.accountType !== 'COLLECTOR' || Number(center.owner_user_id) === Number(user.id)), [centers, user]);
  const defaultFromWorkspace = availableCenters.some((center) => centerIdOf(center) === selectedCenterId)
    ? selectedCenterId
    : centerIdOf(availableCenters[0] || { id: '' });

  const [step, setStep] = useState<Step>(0);
  const [sourceMode, setSourceMode] = useState<'paste' | 'file'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaultCenterId, setDefaultCenterId] = useState(defaultFromWorkspace);
  const [rows, setRows] = useState<BaseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [ocrConfigured, setOcrConfigured] = useState<boolean | null>(null);
  const [ocrSetup, setOcrSetup] = useState<string[]>([]);
  const [existingFarmers, setExistingFarmers] = useState<ImportFarmer[]>([]);
  const [farmersLoading, setFarmersLoading] = useState(true);
  const [farmersError, setFarmersError] = useState('');
  const [farmersTruncated, setFarmersTruncated] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [saveRunning, setSaveRunning] = useState(false);
  const [savedProcessed, setSavedProcessed] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [serverResults, setServerResults] = useState<ServerRowResult[]>([]);
  const [completedSummary, setCompletedSummary] = useState<{ created: number; failed: number; skipped: number } | null>(null);

  const uidRef = useRef(0);
  const batchKeyRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef('');
  const saveLockRef = useRef(false);

  const farmerIndex = useMemo(() => buildFarmerIndex(existingFarmers), [existingFarmers]);

  const replacePreview = (url: string) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreviewUrl(url);
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setFarmersLoading(true);
    loadImportFarmers({ signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setExistingFarmers(result.farmers);
        setFarmersTruncated(result.truncated);
        setFarmersError('');
      })
      .catch((loadError) => {
        if (!active || isAbort(loadError)) return;
        setFarmersError(loadError instanceof Error ? loadError.message : t('loadError'));
      })
      .finally(() => { if (active) setFarmersLoading(false); });
    fetch('/api/imports/ocr', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (!active || !data) return;
        setOcrConfigured(Boolean(data.configured));
        setOcrSetup(Array.isArray(data.setup) ? data.setup : []);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [t]);

  const reset = () => {
    abortRef.current?.abort();
    setStep(0);
    setSourceMode('paste');
    setPasteText('');
    setSelectedFile(null);
    replacePreview('');
    setTableRows([]);
    setHasHeader(false);
    setMapping({});
    setRows([]);
    setError('');
    setWarning('');
    setIssuesOnly(false);
    setPage(0);
    setConfirmed(false);
    setSaveError('');
    setSaveAttempted(false);
    setServerResults([]);
    setCompletedSummary(null);
    setSavedProcessed(0);
    setSaveTotal(0);
    batchKeyRef.current = '';
  };

  const prepareTable = (incoming: string[][]) => {
    const clean = incoming
      .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
      .filter((row) => row.some(Boolean));
    if (!clean.length) {
      setError(t('errorNoRows'));
      return;
    }
    if (clean.length > 1000) {
      setError(`${t('errorNoRows')} ${t('rowLimitNotice')}`);
      return;
    }
    const width = clean.reduce((max, row) => Math.max(max, row.length), 0);
    const detected = detectHeader(clean);
    setTableRows(clean);
    setHasHeader(detected.hasHeader);
    setMapping(detected.hasHeader ? detected.mapping : positionalMapping(width));
    setStep(1);
    setPage(0);
    setError('');
  };

  const handlePaste = () => {
    setError('');
    setWarning('');
    const parsed = parseTextRows(pasteText);
    if (!parsed.length) {
      setError(t('errorNoRows'));
      return;
    }
    prepareTable(parsed);
  };

  const handleFileRead = async () => {
    if (!selectedFile) {
      setError(t('noFile'));
      return;
    }
    setError('');
    setWarning('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      if (isImageFile(selectedFile)) {
        if (ocrConfigured === false) {
          setError(t('ocrDisabled'));
          return;
        }
        setBusyLabel(t('scanning'));
        const prepared = await prepareImageForOcr(selectedFile);
        replacePreview(prepared.previewUrl);
        const result = await postJson<{ text: string; words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }> }>(
          '/api/imports/ocr',
          { imageBase64: prepared.base64, mimeType: prepared.mimeType },
          controller.signal
        );
        if (!result.words?.length && !result.text) throw new Error(t('errorOcr'));
        const lines = result.words?.length ? groupWordsIntoLines(result.words) : [];
        const table = lines.length ? linesToRows(lines) : parseTextRows(result.text);
        prepareTable(table);
        if (!table.length) setError(t('errorNoRows'));
      } else if (isCsvFile(selectedFile)) {
        if (selectedFile.size > IMPORT_MAX_FILE_BYTES) throw new Error(t('fileTooLarge'));
        setBusyLabel(t('readingFile'));
        const text = await readTextFile(selectedFile);
        prepareTable(parseTextRows(text));
      } else if (isSpreadsheetFile(selectedFile) || isPdfFile(selectedFile)) {
        if (selectedFile.size > IMPORT_MAX_FILE_BYTES) throw new Error(t('fileTooLarge'));
        setBusyLabel(t('readingFile'));
        const form = new FormData();
        form.append('file', selectedFile);
        const response = await fetch('/api/imports/extract', {
          method: 'POST',
          credentials: 'include',
          body: form,
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = String(payload.code || '');
          if (code === 'PDF_NO_TEXT') throw new Error(t('pdfNoText'));
          throw Object.assign(new Error(payload.message || t('errorFile')), { code });
        }
        const notices = [];
        if (payload.kind === 'table') {
          if (Number(payload.sheetCount) > 1) notices.push(t('sheetNotice'));
          if (payload.truncated) notices.push(t('rowLimitNotice'));
          prepareTable(payload.rows || []);
        } else {
          if (payload.truncated) notices.push(t('pdfPageNotice', { pages: 30 }));
          prepareTable(parseTextRows(payload.text || ''));
        }
        if (notices.length) setWarning(notices.join(' '));
      } else {
        throw new Error(t('unsupported'));
      }
    } catch (readError) {
      if (isAbort(readError)) return;
      const code = fileErrorCode(readError);
      if (code === 'OCR_NOT_CONFIGURED') {
        setOcrConfigured(false);
        const setup = readError && typeof readError === 'object' ? (readError as { setup?: string[] }).setup : [];
        setOcrSetup(Array.isArray(setup) ? setup : []);
        setError(t('ocrSetup'));
      } else {
        setError(readError instanceof Error ? readError.message : t('errorFile'));
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  };

  const setMappingField = (field: string, value: string) => {
    setMapping((current) => ({
      ...current,
      [field]: value === '' ? '' : Number(value),
    }));
  };

  const toggleHeader = (checked: boolean) => {
    setHasHeader(checked);
    const width = tableRows.reduce((max, row) => Math.max(max, row.length), 0);
    setMapping((checked ? mapHeaderRow(tableRows[0] || []) : positionalMapping(width)) as Mapping);
  };

  const buildRows = () => {
    if (mapping.name === undefined || mapping.name === '') {
      setError(`${t('name')}: ${t('mapHint')}`);
      return;
    }
    const mapped = mapRows(tableRows, mapping, hasHeader ? 1 : 0);
    if (!mapped.length) {
      setError(t('errorNoRows'));
      return;
    }
    const centerByName = new Map(availableCenters.map((center) => [center.name.trim().toLowerCase(), center]));
    const nextRows: BaseRow[] = mapped.map((record: Record<string, string>, index: number) => {
      const name = String(record.name || '').trim();
      const centerText = String(record.collectionCenter || '').trim();
      const matchedCenter = centerText ? centerByName.get(centerText.toLowerCase()) : null;
      const centerId = matchedCenter ? centerIdOf(matchedCenter) : (!centerText ? defaultCenterId : '');
      const match = matchFarmer({ name, nationalId: record.nationalId, accountNumber: record.accountNumber, phone: record.phone }, farmerIndex);
      const identifierDuplicate = Boolean(match.status === 'exact'
        && (match.matchedField === 'nationalId' || match.matchedField === 'accountNumber'))
        || (match.status === 'ambiguous' && match.reason === 'identifier-duplicate');
      const possibleExisting = match.status === 'exact' || match.status === 'possible' || match.status === 'ambiguous';
      return {
        uid: uidRef.current += 1,
        rowNumber: index + 1,
        name,
        phone: String(record.phone || '').trim(),
        nationalId: String(record.nationalId || '').trim(),
        accountNumber: String(record.accountNumber || '').trim(),
        cowType: String(record.cowType || '').trim(),
        centerId,
        centerText,
        include: Boolean(name) && !identifierDuplicate && !possibleExisting,
      };
    });
    setRows(nextRows);
    setServerResults([]);
    setConfirmed(false);
    setPage(0);
    setIssuesOnly(false);
    setError('');
    setStep(2);
    if (nextRows.some((row) => !row.centerId && row.name)) {
      setError(t('selectCenterOption'));
    }
  };

  const assessedRows = useMemo<AssessedRow[]>(() => {
    const duplicateFlags = findImportDuplicates(rows);
    return rows.map((row, index) => {
      const duplicate = duplicateFlags[index] || { duplicateOf: null, duplicateField: null, nameDuplicateOf: null };
      const match = matchFarmer({ name: row.name, nationalId: row.nationalId, accountNumber: row.accountNumber, phone: row.phone }, farmerIndex) as MatchResult;
      const identifierDuplicate = Boolean(match.status === 'exact'
        && (match.matchedField === 'nationalId' || match.matchedField === 'accountNumber'))
        || (match.status === 'ambiguous' && match.reason === 'identifier-duplicate');
      const blocking = Boolean(duplicate.duplicateOf) || identifierDuplicate;
      const possible = Boolean(duplicate.nameDuplicateOf)
        || match.status === 'possible'
        || match.status === 'exact'
        || match.status === 'ambiguous';
      let baseStatus: AssessedRow['status'] = 'ready';
      let detail = '';
      if (blocking) {
        baseStatus = 'duplicate';
        if (duplicate.duplicateOf) detail = `${t('duplicate')}: ${t('rowNumber')} ${duplicate.duplicateOf}`;
        else if (match.farmer) detail = `${t('existingMatch')}: ${farmerLabel(match.farmer)}`;
        else if (match.candidates.length) detail = `${t('existingMatch')}: ${farmerLabel(match.candidates[0])}`;
      } else if (!row.name.trim()) {
        baseStatus = 'invalid';
        detail = `${t('name')}: ${t('notPresent')}`;
      } else if (!row.centerId) {
        baseStatus = 'invalid';
        detail = row.centerText ? `${t('center')}: ${row.centerText}` : t('selectCenterOption');
      } else if (possible) {
        baseStatus = 'possible';
        if (duplicate.nameDuplicateOf) detail = `${t('nameInFile')} ${duplicate.nameDuplicateOf}`;
        else if (match.farmer) detail = `${t('possibleMatch')}: ${farmerLabel(match.farmer)}`;
        else if (match.candidates.length) detail = `${t('possibleMatch')}: ${farmerLabel(match.candidates[0])}`;
        else detail = t('possibleMatch');
      }
      if (!row.include && baseStatus !== 'duplicate') {
        return { ...row, ...duplicate, match, status: 'excluded', blocking, lockedDuplicate: identifierDuplicate, detail };
      }
      return { ...row, ...duplicate, match, status: baseStatus, blocking, lockedDuplicate: identifierDuplicate, detail };
    });
  }, [rows, farmerIndex, t]);

  const counts = useMemo(() => assessedRows.reduce((summary, row) => {
    summary.total += 1;
    if (row.status === 'ready') summary.ready += 1;
    else if (row.status === 'possible') summary.possible += 1;
    else if (row.status === 'duplicate') summary.duplicate += 1;
    else if (row.status === 'invalid') summary.invalid += 1;
    else summary.excluded += 1;
    return summary;
  }, { total: 0, ready: 0, possible: 0, duplicate: 0, invalid: 0, excluded: 0 }), [assessedRows]);

  const includedRows = useMemo(() => assessedRows.filter((row) => row.include && (row.status === 'ready' || row.status === 'possible')), [assessedRows]);
  const blockingIncluded = useMemo(() => assessedRows.filter((row) => row.include && (row.status === 'duplicate' || row.status === 'invalid')), [assessedRows]);
  const canSave = Boolean(confirmed
    && includedRows.length
    && !blockingIncluded.length
    && !saveRunning
    && !busy
    && !farmersLoading
    && !farmersError);

  const updateRow = (uid: number, changes: Partial<BaseRow>) => {
    if (saveAttempted) return;
    setConfirmed(false);
    setRows((current) => current.map((row) => row.uid === uid ? { ...row, ...changes } : row));
  };

  const filteredRows = useMemo(() => assessedRows.filter((row) => !issuesOnly || (row.status !== 'ready' && row.status !== 'excluded')), [assessedRows, issuesOnly]);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const statusLabel = (row: AssessedRow) => {
    if (row.status === 'ready') return t('ready');
    if (row.status === 'possible') return t('possible');
    if (row.status === 'duplicate') return t('duplicate');
    if (row.status === 'invalid') return t('invalid');
    return t('excluded');
  };

  const startSave = async () => {
    if (!canSave || saveLockRef.current) return;
    saveLockRef.current = true;
    setSaveError('');
    setSaveRunning(true);
    setSaveAttempted(true);
    setServerResults([]);
    setCompletedSummary(null);
    setSavedProcessed(0);
    setSaveTotal(includedRows.length);
    if (!batchKeyRef.current) batchKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    abortRef.current = controller;
    const chunkSize = 50;
    const collected: ServerRowResult[] = [];
    let created = 0;
    let failed = 0;
    try {
      for (let offset = 0; offset < includedRows.length; offset += chunkSize) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = includedRows.slice(offset, offset + chunkSize);
        const result = await postJson<{
          created?: number;
          failed?: number;
          rows?: ServerRowResult[];
          idempotent?: boolean;
        }>('/api/farmers/import', {
          batchKey: `${batchKeyRef.current}-${Math.floor(offset / chunkSize)}`,
          rows: chunk.map((row) => ({
            rowNumber: row.rowNumber,
            name: row.name,
            phone: row.phone,
            nationalId: row.nationalId,
            accountNumber: row.accountNumber,
            cowType: row.cowType,
            collectionCenterId: Number(row.centerId),
          })),
        }, controller.signal);
        const chunkResults = Array.isArray(result.rows) ? result.rows : [];
        collected.push(...chunkResults);
        setServerResults([...collected]);
        created += chunkResults.filter((row) => row.status === 'created').length;
        failed += chunkResults.filter((row) => row.status !== 'created').length;
        setSavedProcessed(Math.min(includedRows.length, offset + chunk.length));
      }
      setCompletedSummary({ created, failed, skipped: counts.excluded + counts.invalid + counts.duplicate });
      setStep(3);
      try {
        await onCompleted();
      } catch {
        // The rows were saved; a table refresh failure must not be reported as an import failure.
      }
    } catch (saveFailure) {
      if (isAbort(saveFailure)) {
        setSaveError(`${t('cancel')}. ${t('progress', { done: savedProcessed, total: includedRows.length })}`);
      } else {
        setSaveError(saveFailure instanceof Error ? saveFailure.message : t('errorGeneric'));
      }
    } finally {
      saveLockRef.current = false;
      setSaveRunning(false);
    }
  };

  const cancelSave = () => {
    abortRef.current?.abort();
  };

  const selectFile = (file: File | null) => {
    setSelectedFile(file);
    setError('');
    setWarning('');
    if (file?.type.startsWith('image/')) replacePreview(URL.createObjectURL(file));
    else replacePreview('');
  };

  const steps = [t('stepSource'), t('stepMap'), t('stepReview'), t('stepDone')];

  return <ImportFrame
    title={t('titleFarmers')}
    eyebrow={t('sourceTitle')}
    description={t('subtitleFarmers')}
    busy={saveRunning || busy}
    onClose={onClose}
    footer={step === 2 ? <div className="import-footer-actions">
      <div className="import-footer-left">
        {saveRunning ? <button type="button" className="button button-secondary" onClick={cancelSave}>{t('cancel')}</button> : null}
        <span className="muted-note">{t('confirmHint')}</span>
      </div>
      <div className="import-footer-right">
        <button type="button" className="button button-secondary" onClick={() => setStep(1)} disabled={saveRunning || saveAttempted}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={startSave} disabled={!canSave}>
          <Check size={16} aria-hidden="true" />{saveRunning ? t('importing') : t('importRows')}
        </button>
      </div>
    </div> : step === 3 ? <div className="import-footer-actions">
      <span className="muted-note">{t('doneBody')}</span>
      <div className="import-footer-right">
        <button type="button" className="button button-secondary" onClick={reset}>{t('startOver')}</button>
        <button type="button" className="button button-primary" onClick={onClose}>{t('close')}</button>
      </div>
    </div> : null}
  >
    <ImportSteps steps={steps} active={step} />
    {error ? <ImportNotice tone="error" role="alert">{error}<button type="button" className="text-button import-dismiss" onClick={() => setError('')}><X size={14} /></button></ImportNotice> : null}
    {warning ? <ImportNotice tone="warning">{warning}</ImportNotice> : null}
    {saveError ? <ImportNotice tone="error" role="alert">{saveError}</ImportNotice> : null}
    {farmersError ? <ImportNotice tone="warning" role="alert">{farmersError} <button type="button" className="text-button" onClick={() => { setFarmersLoading(true); setFarmersError(''); loadImportFarmers().then((result) => { setExistingFarmers(result.farmers); setFarmersTruncated(result.truncated); }).catch((loadError) => setFarmersError(loadError instanceof Error ? loadError.message : t('loadError'))).finally(() => setFarmersLoading(false)); }}>{t('retry')}</button></ImportNotice> : null}
    {farmersLoading ? <p className="muted-note" role="status">{t('loadingFarmers')}</p> : <p className="muted-note">{t('farmersLoaded', { count: existingFarmers.length })}{farmersTruncated ? ` ${t('showingFirstFarmers', { count: 1500 })}` : ''}</p>}

    {step === 0 ? <div className="import-source">
      <div className="import-source-tabs" role="tablist" aria-label={t('sourceTitle')}>
        <button type="button" role="tab" aria-selected={sourceMode === 'paste'} className={sourceMode === 'paste' ? 'active' : ''} onClick={() => setSourceMode('paste')}>{t('pasteTab')}</button>
        <button type="button" role="tab" aria-selected={sourceMode === 'file'} className={sourceMode === 'file' ? 'active' : ''} onClick={() => setSourceMode('file')}>{t('fileTab')}</button>
      </div>
      {sourceMode === 'paste' ? <section className="import-source-card">
        <label className="import-textarea-label">{t('pasteTab')}
          <textarea rows={10} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={language === 'rw' ? 'Izina, Telefone, Indangamuntu, Konti, Ikigo, Ubwoko bw inka' : 'Name, Phone, National ID, Account, Center, Cow type'} />
        </label>
        <p className="muted-note">{t('pasteHint')}</p>
        <div className="import-actions"><button type="button" className="button button-primary" onClick={handlePaste} disabled={busy || !pasteText.trim() || farmersLoading || Boolean(farmersError)}><FileText size={16} aria-hidden="true" />{t('readList')}</button></div>
      </section> : <section className="import-source-card">
        <div className="import-file-picker">
          <label className="import-file-button">
            <Upload size={18} aria-hidden="true" />
            <span>{selectedFile ? t('changeFile') : t('chooseFile')}</span>
            <input type="file" accept=".csv,.txt,.xlsx,.xls,.pdf,image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.currentTarget.value = '';
              selectFile(file);
            }} disabled={busy} />
          </label>
          <label className="button button-secondary import-camera-button">
            <Camera size={18} aria-hidden="true" />
            <span>{t('takePhoto')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.currentTarget.value = '';
              selectFile(file);
            }} disabled={busy} />
          </label>
          {selectedFile ? <div className="import-file-name">{isSpreadsheetFile(selectedFile) ? <FileSpreadsheet size={16} /> : isImageFile(selectedFile) ? <ImageIcon size={16} /> : <FileText size={16} />}<span>{selectedFile.name}</span><button type="button" className="text-button" onClick={() => { setSelectedFile(null); replacePreview(''); }} disabled={busy} aria-label={t('removeRow')}><X size={14} /></button></div> : null}
        </div>
        {previewUrl ? <div className="import-photo-preview"><img src={previewUrl} alt="" /></div> : null}
        <p className="muted-note">{isImageFile(selectedFile) ? t('photoHint') : t('fileHint')}</p>
        {isImageFile(selectedFile) && ocrConfigured === false ? <ImportNotice tone="warning">{t('ocrNotConfigured')} {t('ocrSetup')}{ocrSetup.length ? <code>{ocrSetup.join(' / ')}</code> : null}</ImportNotice> : null}
        <div className="import-actions">
          <button type="button" className="button button-primary" onClick={handleFileRead} disabled={busy || !selectedFile || (isImageFile(selectedFile) && ocrConfigured === false) || farmersLoading || Boolean(farmersError)}>
            {isImageFile(selectedFile) ? <ImageIcon size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            {busy ? busyLabel : isImageFile(selectedFile) ? t('scanPage') : t('readList')}
          </button>
          {busy ? <button type="button" className="button button-secondary" onClick={() => abortRef.current?.abort()}>{t('cancel')}</button> : null}
        </div>
      </section>}
      <ImportNotice tone="info">{t('farmersModeNote')}</ImportNotice>
    </div> : null}

    {step === 1 ? <div className="import-map">
      <div className="import-map-heading"><div><h3>{t('mapTitle')}</h3><p className="muted-note">{t('mapHint')}</p></div><label className="import-check"><input type="checkbox" checked={hasHeader} onChange={(event) => toggleHeader(event.target.checked)} />{t('firstRowHeader')}</label></div>
      <div className="import-map-grid">
        {FIELD_KEYS.map((field) => <label key={field}>{t(FIELD_COPY[field])}
          <select value={mapping[field] ?? ''} onChange={(event) => setMappingField(field, event.target.value)}>
            <option value="">{t('notPresent')}</option>
            {(tableRows[0] || []).map((cell, index) => <option key={index} value={index}>{hasHeader && cell ? `${cell} (${index + 1})` : `${language === 'rw' ? 'Inkingi' : 'Column'} ${index + 1}`}</option>)}
          </select>
        </label>)}
      </div>
      <div className="import-map-extra">
        <label>{t('defaultCenter')}<select value={defaultCenterId} onChange={(event) => setDefaultCenterId(event.target.value)}><option value="">{t('chooseCenter')}</option>{availableCenters.map((center) => <option key={center.id} value={centerIdOf(center)}>{center.name}</option>)}</select></label>
      </div>
      <div className="table-scroll import-preview-table"><table><thead><tr>{FIELD_KEYS.map((field) => <th key={field}>{t(FIELD_COPY[field])}</th>)}</tr></thead><tbody>
        {mapRows(tableRows, mapping, hasHeader ? 1 : 0).slice(0, 4).map((record: Record<string, string>, index: number) => <tr key={index}>{FIELD_KEYS.map((field) => <td key={field}>{record[field] || '—'}</td>)}</tr>)}
      </tbody></table></div>
      <div className="import-footer-actions import-inline-actions">
        <button type="button" className="button button-secondary" onClick={() => setStep(0)}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={buildRows} disabled={!tableRows.length || mapping.name === undefined || mapping.name === '' || farmersLoading || Boolean(farmersError)}>{t('continueReview')}</button>
      </div>
    </div> : null}

    {step === 2 ? <div className="import-review">
      {saveRunning ? <ImportProgress value={savedProcessed} max={saveTotal} label={t('progress', { done: savedProcessed, total: saveTotal })} /> : null}
      {saveAttempted && !saveRunning && saveError ? <ImportNotice tone="warning">{t('reviewHint')} {language === 'rw' ? 'Imirongo imwe yanditswe; ntubashe kuyihindura muri iyi session.' : 'Some rows may already be saved; editing is locked in this session. Close and start a new import to correct failed rows.'}</ImportNotice> : null}
      <div className="import-review-toolbar">
        <div className="import-counts">
          <span><b>{counts.total}</b> {t('allRows')}</span>
          <span className="ok"><b>{counts.ready + counts.possible}</b> {t('ready')}</span>
          {counts.possible ? <span className="warn"><b>{counts.possible}</b> {t('possible')}</span> : null}
          {counts.invalid ? <span className="danger"><b>{counts.invalid}</b> {t('invalid')}</span> : null}
          {counts.duplicate ? <span className="danger"><b>{counts.duplicate}</b> {t('duplicate')}</span> : null}
          {counts.excluded ? <span><b>{counts.excluded}</b> {t('excluded')}</span> : null}
        </div>
        <label className="import-check"><input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />{t('filterIssues')}</label>
      </div>
      <div className="table-scroll import-review-table"><table>
        <thead><tr><th>{t('include')}</th><th>{t('rowNumber')}</th><th>{t('name')}</th><th>{t('phone')}</th><th>{t('nationalId')}</th><th>{t('accountNumber')}</th><th>{t('center')}</th><th>{t('cowType')}</th><th>{t('status')}</th></tr></thead>
        <tbody>
          {visibleRows.map((row) => <tr key={row.uid} className={row.status === 'duplicate' || row.status === 'invalid' ? 'import-row-blocked' : row.status === 'possible' ? 'import-row-warning' : ''}>
            <td><input type="checkbox" aria-label={`${t('include')} ${row.rowNumber}`} checked={row.include} disabled={saveRunning || saveAttempted || (row.status === 'duplicate' && row.lockedDuplicate)} onChange={(event) => updateRow(row.uid, { include: event.target.checked })} /></td>
            <td>{row.rowNumber}</td>
            <td><input value={row.name} maxLength={255} disabled={saveRunning || saveAttempted} onChange={(event) => updateRow(row.uid, { name: event.target.value })} /></td>
            <td><input value={row.phone} maxLength={50} disabled={saveRunning || saveAttempted} onChange={(event) => updateRow(row.uid, { phone: event.target.value })} /></td>
            <td><input value={row.nationalId} maxLength={50} disabled={saveRunning || saveAttempted} onChange={(event) => updateRow(row.uid, { nationalId: event.target.value })} /></td>
            <td><input value={row.accountNumber} maxLength={255} disabled={saveRunning || saveAttempted} onChange={(event) => updateRow(row.uid, { accountNumber: event.target.value })} /></td>
            <td><select value={row.centerId} disabled={saveRunning || saveAttempted || !availableCenters.length} onChange={(event) => updateRow(row.uid, { centerId: event.target.value })}>
              <option value="">{t('selectCenterOption')}</option>
              {availableCenters.map((center) => <option key={center.id} value={centerIdOf(center)}>{center.name}</option>)}
            </select></td>
            <td><input value={row.cowType} maxLength={255} disabled={saveRunning || saveAttempted} onChange={(event) => updateRow(row.uid, { cowType: event.target.value })} /></td>
            <td className="import-status-cell"><ImportStatus status={row.status} label={statusLabel(row)} />{row.detail ? <small>{row.detail}</small> : null}{row.status === 'possible' ? <small>{t('include')} / {t('excluded')}: {t('possibleMatch')}</small> : null}</td>
          </tr>)}
        </tbody>
      </table></div>
      {!visibleRows.length ? <p className="muted-note">{t('errorNoRows')}</p> : null}
      <ImportPager page={safePage} pages={totalPages} onChange={setPage} previousLabel={t('previous')} nextLabel={t('next')} />
      <div className="import-confirm">
        <label className="import-check"><input type="checkbox" checked={confirmed} disabled={saveRunning || saveAttempted} onChange={(event) => setConfirmed(event.target.checked)} />{t('confirmReview')}</label>
        {blockingIncluded.length ? <ImportNotice tone="warning">{t('resolveDuplicate')} {blockingIncluded.length}</ImportNotice> : null}
        {counts.invalid ? <p className="muted-note">{t('reviewHint')}</p> : null}
      </div>
      {serverResults.length && !saveRunning && saveError ? <div className="import-results"><h4>{t('batchSummary')}</h4><ul>{serverResults.filter((result) => result.status !== 'created').map((result) => <li key={`${result.rowNumber}-${result.errorCode}`}>{t('rowNumber')} {result.rowNumber}: {result.message || result.errorCode}</li>)}</ul></div> : null}
    </div> : null}

    {step === 3 && completedSummary ? <div className="import-done">
      <div className="import-done-mark"><Check size={28} aria-hidden="true" /></div>
      <h3>{t('doneTitle')}</h3>
      <p>{t('doneBody')}</p>
      <div className="import-summary-cards">
        <div><b>{completedSummary.created}</b><span>{t('created')}</span></div>
        <div><b>{completedSummary.failed}</b><span>{t('failed')}</span></div>
        <div><b>{completedSummary.skipped}</b><span>{t('skipped')}</span></div>
      </div>
      {serverResults.some((row) => row.status !== 'created') ? <div className="import-results"><h4>{t('batchSummary')}</h4><ul>{serverResults.filter((row) => row.status !== 'created').map((row) => <li key={`${row.rowNumber}-${row.errorCode}`}>{t('rowNumber')} {row.rowNumber}: {row.message || row.errorCode}</li>)}</ul></div> : null}
    </div> : null}
  </ImportFrame>;
}
