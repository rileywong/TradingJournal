// Auth primitives: salted password hashing + HMAC-signed, JWT-shaped tokens.
// This is a self-contained stub built on node:crypto. The token layout
// (header.payload.signature, base64url) mirrors a real JWT so migrating to a
// production JWT library is a drop-in replacement.

import crypto from 'node:crypto';

const SECRET = process.env.TJS_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// --- password hashing (scrypt) -------------------------------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expected] = stored.split('$');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- token sign / verify --------------------------------------------------
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function sign(data) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function signToken(payload, ttlSeconds = TOKEN_TTL_SECONDS) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64urlJson(header);
  const data = b64urlJson(body);
  const sig = sign(`${head}.${data}`);
  return `${head}.${data}.${sig}`;
}

/**
 * @returns {object|null} the decoded payload, or null if invalid/expired.
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, data, sig] = parts;
  const expected = sign(`${head}.${data}`);
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- unsubscribe tokens ---------------------------------------------------
// Non-expiring, HMAC-signed token identifying a user, for one-click email
// unsubscribe links (no login required). Scoped with an "unsub:" prefix so it
// can't be confused with a session token.
export function signUnsubscribe(userId) {
  const u = Buffer.from(String(userId)).toString('base64url');
  return `${u}.${sign(`unsub:${u}`)}`;
}

export function verifyUnsubscribe(token) {
  const [u, sig] = String(token || '').split('.');
  if (!u || !sig) return null;
  const expected = sign(`unsub:${u}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Buffer.from(u, 'base64url').toString();
}
