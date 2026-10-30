'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, FileSpreadsheet, FileText, Image as ImageIcon, Upload, X } from 'lucide-react';
import { ImportFrame, ImportNotice, ImportPager, ImportProgress, ImportStatus, ImportSteps } from '@/components/imports/import-ui';
import { getImportCopy, type ImportCopyKey } from '@/lib/i18n/import-copy';
import type { PublicLanguage } from '@/lib/i18n/public-copy';
import { loadImportFarmers, postJson, type ImportFarmer } from '@/lib/imports/client-api';
import {
  IMPORT_MAX_FILE_BYTES,
  isCsvFile,
  isImageFile,
  isPdfFile,
  isSpreadsheetFile,
  prepareImageForOcr,
  readTextFile,
} from '@/lib/imports/client-files';
import { buildFarmerIndex, farmerLabel, findImportDuplicates, matchFarmer } from '@/lib/imports/farmer-matching';
import {
  defaultFieldConfig,
  resolveFieldConfig,
  enabledFields,
  requiredFields,
  assessFieldValue,
  MAX_LENGTHS,
} from '@/lib/imports/farmer-field-config';
import {
  IMPORT_TARGETS,
  interpretColumns,
  detectColumnMisalignment,
} from '@/lib/imports/semantic-mapping';
import {
  detectHeader,
  groupWordsIntoLines,
  linesToRowCells,
  parseTextRows,
  stripSummaryRows,
  SUMMARY_ROW_PATTERN,
} from '@/lib/imports/text-parsing';

type CenterOption = { id: number | string; name: string; owner_user_id?: number };
type Account = { id: number; accountType: string };

type ImportTarget = 'exclude' | 'farmerNumber' | 'name' | 'phone' | 'nationalId' | 'accountNumber' | 'collectionCenter' | 'cowType' | 'volume' | 'netPayable';

type FieldConfig = {
  key: string;
  label: { rw: string; en: string };
  column: string;
  enabled: boolean;
  required: boolean;
  sortOrder: number;
  system: boolean;
};

type CellConfidence = 'high' | 'medium' | 'low' | null;

type ColumnInterpretation = {
  index: number;
  heading: string;
  normalized: string;
  field: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  ambiguous: boolean;
  ocrConfusion: boolean;
  candidates: Array<{ field: string; confidence: string }>;
  reasons: string[];
};

type ImportRow = {
  uid: number;
  rowNumber: number;
  values: Record<string, string>;
  confidence: Record<string, CellConfidence>;
  centerId: string;
  centerText: string;
  include: boolean;
  edited: boolean;
  status: 'ready' | 'needs-review' | 'possible-duplicate' | 'duplicate' | 'invalid' | 'excluded';
  match: ReturnType<typeof matchFarmer>;
  duplicateOf: number | null;
  duplicateField: string | null;
  nameDuplicateOf: number | null;
  warnings: Array<{ field: string; code: string; message: string }>;
  detail: string;
  lockedDuplicate: boolean;
  saveOutcome?: 'created' | 'failed';
  saveErrorMessage?: string;
};

type Step = 0 | 1 | 2 | 3 | 4;

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const fileErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code?: string }).code || '');
  return '';
};

const centerIdOf = (center: CenterOption) => String(center.id);

const fieldCopyKey = (fieldKey: string): ImportCopyKey | null => {
  const map: Record<string, ImportCopyKey> = {
    name: 'name',
    phone: 'phone',
    nationalId: 'nationalId',
    accountNumber: 'accountNumber',
    collectionCenter: 'center',
    cowType: 'cowType',
  };
  return map[fieldKey] ?? null;
};

const fieldLabel = (language: PublicLanguage, fieldKey: string) => {
  if (fieldKey === 'farmerNumber') return getImportCopy(language, 'farmerNumber');
  if (fieldKey === 'volume') return language === 'rw' ? 'Litiro' : 'Volume (Liters)';
  if (fieldKey === 'netPayable') return language === 'rw' ? 'Asigaye' : 'Net payable';
  const key = fieldCopyKey(fieldKey);
  if (!key) return fieldKey;
  return getImportCopy(language, key);
};

const targetOptionLabel = (language: PublicLanguage, target: ImportTarget) => {
  if (target === 'exclude') return getImportCopy(language, 'excludeColumn');
  if (target === 'farmerNumber') return getImportCopy(language, 'farmerNumber');
  if (target === 'volume') return language === 'rw' ? 'Litiro' : 'Volume (Liters)';
  if (target === 'netPayable') return language === 'rw' ? 'Asigaye' : 'Net payable';
  return fieldLabel(language, target);
};

const STATUS_ORDER: Record<ImportRow['status'], number> = {
  invalid: 5,
  duplicate: 4,
  'needs-review': 3,
  'possible-duplicate': 2,
  ready: 1,
  excluded: 0,
};

const worseStatus = (a: ImportRow['status'], b: ImportRow['status']) =>
  STATUS_ORDER[a] >= STATUS_ORDER[b] ? a : b;

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [tableRows, setTableRows] = useState<string[][]>([]);
  // Parallel OCR confidence matrix (same shape as tableRows); null where not OCR-extracted.
  const [cellConfidence, setCellConfidence] = useState<CellConfidence[][]>([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnInterpretations, setColumnInterpretations] = useState<ColumnInterpretation[]>([]);
  // column index -> target ('' = not decided yet, 'exclude' = excluded)
  const [columnDecision, setColumnDecision] = useState<Record<number, ImportTarget | ''>>({});
  const [checksum, setChecksum] = useState<{ checksumLiters?: number | null; checksumGross?: number | null; checksumNet?: number | null } | null>(null);
  const [defaultCenterId, setDefaultCenterId] = useState(defaultFromWorkspace);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fieldConfig, setFieldConfig] = useState<FieldConfig[]>([]);
  const [draftConfig, setDraftConfig] = useState<FieldConfig[]>([]);
  const [fieldConfigLoading, setFieldConfigLoading] = useState(true);
  const [fieldConfigError, setFieldConfigError] = useState('');
  const [fieldConfigSaved, setFieldConfigSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [ocrConfigured, setOcrConfigured] = useState<boolean | null>(null);
  const [ocrSetup, setOcrSetup] = useState<string[]>([]);
  const [existingFarmers, setExistingFarmers] = useState<ImportFarmer[]>([]);
  const [existingFarmersCount, setExistingFarmersCount] = useState<number | null>(null);
  const [farmersLoading, setFarmersLoading] = useState(true);
  const [farmersError, setFarmersError] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [saveRunning, setSaveRunning] = useState(false);
  const [savedProcessed, setSavedProcessed] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [serverResults, setServerResults] = useState<Array<{ rowNumber: number; status: string; farmerId?: number; errorCode?: string; message?: string }>>([]);
  const [completedSummary, setCompletedSummary] = useState<{ created: number; failed: number; skipped: number } | null>(null);

  const uidRef = useRef(0);
  const batchKeyRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef('');
  const saveLockRef = useRef(false);

  const farmerIndex = useMemo(() => buildFarmerIndex(existingFarmers), [existingFarmers]);

  const enabledConfig = useMemo<{ key: string; enabled: boolean; required: boolean; sortOrder: number; system: boolean }[]>(
    () => enabledFields(fieldConfig),
    [fieldConfig]
  );
  const requiredConfig = useMemo<{ key: string; enabled: boolean; required: boolean; sortOrder: number; system: boolean }[]>(
    () => requiredFields(fieldConfig),
    [fieldConfig]
  );
  const reviewEnabledFields = useMemo<{ key: string; enabled: boolean; required: boolean; sortOrder: number; system: boolean }[]>(
    () => enabledConfig.filter((field: { system: boolean; key: string }) => !field.system && field.key !== 'cowType'),
    [enabledConfig]
  );

  const replacePreview = (url: string) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreviewUrl(url);
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const loadContext = useCallback(async () => {
    const controller = new AbortController();
    let active = true;
    setFarmersLoading(true);
    setFieldConfigLoading(true);
    try {
      await Promise.all([
        (async () => {
          try {
            const result = await fetch('/api/farmers/count', { credentials: 'include', signal: controller.signal });
            if (result.ok) {
              const data = await result.json();
              if (active && Number.isInteger(data.count)) setExistingFarmersCount(Number(data.count));
            }
          } catch {
            // The count is informational; the loaded list length is used as fallback.
          }
        })(),
        (async () => {
          try {
            const result = await fetch('/api/farmers/field-config', {
              credentials: 'include',
              signal: controller.signal,
            });
            if (result.ok) {
              const data = await result.json();
              if (active) setFieldConfig(resolveFieldConfig(Array.isArray(data.configurations) ? data.configurations : []));
            } else if (active) {
              setFieldConfig(resolveFieldConfig());
            }
          } catch {
            if (active) setFieldConfig(resolveFieldConfig());
          } finally {
            if (active) setFieldConfigLoading(false);
          }
        })(),
        (async () => {
          try {
            const result = await loadImportFarmers({ signal: controller.signal });
            if (!active) return;
            setExistingFarmers(result.farmers);
            setFarmersError('');
          } catch (loadError) {
            if (!active || isAbort(loadError)) return;
            setFarmersError(loadError instanceof Error ? loadError.message : t('loadError'));
          } finally {
            if (active) setFarmersLoading(false);
          }
        })(),
      ]);
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
    } finally {
      if (active) {
        setFarmersLoading(false);
        setFieldConfigLoading(false);
      }
    }
    return () => { controller.abort(); };
  }, [t]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  useEffect(() => {
    setDraftConfig(fieldConfig);
  }, [fieldConfig]);

  useEffect(() => {
    if (existingFarmersCount === null && !farmersLoading && !farmersError) {
      setExistingFarmersCount(existingFarmers.length);
    }
  }, [existingFarmersCount, farmersLoading, farmersError, existingFarmers.length]);

  const reset = () => {
    abortRef.current?.abort();
    setStep(0);
    setSourceMode('paste');
    setPasteText('');
    setSelectedFile(null);
    replacePreview('');
    setTableRows([]);
    setCellConfidence([]);
    setHasHeader(false);
    setHeaders([]);
    setColumnInterpretations([]);
    setColumnDecision({});
    setChecksum(null);
    setSelectedFiles([]);
    setDragOver(false);
    setRows([]);
    setDraftConfig(fieldConfig);
    setError('');
    setWarning('');
    setFieldConfigSaved(false);
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

  const ocrConfidenceAt = (tableRowIndex: number, columnIndex: number): CellConfidence => {
    const confidence = cellConfidence[tableRowIndex]?.[columnIndex];
    return confidence === null || confidence === undefined ? 'high' : confidence;
  };

  /**
   * Build one data-row value object from a source row using the column decision.
   * Each field receives the value of its mapped source column only. Columns
   * without a mapping contribute nothing: values are never shifted into another
   * field to fill a gap.
   */
  const mapRowValues = (sourceRow: string[], tableRowIndex: number) => {
    const values: Record<string, string> = {};
    const confidence: Record<string, CellConfidence> = {};
    const fieldToColumn = new Map<string, number>();
    for (const [columnIndex, target] of Object.entries(columnDecision)) {
      if (target && target !== 'exclude') fieldToColumn.set(target, Number(columnIndex));
    }
    for (const field of reviewEnabledFields) {
      const columnIndex = fieldToColumn.get(field.key);
      values[field.key] = columnIndex === undefined ? '' : String(sourceRow[columnIndex] ?? '').trim();
      confidence[field.key] = columnIndex === undefined ? 'high' : ocrConfidenceAt(tableRowIndex, columnIndex);
    }
    return { values, confidence };
  };

  const prepareTable = (incoming: string[][], confidenceMatrix: CellConfidence[][] = []) => {
    const clean = incoming
      .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
      .filter((row) => row.some(Boolean));
    if (!clean.length) {
      setError(t('errorNoRows'));
      return;
    }
    const detected = detectHeader(clean);
    const headerRow = detected.hasHeader ? clean[0] : [];
    const synthesized = headerRow.length
      ? headerRow
      : clean[0].map((_, index) => `${t('column')} ${index + 1}`);

    const { rows: dataRows, checksum: detectedChecksum } = stripSummaryRows(clean, synthesized);
    if (detectedChecksum) setChecksum(detectedChecksum);

    if (dataRows.length > 1000) {
      setError(`${t('errorNoRows')} ${t('rowLimitNotice')}`);
      return;
    }
    setTableRows(dataRows);
    setCellConfidence(confidenceMatrix.slice(0, dataRows.length));
    setHasHeader(detected.hasHeader);
    setHeaders(synthesized);
    const interpretations = interpretColumns(synthesized, language);
    setColumnInterpretations(interpretations as ColumnInterpretation[]);
    const decision: Record<number, ImportTarget | ''> = {};
    interpretations.forEach((interp) => {
      decision[interp.index] = (interp.confidence === 'high' || interp.confidence === 'medium') && interp.field
        ? (interp.field as ImportTarget)
        : '';
    });
    setColumnDecision(decision);
    setDraftConfig(fieldConfig);
    setStep(1);
    setPage(0);
    setError('');
    setWarning('');
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
    const filesToRead = selectedFiles.length > 0 ? selectedFiles : (selectedFile ? [selectedFile] : []);
    if (!filesToRead.length) {
      setError(t('noFile'));
      return;
    }
    const firstFile = filesToRead[0];
    setError('');
    setWarning('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      if (filesToRead.length >= 2 && filesToRead.every(isImageFile)) {
        if (ocrConfigured === false) {
          setError(t('ocrDisabled'));
          return;
        }
        const combinedTable: string[][] = [];
        const combinedConfidence: (CellConfidence | null)[][] = [];

        for (let i = 0; i < filesToRead.length; i++) {
          setBusyLabel(`${t('scanning')} (${i + 1}/${filesToRead.length})...`);
          const prepared = await prepareImageForOcr(filesToRead[i]);
          if (i === 0) replacePreview(prepared.previewUrl);
          const result = await postJson<{ text: string; words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }> }>(
            '/api/imports/ocr',
            { imageBase64: prepared.base64, mimeType: prepared.mimeType },
            controller.signal
          );
          if (!result.words?.length && !result.text) throw new Error(`${filesToRead[i].name}: ${t('errorOcr')}`);
          const lines = result.words?.length ? groupWordsIntoLines(result.words) : [];
          const rowCells = lines.length ? linesToRowCells(lines) : null;
          const table = rowCells ? rowCells.map((cells) => cells.map((cell) => cell.text)) : parseTextRows(result.text);
          const confidenceMatrix = rowCells ? rowCells.map((cells) => cells.map((cell) => cell.confidence)) : [];

          if (i === 0) {
            combinedTable.push(...table);
            combinedConfidence.push(...confidenceMatrix);
          } else {
            const hasHdr = table.length > 1 && detectHeader(table).hasHeader;
            const rowsToAdd = hasHdr ? table.slice(1) : table;
            const confToAdd = hasHdr ? confidenceMatrix.slice(1) : confidenceMatrix;
            combinedTable.push(...rowsToAdd);
            combinedConfidence.push(...confToAdd);
          }
        }
        prepareTable(combinedTable, combinedConfidence);
        if (!combinedTable.length) setError(t('errorNoRows'));
        return;
      }

      if (isImageFile(firstFile)) {
        if (ocrConfigured === false) {
          setError(t('ocrDisabled'));
          return;
        }
        setBusyLabel(t('scanning'));
        const prepared = await prepareImageForOcr(firstFile);
        replacePreview(prepared.previewUrl);
        const result = await postJson<{ text: string; words: Array<{ text: string; x: number; y: number; width: number; height: number; confidence?: number }> }>(
          '/api/imports/ocr',
          { imageBase64: prepared.base64, mimeType: prepared.mimeType },
          controller.signal
        );
        if (!result.words?.length && !result.text) throw new Error(t('errorOcr'));
        const lines = result.words?.length ? groupWordsIntoLines(result.words) : [];
        const rowCells = lines.length ? linesToRowCells(lines) : null;
        const table = rowCells ? rowCells.map((cells) => cells.map((cell) => cell.text)) : parseTextRows(result.text);
        const confidenceMatrix = rowCells ? rowCells.map((cells) => cells.map((cell) => cell.confidence)) : [];
        prepareTable(table, confidenceMatrix);
        if (!table.length) setError(t('errorNoRows'));
      } else if (isCsvFile(firstFile)) {
        if (firstFile.size > IMPORT_MAX_FILE_BYTES) throw new Error(t('fileTooLarge'));
        setBusyLabel(t('readingFile'));
        const text = await readTextFile(firstFile);
        prepareTable(parseTextRows(text));
      } else if (isSpreadsheetFile(firstFile) || isPdfFile(firstFile)) {
        if (firstFile.size > IMPORT_MAX_FILE_BYTES) throw new Error(t('fileTooLarge'));
        setBusyLabel(t('readingFile'));
        const form = new FormData();
        form.append('file', firstFile);
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
        const notices: string[] = [];
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

  const setColumnTarget = (columnIndex: number, target: ImportTarget | '') => {
    setColumnDecision((current) => ({ ...current, [columnIndex]: target }));
    setError('');
  };

  const setFieldSource = (fieldKey: string, columnIndex: number | '') => {
    setColumnDecision((current) => {
      const next = { ...current };
      for (const [column, target] of Object.entries(current)) {
        if (target === fieldKey) next[Number(column)] = '';
      }
      if (columnIndex !== '') next[Number(columnIndex)] = fieldKey as ImportTarget;
      return next;
    });
    setError('');
  };

  const mappingValid = () => {
    for (const field of requiredConfig) {
      let mapped = false;
      for (const target of Object.values(columnDecision)) {
        if (target === field.key) { mapped = true; break; }
      }
      if (!mapped) return false;
    }
    return true;
  };

  const buildRows = () => {
    if (!mappingValid()) {
      const missing = requiredConfig.filter((field: { key: string }) => !Object.values(columnDecision).includes(field.key as ImportTarget)) as { key: string }[];
      setError(`${missing.map((field) => fieldLabel(language, field.key)).join(', ')} ${t('mapRequired')}`);
      return;
    }
    const startIndex = hasHeader ? 1 : 0;
    const dataRows = tableRows.slice(startIndex);
    if (!dataRows.length) {
      setError(t('errorNoRows'));
      return;
    }
    const centerByName = new Map(availableCenters.map((center) => [center.name.trim().toLowerCase(), center]));
    const nextRows: ImportRow[] = dataRows.map((sourceRow, index) => {
      const tableRowIndex = startIndex + index;
      const rowNumber = index + 1;
      const { values, confidence } = mapRowValues(sourceRow, tableRowIndex);
      const centerText = String(values.collectionCenter || '').trim();
      const matchedCenter = centerText ? centerByName.get(centerText.toLowerCase()) : null;
      const centerId = matchedCenter ? centerIdOf(matchedCenter) : (!centerText ? defaultCenterId : '');
      return {
        uid: uidRef.current += 1,
        rowNumber,
        values,
        confidence,
        centerId,
        centerText,
        include: Boolean(values.name),
        edited: false,
        status: 'ready',
        match: { status: 'none', farmerId: null, farmer: null, candidates: [], reason: 'no-match' },
        duplicateOf: null,
        duplicateField: null,
        nameDuplicateOf: null,
        warnings: [],
        detail: '',
        lockedDuplicate: false,
      };
    });
    setRows(assessRows(nextRows));
    setServerResults([]);
    setSaveAttempted(false);
    setCompletedSummary(null);
    batchKeyRef.current = '';
    setConfirmed(false);
    setPage(0);
    setIssuesOnly(false);
    setError('');
    setStep(3);
    if (nextRows.some((row) => !row.centerId && Boolean(row.values.name))) {
      setError(t('selectCenterOption'));
    }
  };

  /**
   * Assess every row: field validation, OCR confidence, semantic cross-checks,
   * duplicates against existing farmers and within the file. No row is
   * silently dropped or corrected.
   */
  const assessRows = useCallback((inputRows: ImportRow[]): ImportRow[] => {
    const duplicateFlags = findImportDuplicates(inputRows.map((row, index) => ({
      rowNumber: row.rowNumber,
      name: row.values.name,
      nationalId: row.values.nationalId,
      accountNumber: row.values.accountNumber,
      phone: row.values.phone,
    })));
    return inputRows.map((row, index) => {
      const duplicate = duplicateFlags[index] || { duplicateOf: null, duplicateField: null, nameDuplicateOf: null };
      const match = matchFarmer({
        name: row.values.name,
        nationalId: row.values.nationalId,
        accountNumber: row.values.accountNumber,
        phone: row.values.phone,
      }, farmerIndex) as ReturnType<typeof matchFarmer>;

      const warnings: ImportRow['warnings'] = [];
      let status: ImportRow['status'] = 'ready';
      let detail = '';
      let lockedDuplicate = false;
      let duplicateOf: number | null = duplicate.duplicateOf ?? null;
      let duplicateField: string | null = duplicate.duplicateField ?? null;
      let nameDuplicateOf: number | null = duplicate.nameDuplicateOf ?? null;

      for (const field of reviewEnabledFields) {
        const value = String(row.values[field.key] ?? '').trim();
        if (!value) continue;
        const fit = assessFieldValue(field.key, value);
        for (const fitWarning of fit.warnings) {
          warnings.push({ field: field.key, code: fitWarning.code, message: fitWarning.message });
        }
        if (fit.fit === 'poor') status = worseStatus(status, 'invalid');
        else if (fit.fit === 'suspect') status = worseStatus(status, 'needs-review');
        if (row.confidence[field.key] === 'low') {
          warnings.push({ field: field.key, code: 'OCR_LOW_CONFIDENCE', message: t('ocrLowConfidence') });
          status = worseStatus(status, 'needs-review');
        }
      }

      for (const field of requiredConfig) {
        if (!String(row.values[field.key] ?? '').trim()) {
          warnings.push({ field: field.key, code: 'REQUIRED_MISSING', message: `${fieldLabel(language, field.key)}: ${t('isRequired')}` });
          status = worseStatus(status, 'invalid');
        }
      }

      const identifierDuplicate = Boolean(match.status === 'exact'
        && (match.matchedField === 'nationalId' || match.matchedField === 'accountNumber'))
        || (match.status === 'ambiguous' && match.reason === 'identifier-duplicate');
      const possibleExisting = match.status === 'exact' || match.status === 'possible' || match.status === 'ambiguous';

      if (identifierDuplicate) {
        status = 'duplicate';
        lockedDuplicate = true;
        duplicateOf = match.farmerId ?? null;
        detail = match.farmer ? `${t('existingMatch')}: ${farmerLabel(match.farmer)}`
          : match.candidates.length ? `${t('existingMatch')}: ${farmerLabel(match.candidates[0])}` : t('duplicate');
      } else if (possibleExisting) {
        status = worseStatus(status, 'possible-duplicate');
        detail = match.farmer ? `${t('possibleMatch')}: ${farmerLabel(match.farmer)}`
          : match.candidates.length ? `${t('possibleMatch')}: ${farmerLabel(match.candidates[0])}` : t('possibleMatch');
      } else if (duplicateField) {
        status = 'duplicate';
        duplicateOf = duplicate.duplicateOf ?? null;
        lockedDuplicate = duplicateField === 'nationalId' || duplicateField === 'accountNumber';
        detail = `${t('duplicate')}: ${t('rowNumber')} ${duplicateOf}`;
      } else if (nameDuplicateOf !== null) {
        status = worseStatus(status, 'possible-duplicate');
        detail = `${t('nameInFile')} ${nameDuplicateOf}`;
      }

      const base = { ...row, ...duplicate, match, duplicateOf, duplicateField, nameDuplicateOf, lockedDuplicate, detail, warnings };
      if (!row.include) return { ...base, status: 'excluded' };
      if (row.values.name && SUMMARY_ROW_PATTERN.test(row.values.name)) {
        return { ...base, include: false, status: 'excluded', detail: language === 'rw' ? 'Umurongo w\'igiteranyo wakuwemo' : 'Summary row excluded' };
      }
      return { ...base, status };
    });
  }, [enabledConfig, requiredConfig, reviewEnabledFields, farmerIndex, t]);

  const assessedRows = useMemo(() => assessRows(rows), [rows, assessRows]);

  const counts = useMemo(() => assessedRows.reduce((summary, row) => {
    summary.total += 1;
    if (row.status === 'ready') summary.ready += 1;
    else if (row.status === 'needs-review') summary.needsReview += 1;
    else if (row.status === 'possible-duplicate') summary.possible += 1;
    else if (row.status === 'duplicate') summary.duplicate += 1;
    else if (row.status === 'invalid') summary.invalid += 1;
    else summary.excluded += 1;
    return summary;
  }, { total: 0, ready: 0, needsReview: 0, possible: 0, duplicate: 0, invalid: 0, excluded: 0 }), [assessedRows]);

  const includableRows = useMemo(() => assessedRows.filter((row) =>
    row.include && row.saveOutcome !== 'created' && row.status !== 'invalid' && !row.lockedDuplicate), [assessedRows]);

  const blockingIncluded = useMemo(() => assessedRows.filter((row) =>
    row.include && row.saveOutcome !== 'created' && (row.status === 'invalid' || row.lockedDuplicate)), [assessedRows]);

  const canSave = Boolean(confirmed
    && includableRows.length
    && !blockingIncluded.length
    && !saveRunning
    && !busy
    && !farmersLoading
    && !farmersError);

  const updateRowValue = (uid: number, fieldKey: string, value: string) => {
    if (saveRunning) return;
    setConfirmed(false);
    batchKeyRef.current = '';
    setRows((current) => current.map((row) => row.uid === uid && row.saveOutcome !== 'created'
      ? { ...row, values: { ...row.values, [fieldKey]: value }, edited: true, saveErrorMessage: undefined }
      : row));
  };

  const updateRowCenter = (uid: number, centerId: string) => {
    if (saveRunning) return;
    setConfirmed(false);
    batchKeyRef.current = '';
    setRows((current) => current.map((row) => row.uid === uid && row.saveOutcome !== 'created'
      ? { ...row, centerId, saveErrorMessage: undefined }
      : row));
  };

  const updateRowCenterText = (uid: number, centerText: string) => {
    if (saveRunning) return;
    setConfirmed(false);
    batchKeyRef.current = '';
    const centerByName = new Map(availableCenters.map((center) => [center.name.trim().toLowerCase(), center]));
    const matched = centerText ? centerByName.get(centerText.trim().toLowerCase()) : null;
    setRows((current) => current.map((row) => row.uid === uid && row.saveOutcome !== 'created'
      ? { ...row, centerText, centerId: matched ? centerIdOf(matched) : (!centerText ? defaultCenterId : ''), saveErrorMessage: undefined }
      : row));
  };

  const toggleInclude = (uid: number, include: boolean) => {
    if (saveRunning) return;
    setConfirmed(false);
    batchKeyRef.current = '';
    setRows((current) => current.map((row) => row.uid === uid && row.saveOutcome !== 'created'
      ? { ...row, include }
      : row));
  };

  const misalignmentFlags = useMemo(() => detectColumnMisalignment(
    columnInterpretations.map((interp) => ({ ...interp })),
    rows.map((row) => ({ values: row.values }))
  ), [columnInterpretations, rows]);

  const steps = [t('stepSource'), t('stepUnderstand'), t('stepMapFields'), t('stepReviewRows'), t('stepImport')];

  const filteredRows = useMemo(() => assessedRows.filter((row) => !issuesOnly || (row.status !== 'ready' && row.status !== 'excluded')), [assessedRows, issuesOnly]);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const statusLabel = (row: ImportRow) => {
    if (row.status === 'ready') return t('ready');
    if (row.status === 'needs-review') return t('rowNeedsReview');
    if (row.status === 'possible-duplicate') return t('rowPossibleDuplicate');
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
    setSaveTotal(includableRows.length);
    if (!batchKeyRef.current) batchKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    abortRef.current = controller;
    const chunkSize = 50;
    const collected: Array<{ rowNumber: number; status: string; farmerId?: number; errorCode?: string; message?: string }> = [];
    let created = 0;
    let failed = 0;
    try {
      for (let offset = 0; offset < includableRows.length; offset += chunkSize) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = includableRows.slice(offset, offset + chunkSize);
        const result = await postJson<{
          created?: number;
          failed?: number;
          rows?: Array<{ rowNumber: number; status: string; farmerId?: number; errorCode?: string; message?: string }>;
          idempotent?: boolean;
        }>('/api/farmers/import', {
          batchKey: `${batchKeyRef.current}-${Math.floor(offset / chunkSize)}`,
          dryRun: false,
          rows: chunk.map((row) => {
            const rawFarmerNum = row.values.farmerNumber ? Number(String(row.values.farmerNumber).replace(/[#.\s]/g, '')) : null;
            return {
              rowNumber: row.rowNumber,
              name: row.values.name,
              phone: row.values.phone,
              nationalId: row.values.nationalId,
              accountNumber: row.values.accountNumber,
              cowType: row.values.cowType || '',
              collectionCenterId: Number(row.centerId || defaultCenterId || ''),
              ...(rawFarmerNum && Number.isSafeInteger(rawFarmerNum) && rawFarmerNum > 0 ? { farmerNumber: rawFarmerNum } : {}),
            };
          }),
        }, controller.signal);
        const chunkResults = Array.isArray(result.rows) ? result.rows : [];
        collected.push(...chunkResults);
        setServerResults([...collected]);
        created += chunkResults.filter((row) => row.status === 'created').length;
        failed += chunkResults.filter((row) => row.status !== 'created').length;
        setSavedProcessed(Math.min(includableRows.length, offset + chunk.length));
      }
      const outcomeByRow = new Map(collected.map((item) => [item.rowNumber, item]));
      setRows((current) => current.map((row) => {
        const outcome = outcomeByRow.get(row.rowNumber);
        if (!outcome) return row;
        if (outcome.status === 'created') {
          return {
            ...row,
            saveOutcome: 'created',
            saveErrorMessage: undefined,
            include: false,
          };
        }
        return {
          ...row,
          saveOutcome: 'failed',
          saveErrorMessage: outcome.message || outcome.errorCode || t('failed'),
          include: true,
        };
      }));
      if (failed > 0) {
        batchKeyRef.current = '';
        setConfirmed(false);
      }
      setCompletedSummary({ created, failed, skipped: counts.excluded + counts.invalid + counts.duplicate });
      setStep(4);
      try {
        await onCompleted();
      } catch {
        // The rows were saved; a table refresh failure must not be reported as an import failure.
      }
    } catch (saveFailure) {
      if (isAbort(saveFailure)) {
        setSaveError(`${t('cancel')}. ${t('progress', { done: savedProcessed, total: includableRows.length })}`);
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
    if (files[0]?.type.startsWith('image/')) replacePreview(URL.createObjectURL(files[0]));
    else replacePreview('');
  };

  const removeFile = (index: number) => {
    const next = selectedFiles.filter((_, i) => i !== index);
    selectFiles(next);
  };

  const selectFile = (file: File | null) => {
    selectFiles(file ? [file] : []);
  };

  // Field configuration draft handling
  const toggleDraftEnabled = (key: string) => {
    setDraftConfig((current) => current.map((field) => field.key === key ? { ...field, enabled: !field.enabled } : field));
    setFieldConfigSaved(false);
  };
  const toggleDraftRequired = (key: string) => {
    setDraftConfig((current) => current.map((field) => field.key === key ? { ...field, required: !field.required && field.enabled } : field));
    setFieldConfigSaved(false);
  };
  const changeDraftOrder = (key: string, order: number) => {
    setDraftConfig((current) => current.map((field) => field.key === key ? { ...field, sortOrder: Math.max(0, order) } : field));
    setFieldConfigSaved(false);
  };
  const saveFieldConfig = async () => {
    setSaveError('');
    try {
      const result = await fetch('/api/farmers/field-config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configurations: draftConfig.filter((field) => !field.system).map((field) => ({
            fieldKey: field.key,
            enabled: field.enabled,
            required: field.required,
            sortOrder: field.sortOrder,
          })),
        }),
      });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        throw new Error(body.message || t('errorGeneric'));
      }
      const data = await result.json();
      setFieldConfig(resolveFieldConfig(Array.isArray(data.configurations) ? data.configurations : []));
      setDraftConfig(fieldConfig);
      setFieldConfigSaved(true);
      setTimeout(() => setFieldConfigSaved(false), 3000);
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : t('errorGeneric'));
    }
  };

  return <ImportFrame
    title={t('titleFarmers')}
    eyebrow={t('sourceTitle')}
    description={t('subtitleFarmers')}
    busy={saveRunning || busy}
    onClose={onClose}
    footer={step === 1 || step === 2 ? <div className="import-footer-actions">
      <div className="import-footer-left">
        <span className="muted-note">{t('confirmHint')}</span>
      </div>
      <div className="import-footer-right">
        <button type="button" className="button button-secondary" onClick={() => setStep(0)} disabled={saveRunning}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={buildRows} disabled={!mappingValid() || saveRunning || farmersLoading || Boolean(farmersError)}>
          <Check size={16} aria-hidden="true" />{t('continueReview')}
        </button>
      </div>
    </div> : step === 3 ? <div className="import-footer-actions">
      <div className="import-footer-left">
        {saveRunning ? <button type="button" className="button button-secondary" onClick={cancelSave}>{t('cancel')}</button> : null}
        <span className="muted-note">{t('confirmHint')}</span>
      </div>
      <div className="import-footer-right">
        <button type="button" className="button button-secondary" onClick={() => setStep(2)} disabled={saveRunning}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={startSave} disabled={!canSave}>
          <Check size={16} aria-hidden="true" />{saveRunning ? t('importing') : t('importRows')}
        </button>
      </div>
    </div> : step === 4 ? <div className="import-footer-actions">
      <span className="muted-note">{t('doneBody')}</span>
      <div className="import-footer-right">
        {completedSummary && completedSummary.failed > 0 ? <button type="button" className="button button-secondary" onClick={() => { setStep(3); setIssuesOnly(false); }}>Review failed rows</button> : null}
        <button type="button" className="button button-secondary" onClick={reset}>{t('startOver')}</button>
        <button type="button" className="button button-primary" onClick={onClose}>{t('close')}</button>
      </div>
    </div> : null}
  >
    <ImportSteps steps={steps} active={step} />
    {error ? <ImportNotice tone="error" role="alert">{error}<button type="button" className="text-button import-dismiss" onClick={() => setError('')}><X size={14} /></button></ImportNotice> : null}
    {warning ? <ImportNotice tone="warning">{warning}</ImportNotice> : null}
    {saveError ? <ImportNotice tone="error" role="alert">{saveError}<button type="button" className="text-button import-dismiss" onClick={() => setSaveError('')}> <X size={14} /></button></ImportNotice> : null}
    {fieldConfigSaved ? <ImportNotice tone="success">{t('fieldConfigSaved')}</ImportNotice> : null}
    {farmersError ? <ImportNotice tone="warning" role="alert">{farmersError} <button type="button" className="text-button" onClick={() => { setFarmersLoading(true); setFarmersError(''); loadContext(); }}>{t('retry')}</button></ImportNotice> : null}
    {farmersLoading ? <p className="muted-note" role="status">{t('loadingFarmers')}</p> : <p className="muted-note" role="status">{t('farmersLoaded', { count: existingFarmersCount ?? existingFarmers.length })}{existingFarmersCount === null ? ` ${t('showingFirstFarmers', { count: 1500 })}` : ''}</p>}

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
      </section> : <section
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
        <div className="import-file-picker">
          <label className="import-file-button">
            <Upload size={18} aria-hidden="true" />
            <span>{selectedFiles.length ? t('changeFile') : t('chooseFile')}</span>
            <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls,.csv,.txt,image/*,application/pdf" multiple onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.currentTarget.value = '';
              selectFiles(files);
            }} disabled={busy} />
          </label>
          <label className="button button-secondary import-camera-button">
            <Camera size={18} aria-hidden="true" />
            <span>{t('takePhoto')}</span>
            <input type="file" accept="image/*" capture="environment" multiple onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.currentTarget.value = '';
              selectFiles(files);
            }} disabled={busy} />
          </label>
        </div>

        {selectedFiles.length > 0 ? (
          <div className="import-selected-files-list" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="import-file-pill" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#f1f5f9', borderRadius: 6, fontSize: '0.85rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isSpreadsheetFile(file) ? <FileSpreadsheet size={16} /> : isImageFile(file) ? <ImageIcon size={16} /> : <FileText size={16} />}
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
                  ? `Mafoto ${selectedFiles.length} yatoranyijwe (Amapaji azahuzwa mu buryo bwikora).`
                  : `${selectedFiles.length} photos selected (Pages will be scanned and combined automatically).`}
              </small>
            ) : null}
          </div>
        ) : null}

        {previewUrl ? <div className="import-photo-preview"><img src={previewUrl} alt="" /></div> : null}
        <p className="muted-note">
          {language === 'rw'
            ? "Shyiramo ifoto (JPG/PNG), dosiye ya PDF, cyangwa Excel (.xlsx) y'urutonde rw'aborozi."
            : "Upload photo (JPG/PNG), PDF document, or Excel spreadsheet (.xlsx) of farmers."}
        </p>
        <p className="muted-note">{isImageFile(selectedFile) ? t('photoHint') : t('fileHint')}</p>
        {isImageFile(selectedFile) && ocrConfigured === false ? <ImportNotice tone="warning">{t('ocrNotConfigured')} {t('ocrSetup')}{ocrSetup.length ? <code>{ocrSetup.join(' / ')}</code> : null}</ImportNotice> : null}
        <div className="import-actions">
          <button type="button" className="button button-primary" onClick={handleFileRead} disabled={busy || !selectedFile || (isImageFile(selectedFile) && ocrConfigured === false) || farmersLoading || Boolean(farmersError)}>
            {isImageFile(selectedFile) ? <ImageIcon size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            {busy
              ? busyLabel
              : selectedFiles.length >= 2 && selectedFiles.every(isImageFile)
              ? (language === 'rw' ? `Gusoma Amapaji Yose (${selectedFiles.length})` : `Scan All Pages (${selectedFiles.length})`)
              : isImageFile(selectedFile)
              ? t('scanPage')
              : t('readList')}
          </button>
          {busy ? <button type="button" className="button button-secondary" onClick={() => abortRef.current?.abort()}>{t('cancel')}</button> : null}
        </div>
      </section>}
      <ImportNotice tone="info">{t('farmersModeNote')}</ImportNotice>
    </div> : null}

    {step === 1 ? <div className="import-map">
      <div className="import-map-heading"><div><h3>{t('detectedColumns')}</h3><p className="muted-note">{t('mapHint')}</p></div></div>
      {misalignmentFlags.length ? <ImportNotice tone="warning">{t('possibleColumnMismatch')} {t('mismatchNotice')} <button type="button" className="text-button" onClick={() => setStep(2)}>{t('reviewColumnMapping')}</button></ImportNotice> : null}
      <div className="table-scroll import-preview-table"><table><thead><tr>
        <th>{t('columnHeading')}</th><th>{t('targetField')}</th><th>{t('confidenceLevel')}</th><th>{t('sample')}</th>
      </tr></thead><tbody>
        {columnInterpretations.map((interp) => {
          const decided = columnDecision[interp.index];
          const sampleValues = tableRows.slice(hasHeader ? 1 : 0)
            .map((row) => String(row[interp.index] ?? '').trim())
            .filter(Boolean)
            .slice(0, 3);
          return <tr key={interp.index}>
            <td>{interp.heading || `${t('column')} ${interp.index + 1}`}</td>
            <td>
              <select value={decided ?? ''} onChange={(event) => setColumnTarget(interp.index, (event.target.value as ImportTarget | ''))}>
                <option value="">{t('notDecided')}</option>
                {IMPORT_TARGETS.filter((target) => target.key !== 'cowType').map((target) => <option key={target.key} value={target.key}>{targetOptionLabel(language, target.key as ImportTarget)}</option>)}
              </select>
              {decided === 'exclude' ? <span className="muted-note"> · {t('notFarmerField')}</span> : null}
            </td>
            <td><span className={`conf conf-${interp.confidence}`}>{interp.confidence}</span>
              {interp.ocrConfusion ? <span className="muted-note"> · OCR</span> : null}
              {interp.ambiguous ? <span className="muted-note"> · {t('ambiguous')}</span> : null}
            </td>
            <td className="muted-note import-sample">{sampleValues.length ? sampleValues.join(' · ') : '—'}</td>
          </tr>;
        })}
      </tbody></table></div>
      {availableCenters.length > 1 ? <div className="import-map-extra"><label>{t('defaultCenter')}<select value={defaultCenterId} onChange={(event) => setDefaultCenterId(event.target.value)}><option value="">{t('chooseCenter')}</option>{availableCenters.map((center) => <option key={center.id} value={centerIdOf(center)}>{center.name}</option>)}</select></label></div> : null}
      <p className="muted-note">{t('noFieldNote')}</p>
      <div className="import-footer-actions import-inline-actions">
        <button type="button" className="button button-secondary" onClick={() => setStep(0)}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={buildRows} disabled={!mappingValid() || saveRunning || farmersLoading || Boolean(farmersError)}>{t('continueReview')}</button>
      </div>
    </div> : null}

    {step === 2 ? <div className="import-map">
      <div className="import-map-heading"><div><h3>{t('stepMapFields')}</h3><p className="muted-note">{t('mapHint')}</p></div></div>
      {misalignmentFlags.length ? <ImportNotice tone="warning">{t('possibleColumnMismatch')} {t('mismatchNotice')}</ImportNotice> : null}
      <div className="import-map-grid">
        {reviewEnabledFields.map((field) => {
          const sourceColumn = Number(Object.entries(columnDecision).find(([, target]) => target === field.key)?.[0] || -1);
          const header = sourceColumn >= 0 ? (headers[sourceColumn] || `${t('column')} ${sourceColumn + 1}`) : '';
          return <label key={field.key} className="import-field-row">
            <span>{fieldLabel(language, field.key)}{field.required ? ' *' : ''}</span>
            <select value={sourceColumn >= 0 ? String(sourceColumn) : ''} onChange={(event) => setFieldSource(field.key, event.target.value === '' ? '' : Number(event.target.value))}>
              <option value="">{t('notPresent')}</option>
              {columnInterpretations.map((interp) => <option key={interp.index} value={interp.index}>{interp.heading || `${t('column')} ${interp.index + 1}`}</option>)}
            </select>
            <span className="muted-note">{header}</span>
          </label>;
        })}
        <label className="import-field-row">
          <span>{fieldLabel(language, 'farmerNumber')}</span>
          <span className="muted-note">{t('noFieldNote')}</span>
        </label>
      </div>
      <div className="import-map-extra">
        <h4>{t('excludedColumnsLabel')}</h4>
        <p className="muted-note">{t('excludedColumnsNotice')}</p>
        <ul>
          {columnInterpretations.filter((interp) => columnDecision[interp.index] === 'exclude').map((interp) => <li key={interp.index}>{interp.heading || `${t('column')} ${interp.index + 1}`}</li>)}
        </ul>
      </div>
      <div className="import-map-extra">
        <h4>{t('fieldConfigurationTitle')}</h4>
        <p className="muted-note">{t('configureFields')}</p>
        {fieldConfigLoading ? <p className="muted-note">{t('loadingFarmers')}</p> : null}
        <table className="import-config-table">
          <thead><tr><th>{t('fieldLabel')}</th><th>{t('enabledLabel')}</th><th>{t('requiredLabel')}</th><th>{t('orderLabel')}</th></tr></thead>
          <tbody>
            {draftConfig.filter((field) => !field.system && field.key !== 'cowType').map((field) => <tr key={field.key}>
              <td>{fieldLabel(language, field.key)}</td>
              <td><label className="import-check"><input type="checkbox" checked={field.enabled} onChange={() => toggleDraftEnabled(field.key)} />{field.enabled ? t('enabledLabel') : t('notRequired')}</label></td>
              <td><label className="import-check"><input type="checkbox" checked={field.required} onChange={() => toggleDraftRequired(field.key)} disabled={!field.enabled} />{field.required ? t('requiredLabel') : t('notRequired')}</label></td>
              <td><input type="number" min="0" value={field.sortOrder} onChange={(event) => changeDraftOrder(field.key, Number(event.target.value || 0))} /></td>
            </tr>)}
          </tbody>
        </table>
        {fieldConfigError ? <p className="muted-note">{fieldConfigError}</p> : null}
        <div className="import-actions" style={{ marginTop: 8 }}>
          <button type="button" className="button button-primary" onClick={saveFieldConfig} disabled={fieldConfigLoading}>{t('saveFieldConfig')}</button>
          
        </div>
      </div>
      <div className="import-footer-actions import-inline-actions">
        <button type="button" className="button button-secondary" onClick={() => setStep(1)}>{t('backToSource')}</button>
        <button type="button" className="button button-primary" onClick={buildRows} disabled={!mappingValid() || saveRunning || farmersLoading || Boolean(farmersError)}>{t('continueReview')}</button>
      </div>
    </div> : null}

    {step === 3 ? <div className="import-review">
      {saveRunning ? <ImportProgress value={savedProcessed} max={saveTotal} label={t('progress', { done: savedProcessed, total: saveTotal })} /> : null}
      {saveAttempted && !saveRunning && (saveError || (completedSummary && completedSummary.failed > 0)) ? <ImportNotice tone="warning">{t('reviewHint')} You can correct and retry failed rows in this session.</ImportNotice> : null}
      {checksum && (checksum.checksumLiters || checksum.checksumGross || checksum.checksumNet) ? (
        <div className="import-checksum-banner" style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 6, marginBottom: 12, border: '1px solid #e2e8f0', display: 'flex', gap: 16, alignItems: 'center', fontSize: '0.875rem' }}>
          <strong>{language === 'rw' ? "Igiteranyo cy'inyandiko (TOTAL)" : "Document Summary Total"}:</strong>
          {checksum.checksumLiters ? <span>{language === 'rw' ? 'Litiro' : 'Liters'}: <b>{checksum.checksumLiters}</b></span> : null}
          {checksum.checksumGross ? <span>{language === 'rw' ? 'Amafaranga Yose' : 'Gross'}: <b>{checksum.checksumGross}</b></span> : null}
          {checksum.checksumNet ? <span>{language === 'rw' ? 'Asigaye' : 'Net'}: <b>{checksum.checksumNet}</b></span> : null}
          <span className="badge badge-success" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={14} /> {language === 'rw' ? 'Byakuwemo mu borozi' : 'Excluded from farmers'}
          </span>
        </div>
      ) : null}
      <div className="import-review-toolbar">
        <div className="import-counts">
          <span><b>{counts.total}</b> {t('allRows')}</span>
          <span className="ok"><b>{counts.ready}</b> {t('ready')}</span>
          {counts.needsReview ? <span className="warn"><b>{counts.needsReview}</b> {t('rowNeedsReview')}</span> : null}
          {counts.possible ? <span className="warn"><b>{counts.possible}</b> {t('rowPossibleDuplicate')}</span> : null}
          {counts.duplicate ? <span className="danger"><b>{counts.duplicate}</b> {t('duplicate')}</span> : null}
          {counts.invalid ? <span className="danger"><b>{counts.invalid}</b> {t('invalid')}</span> : null}
          {counts.excluded ? <span><b>{counts.excluded}</b> {t('excluded')}</span> : null}
        </div>
        <label className="import-check"><input type="checkbox" checked={issuesOnly} onChange={(event) => { setIssuesOnly(event.target.checked); setPage(0); }} />{t('filterIssues')}</label>
      </div>
      <div className="table-scroll import-review-table"><table>
        <thead><tr><th>{t('include')}</th><th>{t('rowNumber')}</th>
          {reviewEnabledFields.map((field) => <th key={field.key}>{fieldLabel(language, field.key)}{field.required ? ' *' : ''}</th>)}
          <th>{t('center')}</th><th>{t('status')}</th><th>{t('actions')}</th>
        </tr></thead>
        <tbody>
          {visibleRows.map((row) => <tr key={row.uid} className={row.status === 'duplicate' || row.status === 'invalid' ? 'import-row-blocked' : row.status === 'needs-review' || row.status === 'possible-duplicate' ? 'import-row-warning' : ''}>
            <td><input type="checkbox" aria-label={`${t('include')} ${row.rowNumber}`} checked={row.include}
              disabled={saveRunning || row.saveOutcome === 'created' || row.status === 'invalid' || row.lockedDuplicate}
              onChange={(event) => toggleInclude(row.uid, event.target.checked)} /></td>
            <td>{row.rowNumber}</td>
            {reviewEnabledFields.map((field) => <td key={field.key}>
              <input value={row.values[field.key] ?? ''} maxLength={MAX_LENGTHS[field.key as keyof typeof MAX_LENGTHS] || 255}
                disabled={saveRunning || row.saveOutcome === 'created'}
                onChange={(event) => updateRowValue(row.uid, field.key, event.target.value)} />
              {row.warnings.filter((w) => w.field === field.key).map((w) => <div key={w.code} className="import-field-warning">{w.message}</div>)}
            </td>)}
            <td>
              {availableCenters.length > 1 ? (
                <select value={row.centerId} disabled={saveRunning || row.saveOutcome === 'created' || !availableCenters.length} onChange={(event) => updateRowCenter(row.uid, event.target.value)}>
                  <option value="">{t('selectCenterOption')}</option>
                  {availableCenters.map((center) => <option key={center.id} value={centerIdOf(center)}>{center.name}</option>)}
                </select>
              ) : (
                <span>{availableCenters[0]?.name || row.centerText || '—'}</span>
              )}
            </td>
            <td className="import-status-cell"><ImportStatus status={row.status} label={statusLabel(row)} />
              {row.detail ? <small>{row.detail}</small> : null}
              {row.saveErrorMessage ? <small className="import-field-warning">{row.saveErrorMessage}</small> : null}
              {row.status === 'possible-duplicate' ? <small>{t('include')} / {t('excludeRow')}: {t('possibleMatch')}</small> : null}
            </td>
            <td>
              {row.saveOutcome === 'created' ? <span className="muted-note">{t('created')}</span>
               : row.status === 'excluded' ? <span className="muted-note">{t('excluded')}</span>
               : row.status === 'invalid' || row.lockedDuplicate ? <span className="muted-note">{t('fixAndRetry')}</span>
               : <button type="button" className="text-button" onClick={() => toggleInclude(row.uid, false)}>{t('excludeRow')}</button>}
            </td>
          </tr>)}
        </tbody>
      </table></div>
      {!visibleRows.length ? <p className="muted-note">{t('errorNoRows')}</p> : null}
      <ImportPager page={safePage} pages={totalPages} onChange={setPage} previousLabel={t('previous')} nextLabel={t('next')} />
      <div className="import-confirm">
        <label className="import-check"><input type="checkbox" checked={confirmed} disabled={saveRunning} onChange={(event) => setConfirmed(event.target.checked)} />{t('confirmReview')}</label>
        {blockingIncluded.length ? <ImportNotice tone="warning">{t('resolveDuplicate')} {blockingIncluded.length}</ImportNotice> : null}
        {counts.invalid ? <p className="muted-note">{t('reviewHint')}</p> : null}
      </div>
      {serverResults.length && !saveRunning && saveError ? <div className="import-results"><h4>{t('batchSummary')}</h4><ul>{serverResults.filter((result) => result.status !== 'created').map((result) => <li key={`${result.rowNumber}-${result.errorCode}`}>{t('rowNumber')} {result.rowNumber}: {result.message || result.errorCode}</li>)}</ul></div> : null}
    </div> : null}

    {step === 4 && completedSummary ? <div className="import-done">
      <div className="import-done-mark"><Check size={28} aria-hidden="true" /></div>
      <h3>{t('doneTitle')}</h3>
      <p>{t('doneBody')}</p>
      <div className="import-summary-cards">
        <div><b>{completedSummary.created}</b><span>{t('created')}</span></div>
        <div><b>{completedSummary.failed}</b><span>{t('failed')}</span></div>
        <div><b>{completedSummary.skipped}</b><span>{t('skipped')}</span></div>
      </div>
      <div className="import-note">{t('keepEditable')}</div>
      {completedSummary.failed > 0 ? <div className="import-actions"><button type="button" className="button button-secondary" onClick={() => { setStep(3); setIssuesOnly(false); }}>Review failed rows</button></div> : null}
      {serverResults.some((row) => row.status !== 'created') ? <div className="import-results"><h4>{t('batchSummary')}</h4><ul>{serverResults.filter((row) => row.status !== 'created').map((row) => <li key={`${row.rowNumber}-${row.errorCode}`}>{t('rowNumber')} {row.rowNumber}: {row.message || row.errorCode}</li>)}</ul></div> : null}
    </div> : null}
  </ImportFrame>;
}
