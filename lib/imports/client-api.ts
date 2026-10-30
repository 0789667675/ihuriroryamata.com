'use client';

export type ImportFarmer = {
  id: number;
  name: string;
  phone?: string | null;
  nationalId?: string | null;
  accountNumber?: string | null;
  collectionCenter?: string | null;
  collectorUserId?: number | null;
  farmerNumber?: number | null;
};

export type PageResult<T> = {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
};

const parseError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => ({}));
  const error = Object.assign(new Error(body.message || fallback), {
    code: body.code,
    status: response.status,
    setup: body.setup,
  });
  return error;
};

export const apiJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) throw await parseError(response, 'The request failed.');
  return response.json() as Promise<T>;
};

export const loadImportFarmers = async ({ signal, cap = 1500 }: { signal?: AbortSignal; cap?: number } = {}) => {
  const farmers: ImportFarmer[] = [];
  let cursor: string | null = null;
  let truncated = false;
  let pages = 0;
  do {
    if (pages >= 30) {
      truncated = true;
      break;
    }
    pages += 1;
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await apiJson<PageResult<ImportFarmer>>(`/api/farmers?${params.toString()}`, { signal });
    const rows = Array.isArray(page.data) ? page.data : [];
    for (const farmer of rows) {
      if (farmers.length >= cap) {
        truncated = true;
        break;
      }
      farmers.push(farmer);
    }
    if (truncated) break;
    cursor = page.hasMore ? page.nextCursor : null;
  } while (cursor);
  return { farmers, truncated };
};

export const loadRecordedFarmerIds = async (date: string, signal?: AbortSignal) => {
  const recorded = new Set<number>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    if (pages >= 20) break;
    pages += 1;
    const params = new URLSearchParams({ date, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await apiJson<{
      farmers?: Array<{ farmerId: number; recordId?: number | null; status?: string }>;
      farmerPagination?: { nextCursor?: string | null; hasMore?: boolean };
    }>(`/api/milk/daily?${params.toString()}`, { signal });
    for (const row of page.farmers || []) {
      if (row.recordId && row.status !== 'cancelled') recorded.add(Number(row.farmerId));
    }
    cursor = page.farmerPagination?.hasMore ? page.farmerPagination.nextCursor || null : null;
  } while (cursor);
  return recorded;
};

export const postJson = <T>(url: string, body: unknown, signal?: AbortSignal) => apiJson<T>(url, {
  method: 'POST',
  body: JSON.stringify(body),
  signal,
});

export type ExtractResult = {
  type?: string;
  kind?: string;
  name?: string;
  rows?: string[][];
  headers?: string[];
  text?: string;
  sheetCount?: number;
  truncated?: boolean;
  checksum?: { checksumLiters?: number | null; checksumGross?: number | null; checksumNet?: number | null } | null;
};

export const extractImportDocument = async (file: File, signal?: AbortSignal): Promise<ExtractResult> => {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/imports/extract', {
    method: 'POST',
    credentials: 'include',
    body: form,
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error(payload.message || 'The file could not be read.'), {
      code: payload.code,
      status: response.status,
    });
    throw error;
  }
  return payload as ExtractResult;
};
