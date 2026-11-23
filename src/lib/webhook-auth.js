'use strict';

/**
 * Webhook signature verification for Ashby and DocuSign Connect.
 *
 * Both endpoints are reachable from the public internet, so every request must
 * prove it came from the provider before any payload is parsed or acted on.
 * Verification fails closed: if the shared secret is not configured, every
 * request is rejected.
 *
 *  - Ashby:    header `Ashby-Signature: sha256=<hex HMAC-SHA256(rawBody, ASHBY_WEBHOOK_SECRET)>`
 *  - DocuSign: headers `X-DocuSign-Signature-1..N: <base64 HMAC-SHA256(rawBody, key)>`
 *              (one header per active Connect HMAC key; any match is accepted)
 *              keys come from DOCUSIGN_CONNECT_HMAC_KEYS (comma-separated, to allow rotation)
 */

const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function toBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  return null;
}

function verifyAshbySignature(rawBody, headers, secret = process.env.ASHBY_WEBHOOK_SECRET) {
  if (!secret) {
    console.error('[WEBHOOK-AUTH] ASHBY_WEBHOOK_SECRET is not set — rejecting Ashby webhook');
    return false;
  }
  const body = toBuffer(rawBody);
  const provided = headerValue(headers, 'ashby-signature');
  if (!body || !provided) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqualStr(provided.trim(), expected);
}

function docusignKeys() {
  return (process.env.DOCUSIGN_CONNECT_HMAC_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function verifyDocuSignSignature(rawBody, headers, keys = docusignKeys()) {
  if (!keys.length) {
    console.error('[WEBHOOK-AUTH] DOCUSIGN_CONNECT_HMAC_KEYS is not set — rejecting DocuSign webhook');
    return false;
  }
  const body = toBuffer(rawBody);
  if (!body) return false;

  const provided = [];
  for (let i = 1; i <= 10; i++) {
    const v = headerValue(headers, `x-docusign-signature-${i}`);
    if (v) provided.push(v.trim());
  }
  if (!provided.length) return false;

  const expected = keys.map((k) => crypto.createHmac('sha256', k).update(body).digest('base64'));
  return provided.some((p) => expected.some((e) => timingSafeEqualStr(p, e)));
}

module.exports = { verifyAshbySignature, verifyDocuSignSignature };
