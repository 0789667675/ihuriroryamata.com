export type NotebookWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
};

export type NotebookDateColumn = {
  isoDate: string;
  raw: string;
  x: number;
  confidence: number | null;
  width?: number;
  y?: number;
};

export type NotebookEntry = {
  rowNumber: number;
  farmerNumber?: number | null;
  rawText: string;
  name: string;
  nameRaw: string;
  quantity: number | null;
  quantityRaw: string;
  morningQuantity?: number | null;
  eveningQuantity?: number | null;
  status: string;
  confidence: number | null;
  dateColumnFound: boolean;
  dateRequiresConfirmation?: boolean;
  businessDate?: string | null;
  detectedPhone?: string | null;
  detectedNationalId?: string | null;
  detectedAccountNumber?: string | null;
  x: number;
  y: number;
  words: NotebookWord[];
};

export type NotebookParsedPage = {
  entries: NotebookEntry[];
  dateColumnFound: boolean;
  headerText: string;
  lineCount: number;
  targetDate: string | null;
  businessDate: string | null;
  columnTolerance: number;
  detectedColumns: NotebookDateColumn[];
  selectedColumn: NotebookDateColumn | null;
};

export type NotebookEntriesResult = NotebookEntry[] & NotebookParsedPage;

export function detectNotebookDateColumns(
  ocrResult: { words?: NotebookWord[] } | NotebookWord[],
  referenceYearMonth?: string | { year: number; month: number } | null
): NotebookDateColumn[];

export function detectNotebookPageMonthYear(
  words: { words?: NotebookWord[] } | NotebookWord[]
): { year: number; month: number } | null;

export function extractNotebookEntries(
  ocrResult: { words?: NotebookWord[] } | NotebookWord[],
  selectedDateOrColumn?: string | NotebookDateColumn | { isoDate?: string; raw?: string; x?: number; session?: 'morning' | 'evening' } | null,
  referenceYearMonth?: string | { year: number; month: number } | null
): NotebookEntriesResult;

export function parseNotebookPage(options?: {
  words?: NotebookWord[];
  targetDate?: string | null;
  targetX?: number | null;
  selectedColumn?: NotebookDateColumn | null;
  referenceYearMonth?: string | { year: number; month: number } | null;
  session?: 'morning' | 'evening' | null;
}): NotebookParsedPage;

export function parseTargetDate(date?: string | null): { year: number; month: number; day: number } | null;

export function parseDateToken(
  text: string,
  referenceYearMonth?: string | { year: number; month: number } | null
): { year: number; month: number; day: number; isoDate: string } | null;

export function tokenMatchesDate(
  text: string,
  target?: { year: number; month: number; day: number } | null
): boolean;

export function parseQuantityToken(
  text: string,
  session?: 'morning' | 'evening' | null
): {
  value: number | null;
  status: 'ok' | 'empty' | 'unreadable' | 'not-quantity' | 'subtotal';
  raw: string;
  morningValue?: number;
  eveningValue?: number;
  ocrCorrected?: boolean;
  isZeroMarker?: boolean;
};

export function splitFarmerNumberAndName(
  firstWord: NotebookWord,
  subsequentWords?: NotebookWord[]
): {
  farmerNumber: number | null;
  nameWords: NotebookWord[];
  rawPrefix: string;
};

export function extractSublineMetadata(lineText: string): {
  phone: string | null;
  nationalId: string | null;
  accountNumber: string | null;
} | null;

export function normalizeQuantityString(str: string): string;

export function correctNumericOcrConfusion(str: string): string;
