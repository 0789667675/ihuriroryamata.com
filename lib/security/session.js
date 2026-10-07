const crypto = require('node:crypto');

const COOKIE_NAME = 'milk_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const getSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error('SESSION_SECRET must contain at least 32 characters.');
    error.code = 'SESSION_SECRET_NOT_CONFIGURED';
    throw error;
  }
  return secret;
};

const sign = (payload) => crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

const createSessionToken = ({ id, role }) => {
  const payload = Buffer.from(JSON.stringify({
    id: Number(id),
    role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
};

const verifySessionToken = (token) => {
  if (typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isInteger(value.id) || value.id <= 0 || value.exp <= Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch {
    return null;
  }
};

const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
});

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
};
