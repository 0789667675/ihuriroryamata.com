'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Image as ImageIcon, Plus, X } from 'lucide-react';
import { ImportFrame, ImportNotice, ImportPager, ImportProgress, ImportStatus, ImportSteps } from '@/components/imports/import-ui';
import { getImportCopy, type ImportCopyKey } from '@/lib/i18n/import-copy';
import type { PublicLanguage } from '@/lib/i18n/public-copy';
import { prepareImageForOcr } from '@/lib/imports/client-files';
import { loadImportFarmers, loadRecordedFarmerIds, postJson, type ImportFarmer } from '@/lib/imports/client-api';
import { buildFarmerIndex, farmerLabel, matchFarmer } from '@/lib/imports/farmer-matching';
import { parseNotebookPage } from '@/lib/imports/notebook';
import { detectHeader, normalizeHeader, parseTextRows } from '@/lib/imports/text-parsing';
import { getAccountingDate } from '@/lib/utils/accounting-period.js';

type MilkDraft = {
  uid: number;
  rowNumber: number;
  nameText: string;
  rawText: string;
  quantityRaw: string;
  ocrStatus: string;
  confidence: number | null;
  dateColumnFound: boolean;
  morning: string;
  evening: string;
  farmerId: string;
  candidates: number[];
  matchStatus: string;
  matchReason: string;
  include: boolean;
  verified: boolean;
};

type AssessedMilkRow = MilkDraft & {
  status: 'ready' | 'unmatched' | 'uncertain' | 'unreadable' | 'duplicate' | 'invalid' | 'excluded';
  detail: string;
  morningValue: number;
  eveningValue: number;
  total: number;
  duplicateInPage: boolean;
  existingMilk: boolean;
  blocking: boolean;
};

type ServerMilkRow = {
  rowNumber: number;
  farmerId: number | null;
  status: string;
  errorCode?: string;
  message?: string;
  recordId?: number;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const todayIso = () => getAccountingDate();

const parseVolume = (value: string) => {
  const text = String(value ?? '').replace(',', '.').trim();
  if (!text) return { value: 0, present: false, invalid: false };
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(text)) return { value: 0, present: true, invalid: true };
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) return { value: 0, present: true, invalid: true };
  return { value: parsed, present: true, invalid: false };
};

const milkHeaderIndex = (header: string[], aliases: string[]) => header.findIndex((cell) => {
  const normalized = normalizeHeader(cell);
  return aliases.includes(normalized);
});

const parseMilkPaste = (rows: string[][], session: 'morning' | 'evening') => {
  if (!rows.length) return { rows: [] as Array<{ name: string; morning: string; evening: string; raw: string; quantityRaw: string; invalidQuantity: boolean }>, warning: '' };
  const detected = detectHeader(rows);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const header = rows[0] || [];
  const mapping = detected.mapping as Record<string, number | undefined>;
  const nameIndex = mapping.name ?? 0;
  const morningIndex = milkHeaderIndex(header, ['morning', 'ijoro', 'amata y ijoro', 'morning milk', 'morning qty']);
  const eveningIndex = milkHeaderIndex(header, ['evening', 'nimugoroba', 'umugoroba', 'amata y nimugoroba', 'evening milk', 'evening qty']);
  const quantityIndex = milkHeaderIndex(header, ['quantity', 'ingano', 'total', 'amata', 'liters', 'litres', 'volume', 'umubare', 'umubare w amata']);
  const hasMilkHeader = morningIndex >= 0 || eveningIndex >= 0 || quantityIndex >= 0;
  const hasHeader = detected.hasHeader || hasMilkHeader;
  let resolvedMorning = morningIndex;
  let resolvedEvening = eveningIndex;
  let resolvedQuantity = quantityIndex;
  if (!hasHeader && width === 3) {
    resolvedMorning = 1;
    resolvedEvening = 2;
  } else if (!hasHeader) {
    resolvedQuantity = width > 1 ? 1 : -1;
  }
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const parsed = dataRows.map((row) => {
    const name = String(row[nameIndex] ?? '').trim();
    const morningRaw = resolvedMorning >= 0 ? String(row[resolvedMorning] ?? '') : '';
    const eveningRaw = resolvedEvening >= 0 ? String(row[resolvedEvening] ?? '') : '';
    const quantityRaw = resolvedQuantity >= 0 ? String(row[resolvedQuantity] ?? '') : '';
    const morningParsed = parseVolume(morningRaw);
    const eveningParsed = parseVolume(eveningRaw);
    const quantityParsed = parseVolume(quantityRaw);
    const hasSplit = resolvedMorning >= 0 || resolvedEvening >= 0;
    let morning = hasSplit ? (morningParsed.invalid ? '' : String(morningParsed.value || '')) : '';
    let evening = hasSplit ? (eveningParsed.invalid ? '' : String(eveningParsed.value || '')) : '';
    if (!hasSplit && quantityParsed.present) {
      if (session === 'morning') morning = String(quantityParsed.value || '');
      else evening = String(quantityParsed.value || '');
    }
    return {
      name,
      morning,
      evening,
      raw: row.join(' · '),
      quantityRaw: hasSplit ? `${morningRaw || '0'} / ${eveningRaw || '0'}` : quantityRaw,
      invalidQuantity: morningParsed.invalid || eveningParsed.invalid || (!hasSplit && quantityParsed.invalid),
    };
  }).filter((row) => row.name || row.morning || row.evening);
  const warning = !hasHeader
    ? (width === 3 ? 'noHeaderSplit' : 'noHeaderQuantity')
    : '';
  return { rows: parsed, warning };
};

export function MilkNotebookImportModal({
  onClose,
  onCompleted,
  collectionDate,
  language,
}: {
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
  collectionDate: string;
  language: PublicLanguage;
}) {
  const t = useCallback((key: ImportCopyKey, params?: Record<string, string | number>) => getImportCopy(language, key, params), [language]);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [sourceMode, setSourceMode] = useState<'photo' | 'paste'>('photo');
  const [date, setDate] = useState(collectionDate || todayIso());
  const [session, setSession] = useState<'morning' | 'evening'>('morning');
  const [pasteText, setPasteText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
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
  const [rows, setRows] = useState<MilkDraft[]>([]);
  const [recordedFarmerIds, setRecordedFarmerIds] = useState<Set<number>>(new Set());
  const [existingError, setExistingError] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedFarmerRow, setExpandedFarmerRow] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saveRunning, setSaveRunning] = useState(false);
  const [savedProcessed, setSavedProcessed] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [serverResults, setServerResults] = useState<ServerMilkRow[]>([]);
  const [completedSummary, setCompletedSummary] = useState<{ created: number; failed: number; duplicates: number } | null>(null);

  const uidRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef('');
  const saveLockRef = useRef(false);

  const farmerIndex = useMemo(() => buildFarmerIndex(existingFarmers), [existingFarmers]);
  const farmerById = useMemo(() => new Map(existingFarmers.map((farmer) => [Number(farmer.id), farmer])), [existingFarmers]);

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
      .then(async (response) => response.ok ? response.json() : null)
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
    setSourceMode('photo');
    setDate(collectionDate || todayIso());
    setSession('morning');
    setPasteText('');
    setSelectedFile(null);
    replacePreview('');
    setError('');
    setWarning('');
    setRows([]);
    setRecordedFarmerIds(new Set());
    setExistingError('');
    setIssuesOnly(false);
    setPage(0);
    setExpandedFarmerRow(null);
    setConfirmed(false);
    setSaveError('');
    setServerResults([]);
    setCompletedSummary(null);
    setSavedProcessed(0);
    setSaveTotal(0);
  };

  const matchDraft = (name: string, base: {
    rowNumber: number;
    rawText: string;
    quantityRaw: string;
    ocrStatus: string;
    confidence: number | null;
    dateColumnFound: boolean;
    morning: string;
    evening: string;
    include: boolean;
    verified: boolean;
  }): MilkDraft => {
    const match = matchFarmer({ name }, farmerIndex);
    const exact = match.status === 'exact' && match.farmerId;
    return {
      uid: uidRef.current += 1,
      ...base,
      nameText: name,
      farmerId: exact ? String(match.farmerId) : '',
      candidates: (match.candidates || []).map((farmer: { id: number | string }) => Number(farmer.id)).filter(Boolean),
      matchStatus: match.status,
      matchReason: match.reason || '',
      verified: base.verified && Boolean(exact),
      include: base.include,
    };
  };

  const openReview = async (drafts: MilkDraft[], dateValue: string) => {
    setBusy(true);
    setBusyLabel(t('checkingExisting'));
    setExistingError('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let recorded = new Set<number>();
    try {
      recorded = await loadRecordedFarmerIds(dateValue, controller.signal);
    } catch (loadError) {
      if (!isAbort(loadError)) setExistingError(loadError instanceof Error ? loadError.message : t('existingMilk'));
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
    setRecordedFarmerIds(recorded);
    setRows(drafts.map((draft) => ({
      ...draft,
      include: draft.include && (!draft.farmerId || !recorded.has(Number(draft.farmerId))),
    })));
    setStep(1);
    setPage(0);
    setIssuesOnly(false);
    setConfirmed(false);
    setServerResults([]);
    setCompletedSummary(null);
  };

  const scanNotebook = async () => {
    if (!date) {
      setError(t('noDate'));
      return;
    }
    if (!selectedFile) {
      setError(t('noFile'));
      return;
    }
    if (ocrConfigured !== true) {
      setError(t('ocrDisabled'));
      return;
    }
    setError('');
    setWarning('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setBusyLabel(t('scanning'));
    try {
      const prepared = await prepareImageForOcr(selectedFile);
      replacePreview(prepared.previewUrl);
      const result = await postJson<{
        text: string;
        words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }>;
      }>('/api/imports/ocr', { imageBase64: prepared.base64, mimeType: prepared.mimeType }, controller.signal);
      if (!result.words?.length) throw new Error(t('errorOcr'));
      const parsed = parseNotebookPage({ words: result.words, targetDate: date });
      if (!parsed.entries?.length) throw new Error(t('noMilkRows'));
      const mode = session;
      const drafts = parsed.entries.map((entry: {
        rowNumber: number;
        rawText: string;
        name: string;
        quantity: number | null;
        quantityRaw: string;
        status: string;
        confidence: number | null;
        dateColumnFound: boolean;
      }) => {
        const quantity = entry.quantity;
        const amount = quantity !== null && Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? String(quantity) : '';
        const hasQuantity = Boolean(amount) && entry.status !== 'ambiguous' && entry.status !== 'unreadable';
        return matchDraft(entry.name, {
          rowNumber: entry.rowNumber,
          rawText: entry.rawText,
          quantityRaw: entry.quantityRaw,
          ocrStatus: entry.status,
          confidence: entry.confidence,
          dateColumnFound: entry.dateColumnFound,
          morning: mode === 'morning' ? amount : '',
          evening: mode === 'evening' ? amount : '',
          include: hasQuantity,
          verified: entry.status === 'ok' && hasQuantity,
        });
      });
      if (!parsed.dateColumnFound) setWarning(t('dateColumnWarning'));
      await openReview(drafts, date);
    } catch (scanError) {
      if (isAbort(scanError)) return;
      const code = scanError && typeof scanError === 'object' && 'code' in scanError ? String((scanError as { code?: string }).code || '') : '';
      if (code === 'OCR_NOT_CONFIGURED') {
        setOcrConfigured(false);
        const setup = scanError && typeof scanError === 'object' ? (scanError as { setup?: string[] }).setup : [];
        setOcrSetup(Array.isArray(setup) ? setup : []);
        setError(t('ocrSetup'));
      } else {
        setError(scanError instanceof Error ? scanError.message : t('errorOcr'));
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  };

  const parsePaste = async () => {
    if (!date) {
      setError(t('noDate'));
      return;
    }
    setError('');
    setWarning('');
    const parsedTable = parseTextRows(pasteText);
    if (!parsedTable.length) {
      setError(t('errorNoRows'));
      return;
    }
    const parsed = parseMilkPaste(parsedTable, session);
    if (!parsed.rows.length) {
      setError(t('noMilkRows'));
      return;
    }
    if (parsed.warning === 'noHeaderSplit') setWarning(t('noHeaderSplit'));
    else if (parsed.warning === 'noHeaderQuantity') setWarning(t('noHeaderQuantity'));
    const drafts = parsed.rows.map((row, index) => {
      const morning = parseVolume(row.morning);
      const evening = parseVolume(row.evening);
      const total = morning.value + evening.value;
      return matchDraft(row.name, {
        rowNumber: index + 1,
        rawText: row.raw,
        quantityRaw: row.quantityRaw,
        ocrStatus: row.invalidQuantity ? 'unreadable' : total > 0 ? 'ok' : 'unreadable',
        confidence: null,
        dateColumnFound: true,
        morning: row.morning,
        evening: row.evening,
        include: total > 0 && !row.invalidQuantity,
        verified: total > 0 && !row.invalidQuantity,
      });
    });
    await openReview(drafts, date);
  };

  const updateRow = (uid: number, changes: Partial<MilkDraft>) => {
    if (saveRunning) return;
    setConfirmed(false);
    setRows((current) => current.map((row) => row.uid === uid ? { ...row, ...changes } : row));
  };

  const chooseFarmer = (row: MilkDraft, value: string) => {
    if (value === '__all__') {
      setExpandedFarmerRow(row.uid);
      return;
    }
    setExpandedFarmerRow(null);
    updateRow(row.uid, {
      farmerId: value,
      verified: false,
      include: value ? true : row.include,
      matchStatus: value ? 'manual' : 'none',
    });
  };

  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.include || !row.farmerId) continue;
      counts.set(row.farmerId, (counts.get(row.farmerId) || 0) + 1);
    }
    return counts;
  }, [rows]);

  const assessedRows = useMemo<AssessedMilkRow[]>(() => rows.map((row) => {
    const morning = parseVolume(row.morning);
    const evening = parseVolume(row.evening);
    const total = morning.value + evening.value;
    const existingMilk = Boolean(row.farmerId) && recordedFarmerIds.has(Number(row.farmerId));
    const duplicateInPage = Boolean(row.farmerId) && (duplicateCounts.get(row.farmerId) || 0) > 1;
    const invalidVolume = morning.invalid || evening.invalid;
    let status: AssessedMilkRow['status'] = 'ready';
    let detail = '';
    if (!row.include) status = 'excluded';
    else if (!row.farmerId) {
      status = 'unmatched';
      detail = row.candidates.length ? row.candidates.slice(0, 3).map((id) => farmerById.get(id)?.name).filter(Boolean).join(' / ') : t('selectFarmerForRow');
    } else if (duplicateInPage) {
      status = 'duplicate';
      detail = t('duplicateInPage');
    } else if (existingMilk) {
      status = 'duplicate';
      detail = t('existingRecord');
    } else if (!total || invalidVolume) {
      status = 'unreadable';
      detail = t('milkNoQty');
    } else if (!row.verified) {
      status = 'uncertain';
      detail = t('confirmRow');
    }
    const farmer = row.farmerId ? farmerById.get(Number(row.farmerId)) : null;
    if (farmer && !detail) detail = farmerLabel(farmer);
    return {
      ...row,
      status,
      detail,
      morningValue: morning.value,
      eveningValue: evening.value,
      total,
      duplicateInPage,
      existingMilk,
      blocking: row.include && (status === 'unmatched' || status === 'uncertain' || status === 'unreadable' || status === 'duplicate'),
    };
  }), [rows, recordedFarmerIds, duplicateCounts, farmerById, t]);

  const includedRows = assessedRows.filter((row) => row.include);
  const blockingRows = includedRows.filter((row) => row.blocking);
  const canSave = confirmed && includedRows.length > 0 && blockingRows.length === 0 && !saveRunning && !busy;
  const counts = assessedRows.reduce((summary, row) => {
    summary.total += 1;
    if (row.status === 'ready') summary.ready += 1;
    else if (row.status === 'duplicate') summary.duplicate += 1;
    else if (row.status === 'unmatched') summary.unmatched += 1;
    else if (row.status === 'uncertain') summary.uncertain += 1;
    else if (row.status === 'unreadable') summary.unreadable += 1;
    else summary.excluded += 1;
    return summary;
  }, { total: 0, ready: 0, duplicate: 0, unmatched: 0, uncertain: 0, unreadable: 0, excluded: 0 });

  const filteredRows = assessedRows.filter((row) => !issuesOnly || row.status !== 'ready' && row.status !== 'excluded');
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const statusLabel = (row: AssessedMilkRow) => {
    if (row.status === 'ready') return t('ready');
    if (row.status === 'duplicate') return t('duplicate');
    if (row.status === 'unmatched') return t('unmatched');
    if (row.status === 'uncertain') return t('uncertain');
    if (row.status === 'unreadable') return t('unreadable');
    return t('excluded');
  };

  const farmerOptions = (row: AssessedMilkRow) => {
    const ids = new Set<number>();
    for (const id of row.candidates) ids.add(id);
    if (row.farmerId) ids.add(Number(row.farmerId));
    if (expandedFarmerRow === row.uid) {
      for (const farmer of existingFarmers) ids.add(Number(farmer.id));
    }
    return Array.from(ids).map((id) => farmerById.get(id)).filter(Boolean) as ImportFarmer[];
  };

  const startSave = async () => {
    if (!canSave || saveLockRef.current) return;
    saveLockRef.current = true;
    setSaveError('');
    setSaveRunning(true);
    setServerResults([]);
    setCompletedSummary(null);
    setSavedProcessed(0);
    setSaveTotal(includedRows.length);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const collected: ServerMilkRow[] = [];
    let created = 0;
    let failed = 0;
    let duplicates = 0;
    try {
      for (let offset = 0; offset < includedRows.length; offset += 50) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = includedRows.slice(offset, offset + 50);
        const result = await postJson<{
          summary?: { created?: number; failed?: number; duplicates?: number };
          rows?: ServerMilkRow[];
        }>('/api/milk/import', {
          date,
          rows: chunk.map((row) => ({
            rowNumber: row.rowNumber,
            farmerId: Number(row.farmerId),
            volumeMorning: row.morningValue,
            volumeEvening: row.eveningValue,
          })),
        }, controller.signal);
        const chunkRows = Array.isArray(result.rows) ? result.rows : [];
        collected.push(...chunkRows);
        setServerResults([...collected]);
        created += chunkRows.filter((row) => row.status === 'created').length;
        duplicates += chunkRows.filter((row) => row.status === 'duplicate' || row.status === 'conflict').length;
        failed += chunkRows.filter((row) => row.status === 'failed').length;
        setSavedProcessed(Math.min(includedRows.length, offset + chunk.length));
      }
      setCompletedSummary({ created, failed, duplicates });
      setStep(2);
      try {
        await onCompleted();
      } catch {
        // The milk rows were saved; a table refresh failure must not be reported as a save failure.
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

  const addManualRow = () => {
    setConfirmed(false);
    setRows((current) => [...current, {
      uid: uidRef.current += 1,
      rowNumber: current.length + 1,
      nameText: '',
      rawText: '',
      quantityRaw: '',
      ocrStatus: 'manual',
      confidence: null,
      dateColumnFound: true,
      morning: '',
      evening: '',
      farmerId: '',
      candidates: [],
      matchStatus: 'manual',
      matchReason: 'manual',
      include: true,
      verified: false,
    }]);
    setPage(0);
  };

  const selectPhoto = (file: File | null) => {
    setSelectedFile(file);
    setError('');
    setWarning('');
    replacePreview(file ? URL.createObjectURL(file) : '');
  };

  const steps = [t('stepSource'), t('stepReview'), t('stepDone')];

  return <ImportFrame
    title={t('titleMilk')}
    eyebrow={t('titleMilk')}
    description={t('subtitleMilk')}
    busy={saveRunning || busy}
    onClose={onClose}
    footer={step === 1 ? <div className="import-footer-actions">
      <div className="import-footer-left">
        {saveRunning ? <button type="button" className="button button-secondary" onClick={() => abortRef.current?.abort()}>{t('cancel')}</button> : null}
        <span className="muted-note">{t('confirmHint')}</span>
      </div>
      <div className="import-footer-right">
        <button type="button" className="button button-secondary" onClick={() => setStep(0)} disabled={saveRunning}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={startSave} disabled={!canSave}>
          <Check size={16} aria-hidden="true" />{saveRunning ? t('importing') : t('importRows')}
        </button>
      </div>
    </div> : step === 2 ? <div className="import-footer-actions">
      <span className="muted-note">{t('doneBody')}</span>
      <div className="import-footer-right">
        {completedSummary && completedSummary.failed + completedSummary.duplicates > 0 ? <button type="button" className="button button-secondary" onClick={() => setStep(1)}>{t('stepReview')}</button> : null}
        <button type="button" className="button button-secondary" onClick={reset}>{t('startOver')}</button>
        <button type="button" className="button button-primary" onClick={onClose}>{t('close')}</button>
      </div>
    </div> : null}
  >
    <ImportSteps steps={steps} active={step} />
    {error ? <ImportNotice tone="error" role="alert">{error}<button type="button" className="text-button import-dismiss" onClick={() => setError('')}><X size={14} /></button></ImportNotice> : null}
    {warning ? <ImportNotice tone="warning">{warning}</ImportNotice> : null}
    {saveError ? <ImportNotice tone="error" role="alert">{saveError}</ImportNotice> : null}
    {existingError ? <ImportNotice tone="warning">{t('existingMilk')}: {existingError}. {t('errorGeneric')}</ImportNotice> : null}
    {farmersError ? <ImportNotice tone="warning" role="alert">{farmersError} <button type="button" className="text-button" onClick={() => { setFarmersLoading(true); setFarmersError(''); loadImportFarmers().then((result) => { setExistingFarmers(result.farmers); setFarmersTruncated(result.truncated); }).catch((loadError) => setFarmersError(loadError instanceof Error ? loadError.message : t('loadError'))).finally(() => setFarmersLoading(false)); }}>{t('retry')}</button></ImportNotice> : null}
    {farmersLoading ? <p className="muted-note" role="status">{t('loadingFarmers')}</p> : <p className="muted-note">{t('farmersLoaded', { count: existingFarmers.length })}{farmersTruncated ? ` ${t('showingFirstFarmers', { count: 1500 })}` : ''}</p>}

    {step === 0 ? <div className="import-source">
      <div className="import-milk-meta">
        <label>{t('targetDate')}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label>{t('session')}<select value={session} onChange={(event) => setSession(event.target.value as 'morning' | 'evening')}><option value="morning">{t('morning')}</option><option value="evening">{t('evening')}</option></select></label>
      </div>
      <div className="import-source-tabs" role="tablist" aria-label={t('sourceTitle')}>
        <button type="button" role="tab" aria-selected={sourceMode === 'photo'} className={sourceMode === 'photo' ? 'active' : ''} onClick={() => setSourceMode('photo')}><ImageIcon size={16} />{t('photoTab')}</button>
        <button type="button" role="tab" aria-selected={sourceMode === 'paste'} className={sourceMode === 'paste' ? 'active' : ''} onClick={() => setSourceMode('paste')}>{t('pasteTab')}</button>
      </div>
      {sourceMode === 'photo' ? <section className="import-source-card">
        <div className="import-file-picker">
          <label className="import-file-button">
            <ImageIcon size={18} aria-hidden="true" />
            <span>{selectedFile ? t('changeFile') : t('chooseFile')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.currentTarget.value = '';
              selectPhoto(file);
            }} disabled={busy} />
          </label>
          <label className="button button-secondary import-camera-button">
            <Camera size={18} aria-hidden="true" />
            <span>{t('takePhoto')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.currentTarget.value = '';
              selectPhoto(file);
            }} disabled={busy} />
          </label>
          {selectedFile ? <div className="import-file-name"><ImageIcon size={16} /><span>{selectedFile.name}</span><button type="button" className="text-button" onClick={() => { setSelectedFile(null); replacePreview(''); }} disabled={busy} aria-label={t('removeRow')}><X size={14} /></button></div> : null}
        </div>
        {previewUrl ? <div className="import-photo-preview"><img src={previewUrl} alt="" /></div> : null}
        <p className="muted-note">{t('photoHint')}</p>
        {ocrConfigured === false ? <ImportNotice tone="warning">{t('ocrNotConfigured')} {t('ocrSetup')}{ocrSetup.length ? <code>{ocrSetup.join(' / ')}</code> : null}</ImportNotice> : null}
        <p className="muted-note">{t('scanHint')}</p>
        <div className="import-actions">
          <button type="button" className="button button-primary" onClick={scanNotebook} disabled={busy || !selectedFile || !date || ocrConfigured !== true || farmersLoading || Boolean(farmersError)}>
            <ImageIcon size={16} aria-hidden="true" />{busy ? busyLabel : t('scanPage')}
          </button>
          {busy ? <button type="button" className="button button-secondary" onClick={() => abortRef.current?.abort()}>{t('cancel')}</button> : null}
        </div>
        {ocrConfigured === false ? <p className="muted-note">{t('sourceHint')}</p> : null}
      </section> : <section className="import-source-card">
        <label className="import-textarea-label">{t('pasteTab')}<textarea rows={10} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={language === 'rw' ? 'Izina, Ijoro, Nimugoroba' : 'Name, Morning, Evening'} /></label>
        <p className="muted-note">{t('pasteMilkHint')}</p>
        <div className="import-actions"><button type="button" className="button button-primary" onClick={parsePaste} disabled={busy || !pasteText.trim() || farmersLoading || Boolean(farmersError)}>{t('readList')}</button></div>
      </section>}
      <ImportNotice tone="info">{t('milkModeNote')}</ImportNotice>
    </div> : null}

    {step === 1 ? <div className="import-review">
      {saveRunning ? <ImportProgress value={savedProcessed} max={saveTotal} label={t('progress', { done: savedProcessed, total: saveTotal })} /> : null}
      <div className="import-review-toolbar">
        <div className="import-counts">
          <span><b>{counts.total}</b> {t('allRows')}</span>
          <span className="ok"><b>{counts.ready}</b> {t('ready')}</span>
          {counts.uncertain ? <span className="warn"><b>{counts.uncertain}</b> {t('uncertain')}</span> : null}
          {counts.unmatched ? <span className="warn"><b>{counts.unmatched}</b> {t('unmatched')}</span> : null}
          {counts.unreadable ? <span className="danger"><b>{counts.unreadable}</b> {t('unreadable')}</span> : null}
          {counts.duplicate ? <span className="danger"><b>{counts.duplicate}</b> {t('duplicate')}</span> : null}
        </div>
        <div className="import-review-toolbar-actions">
          <label className="import-check"><input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />{t('filterIssues')}</label>
          <button type="button" className="button button-secondary small-button" onClick={addManualRow} disabled={saveRunning}><Plus size={14} />{t('addManualRow')}</button>
        </div>
      </div>
      <div className="import-review-meta"><span>{t('targetDate')}: <b>{date}</b></span><span>{t('session')}: <b>{t(session)}</b></span></div>
      <div className="table-scroll import-review-table import-milk-table"><table>
        <thead><tr><th>{t('include')}</th><th>{t('rowNumber')}</th><th>{t('name')}</th><th>{t('selectFarmer')}</th><th>{t('morningQty')}</th><th>{t('eveningQty')}</th><th>{t('confirmRow')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{visibleRows.map((row) => <tr key={row.uid} className={row.status === 'duplicate' || row.status === 'unreadable' ? 'import-row-blocked' : row.status === 'uncertain' || row.status === 'unmatched' ? 'import-row-warning' : ''}>
          <td><input type="checkbox" aria-label={`${t('include')} ${row.rowNumber}`} checked={row.include} disabled={saveRunning} onChange={(event) => updateRow(row.uid, { include: event.target.checked, verified: event.target.checked ? false : row.verified })} /></td>
          <td>{row.rowNumber}</td>
          <td className="import-ocr-name"><b>{row.nameText || '—'}</b>{row.rawText && row.rawText !== row.nameText ? <small title={row.rawText}>{row.rawText}</small> : null}{row.quantityRaw ? <small>{t('quantity')}: {row.quantityRaw}</small> : null}</td>
          <td><select value={row.farmerId} onChange={(event) => chooseFarmer(row, event.target.value)} disabled={saveRunning}>
            <option value="">{t('selectFarmer')}</option>
            {farmerOptions(row).map((farmer) => <option key={farmer.id} value={farmer.id}>{farmerLabel(farmer)}</option>)}
            {expandedFarmerRow !== row.uid ? <option value="__all__">{t('showAllFarmers')}</option> : null}
          </select></td>
          <td><input type="number" min="0" max="10000" step="0.01" value={row.morning} onChange={(event) => updateRow(row.uid, { morning: event.target.value, verified: false })} disabled={saveRunning} /></td>
          <td><input type="number" min="0" max="10000" step="0.01" value={row.evening} onChange={(event) => updateRow(row.uid, { evening: event.target.value, verified: false })} disabled={saveRunning} /></td>
          <td><input type="checkbox" aria-label={t('confirmRow')} checked={row.verified} disabled={saveRunning || !row.include} onChange={(event) => updateRow(row.uid, { verified: event.target.checked })} /></td>
          <td className="import-status-cell"><ImportStatus status={row.status} label={statusLabel(row)} />{row.detail ? <small>{row.detail}</small> : null}{row.matchStatus === 'ambiguous' ? <small>{t('ambiguous')}: {row.candidates.slice(0, 3).map((id) => farmerById.get(id)?.name).filter(Boolean).join(' / ')}</small> : null}</td>
        </tr>)}</tbody>
      </table></div>
      {!visibleRows.length ? <p className="muted-note">{t('noMilkRows')}</p> : null}
      <ImportPager page={safePage} pages={totalPages} onChange={setPage} previousLabel={t('previous')} nextLabel={t('next')} />
      <ImportNotice tone="info">{t('reviewMilkHint')}</ImportNotice>
      <div className="import-confirm">
        <label className="import-check"><input type="checkbox" checked={confirmed} disabled={saveRunning} onChange={(event) => setConfirmed(event.target.checked)} />{t('confirmReview')}</label>
        {blockingRows.length ? <ImportNotice tone="warning">{blockingRows.length} {t('reviewMilkHint')}</ImportNotice> : null}
      </div>
      {serverResults.some((row) => row.status !== 'created') ? <div className="import-results"><h4>{t('batchSummary')}</h4><ul>{serverResults.filter((row) => row.status !== 'created').map((row) => <li key={`${row.rowNumber}-${row.errorCode}`}>{t('rowNumber')} {row.rowNumber}: {row.message || row.errorCode}</li>)}</ul></div> : null}
    </div> : null}

    {step === 2 && completedSummary ? <div className="import-done">
      <div className="import-done-mark"><Check size={28} aria-hidden="true" /></div>
      <h3>{t('doneTitle')}</h3>
      <p>{t('doneBody')}</p>
      <div className="import-summary-cards">
        <div><b>{completedSummary.created}</b><span>{t('created')}</span></div>
        <div><b>{completedSummary.duplicates}</b><span>{t('duplicates')}</span></div>
        <div><b>{completedSummary.failed}</b><span>{t('failed')}</span></div>
      </div>
      {serverResults.some((row) => row.status !== 'created') ? <div className="import-results"><h4>{t('batchSummary')}</h4><ul>{serverResults.filter((row) => row.status !== 'created').map((row) => <li key={`${row.rowNumber}-${row.errorCode}`}>{t('rowNumber')} {row.rowNumber}: {row.message || row.errorCode}</li>)}</ul></div> : null}
    </div> : null}
  </ImportFrame>;
}
