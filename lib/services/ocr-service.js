const crypto = require('node:crypto');
const fs = require('node:fs');

const PROVIDER_KEY = 'GOOGLE_VISION_API_KEY';
const PROVIDER_SA_JSON = 'GOOGLE_VISION_SERVICE_ACCOUNT_JSON';
const PROVIDER_SA_BASE64 = 'GOOGLE_VISION_SERVICE_ACCOUNT_BASE64';
const PROVIDER_SA_FILE = 'GOOGLE_APPLICATION_CREDENTIALS';
const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

let cachedToken = null;

const providerFetch = async (url, init, timeoutMs) => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    const error = new Error('The OCR provider is unavailable. Try again in a moment.');
    error.code = 'OCR_PROVIDER_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  }
};

const readServiceAccount = () => {
  const direct = process.env[PROVIDER_SA_JSON];
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      // The base64 variant below is the supported fallback.
    }
  }
  const encoded = process.env[PROVIDER_SA_BASE64];
  if (encoded) {
    try {
      return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
  const filePath = process.env[PROVIDER_SA_FILE];
  if (filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
};

const getOcrConfiguration = () => {
  const apiKey = String(process.env[PROVIDER_KEY] || '').trim();
  if (apiKey) return { configured: true, provider: 'google-cloud-vision', auth: 'api-key' };
  const serviceAccount = readServiceAccount();
  if (serviceAccount?.client_email && serviceAccount?.private_key) {
    return { configured: true, provider: 'google-cloud-vision', auth: 'service-account' };
  }
  return {
    configured: false,
    provider: 'google-cloud-vision',
    auth: null,
    setup: [PROVIDER_KEY, `${PROVIDER_SA_JSON} (or ${PROVIDER_SA_BASE64})`],
  };
};

const base64url = (value) => Buffer.from(value).toString('base64url');

const getAccessToken = async (serviceAccount) => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${header}.${payload}.${base64url(signature)}`;
  const response = await providerFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }, 15_000);
  const payloadJson = await response.json().catch(() => ({}));
  if (!response.ok || !payloadJson.access_token) {
    throw Object.assign(new Error('OCR provider authentication failed.'), { code: 'OCR_AUTH_FAILED', statusCode: 503 });
  }
  cachedToken = {
    token: payloadJson.access_token,
    expiresAt: Date.now() + Number(payloadJson.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
};

const verticesBounds = (vertices) => {
  const points = (Array.isArray(vertices) ? vertices : [])
    .map((vertex) => ({ x: Number(vertex.x) || 0, y: Number(vertex.y) || 0 }));
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, Math.max(...xs) - minX),
    height: Math.max(0, Math.max(...ys) - minY),
  };
};

const extractWords = (annotation) => {
  const words = [];
  const pages = annotation?.pages || [];
  for (const page of pages) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const text = (word.symbols || []).map((symbol) => symbol.text || '').join('').trim();
          if (!text) continue;
          const bounds = verticesBounds(word.boundingBox?.vertices);
          if (!bounds) continue;
          words.push({
            text,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            confidence: Number.isFinite(Number(word.confidence)) ? Number(word.confidence) : null,
          });
        }
      }
    }
  }
  return words;
};

const callVision = async ({ base64, authHeader, apiKey }) => {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Goog-Api-Key'] = apiKey;
  else headers.Authorization = authHeader;
  const response = await providerFetch(VISION_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
      }],
    }),
  }, 25_000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = payload?.error?.message ? String(payload.error.message).slice(0, 180) : '';
    const statusCode = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 503 : 502;
    const error = new Error(statusCode === 429
      ? 'The OCR provider is busy. Wait a moment and try again.'
      : 'The OCR provider rejected the scan.');
    error.code = statusCode === 429 ? 'OCR_RATE_LIMITED' : 'OCR_PROVIDER_ERROR';
    error.statusCode = statusCode;
    if (providerMessage && process.env.NODE_ENV !== 'production') error.providerMessage = providerMessage;
    throw error;
  }
  const result = payload?.responses?.[0];
  if (result?.error) {
    const error = new Error('The OCR provider could not read this image.');
    error.code = 'OCR_PROVIDER_ERROR';
    error.statusCode = 422;
    throw error;
  }
  const annotation = result?.fullTextAnnotation;
  const words = extractWords(annotation);
  const text = String(annotation?.text || result?.textAnnotations?.[0]?.description || '').trim();
  return { text, words };
};

/**
 * Send one image to the configured OCR provider. The image lives in memory for
 * the duration of this request only; nothing is written to disk or the database.
 */
const extractTextFromImage = async ({ base64 }) => {
  const configuration = getOcrConfiguration();
  if (!configuration.configured) {
    const error = new Error('OCR is not configured on this server.');
    error.code = 'OCR_NOT_CONFIGURED';
    error.statusCode = 503;
    error.setup = configuration.setup;
    throw error;
  }
  const content = String(base64 || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
  if (!content || content.length > 10_000_000) {
    const error = new Error('The image is missing or too large.');
    error.code = 'OCR_IMAGE_INVALID';
    error.statusCode = 400;
    throw error;
  }
  if (!/^(?:\/9j\/|iVBORw0KGgo|UklGR)/.test(content)) {
    const error = new Error('Only JPEG, PNG or WebP images can be scanned.');
    error.code = 'OCR_IMAGE_INVALID';
    error.statusCode = 400;
    throw error;
  }

  let result;
  if (configuration.auth === 'api-key') {
    result = await callVision({ base64: content, apiKey: String(process.env[PROVIDER_KEY]).trim() });
  } else {
    const serviceAccount = readServiceAccount();
    if (!serviceAccount) {
      const error = new Error('OCR credentials are incomplete on this server.');
      error.code = 'OCR_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
    const token = await getAccessToken(serviceAccount);
    result = await callVision({ base64: content, authHeader: `Bearer ${token}` });
  }

  return {
    text: result.text,
    words: result.words,
    provider: 'google-cloud-vision',
  };
};

module.exports = {
  getOcrConfiguration,
  extractTextFromImage,
};
