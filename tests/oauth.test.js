import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { verifyIdToken, makeJwksResolver, googleVerifier } from '../core/oauth.js';

// Generate an RSA keypair once and sign tokens with it, exposing the public key
// as a JWK so we can verify real RS256 signatures without any network access.
let privateKey;
let jwk;
const KID = 'test-key-1';

beforeAll(() => {
  const { publicKey, privateKey: pk } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pk;
  jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
});

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signRs256(payload, { kid = KID } = {}) {
  const head = b64url({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64url(payload);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const now = () => 1_700_000_000_000; // fixed clock (ms)
const futureExp = Math.floor(now() / 1000) + 3600;
const getKey = async (kid) => {
  if (kid !== KID) throw new Error('unknown kid');
  return jwk;
};

describe('verifyIdToken', () => {
  const base = { iss: 'https://accounts.google.com', aud: 'client-123', sub: 'u-1', email: 'a@b.com', email_verified: true, exp: futureExp };

  it('verifies a valid RS256 token', async () => {
    const payload = await verifyIdToken(signRs256(base), {
      issuer: 'https://accounts.google.com', audience: 'client-123', getKey, now,
    });
    expect(payload.email).toBe('a@b.com');
  });

  it('rejects a tampered payload (signature mismatch)', async () => {
    const token = signRs256(base);
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...base, email: 'evil@x.com' })).toString('base64url')}.${s}`;
    await expect(verifyIdToken(forged, { issuer: base.iss, audience: 'client-123', getKey, now })).rejects.toThrow(/signature/);
  });

  it('rejects a wrong audience and a wrong issuer', async () => {
    await expect(verifyIdToken(signRs256(base), { issuer: base.iss, audience: 'other', getKey, now })).rejects.toThrow(/audience/);
    await expect(verifyIdToken(signRs256(base), { issuer: 'https://evil', audience: 'client-123', getKey, now })).rejects.toThrow(/issuer/);
  });

  it('rejects an expired token', async () => {
    const expired = signRs256({ ...base, exp: Math.floor(now() / 1000) - 10 });
    await expect(verifyIdToken(expired, { issuer: base.iss, audience: 'client-123', getKey, now })).rejects.toThrow(/expired/);
  });

  it('rejects an unsupported algorithm', async () => {
    const head = b64url({ alg: 'none', typ: 'JWT', kid: KID });
    const body = b64url(base);
    await expect(verifyIdToken(`${head}.${body}.`, { issuer: base.iss, audience: 'client-123', getKey, now })).rejects.toThrow(/alg/);
  });
});

describe('makeJwksResolver', () => {
  it('fetches, caches, and resolves a key by kid', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls += 1; return { json: async () => ({ keys: [jwk] }) }; };
    const resolve = makeJwksResolver('https://example/jwks', fakeFetch);
    expect((await resolve(KID)).kid).toBe(KID);
    await resolve(KID);
    expect(calls).toBe(1); // cached
  });
});

describe('googleVerifier', () => {
  it('returns a normalized identity from a valid token', async () => {
    const verify = googleVerifier({ clientId: 'client-123', getKey });
    // googleVerifier uses the real clock, so expire comfortably in the future.
    const realFutureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = signRs256({ iss: 'https://accounts.google.com', aud: 'client-123', sub: 'g-9', email: 'g@b.com', email_verified: true, exp: realFutureExp });
    const id = await verify(token);
    expect(id).toMatchObject({ provider: 'google', sub: 'g-9', email: 'g@b.com', emailVerified: true });
  });
});
