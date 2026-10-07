export type OfflineWrite = {
  id: number;
  ownerId: number;
  url: string;
  method: string;
  body: unknown;
  createdAt: string;
};

type NewOfflineWrite = Omit<OfflineWrite, 'id' | 'createdAt'>;

const DATABASE_NAME = 'milk-system-offline';
const STORE_NAME = 'pending-writes';

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('Offline storage is unavailable in this browser.'));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Unable to open offline storage.'));
});

export const queueOfflineWrite = async (write: NewOfflineWrite) => {
  const database = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).add({ ...write, createdAt: new Date().toISOString() });
    request.onsuccess = () => resolve(Number(request.result));
    request.onerror = () => reject(request.error || new Error('Unable to queue this entry.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
};

export const getOfflineWrites = async (): Promise<OfflineWrite[]> => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as OfflineWrite[]);
    request.onerror = () => reject(request.error || new Error('Unable to read offline entries.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
};

export const removeOfflineWrite = async (id: number) => {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error('Unable to clear synced entry.')); };
  });
};

export const flushOfflineWrites = async (ownerId: number) => {
  const queue = await getOfflineWrites();
  const ownedWrites = queue.filter((write) => write.ownerId === ownerId);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { synced: 0, remaining: ownedWrites.length };
  let synced = 0;
  for (const write of ownedWrites) {
    let response: Response;
    try {
      response = await fetch(write.url, {
        method: write.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(write.body),
      });
    } catch {
      break;
    }
    const body = await response.json().catch(() => ({}));
    const alreadyRecorded = response.status === 409 && body.code === 'DUPLICATE_MILK_RECORD';
    if (!response.ok && !alreadyRecorded) break;
    await removeOfflineWrite(write.id);
    synced += 1;
  }
  return { synced, remaining: (await getOfflineWrites()).filter((write) => write.ownerId === ownerId).length };
};
