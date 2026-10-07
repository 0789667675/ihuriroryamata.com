const { isIP } = require('node:net');

const PHONE_PATTERN = /^(?:\+?250|0)(?:78|79)\d{7}$/;
const LMBTECH_API_BASE_URL = 'https://pay.lmbtech.rw/pay/config/api';

const cleanPhone = (value) => String(value || '').replace(/[\s-]/g, '');
const canonicalPhone = (value) => {
  const clean = cleanPhone(value);
  if (!PHONE_PATTERN.test(clean)) return null;
  const digits = clean.replace(/\D/g, '');
  return digits.startsWith('0') ? `+250${digits.slice(1)}` : `+${digits}`;
};

const normalizeLmbtechBaseUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return LMBTECH_API_BASE_URL;
  try {
    const endpoint = new URL(raw.trim());
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;
    let pathname = endpoint.pathname.replace(/\/+$/, '').replace(/\.php$/i, '');
    if (!pathname || pathname === '/') pathname = '/pay/config/api';
    else if (pathname.endsWith('/pay/config')) pathname += '/api';
    else if (!pathname.endsWith('/api')) pathname += '/pay/config/api';
    return `${endpoint.origin}${pathname}`;
  } catch {
    return null;
  }
};

const normalizeLmbtechCallbackUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const callback = new URL(raw.trim());
    if (callback.protocol !== 'https:' || callback.username || callback.password) return null;
    const host = callback.hostname.toLowerCase();
    const ipHost = host.replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(ipHost)) return null;
    if (callback.pathname === '/' || callback.pathname === '') callback.pathname = '/api/subscription/payments/callback';
    if (callback.pathname !== '/api/subscription/payments/callback') return null;
    callback.search = '';
    callback.hash = '';
    return callback.toString();
  } catch {
    return null;
  }
};

const getLmbtechCredentials = () => ({
  appKey: process.env.LMBTECH_APP_KEY || null,
  secretKey: process.env.LMBTECH_SECRET_KEY || null,
  baseUrl: normalizeLmbtechBaseUrl(process.env.LMBTECH_BASE_URL),
  callbackUrl: normalizeLmbtechCallbackUrl(process.env.LMBTECH_CALLBACK_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL),
  allowRealPayments: String(process.env.LMBTECH_ALLOW_REAL_PAYMENTS || 'false').toLowerCase() === 'true',
});

const getLmbtechPublicStatus = () => {
  const credentials = getLmbtechCredentials();
  const credentialsConfigured = Boolean(credentials.appKey && credentials.secretKey);
  const callbackConfigured = Boolean(credentials.callbackUrl);
  const apiConfigured = Boolean(credentials.baseUrl);
  return {
    provider: 'mtn_momo',
    paymentMethod: 'MTN_MOMO_RWA',
    displayName: 'MTN MoMo Rwanda',
    currency: 'RWF',
    payerAccount: 'user',
    payerPhoneSource: 'users.phone',
    realPaymentsEnabled: credentials.allowRealPayments,
    credentialsConfigured,
    apiConfigured,
    callbackConfigured,
    ready: credentials.allowRealPayments && credentialsConfigured && apiConfigured && callbackConfigured,
  };
};

const assertLmbtechPaymentReady = () => {
  const credentials = getLmbtechCredentials();
  if (!credentials.allowRealPayments) throw Object.assign(new Error('Real LMBTech payments are disabled in this environment.'), { code: 'LMBTECH_PAYMENT_DISABLED' });
  if (!credentials.appKey || !credentials.secretKey) throw Object.assign(new Error('LMBTech credentials are missing.'), { code: 'LMBTECH_CREDENTIALS_MISSING' });
  if (!credentials.baseUrl) throw Object.assign(new Error('LMBTech API base URL is invalid.'), { code: 'LMBTECH_BASE_URL_INVALID' });
  if (!credentials.callbackUrl) throw Object.assign(new Error('A public HTTPS payment callback URL is required.'), { code: 'LMBTECH_CALLBACK_URL_MISSING' });
};

const normalizeLmbtechStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'success') return 'SUCCESS';
  if (status === 'failed' || status === 'fail') return 'FAILED';
  if (status === 'cancelled' || status === 'canceled') return 'CANCELLED';
  if (status === 'expired') return 'EXPIRED';
  if (status === 'pending') return 'PENDING';
  return 'UNKNOWN';
};

const resolveCallbackStatus = (payload = {}) => normalizeLmbtechStatus(
  typeof payload === 'string'
    ? payload
    : payload.status
);

const findCallbackReference = (payload = {}) => payload.reference_id || null;

const verifyCallbackPayload = (body = {}) => {
  const payload = body && typeof body === 'object' ? body : {};
    const missing = ['reference_id', 'transaction_id', 'status', 'amount', 'payment_method']
      .filter((field) => payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === '');
  if (missing.length) return { valid: false, reason: `Missing required callback fields: ${missing.join(', ')}.` };
  if (normalizeLmbtechStatus(payload.status) === 'UNKNOWN') return { valid: false, reason: `Unsupported callback status: ${payload.status}.` };
  if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) return { valid: false, reason: 'Callback amount must be a positive number.' };
  if (String(payload.payment_method).trim().toUpperCase() !== 'MTN_MOMO_RWA') return { valid: false, reason: 'Callback payment method is not MTN_MOMO_RWA.' };
  if (!canonicalPhone(payload.payer_phone)) return { valid: false, reason: 'Callback payer phone is invalid.' };
  return { valid: true };
};

const tryJson = async (response) => {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { raw }; }
};

class LmbtechProvider {
  constructor(fetchImplementation = globalThis.fetch) {
    this.fetch = fetchImplementation;
    this.name = 'mtn_momo';
  }

  assertReady() { assertLmbtechPaymentReady(); }

  async createPaymentRequest({ paymentId, userId, referenceId, phoneNumber, amount, currency, userEmail, userName }) {
    this.assertReady();
    const credentials = getLmbtechCredentials();
    const phone = canonicalPhone(phoneNumber);
      if (!phone) throw Object.assign(new Error('A valid Rwanda MTN mobile number is required.'), { code: 'INVALID_PHONE_NUMBER' });
      if (!userEmail || !userName) throw Object.assign(new Error('Customer name and email are required.'), { code: 'CUSTOMER_DETAILS_MISSING' });
    const apiUrl = credentials.baseUrl;
    let response;
    let body;
    try {
      response = await this.fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${credentials.appKey}:${credentials.secretKey}`).toString('base64')}`,
        },
        body: JSON.stringify({
          email: userEmail,
          name: userName,
          payment_method: 'MTN_MOMO_RWA',
          amount: Number(amount),
          payer_phone: phone,
          service_paid: 'milk-system-subscription',
          reference_id: referenceId,
          callback_url: credentials.callbackUrl,
          action: 'pay',
        }),
        signal: AbortSignal.timeout(20000),
      });
      body = await tryJson(response);
    } catch (cause) {
      throw Object.assign(new Error('LMBTech payment outcome is uncertain; reconcile its reference before retrying.'), { code: 'LMBTECH_INITIATION_UNCERTAIN', uncertain: true, cause });
    }
    if (!response.ok) {
      const uncertain = response.status === 408 || response.status >= 500;
      throw Object.assign(new Error(body.message || `LMBTech rejected the request (${response.status}).`), {
        code: uncertain ? 'LMBTECH_INITIATION_UNCERTAIN' : 'LMBTECH_INITIATION_REJECTED',
        uncertain,
        providerResponse: body,
      });
    }
    return {
      provider: this.name,
      providerReference: body?.data?.reference_id || body.reference_id || referenceId,
      status: normalizeLmbtechStatus(body?.data?.status || body.status),
      paymentId,
      userId,
      phoneNumber: phone,
      amount,
      currency,
      rawResponse: body,
    };
  }

  async getPaymentStatus({ providerReference }) {
    const credentials = getLmbtechCredentials();
    if (!credentials.allowRealPayments) throw Object.assign(new Error('Real payment status checks are disabled.'), { code: 'LMBTECH_PAYMENT_DISABLED' });
    if (!credentials.appKey || !credentials.secretKey) throw Object.assign(new Error('LMBTech credentials are missing.'), { code: 'LMBTECH_CREDENTIALS_MISSING' });
    if (!credentials.baseUrl) throw Object.assign(new Error('LMBTech API base URL is invalid.'), { code: 'LMBTECH_BASE_URL_INVALID' });
    const url = `${credentials.baseUrl}.php?reference_id=${encodeURIComponent(providerReference)}`;
    const response = await this.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${credentials.appKey}:${credentials.secretKey}`).toString('base64')}` },
      signal: AbortSignal.timeout(20000),
    });
    const body = await tryJson(response);
    if (!response.ok) throw Object.assign(new Error(body.message || `LMBTech status lookup failed (${response.status}).`), { code: 'LMBTECH_STATUS_FAILED' });
    const data = body?.data && typeof body.data === 'object' ? body.data : body;
    return {
      provider: this.name,
      providerReference: data.reference_id || null,
      transactionId: data.transaction_id || null,
      amount: data.amount === undefined ? null : Number(data.amount),
      paymentMethod: data.payment_method || null,
      payerPhone: data.payer_phone || null,
      status: normalizeLmbtechStatus(data.status),
    };
  }
}

module.exports = {
  PHONE_PATTERN,
  cleanPhone,
  canonicalPhone,
  normalizeLmbtechBaseUrl,
  normalizeLmbtechCallbackUrl,
  getLmbtechCredentials,
  getLmbtechPublicStatus,
  assertLmbtechPaymentReady,
  normalizeLmbtechStatus,
  resolveCallbackStatus,
  findCallbackReference,
  verifyCallbackPayload,
  LmbtechProvider,
};
