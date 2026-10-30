'use client';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2400;

export type PreparedImage = {
  base64: string;
  mimeType: 'image/jpeg';
  previewUrl: string;
  width: number;
  height: number;
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('The image could not be prepared.'));
  reader.readAsDataURL(blob);
});

const loadImage = async (file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the <img> path for browsers without this option.
    }
  }
  const url = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('This image could not be opened.'));
    element.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
};

export async function compressImageForOcr(file: File, maxWidth = 2048, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context unavailable'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * Rotate/scale a selected photo in browser memory, then return a JPEG base64
 * payload for the OCR endpoint. No copy is written to local/session storage or
 * IndexedDB. The caller must revoke previewUrl when it is no longer shown.
 */
export const prepareImageForOcr = async (file: File): Promise<PreparedImage> => {
  if (!file.type.startsWith('image/')) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('The photo is larger than 50 MB.');
  const loaded = await loadImage(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(loaded.width, loaded.height));
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(loaded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('The photo could not be converted.');
    const dataUrl = await blobToDataUrl(blob);
    return {
      base64: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      mimeType: 'image/jpeg',
      previewUrl: URL.createObjectURL(blob),
      width,
      height,
    };
  } finally {
    loaded.close();
  }
};

export const readTextFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('The file could not be read.'));
  reader.readAsText(file);
});

export const isSpreadsheetFile = (file: File | null | undefined) => Boolean(file && /\.(xlsx|xls)$/i.test(file.name));
export const isPdfFile = (file: File | null | undefined) => Boolean(file && (/\.pdf$/i.test(file.name) || file.type === 'application/pdf'));
export const isCsvFile = (file: File | null | undefined) => Boolean(file && (/\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain'));
export const isImageFile = (file: File | null | undefined) => Boolean(file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|heic)$/i.test(file.name)));

export const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;
