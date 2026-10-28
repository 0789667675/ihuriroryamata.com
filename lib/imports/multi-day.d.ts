import type { NotebookMultiDayRow } from './notebook';

export type MultiDayCellDraft = {
  morning: string;
  evening: string;
  raw: string;
  status: string;
  verified: boolean;
};

export type MultiDayRowDraft = {
  uid: number;
  rowNumber: number;
  farmerNumber?: number | null;
  detectedPhone?: string | null;
  detectedNationalId?: string | null;
  detectedAccountNumber?: string | null;
  nameText: string;
  rawText: string;
  farmerId: string;
  candidates: number[];
  matchStatus: string;
  matchReason: string;
  include: boolean;
  days: Record<string, MultiDayCellDraft>;
};

export type MultiDayCellState = 'record' | 'empty' | 'existing' | 'review' | 'invalid';

export type MultiDayAssessment = {
  status: 'matched' | 'review' | 'needsMatch' | 'invalid' | 'excluded';
  cells: Record<string, { morning: number; evening: number; total: number; state: MultiDayCellState }>;
  totalLiters: number;
  recordCount: number;
  existingCount: number;
  blocking: boolean;
};

export type MultiDayEntry = {
  rowNumber: number;
  farmerId: number;
  date: string;
  volumeMorning: number;
  volumeEvening: number;
  ocrDetectedName: string | null;
  ocrDetectedLiters: string | null;
  confirmedLiters: number;
};

export function parseLitres(value: string): { value: number; present: boolean; invalid: boolean };
export function buildMultiDayDraftDays(extractedRow: NotebookMultiDayRow, dates: string[]): Record<string, MultiDayCellDraft>;
export function assessMultiDayRow(
  row: Pick<MultiDayRowDraft, 'farmerId' | 'include' | 'days'>,
  context: { dates: string[]; recordedByDate?: Record<string, Set<number>> }
): MultiDayAssessment;
export function buildMultiDayEntries(rows: MultiDayRowDraft[], assessments: MultiDayAssessment[]): MultiDayEntry[];
export function chunkMultiDayEntries(
  entries: MultiDayEntry[],
  batchKey: string,
  size?: number
): Array<{ batchKey: string; entries: MultiDayEntry[] }>;
