// OAuth / OpenID Connect ID-token verification for "Sign in with Google/Apple".
//
// The browser obtains an ID token (a signed JWT) from the provider and posts it
// to our API; we verify the RS256 signature against the provider's published
// JWKS, check issuer/audience/expiry, and trust the email claim. Key resolution
// is injectable so the logic is testable without network access.

import crypto from 'node:crypto';

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  return { header, payload, signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
}

/**
 * Verify a signed OIDC ID token.
 * @param {string} token
 * @param {object} opts
 * @param {string|string[]} opts.issuer   accepted `iss` value(s)
 * @param {string} opts.audience          expected `aud` (the OAuth client id)
 * @param {(kid:string)=>Promise<object>} opts.getKey  resolves a kid to a JWK
 * @param {()=>number} [opts.now]         clock (ms) injection for tests
 * @returns {Promise<object>} the verified payload
 */
export async function verifyIdToken(token, { issuer, audience, getKey, now = Date.now }) {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== 'RS256') throw new Error('unsupported alg');
  if (!header.kid) throw new Error('missing kid');

  const jwk = await getKey(header.kid);
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(signingInput), pub, signature);
  if (!ok) throw new Error('invalid signature');

  const issuers = Array.isArray(issuer) ? issuer : [issuer];
  if (issuer && !issuers.includes(payload.iss)) throw new Error('invalid issuer');
  if (audience && payload.aud !== audience) throw new Error('invalid audience');
  if (payload.exp && now() / 1000 > payload.exp) throw new Error('token expired');
  return payload;
}

/** Cached JWKS resolver: fetch the key set, find a key by `kid`. */
export function makeJwksResolver(jwksUri, fetchImpl = globalThis.fetch, ttlMs = 3600_000) {
  let keys = null;
  let fetchedAt = 0;
  return async (kid) => {
    if (!keys || Date.now() - fetchedAt > ttlMs) {
      const res = await fetchImpl(jwksUri);
      const body = await res.json();
      keys = body.keys || [];
      fetchedAt = Date.now();
    }
    let key = keys.find((k) => k.kid === kid);
    if (!key) {
      // Key may have rotated; refetch once.
      const res = await fetchImpl(jwksUri);
      keys = (await res.json()).keys || [];
      fetchedAt = Date.now();
      key = keys.find((k) => k.kid === kid);
    }
    if (!key) throw new Error('unknown signing key');
    return key;
  };
}

const GOOGLE = {
  issuer: ['https://accounts.google.com', 'accounts.google.com'],
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
};
const APPLE = {
  issuer: 'https://appleid.apple.com',
  jwks: 'https://appleid.apple.com/auth/keys',
};

function normalizeIdentity(provider, payload) {
  if (!payload.email) throw new Error('no email in token');
  // Providers send email_verified as boolean or string ("true"/"false").
  const ev = payload.email_verified;
  const emailVerified = ev === true || ev === 'true' || ev === undefined;
  return { provider, sub: payload.sub, email: payload.email, emailVerified, name: payload.name || '' };
}

/** A verifier function (idToken → identity) for Google. */
export function googleVerifier({ clientId, getKey = makeJwksResolver(GOOGLE.jwks) }) {
  return async (idToken) => {
    const payload = await verifyIdToken(idToken, { issuer: GOOGLE.issuer, audience: clientId, getKey });
    return normalizeIdentity('google', payload);
  };
}

/** A verifier function (idToken → identity) for Apple. */
export function appleVerifier({ clientId, getKey = makeJwksResolver(APPLE.jwks) }) {
  return async (idToken) => {
    const payload = await verifyIdToken(idToken, { issuer: APPLE.issuer, audience: clientId, getKey });
    return normalizeIdentity('apple', payload);
  };
}
