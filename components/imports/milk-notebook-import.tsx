'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, FileSpreadsheet, FileText, Image as ImageIcon, Plus, Upload, X } from 'lucide-react';
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
} from '@/lib/imports/client-files';
import {
  extractImportDocument,
  loadImportFarmers,
  loadRecordedFarmerIds,
  postJson,
  type ImportFarmer,
} from '@/lib/imports/client-api';
import { buildFarmerIndex, farmerLabel, matchFarmer } from '@/lib/imports/farmer-matching';
import {
  detectNotebookDateColumns,
  detectNotebookPageMonthYear,
  extractNotebookEntries,
  parseNotebookPage,
  stitchNotebookMultiDay,
  stitchNotebookPages,
} from '@/lib/imports/notebook';
import { assessMultiDayRow, buildMultiDayDraftDays, buildMultiDayEntries, chunkMultiDayEntries, type MultiDayRowDraft } from '@/lib/imports/multi-day';
import { MultiDayReviewMatrix } from '@/components/imports/milk-multiday-matrix';
import {
  detectHeader,
  normalizeHeader,
  parseTextRows,
  stripSummaryRows,
  SUMMARY_ROW_PATTERN,
} from '@/lib/imports/text-parsing';
import { getAccountingDate } from '@/lib/utils/accounting-period.js';

type DetectedDateCol = {
  isoDate: string;
  raw: string;
  x: number;
  confidence: number | null;
  width?: number;
  y?: number;
};

type MilkDraft = {
  uid: number;
  rowNumber: number;
  farmerNumber?: number | null;
  detectedPhone?: string | null;
  detectedNationalId?: string | null;
  detectedAccountNumber?: string | null;
  nameText: string;
  rawText: string;
  quantityRaw: string;
  ocrStatus: string;
  confidence: number | null;
  dateColumnFound: boolean;
  businessDate: string;
  session: 'morning' | 'evening';
  litres: string;
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
  status: 'matched' | 'review' | 'needsMatch' | 'duplicate' | 'invalid' | 'excluded';
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
  date?: string;
  farmerId: number | null;
  status: string;
  errorCode?: string;
  message?: string;
  recordId?: number;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const todayIso = () => getAccountingDate();

const toDisplayDate = (isoDate: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
};

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
  if (!rows.length) return {
    rows: [] as Array<{
      name: string;
      farmerNumber?: number | null;
      detectedPhone?: string | null;
      detectedNationalId?: string | null;
      detectedAccountNumber?: string | null;
      morning: string;
      evening: string;
      raw: string;
      quantityRaw: string;
      invalidQuantity: boolean;
    }>,
    warning: '',
    checksum: null,
  };
  const { rows: strippedRows, checksum } = stripSummaryRows(rows);
  const detected = detectHeader(strippedRows);
  const width = strippedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const header = strippedRows[0] || [];
  const mapping = detected.mapping as Record<string, number | undefined>;
  const nameIndex = mapping.name ?? 0;
  const farmerNumberIndex = mapping.farmerNumber ?? milkHeaderIndex(header, ['no', 'no.', 'nambara', 'lineno', 'number', 'nimero']);
  const morningIndex = milkHeaderIndex(header, ['morning', 'ijoro', 'amata y ijoro', 'morning milk', 'morning qty']);
  const eveningIndex = milkHeaderIndex(header, ['evening', 'nimugoroba', 'umugoroba', 'amata y nimugoroba', 'evening milk', 'evening qty']);
  const quantityIndex = milkHeaderIndex(header, ['quantity', 'ingano', 'total', 'amata', 'liters', 'litres', 'litiro', 'volume', 'umubare', 'umubare w amata']);
  const phoneIndex = mapping.phone ?? milkHeaderIndex(header, ['telephone', 'telefone', 'phone', 'tel', 'mobile']);
  const nationalIdIndex = mapping.nationalId ?? milkHeaderIndex(header, ['indangamuntu', 'nationalid', 'nid', 'id', 'cni']);
  const accountIndex = mapping.accountNumber ?? milkHeaderIndex(header, ['nimero ya konti', 'konti', 'account', 'compte', 'accountnumber', 'bankaccount', 'bank account']);
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
  const dataRows = hasHeader ? strippedRows.slice(1) : strippedRows;
  const parsed = dataRows.map((row) => {
    const name = String(row[nameIndex] ?? '').trim();
    const rawNum = farmerNumberIndex >= 0 ? String(row[farmerNumberIndex] ?? '').replace(/[#.\s]/g, '') : '';
    const farmerNumber = rawNum && /^\d+$/.test(rawNum) ? Number(rawNum) : null;
    const detectedPhone = phoneIndex >= 0 ? String(row[phoneIndex] ?? '').trim() : null;
    const detectedNationalId = nationalIdIndex >= 0 ? String(row[nationalIdIndex] ?? '').trim() : null;
    const detectedAccountNumber = accountIndex >= 0 ? String(row[accountIndex] ?? '').trim() : null;
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
      farmerNumber,
      detectedPhone,
      detectedNationalId,
      detectedAccountNumber,
      morning,
      evening,
      raw: row.join(' · '),
      quantityRaw: hasSplit ? `${morningRaw || '0'} / ${eveningRaw || '0'}` : quantityRaw,
      invalidQuantity: morningParsed.invalid || eveningParsed.invalid || (!hasSplit && quantityParsed.invalid),
    };
  }).filter((row) => (row.name || row.morning || row.evening) && !SUMMARY_ROW_PATTERN.test(row.name));
  const warning = !hasHeader
    ? (width === 3 ? 'noHeaderSplit' : 'noHeaderQuantity')
    : '';
  return { rows: parsed, warning, checksum };
};

export function MilkNotebookImportModal({
  onClose,
  onCompleted,
  collectionDate,
  language,
  centers = [],
}: {
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
  collectionDate: string;
  language: PublicLanguage;
  centers?: Array<{ id: number | string; name: string }>;
}) {
  const t = useCallback((key: ImportCopyKey, params?: Record<string, string | number>) => getImportCopy(language, key, params), [language]);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [sourceMode, setSourceMode] = useState<'photo' | 'paste'>('photo');
  const [date, setDate] = useState(collectionDate || todayIso());
  const [businessDate, setBusinessDate] = useState(collectionDate || todayIso());
  const [dateDetectionUncertain, setDateDetectionUncertain] = useState(false);
  const [detectedDateColumns, setDetectedDateColumns] = useState<DetectedDateCol[]>([]);
  const [selectedColumnDate, setSelectedColumnDate] = useState<string>('');
  const [session, setSession] = useState<'morning' | 'evening'>('morning');
  const [pasteText, setPasteText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [checksum, setChecksum] = useState<{ checksumLiters?: number | null; checksumGross?: number | null; checksumNet?: number | null } | null>(null);
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

  // Multi-Day Batch state (record several register columns at once)
  const [scanMode, setScanMode] = useState<'single' | 'multi'>('single');
  const [multiFromDay, setMultiFromDay] = useState('');
  const [multiToDay, setMultiToDay] = useState('');
  const [multiDay, setMultiDay] = useState(false);
  const [multiDates, setMultiDates] = useState<string[]>([]);
  const [multiSelectedDates, setMultiSelectedDates] = useState<string[]>([]);
  const [multiRows, setMultiRows] = useState<MultiDayRowDraft[]>([]);
  const [multiRecorded, setMultiRecorded] = useState<Record<string, Set<number>>>({});
  const [multiExpandedUid, setMultiExpandedUid] = useState<number | null>(null);
  const [creatingUid, setCreatingUid] = useState<number | null>(null);
  const [createError, setCreateError] = useState<{ uid: number; message: string } | null>(null);
  // Inline quick farmer registration state
  const [inlineRegisterRow, setInlineRegisterRow] = useState<number | null>(null);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regCenter, setRegCenter] = useState('');
  const [regCenterId, setRegCenterId] = useState<number | ''>('');
  const [regNid, setRegNid] = useState('');
  const [regAccount, setRegAccount] = useState('');
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState('');

  const uidRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef('');
  const saveLockRef = useRef(false);
  const ocrWordsRef = useRef<Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }>>([]);
  const batchKeyRef = useRef<string>('');
  const scannedAtRef = useRef<string>('');

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
    setBusinessDate(collectionDate || todayIso());
    setDateDetectionUncertain(false);
    setDetectedDateColumns([]);
    setSelectedColumnDate('');
    setSession('morning');
    setPasteText('');
    setSelectedFile(null);
    setSelectedFiles([]);
    setDragOver(false);
    replacePreview('');
    setChecksum(null);
    setError('');
    setWarning('');
    setRows([]);
    setRecordedFarmerIds(new Set());
    setExistingError('');
    setIssuesOnly(false);
    setPage(0);
    setExpandedFarmerRow(null);
    setInlineRegisterRow(null);
    setConfirmed(false);
    setSaveError('');
    setServerResults([]);
    setCompletedSummary(null);
    setSavedProcessed(0);
    setSaveTotal(0);
    setScanMode('single');
    setMultiFromDay('');
    setMultiToDay('');
    setMultiDay(false);
    setMultiDates([]);
    setMultiSelectedDates([]);
    setMultiRows([]);
    setMultiRecorded({});
    setMultiExpandedUid(null);
    setCreatingUid(null);
    setCreateError(null);
    ocrWordsRef.current = [];
    batchKeyRef.current = '';
    scannedAtRef.current = '';
  };

  const resolveMatch = (name: string, farmerNumber?: number | null) => {
    let exactId: number | null = null;
    let matchStatus = 'none';
    let matchReason = '';
    let candidates: number[] = [];

    if (farmerNumber && existingFarmers.length) {
      const byNum = existingFarmers.find((f) => f.farmerNumber === farmerNumber);
      if (byNum) {
        exactId = byNum.id;
        matchStatus = 'exact';
        matchReason = 'farmer_number_match';
        candidates = [byNum.id];
      }
    }

    if (!exactId) {
      const match = matchFarmer({ name }, farmerIndex);
      if (match.status === 'exact' && match.farmerId) {
        exactId = Number(match.farmerId);
        matchStatus = 'exact';
        matchReason = match.reason || 'name_match';
      } else {
        matchStatus = match.status;
        matchReason = match.reason || '';
      }
      candidates = (match.candidates || []).map((farmer: { id: number | string }) => Number(farmer.id)).filter(Boolean);
    }
    return { exactId, matchStatus, matchReason, candidates };
  };

  const matchDraft = (name: string, base: {
    rowNumber: number;
    farmerNumber?: number | null;
    detectedPhone?: string | null;
    detectedNationalId?: string | null;
    detectedAccountNumber?: string | null;
    rawText: string;
    quantityRaw: string;
    ocrStatus: string;
    confidence: number | null;
    dateColumnFound: boolean;
    businessDate: string;
    session: 'morning' | 'evening';
    litres: string;
    morning: string;
    evening: string;
    include: boolean;
    verified: boolean;
  }): MilkDraft => {
    const { exactId, matchStatus, matchReason, candidates } = resolveMatch(name, base.farmerNumber);

    return {
      uid: uidRef.current += 1,
      ...base,
      nameText: name,
      farmerId: exactId ? String(exactId) : '',
      candidates,
      matchStatus,
      matchReason,
      verified: base.verified && Boolean(exactId),
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
    setMultiDay(false);
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

  const loadRecordedForDates = async (dates: string[], signal?: AbortSignal) => {
    const loaded: Record<string, Set<number>> = {};
    for (const day of dates) {
      loaded[day] = await loadRecordedFarmerIds(day, signal);
    }
    return loaded;
  };

  const openMultiReview = async (drafts: MultiDayRowDraft[], allDates: string[], selected: string[]) => {
    setBusy(true);
    setBusyLabel(t('checkingExisting'));
    setExistingError('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let recorded: Record<string, Set<number>> = {};
    try {
      recorded = await loadRecordedForDates(selected, controller.signal);
    } catch (loadError) {
      if (!isAbort(loadError)) setExistingError(loadError instanceof Error ? loadError.message : t('existingMilk'));
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
    setMultiRecorded(recorded);
    setMultiDates(allDates);
    setMultiSelectedDates(selected);
    setMultiRows(drafts);
    setMultiDay(true);
    setStep(1);
    setConfirmed(false);
    setServerResults([]);
    setCompletedSummary(null);
  };

  const scanMultiDay = (words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }>) => {
    // The register's own header decides the month; the target date is only a fallback reference.
    const reference = detectNotebookPageMonthYear(words) || date;
    const extracted = extractNotebookEntries(words, null, reference, { multiDay: true });
    if (!extracted.dates.length) {
      throw new Error(language === 'rw'
        ? 'Nta nkingi z amatariki zabonetse. Koresha "Umunsi umwe" cyangwa ufate ifoto igaragara neza.'
        : 'No date columns were detected. Use Single Day or retake a clearer photo.');
    }
    if (!extracted.length) throw new Error(t('noMilkRows'));
    const from = Number(multiFromDay) || 1;
    const to = Number(multiToDay) || 31;
    const selected = extracted.dates.filter((isoDate) => {
      const day = Number(isoDate.slice(8, 10));
      return day >= from && day <= to;
    });
    if (!selected.length) {
      throw new Error(language === 'rw'
        ? 'Nta munsi uri muri iyo ntera wabonetse mu ikayi.'
        : 'None of the detected register days fall in that range.');
    }
    setDetectedDateColumns(extracted.columns);
    setDateDetectionUncertain(extracted.columns.some((col) => col.confidence !== null && col.confidence < 0.72));
    setSelectedColumnDate('');
    setBusinessDate(selected[0]);

    const drafts: MultiDayRowDraft[] = extracted.map((row) => {
      const match = resolveMatch(row.detectedName, row.farmerNumber);
      const days = buildMultiDayDraftDays(row, extracted.dates);
      const hasLitres = selected.some((day) => Number(days[day]?.morning || 0) + Number(days[day]?.evening || 0) > 0);
      return {
        uid: uidRef.current += 1,
        rowNumber: row.rowNumber,
        farmerNumber: row.farmerNumber,
        detectedPhone: row.sublineMetadata.phone,
        detectedNationalId: row.sublineMetadata.nationalId,
        detectedAccountNumber: row.sublineMetadata.accountNumber,
        nameText: row.detectedName,
        rawText: row.nameRaw,
        farmerId: match.exactId ? String(match.exactId) : '',
        candidates: match.candidates,
        matchStatus: match.matchStatus,
        matchReason: match.matchReason,
        include: hasLitres,
        recordedTotal: typeof row.recordedTotal === 'number' ? row.recordedTotal : null,
        days,
      };
    });
    return { drafts, allDates: extracted.dates, selected };
  };

  const toggleMultiDate = async (isoDate: string) => {
    if (saveRunning) return;
    setConfirmed(false);
    if (multiSelectedDates.includes(isoDate)) {
      setMultiSelectedDates((current) => current.filter((day) => day !== isoDate));
      return;
    }
    if (!multiRecorded[isoDate]) {
      setBusy(true);
      try {
        const recorded = await loadRecordedFarmerIds(isoDate);
        setMultiRecorded((current) => ({ ...current, [isoDate]: recorded }));
      } catch (loadError) {
        setExistingError(loadError instanceof Error ? loadError.message : t('existingMilk'));
      } finally {
        setBusy(false);
      }
    }
    setMultiSelectedDates((current) => [...current, isoDate].sort());
  };

  const updateMultiRow = (uid: number, changes: Partial<MultiDayRowDraft>) => {
    if (saveRunning) return;
    setConfirmed(false);
    setMultiRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...changes } : row)));
  };

  const editMultiCell = (uid: number, isoDate: string, field: 'morning' | 'evening', value: string) => {
    if (saveRunning) return;
    setConfirmed(false);
    setMultiRows((current) => current.map((row) => (row.uid === uid
      ? { ...row, days: { ...row.days, [isoDate]: { ...row.days[isoDate], [field]: value, verified: true } } }
      : row)));
  };

  const confirmMultiRow = (uid: number) => {
    if (saveRunning) return;
    setConfirmed(false);
    setMultiRows((current) => current.map((row) => (row.uid === uid
      ? { ...row, days: Object.fromEntries(Object.entries(row.days).map(([day, cell]) => [day, { ...cell, verified: true }])) }
      : row)));
  };

  const chooseMultiFarmer = (row: MultiDayRowDraft, value: string) => {
    if (value === '__all__') {
      setMultiExpandedUid(row.uid);
      return;
    }
    setMultiExpandedUid(null);
    updateMultiRow(row.uid, { farmerId: value, include: value ? true : row.include, matchStatus: value ? 'manual' : 'none' });
  };

  /** One-click registration: the new farmer gets a permanent #Number from the server and every day of this row links to it. */
  const createMultiFarmer = async (row: MultiDayRowDraft) => {
    if (!row.nameText.trim()) {
      setCreateError({ uid: row.uid, message: language === 'rw' ? 'Izina rirakenewe.' : 'Farmer name is required.' });
      return;
    }
    const center = centers[0] || null;
    const fallbackCenterName = existingFarmers.find((f) => f.collectionCenter)?.collectionCenter || '';
    if (!center && !fallbackCenterName) {
      setCreateError({
        uid: row.uid,
        message: language === 'rw'
          ? 'Banza ushyireho ikigo cy ikusanyirizo mu Igenamiterere.'
          : 'Set up a collection center in Settings before registering farmers.',
      });
      return;
    }
    setCreatingUid(row.uid);
    setCreateError(null);
    try {
      const created = await postJson<ImportFarmer>('/api/farmers', {
        name: row.nameText.trim(),
        phone: row.detectedPhone || null,
        nationalId: row.detectedNationalId || null,
        accountNumber: row.detectedAccountNumber || null,
        collectionCenter: center ? center.name : fallbackCenterName,
        collectionCenterId: center ? Number(center.id) : undefined,
      });
      setExistingFarmers((prev) => [...prev, created]);
      updateMultiRow(row.uid, {
        farmerId: String(created.id),
        nameText: created.name,
        matchStatus: 'exact',
        matchReason: 'inline_registered',
        include: true,
      });
    } catch (err) {
      setCreateError({ uid: row.uid, message: err instanceof Error ? err.message : t('errorGeneric') });
    } finally {
      setCreatingUid(null);
    }
  };

  const scanNotebook = async () => {
    if (!date) {
      setError(t('noDate'));
      return;
    }
    const filesToScan = selectedFiles.length > 0 ? selectedFiles : (selectedFile ? [selectedFile] : []);
    if (!filesToScan.length) {
      setError(t('noFile'));
      return;
    }

    const firstFile = filesToScan[0];
    const isDoc = isSpreadsheetFile(firstFile) || isPdfFile(firstFile) || isCsvFile(firstFile);

    if (!isDoc && ocrConfigured !== true) {
      setError(t('ocrDisabled'));
      return;
    }
    setError('');
    setWarning('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    try {
      // 1. Non-image document routing (PDF, Excel .xlsx/.xls, CSV, TXT)
      if (isDoc) {
        if (firstFile.size > IMPORT_MAX_FILE_BYTES) throw new Error(t('fileTooLarge'));
        setBusyLabel(t('readingFile'));
        const extractResult = await extractImportDocument(firstFile, controller.signal);
        const rawRows: string[][] = extractResult.rows || [];
        if (!rawRows.length) throw new Error(t('errorNoRows'));

        if (extractResult.checksum) {
          setChecksum(extractResult.checksum);
        }

        const { rows: strippedRows, checksum: detectedChecksum } = stripSummaryRows(rawRows);
        if (detectedChecksum) setChecksum(detectedChecksum);

        // Check if table contains multiple day columns
        const header: string[] = strippedRows[0] || [];
        const isDayCol = (val: string) => {
          const clean = String(val ?? '').trim();
          return /^0?[1-9]$|^[12][0-9]$|^3[01]$/.test(clean) || /^\d{4}-\d{2}-\d{2}$/.test(clean);
        };
        const dayCols = header.map((h: string, i: number) => ({ col: h, index: i })).filter((c: { col: string; index: number }) => isDayCol(c.col));

        if (dayCols.length >= 2 || scanMode === 'multi') {
          const yearMonth = (date || todayIso()).slice(0, 7);
          const allDates = dayCols.map((c: { col: string; index: number }) => {
            const clean = String(c.col).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
            const dayNum = Number(clean);
            return `${yearMonth}-${String(dayNum).padStart(2, '0')}`;
          });

          const detected = detectHeader(strippedRows);
          const mapping = detected.mapping as Record<string, number | undefined>;
          const nameIndex = mapping.name ?? (dayCols[0]?.index > 1 ? 1 : 0);
          const farmerNumberIndex = mapping.farmerNumber ?? milkHeaderIndex(header, ['no', 'no.', 'nambara', 'lineno', 'number', 'nimero']);
          const phoneIndex = mapping.phone ?? milkHeaderIndex(header, ['telephone', 'telefone', 'phone', 'tel', 'mobile']);
          const nationalIdIndex = mapping.nationalId ?? milkHeaderIndex(header, ['indangamuntu', 'nationalid', 'nid', 'id', 'cni']);
          const accountIndex = mapping.accountNumber ?? milkHeaderIndex(header, ['nimero ya konti', 'konti', 'account', 'compte', 'accountnumber', 'bankaccount']);

          const dataRows = (detected.hasHeader || dayCols.length > 0) ? strippedRows.slice(1) : strippedRows;
          const multiDrafts: MultiDayRowDraft[] = dataRows.map((r, rIdx) => {
            const name = String(r[nameIndex] ?? '').trim();
            const rawNum = farmerNumberIndex >= 0 ? String(r[farmerNumberIndex] ?? '').replace(/[#.\s]/g, '') : '';
            const farmerNum = rawNum && /^\d+$/.test(rawNum) ? Number(rawNum) : null;
            const match = resolveMatch(name, farmerNum);
            const days: Record<string, { morning: string; evening: string; raw: string; status: string; verified: boolean }> = {};
            dayCols.forEach((dc: { col: string; index: number }, dIdx: number) => {
              const iso = allDates[dIdx];
              const cellVal = String(r[dc.index] ?? '').trim();
              const parsedV = parseVolume(cellVal);
              days[iso] = {
                morning: parsedV.present && !parsedV.invalid && parsedV.value > 0 ? String(parsedV.value) : '',
                evening: '',
                raw: cellVal,
                status: parsedV.invalid ? 'unreadable' : (parsedV.value > 0 ? 'ok' : 'empty'),
                verified: parsedV.present && !parsedV.invalid && parsedV.value > 0,
              };
            });
            const hasLitres = allDates.some((d: string) => Number(days[d]?.morning || 0) > 0);
            return {
              uid: uidRef.current += 1,
              rowNumber: rIdx + 1,
              farmerNumber: farmerNum,
              detectedPhone: phoneIndex >= 0 ? String(r[phoneIndex] ?? '').trim() : null,
              detectedNationalId: nationalIdIndex >= 0 ? String(r[nationalIdIndex] ?? '').trim() : null,
              detectedAccountNumber: accountIndex >= 0 ? String(r[accountIndex] ?? '').trim() : null,
              nameText: name,
              rawText: r.join(' • '),
              farmerId: match.exactId ? String(match.exactId) : '',
              candidates: match.candidates,
              matchStatus: match.matchStatus,
              matchReason: match.matchReason,
              include: hasLitres,
              days,
            };
          }).filter((row) => row.nameText && !SUMMARY_ROW_PATTERN.test(row.nameText));

          scannedAtRef.current = new Date().toISOString();
          batchKeyRef.current = `milk_doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          await openMultiReview(multiDrafts, allDates, allDates);
          return;
        }

        // Single collection list or SACCO sheet
        const parsed = parseMilkPaste(strippedRows, session);
        if (!parsed.rows.length) throw new Error(t('noMilkRows'));
        if (parsed.warning === 'noHeaderSplit') setWarning(t('noHeaderSplit'));
        else if (parsed.warning === 'noHeaderQuantity') setWarning(t('noHeaderQuantity'));

        scannedAtRef.current = new Date().toISOString();
        batchKeyRef.current = `milk_doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        setBusinessDate(date);
        setSelectedColumnDate('');

        const drafts = parsed.rows.map((row, index) => {
          const morning = parseVolume(row.morning);
          const evening = parseVolume(row.evening);
          const total = morning.value + evening.value;
          const initialLitres = total > 0 ? (morning.value > 0 ? String(morning.value) : String(evening.value)) : '';
          return matchDraft(row.name, {
            rowNumber: index + 1,
            farmerNumber: row.farmerNumber,
            detectedPhone: row.detectedPhone,
            detectedNationalId: row.detectedNationalId,
            detectedAccountNumber: row.detectedAccountNumber,
            rawText: row.raw,
            quantityRaw: row.quantityRaw,
            ocrStatus: row.invalidQuantity ? 'unreadable' : total > 0 ? 'ok' : 'unreadable',
            confidence: null,
            dateColumnFound: true,
            businessDate: date,
            session: morning.value > 0 ? 'morning' : 'evening',
            litres: initialLitres,
            morning: row.morning,
            evening: row.evening,
            include: total > 0 && !row.invalidQuantity,
            verified: total > 0 && !row.invalidQuantity,
          });
        });
        await openReview(drafts, date);
        return;
      }

      // 2. Multi-image stitching (e.g. Left Page Days 1-15 & Right Page Days 16-30)
      if (filesToScan.length >= 2 && filesToScan.every(isImageFile)) {
        const ocrPages: Array<Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }>> = [];
        for (let i = 0; i < filesToScan.length; i++) {
          setBusyLabel(`${t('scanning')} (${i + 1}/${filesToScan.length})...`);
          const prepared = await prepareImageForOcr(filesToScan[i]);
          if (i === 0) replacePreview(prepared.previewUrl);
          const res = await postJson<{
            text: string;
            words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }>;
          }>('/api/imports/ocr', { imageBase64: prepared.base64, mimeType: prepared.mimeType }, controller.signal);
          if (!res.words?.length) throw new Error(`${filesToScan[i].name}: ${t('errorOcr')}`);
          ocrPages.push(res.words);
        }

        const stitched = stitchNotebookPages(ocrPages, { multiDay: true }, date);
        if (stitched.checksum) setChecksum(stitched.checksum);
        if (!stitched.dates.length) {
          throw new Error(language === 'rw'
            ? 'Nta nkingi z amatariki zabonetse mu mafoto. Banza urebe ko amapaji agaragara neza.'
            : 'No date columns were detected across the uploaded pages.');
        }
        if (!stitched.length) throw new Error(t('noMilkRows'));

        const from = Number(multiFromDay) || 1;
        const to = Number(multiToDay) || 31;
        const selected = stitched.dates.filter((isoDate) => {
          const day = Number(isoDate.slice(8, 10));
          return day >= from && day <= to;
        });
        const effectiveSelected = selected.length ? selected : stitched.dates;

        setDetectedDateColumns(stitched.columns);
        setDateDetectionUncertain(stitched.columns.some((col: any) => col.confidence !== null && col.confidence < 0.72));
        setSelectedColumnDate('');
        setBusinessDate(effectiveSelected[0]);

        scannedAtRef.current = new Date().toISOString();
        batchKeyRef.current = `milk_stitch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        const drafts: MultiDayRowDraft[] = stitched.map((row: any) => {
          const match = resolveMatch(row.detectedName, row.farmerNumber);
          const days = buildMultiDayDraftDays(row, stitched.dates);
          const hasLitres = effectiveSelected.some((day) => Number(days[day]?.morning || 0) + Number(days[day]?.evening || 0) > 0);
          return {
            uid: uidRef.current += 1,
            rowNumber: row.rowNumber,
            farmerNumber: row.farmerNumber,
            detectedPhone: row.sublineMetadata?.phone || null,
            detectedNationalId: row.sublineMetadata?.nationalId || null,
            detectedAccountNumber: row.sublineMetadata?.accountNumber || null,
            nameText: row.detectedName,
            rawText: row.nameRaw || row.detectedName,
            farmerId: match.exactId ? String(match.exactId) : '',
            candidates: match.candidates,
            matchStatus: match.matchStatus,
            matchReason: match.matchReason,
            include: hasLitres,
            recordedTotal: typeof row.recordedTotal === 'number' ? row.recordedTotal : null,
            days,
          };
        });
        await openMultiReview(drafts, stitched.dates, effectiveSelected);
        return;
      }

      // 3. Single image upload
      setBusyLabel(t('scanning'));
      const prepared = await prepareImageForOcr(firstFile);
      replacePreview(prepared.previewUrl);
      const result = await postJson<{
        text: string;
        words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }>;
      }>('/api/imports/ocr', { imageBase64: prepared.base64, mimeType: prepared.mimeType }, controller.signal);
      if (!result.words?.length) throw new Error(t('errorOcr'));

      ocrWordsRef.current = result.words;
      scannedAtRef.current = new Date().toISOString();
      batchKeyRef.current = `milk_scan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      if (scanMode === 'multi') {
        const multi = scanMultiDay(result.words);
        await openMultiReview(multi.drafts, multi.allDates, multi.selected);
        return;
      }

      const cols = detectNotebookDateColumns(result.words, date);
      setDetectedDateColumns(cols);

      let targetCol: DetectedDateCol | null = null;
      let effectiveBusinessDate = date;

      if (cols.length > 0) {
        const found = cols.find((c) => c.isoDate === date) || cols[0];
        targetCol = found;
        effectiveBusinessDate = found.isoDate;
        setSelectedColumnDate(found.isoDate);
        setBusinessDate(found.isoDate);
        setDate(found.isoDate);
        setDateDetectionUncertain(found.confidence !== null && found.confidence < 0.72);
      } else {
        setDateDetectionUncertain(true);
        setSelectedColumnDate('');
        setBusinessDate(date);
      }

      const parsed = extractNotebookEntries(result.words, targetCol || date);
      if (parsed.checksum) setChecksum(parsed.checksum);
      if (!parsed.entries?.length) throw new Error(t('noMilkRows'));

      const mode = session;
      const drafts = parsed.entries
        .filter((entry: any) => !SUMMARY_ROW_PATTERN.test(entry.name || entry.rawText || ''))
        .map((entry: any) => {
          const quantity = entry.quantity;
          const amount = quantity !== null && Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? String(quantity) : '';
          const hasQuantity = Boolean(amount) && entry.status !== 'ambiguous' && entry.status !== 'unreadable';
          return matchDraft(entry.name, {
            rowNumber: entry.rowNumber,
            farmerNumber: entry.farmerNumber || null,
            detectedPhone: entry.detectedPhone || null,
            detectedNationalId: entry.detectedNationalId || null,
            detectedAccountNumber: entry.detectedAccountNumber || null,
            rawText: entry.rawText,
            quantityRaw: entry.quantityRaw,
            ocrStatus: entry.status,
            confidence: entry.confidence,
            dateColumnFound: entry.dateColumnFound,
            businessDate: effectiveBusinessDate,
            session: mode,
            litres: amount,
            morning: mode === 'morning' ? amount : (entry.morningQuantity ? String(entry.morningQuantity) : ''),
            evening: mode === 'evening' ? amount : (entry.eveningQuantity ? String(entry.eveningQuantity) : ''),
            include: hasQuantity,
            verified: entry.status === 'ok' && hasQuantity,
          });
        });

      if (!parsed.dateColumnFound || !cols.length) setWarning(t('dateColumnWarning'));
      await openReview(drafts, effectiveBusinessDate);
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

  const switchDateColumn = async (col: DetectedDateCol) => {
    setSelectedColumnDate(col.isoDate);
    setBusinessDate(col.isoDate);
    setDate(col.isoDate);
    setDateDetectionUncertain(col.confidence !== null && col.confidence < 0.72);
    setConfirmed(false);

    if (ocrWordsRef.current.length > 0) {
      const parsed = extractNotebookEntries(ocrWordsRef.current, col);
      if (parsed.entries?.length) {
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
            businessDate: col.isoDate,
            session: mode,
            litres: amount,
            morning: mode === 'morning' ? amount : '',
            evening: mode === 'evening' ? amount : '',
            include: hasQuantity,
            verified: entry.status === 'ok' && hasQuantity,
          });
        });
        await openReview(drafts, col.isoDate);
      }
    } else {
      setRows((current) => current.map((r) => ({ ...r, businessDate: col.isoDate })));
      try {
        const recorded = await loadRecordedFarmerIds(col.isoDate);
        setRecordedFarmerIds(recorded);
      } catch {}
    }
  };

  const handleBusinessDateChange = async (newDate: string) => {
    setBusinessDate(newDate);
    setDate(newDate);
    setConfirmed(false);
    setDateDetectionUncertain(false);
    setRows((current) => current.map((r) => ({ ...r, businessDate: newDate })));
    setBusy(true);
    try {
      const recorded = await loadRecordedFarmerIds(newDate);
      setRecordedFarmerIds(recorded);
    } catch {} finally {
      setBusy(false);
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

    scannedAtRef.current = new Date().toISOString();
    batchKeyRef.current = `milk_paste_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    setBusinessDate(date);
    setSelectedColumnDate('');

    const drafts = parsed.rows.map((row, index) => {
      const morning = parseVolume(row.morning);
      const evening = parseVolume(row.evening);
      const total = morning.value + evening.value;
      const initialLitres = total > 0 ? (morning.value > 0 ? String(morning.value) : String(evening.value)) : '';
      return matchDraft(row.name, {
        rowNumber: index + 1,
        rawText: row.raw,
        quantityRaw: row.quantityRaw,
        ocrStatus: row.invalidQuantity ? 'unreadable' : total > 0 ? 'ok' : 'unreadable',
        confidence: null,
        dateColumnFound: true,
        businessDate: date,
        session: morning.value > 0 ? 'morning' : 'evening',
        litres: initialLitres,
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

  const startInlineRegister = (row: MilkDraft) => {
    setInlineRegisterRow(row.uid);
    setRegName(row.nameText);
    setRegPhone(row.detectedPhone || '');
    setRegNid(row.detectedNationalId || '');
    setRegAccount(row.detectedAccountNumber || '');
    const firstCenter = centers.length === 1 ? centers[0] : null;
    const centerName = firstCenter ? firstCenter.name : (existingFarmers.find((f) => f.collectionCenter)?.collectionCenter || '');
    const centerId = firstCenter ? Number(firstCenter.id) : (existingFarmers.find((f) => f.collectionCenter)?.id ? 1 : '');
    setRegCenter(centerName);
    setRegCenterId(centerId);
    setRegError('');
  };

  const submitInlineRegister = async (row: MilkDraft) => {
    if (!regName.trim()) {
      setRegError(language === 'rw' ? 'Izina rirakenewe.' : 'Farmer name is required.');
      return;
    }
    setRegSaving(true);
    setRegError('');
    try {
      const created = await postJson<ImportFarmer>('/api/farmers', {
        name: regName.trim(),
        phone: regPhone.trim() || null,
        collectionCenter: regCenter.trim() || null,
        collectionCenterId: regCenterId ? Number(regCenterId) : undefined,
        nationalId: regNid.trim() || null,
        accountNumber: regAccount.trim() || null,
      });
      setExistingFarmers((prev) => [...prev, created]);
      updateRow(row.uid, {
        farmerId: String(created.id),
        nameText: created.name,
        matchStatus: 'exact',
        matchReason: 'inline_registered',
        verified: Boolean(row.litres && row.ocrStatus === 'ok'),
      });
      setInlineRegisterRow(null);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setRegSaving(false);
    }
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
    const litresParsed = parseVolume(row.litres);
    const morning = parseVolume(row.morning);
    const evening = parseVolume(row.evening);
    const total = litresParsed.present
      ? litresParsed.value
      : (morning.value + evening.value);
    const existingMilk = Boolean(row.farmerId) && recordedFarmerIds.has(Number(row.farmerId));
    const duplicateInPage = Boolean(row.farmerId) && (duplicateCounts.get(row.farmerId) || 0) > 1;
    const invalidVolume = litresParsed.invalid || morning.invalid || evening.invalid;

    let status: AssessedMilkRow['status'] = 'matched';
    let detail = '';

    if (!row.include) {
      status = 'excluded';
    } else if (!row.farmerId || row.matchStatus === 'none' || row.matchStatus === 'ambiguous') {
      status = 'needsMatch';
      detail = row.candidates.length
        ? row.candidates.slice(0, 3).map((id) => farmerById.get(id)?.name).filter(Boolean).join(' / ')
        : t('selectFarmerForRow');
    } else if (duplicateInPage) {
      status = 'duplicate';
      detail = t('duplicateInPage');
    } else if (existingMilk) {
      status = 'duplicate';
      detail = t('existingRecord');
    } else if (invalidVolume) {
      status = 'invalid';
      detail = t('milkNoQty');
    } else if (!total) {
      status = 'review';
      detail = t('milkNoQty');
    } else if (!row.verified && (row.ocrStatus === 'uncertain' || row.ocrStatus === 'ambiguous' || row.ocrStatus === 'unreadable' || !row.dateColumnFound || (row.confidence !== null && row.confidence < 0.72))) {
      status = 'review';
      detail = row.quantityRaw ? `OCR: ${row.quantityRaw}` : t('verifyQuantity');
    }

    const farmer = row.farmerId ? farmerById.get(Number(row.farmerId)) : null;
    if (farmer && !detail && status === 'matched') detail = farmerLabel(farmer);

    const isBlocking = row.include && (status === 'needsMatch' || status === 'review' || status === 'duplicate' || status === 'invalid');

    return {
      ...row,
      status,
      detail,
      morningValue: (row.session || session) === 'morning' ? total : morning.value,
      eveningValue: (row.session || session) === 'evening' ? total : evening.value,
      total,
      duplicateInPage,
      existingMilk,
      blocking: isBlocking,
    };
  }), [rows, recordedFarmerIds, duplicateCounts, farmerById, session, t]);

  const includedRows = assessedRows.filter((row) => row.include);
  const blockingRows = includedRows.filter((row) => row.blocking);
  const canSaveSingle = confirmed && includedRows.length > 0 && blockingRows.length === 0 && !saveRunning && !busy;

  const multiAssessments = useMemo(() => multiRows.map((row) => assessMultiDayRow(row, {
    dates: multiSelectedDates,
    recordedByDate: multiRecorded,
  })), [multiRows, multiSelectedDates, multiRecorded]);
  const multiEntries = useMemo(() => buildMultiDayEntries(multiRows, multiAssessments), [multiRows, multiAssessments]);
  const multiBlocking = multiAssessments.filter((assessed) => assessed.blocking);
  const multiCounts = multiAssessments.reduce((summary, assessed) => {
    summary.total += 1;
    if (assessed.status === 'matched') summary.matched += 1;
    else if (assessed.status === 'review') summary.review += 1;
    else if (assessed.status === 'needsMatch') summary.needsMatch += 1;
    else if (assessed.status === 'invalid') summary.invalid += 1;
    return summary;
  }, { total: 0, matched: 0, review: 0, needsMatch: 0, invalid: 0 });
  const canSaveMulti = confirmed && multiEntries.length > 0 && multiBlocking.length === 0 && !saveRunning && !busy;
  const canSave = multiDay ? canSaveMulti : canSaveSingle;
  const multiDateRangeLabel = multiSelectedDates.length
    ? `${toDisplayDate(multiSelectedDates[0])}${multiSelectedDates.length > 1 ? ` – ${toDisplayDate(multiSelectedDates[multiSelectedDates.length - 1])}` : ''}`
    : '—';

  const counts = assessedRows.reduce((summary, row) => {
    summary.total += 1;
    if (row.status === 'matched') summary.matched += 1;
    else if (row.status === 'duplicate') summary.duplicate += 1;
    else if (row.status === 'needsMatch') summary.needsMatch += 1;
    else if (row.status === 'review') summary.review += 1;
    else summary.excluded += 1;
    return summary;
  }, { total: 0, matched: 0, duplicate: 0, needsMatch: 0, review: 0, excluded: 0 });

  const filteredRows = assessedRows.filter((row) => !issuesOnly || (row.status !== 'matched' && row.status !== 'excluded'));
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const statusLabel = (row: AssessedMilkRow) => {
    if (row.status === 'matched') return t('matched');
    if (row.status === 'review') return t('reviewBadge');
    if (row.status === 'needsMatch') return t('needsMatch');
    if (row.status === 'duplicate') return t('duplicate');
    if (row.status === 'invalid') return t('invalid');
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

  const multiFarmerOptions = (row: MultiDayRowDraft) => {
    const ids = new Set<number>();
    for (const id of row.candidates) ids.add(id);
    if (row.farmerId) ids.add(Number(row.farmerId));
    if (multiExpandedUid === row.uid) {
      for (const farmer of existingFarmers) ids.add(Number(farmer.id));
    }
    return Array.from(ids).map((id) => farmerById.get(id)).filter(Boolean) as ImportFarmer[];
  };

  /**
   * Multi-day save: every confirmed day goes to /api/milk/import as its own entry carrying the
   * register column date. The batchKey makes a repeated submission idempotent (import_batches).
   */
  const startSaveMulti = async () => {
    if (!canSaveMulti || saveLockRef.current) return;
    saveLockRef.current = true;
    setSaveError('');
    setSaveRunning(true);
    setServerResults([]);
    setCompletedSummary(null);
    setSavedProcessed(0);
    setSaveTotal(multiEntries.length);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const collected: ServerMilkRow[] = [];
    let created = 0;
    let failed = 0;
    let duplicates = 0;
    let processed = 0;

    const currentBatchKey = batchKeyRef.current || `milk_scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const currentScannedAt = scannedAtRef.current || new Date().toISOString();

    try {
      for (const chunk of chunkMultiDayEntries(multiEntries, currentBatchKey)) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const result = await postJson<{
          summary?: { created?: number; failed?: number; duplicates?: number };
          rows?: ServerMilkRow[];
        }>('/api/milk/import', {
          batchKey: chunk.batchKey,
          scannedAt: currentScannedAt,
          source: 'ocr_register_scan',
          entries: chunk.entries,
        }, controller.signal);
        const chunkRows = Array.isArray(result.rows) ? result.rows : [];
        collected.push(...chunkRows);
        setServerResults([...collected]);
        created += chunkRows.filter((row) => row.status === 'created').length;
        duplicates += chunkRows.filter((row) => row.status === 'duplicate' || row.status === 'conflict').length;
        failed += chunkRows.filter((row) => row.status === 'failed').length;
        processed += chunk.entries.length;
        setSavedProcessed(Math.min(multiEntries.length, processed));
      }
      setCompletedSummary({ created, failed, duplicates });
      setStep(2);
      try {
        await onCompleted();
      } catch {
        // Table refresh error is non-fatal
      }
    } catch (saveFailure) {
      if (isAbort(saveFailure)) {
        setSaveError(`${t('cancel')}. ${t('progress', { done: processed, total: multiEntries.length })}`);
      } else {
        setSaveError(saveFailure instanceof Error ? saveFailure.message : t('errorGeneric'));
      }
    } finally {
      saveLockRef.current = false;
      setSaveRunning(false);
    }
  };

  const startSave = async () => {
    if (multiDay) {
      await startSaveMulti();
      return;
    }
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

    const currentBatchKey = batchKeyRef.current || `milk_scan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const currentScannedAt = scannedAtRef.current || new Date().toISOString();

    try {
      for (let offset = 0; offset < includedRows.length; offset += 50) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = includedRows.slice(offset, offset + 50);
        const result = await postJson<{
          summary?: { created?: number; failed?: number; duplicates?: number };
          rows?: ServerMilkRow[];
        }>('/api/milk/import', {
          date: businessDate,
          // Each chunk needs its own idempotency key, otherwise chunk 2+ would replay chunk 1's batch.
          batchKey: offset === 0 ? currentBatchKey : `${currentBatchKey}_p${offset / 50}`,
          scannedAt: currentScannedAt,
          source: 'ocr_register_scan',
          session,
          rows: chunk.map((row) => ({
            rowNumber: row.rowNumber,
            farmerId: Number(row.farmerId),
            date: row.businessDate || businessDate,
            session: row.session || session,
            liters: row.total,
            volumeMorning: (row.session || session) === 'morning' ? row.total : 0,
            volumeEvening: (row.session || session) === 'evening' ? row.total : 0,
            ocrDetectedName: row.nameText || row.rawText || null,
            ocrDetectedLiters: row.quantityRaw || null,
            confirmedLiters: row.total,
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
        // Table refresh error is non-fatal
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
      businessDate,
      session,
      litres: '',
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

  const selectFiles = (files: File[]) => {
    if (!files.length) {
      setSelectedFile(null);
      setSelectedFiles([]);
      replacePreview('');
      return;
    }
    setSelectedFiles(files);
    setSelectedFile(files[0]);
    setError('');
    setWarning('');
    if (isImageFile(files[0])) {
      replacePreview(URL.createObjectURL(files[0]));
    } else {
      replacePreview('');
    }
  };

  const removeFile = (index: number) => {
    const next = selectedFiles.filter((_, i) => i !== index);
    selectFiles(next);
  };

  const totalIncludedLiters = useMemo(() => {
    return includedRows.reduce((sum, r) => sum + (Number(r.litres) || (Number(r.morning) || 0) + (Number(r.evening) || 0)), 0);
  }, [includedRows]);

  const totalMultiDayLiters = useMemo(() => {
    return multiEntries.reduce((sum, e) => sum + (Number(e.volumeMorning) || 0) + (Number(e.volumeEvening) || 0), 0);
  }, [multiEntries]);

  const isDocFile = selectedFile && (isSpreadsheetFile(selectedFile) || isPdfFile(selectedFile) || isCsvFile(selectedFile));
  const scanDisabled = busy || !selectedFile || !date || (!isDocFile && ocrConfigured !== true) || farmersLoading || Boolean(farmersError);

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
        <label>{t('targetDate')}<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setBusinessDate(event.target.value); }} required /></label>
        {sourceMode === 'photo' && scanMode === 'multi' ? null : <label>{t('session')}<select value={session} onChange={(event) => setSession(event.target.value as 'morning' | 'evening')}><option value="morning">{t('morning')}</option><option value="evening">{t('evening')}</option></select></label>}
      </div>
      {sourceMode === 'photo' ? <div className="import-mode-toggle" role="radiogroup" aria-label={language === 'rw' ? 'Uburyo bwo kwandika' : 'Recording mode'}>
        <button type="button" role="radio" aria-checked={scanMode === 'single'} className={scanMode === 'single' ? 'active' : ''} onClick={() => setScanMode('single')} disabled={busy}>{language === 'rw' ? 'Umunsi umwe' : 'Single Day'}</button>
        <button type="button" role="radio" aria-checked={scanMode === 'multi'} className={scanMode === 'multi' ? 'active' : ''} onClick={() => setScanMode('multi')} disabled={busy}>{language === 'rw' ? 'Iminsi myinshi icyarimwe' : 'Multi-Day Batch'}</button>
      </div> : null}
      {sourceMode === 'photo' ? (
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              type="button"
              className={`button button-secondary ${scanMode === 'multi' && multiFromDay === '1' && multiToDay === '15' ? 'active-range font-bold text-[#0b5d7e] bg-[#e6f4f9] border-[#1681ab]' : ''}`}
              onClick={() => {
                setScanMode('multi');
                setMultiFromDay('1');
                setMultiToDay('15');
              }}
              style={{ flex: '1 1 auto', minHeight: 40, fontSize: '0.85rem', padding: '6px 12px' }}
            >
              {language === 'rw' ? "📖 Urupapuro rw'Ibumoso: Iminsi 1–15" : "📖 Left Page: Days 1–15"}
            </button>
            <button
              type="button"
              className={`button button-secondary ${scanMode === 'multi' && multiFromDay === '16' && (multiToDay === '31' || multiToDay === '30') ? 'active-range font-bold text-[#0b5d7e] bg-[#e6f4f9] border-[#1681ab]' : ''}`}
              onClick={() => {
                setScanMode('multi');
                setMultiFromDay('16');
                setMultiToDay('31');
              }}
              style={{ flex: '1 1 auto', minHeight: 40, fontSize: '0.85rem', padding: '6px 12px' }}
            >
              {language === 'rw' ? "📖 Urupapuro rw'Iburyo: Iminsi 16–31" : "📖 Right Page: Days 16–31"}
            </button>
          </div>
          <div style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '0.85rem',
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span aria-hidden="true" style={{ fontSize: '1.05rem', flexShrink: 0 }}>⚠️</span>
            <span>
              {language === 'rw'
                ? 'Ntukafotore amapaji abiri icyarimwe. Buri rupapuro rugomba gufatwa ukwarwo kugira ngo imibare isomeke neza.'
                : 'Do not photograph both pages simultaneously. Each page must be captured separately for accurate number recognition.'}
            </span>
          </div>
        </div>
      ) : null}
      {sourceMode === 'photo' && scanMode === 'multi' ? <div className="import-milk-meta import-multiday-range">
        <label>{language === 'rw' ? 'Kuva ku munsi (si ngombwa)' : 'From day (optional)'}<input type="number" min="1" max="31" inputMode="numeric" placeholder="20" value={multiFromDay} onChange={(event) => setMultiFromDay(event.target.value)} /></label>
        <label>{language === 'rw' ? 'Kugeza ku munsi (si ngombwa)' : 'To day (optional)'}<input type="number" min="1" max="31" inputMode="numeric" placeholder="24" value={multiToDay} onChange={(event) => setMultiToDay(event.target.value)} /></label>
        <p className="muted-note">{language === 'rw'
          ? 'Siga ubusa kugira ngo ufate iminsi yose igaragara. Buri munsi uzabikwa ku itariki iri mu nkingi y ikayi, ntabwo ari itariki y ifoto.'
          : 'Leave blank to select all visible days. Each day is saved under the date printed on the register column, never the scan date.'}</p>
      </div> : null}
      <div className="import-source-tabs" role="tablist" aria-label={t('sourceTitle')}>
        <button type="button" role="tab" aria-selected={sourceMode === 'photo'} className={sourceMode === 'photo' ? 'active' : ''} onClick={() => setSourceMode('photo')}><ImageIcon size={16} />{t('photoTab')}</button>
        <button type="button" role="tab" aria-selected={sourceMode === 'paste'} className={sourceMode === 'paste' ? 'active' : ''} onClick={() => setSourceMode('paste')}>{t('pasteTab')}</button>
      </div>
      {sourceMode === 'photo' ? <section
        className={`import-source-card ${dragOver ? 'import-drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files || []);
          if (dropped.length) selectFiles(dropped);
        }}
      >
        <p className="import-format-lead" style={{ fontWeight: 600, marginBottom: 8 }}>
          {language === 'rw'
            ? "Shyiramo ifoto (JPG/PNG), dosiye ya PDF, cyangwa Excel (.xlsx) y'ikayi y'amata."
            : "Upload photo (JPG/PNG), PDF document, or Excel (.xlsx) register."}
        </p>

        <div className="import-source-actions">
          <label className="import-file-button">
            <Upload size={18} aria-hidden="true" />
            <span>{selectedFiles.length ? t('changeFile') : t('chooseFile')}</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv,.txt,image/*,application/pdf"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.currentTarget.value = '';
                selectFiles(files);
              }}
              disabled={busy}
            />
          </label>
          <label className="button button-secondary import-camera-button">
            <Camera size={18} aria-hidden="true" />
            <span>{t('takePhoto')}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.currentTarget.value = '';
                selectFiles(files);
              }}
              disabled={busy}
            />
          </label>
        </div>

        {selectedFiles.length > 0 ? (
          <div className="import-selected-files-list" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="import-file-pill" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#f1f5f9', borderRadius: 6, fontSize: '0.85rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSpreadsheetFile(file) ? <FileSpreadsheet size={16} /> : isPdfFile(file) ? <FileText size={16} /> : <ImageIcon size={16} />}
                  <strong>{file.name}</strong> <small className="text-muted">({(file.size / 1024).toFixed(1)} KB)</small>
                </span>
                <button type="button" className="text-button" onClick={() => removeFile(idx)} style={{ cursor: 'pointer', color: '#64748b' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {selectedFiles.length >= 2 && selectedFiles.every(isImageFile) ? (
              <small className="text-success" style={{ fontWeight: 500, color: '#16a34a' }}>
                {language === 'rw'
                  ? `Mafoto ${selectedFiles.length} yatoranyijwe (Amapaji azahuzwa mu buryo bwikora: Umunsi 1-15 & 16-30).`
                  : `${selectedFiles.length} photos selected (Pages will be stitched automatically: Days 1-15 & 16-30).`}
              </small>
            ) : null}
          </div>
        ) : null}

        {previewUrl ? <div className="import-photo-preview"><img src={previewUrl} alt="" /></div> : null}
        <p className="muted-note">{t('photoHint')}</p>
        {ocrConfigured === false && !isDocFile ? <ImportNotice tone="warning">{t('ocrNotConfigured')} {t('ocrSetup')}{ocrSetup.length ? <code>{ocrSetup.join(' / ')}</code> : null}</ImportNotice> : null}
        <p className="muted-note">{t('scanHint')}</p>
        <div className="import-actions">
          <button type="button" className="button button-primary" onClick={scanNotebook} disabled={scanDisabled}>
            <ImageIcon size={16} aria-hidden="true" />
            {busy
              ? busyLabel
              : selectedFiles.length >= 2 && selectedFiles.every(isImageFile)
              ? (language === 'rw' ? `Guhuza no Gusoma Amapaji (${selectedFiles.length})` : `Stitch & Scan Pages (${selectedFiles.length})`)
              : isDocFile
              ? (language === 'rw' ? 'Gusoma Dosiye' : 'Extract Document')
              : t('scanPage')}
          </button>
          {busy ? <button type="button" className="button button-secondary" onClick={() => abortRef.current?.abort()}>{t('cancel')}</button> : null}
        </div>
        {ocrConfigured === false && !isDocFile ? <p className="muted-note">{t('sourceHint')}</p> : null}
      </section> : <section className="import-source-card">
        <label className="import-textarea-label">{t('pasteTab')}<textarea rows={10} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={language === 'rw' ? 'Izina, Ijoro, Nimugoroba' : 'Name, Morning, Evening'} /></label>
        <p className="muted-note">{t('pasteMilkHint')}</p>
        <div className="import-actions"><button type="button" className="button button-primary" onClick={parsePaste} disabled={busy || !pasteText.trim() || farmersLoading || Boolean(farmersError)}>{t('readList')}</button></div>
      </section>}
      <ImportNotice tone="info">{t('milkModeNote')}</ImportNotice>
    </div> : null}

    {step === 1 && !multiDay ? <div className="import-review">
      {saveRunning ? <ImportProgress value={savedProcessed} max={saveTotal} label={t('progress', { done: savedProcessed, total: saveTotal })} /> : null}

      {checksum && (checksum.checksumLiters || checksum.checksumGross || checksum.checksumNet) ? (
        <div className="import-checksum-banner" style={{
          padding: '10px 14px',
          background: '#f8fafc',
          borderRadius: 6,
          marginBottom: 12,
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          fontSize: '0.875rem'
        }}>
          <strong>{language === 'rw' ? "Igiteranyo cy'inyandiko (TOTAL)" : "Document Summary Total"}:</strong>
          {checksum.checksumLiters ? (
            <span>
              {language === 'rw' ? 'Litiro' : 'Liters'}: <b>{checksum.checksumLiters} L</b>
              <span style={{ marginLeft: 8, color: Math.abs(totalIncludedLiters - checksum.checksumLiters) < 0.01 ? '#16a34a' : '#d97706' }}>
                ({language === 'rw' ? 'Imirongo yose' : 'Row sum'}: <b>{Math.round(totalIncludedLiters * 100) / 100} L</b>)
              </span>
            </span>
          ) : null}
          {checksum.checksumGross ? <span>{language === 'rw' ? 'Amafaranga Yose' : 'Gross'}: <b>{checksum.checksumGross}</b></span> : null}
          {checksum.checksumNet ? <span>{language === 'rw' ? 'Asigaye' : 'Net'}: <b>{checksum.checksumNet}</b></span> : null}
          <span className="badge badge-success" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={14} /> {language === 'rw' ? "Byakuwemo mu makuru y'amata" : 'Summary row excluded'}
          </span>
        </div>
      ) : null}

      {/* Detected Date Columns Pill Bar */}
      {detectedDateColumns.length > 0 ? (
        <div className="import-date-pills-bar" role="region" aria-label={t('detectedDateColumns')}>
          <span className="muted-note"><strong>{t('detectedDateColumns')}:</strong></span>
          {detectedDateColumns.map((col) => (
            <button
              key={`${col.raw}-${col.x}`}
              type="button"
              className={`import-date-pill ${selectedColumnDate === col.isoDate ? 'active' : ''}`}
              onClick={() => switchDateColumn(col)}
              disabled={saveRunning}
            >
              <span>{col.raw}</span>
              <small>({col.isoDate})</small>
            </button>
          ))}
        </div>
      ) : null}

      {/* Authoritative Business Date Display and Warning */}
      <div className="import-review-meta">
        <label className="import-business-date-control">
          <span>{t('businessDate')}: </span>
          <input
            type="date"
            value={businessDate}
            onChange={(event) => handleBusinessDateChange(event.target.value)}
            disabled={saveRunning}
          />
        </label>
        <span>{t('session')}: <b>{t(session)}</b></span>
      </div>

      {dateDetectionUncertain ? (
        <ImportNotice tone="warning" role="alert">
          {t('dateDetectionUncertain')}
        </ImportNotice>
      ) : null}

      <div className="import-review-toolbar">
        <div className="import-counts">
          <span><b>{counts.total}</b> {t('allRows')}</span>
          <span className="ok"><b>{counts.matched}</b> {t('matched')}</span>
          {counts.review ? <span className="warn"><b>{counts.review}</b> {t('reviewBadge')}</span> : null}
          {counts.needsMatch ? <span className="warn"><b>{counts.needsMatch}</b> {t('needsMatch')}</span> : null}
          {counts.duplicate ? <span className="danger"><b>{counts.duplicate}</b> {t('duplicate')}</span> : null}
        </div>
        <div className="import-review-toolbar-actions">
          <label className="import-check"><input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />{t('filterIssues')}</label>
          <button type="button" className="button button-secondary small-button" onClick={addManualRow} disabled={saveRunning}><Plus size={14} />{t('addManualRow')}</button>
        </div>
      </div>

      {/* Review Table conforming to specification: # | Farmer (Matched Name & #Number) | Date (DD/MM/YYYY) | Session | Litres | Status */}
      <div className="table-scroll import-review-table import-milk-table"><table>
        <thead>
          <tr>
            <th style={{ width: 50 }}>#</th>
            <th>{language === 'rw' ? 'Umworozi (Izina & #Nimero)' : 'Farmer (Matched Name & #Number)'}</th>
            <th>{language === 'rw' ? 'Itariki (DD/MM/YYYY)' : 'Date (DD/MM/YYYY)'}</th>
            <th>{t('session')}</th>
            <th>{t('litres')}</th>
            <th>{t('status')}</th>
          </tr>
        </thead>
        <tbody>{visibleRows.map((row) => {
          const farmer = row.farmerId ? farmerById.get(Number(row.farmerId)) : null;
          return <tr key={row.uid} className={row.status === 'duplicate' ? 'import-row-blocked' : row.status === 'review' || row.status === 'needsMatch' ? 'import-row-warning' : ''}>
            <td>
              <label className="import-row-number-label">
                <input
                  type="checkbox"
                  aria-label={`${t('include')} ${row.rowNumber}`}
                  checked={row.include}
                  disabled={saveRunning}
                  onChange={(event) => updateRow(row.uid, { include: event.target.checked, verified: event.target.checked ? false : row.verified })}
                />
                <span>{row.rowNumber}</span>
              </label>
            </td>
            <td className="import-ocr-name">
              <div className="farmer-match-cell">
                {farmer ? (
                  <div className="matched-farmer-info">
                    <b>{farmer.name} <span className="farmer-badge-id">#{farmer.id}</span></b>
                    {row.nameText && row.nameText !== farmer.name ? <small>OCR: {row.nameText}</small> : null}
                  </div>
                ) : (
                  <div className="unmatched-farmer-info">
                    <b>{row.nameText || '—'}</b>
                    {row.rawText && row.rawText !== row.nameText ? <small title={row.rawText}>{row.rawText}</small> : null}
                  </div>
                )}
                <div className="farmer-select-row">
                  <select value={row.farmerId} onChange={(event) => chooseFarmer(row, event.target.value)} disabled={saveRunning}>
                    <option value="">{t('selectFarmer')}</option>
                    {farmerOptions(row).map((f) => <option key={f.id} value={f.id}>{farmerLabel(f)}</option>)}
                    {expandedFarmerRow !== row.uid ? <option value="__all__">{t('showAllFarmers')}</option> : null}
                  </select>
                  {(!row.farmerId || row.matchStatus === 'ambiguous' || row.matchStatus === 'none') ? (
                    <button
                      type="button"
                      className="button button-secondary small-button"
                      onClick={() => startInlineRegister(row)}
                      disabled={saveRunning}
                    >
                      <Plus size={12} /> {t('registerNewFarmer')}
                    </button>
                  ) : null}
                </div>
                {inlineRegisterRow === row.uid ? (
                  <div className="inline-register-box" role="region" aria-label={t('registerNewFarmer')}>
                    <strong>{t('registerNewFarmer')}</strong>
                    {regError ? <div className="text-danger small">{regError}</div> : null}
                    <div className="inline-register-grid">
                      <label>
                        <span>{t('name')}*</span>
                        <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} required />
                      </label>
                      <label>
                        <span>{t('phone')}</span>
                        <input type="tel" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="0788..." />
                      </label>
                      {centers.length > 1 ? (
                        <label>
                          <span>{t('center')}</span>
                          <select value={regCenterId} onChange={(e) => {
                            const val = e.target.value;
                            setRegCenterId(val ? Number(val) : '');
                            const found = centers.find((c) => String(c.id) === val);
                            setRegCenter(found ? found.name : '');
                          }}>
                            <option value="">{t('chooseCenter')}</option>
                            {centers.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        <span>{t('nationalId')}</span>
                        <input type="text" value={regNid} onChange={(e) => setRegNid(e.target.value)} />
                      </label>
                      <label>
                        <span>{t('accountNumber')}</span>
                        <input type="text" value={regAccount} onChange={(e) => setRegAccount(e.target.value)} />
                      </label>
                    </div>
                    <div className="inline-register-actions">
                      <button
                        type="button"
                        className="button button-primary small-button"
                        onClick={() => submitInlineRegister(row)}
                        disabled={regSaving || !regName.trim()}
                      >
                        <Check size={12} /> {regSaving ? t('savingFarmer') : t('registerNewFarmer')}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary small-button"
                        onClick={() => setInlineRegisterRow(null)}
                        disabled={regSaving}
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </td>
            <td>
              <div className="date-cell">
                <input
                  type="date"
                  value={row.businessDate || businessDate}
                  onChange={(event) => updateRow(row.uid, { businessDate: event.target.value, verified: false })}
                  disabled={saveRunning}
                />
                <small className="date-display-hint">{toDisplayDate(row.businessDate || businessDate)}</small>
              </div>
            </td>
            <td>
              <select
                value={row.session || session}
                onChange={(event) => {
                  const nextSession = event.target.value as 'morning' | 'evening';
                  updateRow(row.uid, {
                    session: nextSession,
                    morning: nextSession === 'morning' ? row.litres : '',
                    evening: nextSession === 'evening' ? row.litres : '',
                    verified: false,
                  });
                }}
                disabled={saveRunning}
              >
                <option value="morning">{t('morning')}</option>
                <option value="evening">{t('evening')}</option>
              </select>
            </td>
            <td>
              <div className="litres-cell">
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  value={row.litres}
                  onChange={(event) => {
                    const val = event.target.value;
                    const num = Number(val);
                    updateRow(row.uid, {
                      litres: val,
                      morning: (row.session || session) === 'morning' ? val : '',
                      evening: (row.session || session) === 'evening' ? val : '',
                      verified: Number.isFinite(num) && num > 0,
                    });
                  }}
                  disabled={saveRunning}
                />
                {row.quantityRaw ? <small title={row.quantityRaw}>OCR: {row.quantityRaw}</small> : null}
                {!row.verified && row.status === 'review' ? (
                  <label className="inline-confirm-check">
                    <input
                      type="checkbox"
                      checked={row.verified}
                      onChange={(e) => updateRow(row.uid, { verified: e.target.checked })}
                    />
                    <span>{t('confirmRow')}</span>
                  </label>
                ) : null}
              </div>
            </td>
            <td className="import-status-cell">
              <ImportStatus status={row.status} label={statusLabel(row)} />
              {row.detail ? <small>{row.detail}</small> : null}
              {row.matchStatus === 'ambiguous' ? <small>{t('ambiguous')}: {row.candidates.slice(0, 3).map((id) => farmerById.get(id)?.name).filter(Boolean).join(' / ')}</small> : null}
            </td>
          </tr>;
        })}</tbody>
      </table></div>

      {!visibleRows.length ? <p className="muted-note">{t('noMilkRows')}</p> : null}
      <ImportPager page={safePage} pages={totalPages} onChange={setPage} previousLabel={t('previous')} nextLabel={t('next')} />
      <ImportNotice tone="info">{t('reviewMilkHint')}</ImportNotice>

      <div className="import-confirm">
        <label className="import-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={saveRunning || blockingRows.length > 0}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {t('confirmBusinessDate')}: <b>{toDisplayDate(businessDate)}</b>
        </label>
        {blockingRows.length ? (
          <ImportNotice tone="warning">
            {blockingRows.length} {t('reviewMilkHint')} ({t('unmatched')}: {counts.needsMatch}, {t('reviewBadge')}: {counts.review})
          </ImportNotice>
        ) : null}
      </div>

      {serverResults.some((row) => row.status !== 'created') ? (
        <div className="import-results">
          <h4>{t('batchSummary')}</h4>
          <ul>
            {serverResults.filter((row) => row.status !== 'created').map((row) => (
              <li key={`${row.rowNumber}-${row.errorCode}`}>
                {t('rowNumber')} {row.rowNumber}: {row.message || row.errorCode}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div> : null}

    {step === 1 && multiDay ? (
      <div className="import-review import-multiday-review">
        {saveRunning ? (
          <ImportProgress
            value={savedProcessed}
            max={saveTotal}
            label={t('progress', { done: savedProcessed, total: saveTotal })}
          />
        ) : null}

        {checksum && (checksum.checksumLiters || checksum.checksumGross || checksum.checksumNet) ? (
          <div className="import-checksum-banner" style={{
            padding: '10px 14px',
            background: '#f8fafc',
            borderRadius: 6,
            marginBottom: 12,
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'center',
            fontSize: '0.875rem'
          }}>
            <strong>{language === 'rw' ? "Igiteranyo cy'inyandiko (TOTAL)" : "Document Summary Total"}:</strong>
            {checksum.checksumLiters ? (
              <span>
                {language === 'rw' ? 'Litiro' : 'Liters'}: <b>{checksum.checksumLiters} L</b>
                <span style={{ marginLeft: 8, color: Math.abs(totalMultiDayLiters - checksum.checksumLiters) < 0.01 ? '#16a34a' : '#d97706' }}>
                  ({language === 'rw' ? 'Imirongo yose' : 'Row sum'}: <b>{Math.round(totalMultiDayLiters * 100) / 100} L</b>)
                </span>
              </span>
            ) : null}
            {checksum.checksumGross ? <span>{language === 'rw' ? 'Amafaranga Yose' : 'Gross'}: <b>{checksum.checksumGross}</b></span> : null}
            {checksum.checksumNet ? <span>{language === 'rw' ? 'Asigaye' : 'Net'}: <b>{checksum.checksumNet}</b></span> : null}
            <span className="badge badge-success" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Check size={14} /> {language === 'rw' ? "Byakuwemo mu makuru y'amata" : 'Summary row excluded'}
            </span>
          </div>
        ) : null}

        <div className="import-date-pills-bar" role="region" aria-label={language === 'rw' ? 'Iminsi yatoranyijwe' : 'Selected days'}>
          <span className="muted-note">
            <strong>{language === 'rw' ? 'Iminsi yatoranyijwe' : 'Selected days'}:</strong>
          </span>
          {multiDates.map((d) => (
            <button
              key={d}
              type="button"
              className={`import-date-pill ${multiSelectedDates.includes(d) ? 'active' : ''}`}
              onClick={() => toggleMultiDate(d)}
              disabled={saveRunning}
            >
              <span>{toDisplayDate(d)}</span>
            </button>
          ))}
        </div>

        <div className="import-review-meta">
          <span>
            {language === 'rw' ? 'Igihe cy ikayi' : 'Register range'}: <b>{multiDateRangeLabel}</b> ({multiSelectedDates.length} {language === 'rw' ? 'iminsi' : 'days'})
          </span>
        </div>

        {dateDetectionUncertain ? (
          <ImportNotice tone="warning" role="alert">
            {t('dateDetectionUncertain')}
          </ImportNotice>
        ) : null}

        <div className="import-review-toolbar">
          <div className="import-counts">
            <span><b>{multiCounts.total}</b> {t('allRows')}</span>
            <span className="ok"><b>{multiCounts.matched}</b> {t('matched')}</span>
            {multiCounts.review ? <span className="warn"><b>{multiCounts.review}</b> {t('reviewBadge')}</span> : null}
            {multiCounts.needsMatch ? <span className="warn"><b>{multiCounts.needsMatch}</b> {t('needsMatch')}</span> : null}
            {multiCounts.invalid ? <span className="danger"><b>{multiCounts.invalid}</b> {t('invalid')}</span> : null}
          </div>
        </div>

        <MultiDayReviewMatrix
          language={language}
          t={t}
          rows={multiRows}
          assessments={multiAssessments}
          dates={multiSelectedDates}
          farmerById={farmerById}
          farmerOptions={multiFarmerOptions}
          disabled={saveRunning}
          creatingUid={creatingUid}
          createError={createError}
          onToggleInclude={(uid, inc) => updateMultiRow(uid, { include: inc })}
          onChooseFarmer={chooseMultiFarmer}
          onCreateFarmer={createMultiFarmer}
          onEditCell={editMultiCell}
          onConfirmRow={confirmMultiRow}
        />

        <div className="import-confirm">
          <label className="import-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={saveRunning || multiBlocking.length > 0}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {language === 'rw'
              ? `Emeza amatariki y ikayi (${multiDateRangeLabel}) n imirongo ${multiEntries.length} igiye kubikwa`
              : `Confirm register column dates (${multiDateRangeLabel}) and ${multiEntries.length} milk records to save`}
          </label>
          {multiBlocking.length ? (
            <ImportNotice tone="warning">
              {multiBlocking.length} {t('reviewMilkHint')} ({t('unmatched')}: {multiCounts.needsMatch}, {t('reviewBadge')}: {multiCounts.review})
            </ImportNotice>
          ) : null}
        </div>

        {serverResults.some((row) => row.status !== 'created') ? (
          <div className="import-results">
            <h4>{t('batchSummary')}</h4>
            <ul>
              {serverResults.filter((row) => row.status !== 'created').map((row) => (
                <li key={`${row.rowNumber}-${row.date}-${row.errorCode}`}>
                  {t('rowNumber')} {row.rowNumber} ({row.date}): {row.message || row.errorCode}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    ) : null}

    {step === 2 && completedSummary ? <div className="import-done">
      <div className="import-done-mark"><Check size={28} aria-hidden="true" /></div>
      <h3>{t('doneTitle')}</h3>
      <p>{t('doneBody')}</p>
      <div className="import-summary-cards">
        <div><b>{completedSummary.created}</b><span>{t('created')}</span></div>
        <div><b>{completedSummary.duplicates}</b><span>{t('duplicates')}</span></div>
        <div><b>{completedSummary.failed}</b><span>{t('failed')}</span></div>
      </div>
      {serverResults.some((row) => row.status !== 'created') ? (
        <div className="import-results">
          <h4>{t('batchSummary')}</h4>
          <ul>
            {serverResults.filter((row) => row.status !== 'created').map((row) => (
              <li key={`${row.rowNumber}-${row.errorCode}`}>
                {t('rowNumber')} {row.rowNumber}: {row.message || row.errorCode}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div> : null}
  </ImportFrame>;
}
