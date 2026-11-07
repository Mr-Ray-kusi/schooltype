import crypto from 'crypto';

const getGoogleClientId = () =>
  String(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: [], fetchedAt: 0 };

export function getGoogleAuthConfig() {
  const clientId = getGoogleClientId();
  return {
    configured: Boolean(clientId),
    clientId: clientId || null,
  };
}

function googleError(message, status = 401, code = 'GOOGLE_AUTH_FAILED') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(String(part || ''), 'base64url').toString('utf8'));
}

async function getGoogleJwks() {
  if (jwksCache.keys.length && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.keys)) {
    throw googleError('Google sign-in could not be verified.');
  }
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function verifyRs256(signingInput, signatureB64url, jwk) {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, Buffer.from(signatureB64url, 'base64url'));
}

async function verifyGoogleIdToken(idToken, clientId) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw googleError('Google sign-in could not be verified.');
  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    throw googleError('Google sign-in could not be verified.');
  }
  if (header.alg !== 'RS256' || !header.kid) {
    throw googleError('Google sign-in could not be verified.');
  }
  const keys = await getGoogleJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw googleError('Google sign-in could not be verified.');
  let ok = false;
  try {
    ok = verifyRs256(`${parts[0]}.${parts[1]}`, parts[2], jwk);
  } catch {
    throw googleError('Google sign-in could not be verified.');
  }
  if (!ok) throw googleError('Google sign-in could not be verified.');

  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) < now) {
    throw googleError('Google sign-in has expired. Try again.');
  }
  if (String(payload.aud || '') !== clientId) {
    throw googleError('Google sign-in was issued for a different app.');
  }
  if (!GOOGLE_ISSUERS.has(String(payload.iss || ''))) {
    throw googleError('Google sign-in could not be verified.');
  }
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  if (!verified || !payload.email) {
    throw googleError('Your Google email is not verified.');
  }
  return {
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || '').trim() || null,
    picture: payload.picture || null,
    sub: payload.sub || null,
  };
}

export async function verifyGoogleIdentity({ idToken, accessToken }) {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw googleError('Google sign-in is not configured on the server.', 503, 'GOOGLE_NOT_CONFIGURED');
  }

  if (idToken) {
    return verifyGoogleIdToken(idToken, clientId);
  }

  if (accessToken) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${String(accessToken)}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw googleError(data.error_description || 'Google sign-in could not be verified.');
    }
    const verified = data.email_verified === true || data.email_verified === 'true';
    if (!verified || !data.email) {
      throw googleError('Your Google email is not verified.');
    }
    return {
      email: String(data.email).trim().toLowerCase(),
      name: String(data.name || '').trim() || null,
      picture: data.picture || null,
      sub: data.sub || null,
    };
  }

  throw googleError('Google sign-in token is missing.');
}
