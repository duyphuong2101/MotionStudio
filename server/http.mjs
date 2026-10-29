// Outbound HTTP for the person-clicked model paths: a timeout, a byte cap, no redirect
// (fetch would carry the key header to the next host) and no key in any text it returns.
import { StudioError } from '../engine/core.mjs';

// Google (AIza…), OpenAI and Anthropic (sk-…, sk-ant-…), xAI (xai-…) and ElevenLabs (sk_…) key shapes; configured keys are removed by value too.
const KEY_RES = [/AIza[0-9A-Za-z_-]{20,}/g, /sk-ant-[A-Za-z0-9_-]{16,}/g, /sk-[A-Za-z0-9_-]{16,}/g, /xai-[A-Za-z0-9_-]{16,}/g, /sk_[A-Za-z0-9]{24,}/g];

/** `text` without the given key value(s) (a string or a list; values under 4 characters are ignored) or anything shaped like a key. */
export function redact(text, keys) {
  let s = String(text ?? '');
  for (const key of [keys].flat()) if (typeof key === 'string' && key.length >= 4) s = s.split(key).join('[key]');
  return KEY_RES.reduce((out, re) => out.replace(re, '[key]'), s);
}

// C0/C1 controls plus the Unicode line and paragraph separators (U+2028, U+2029).
const CONTROL_RE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');

/** A provider message saying a model id is gone or unknown. */
export const GONE_RE = /not found|retired|deprecated|no longer (available|supported)|shut ?down|discontinued/i;

/** One log line: control characters flattened so outside text cannot forge a line. */
export const flatLine = (text) => String(text).replace(CONTROL_RE, ' ');

/** The body as a Buffer, refused with 413 past `max` bytes; `label` names the cap, `who` the sender. */
export async function readCapped(res, max, label, who = 'The server') {
  const tooBig = () => new StudioError(`${who}'s answer is larger than ${max} bytes (${label})`, 413);
  if (Number(res.headers.get('content-length')) > max) throw tooBig();
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) throw tooBig();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * One request: `signal` (a whole run or refresh) and a per-call timeout, the body capped at `maxBytes` (`label`),
 * a 3xx refused. Returns `{ res, json, text }` for any other status; `json` is null when the body is not JSON.
 * `who` names the host in messages, `timeoutLabel` the timeout's config key, `keys` what to redact.
 */
export async function fetchJson(fetch, { url, init, who, timeoutMs, timeoutLabel, maxBytes, label, signal, keys }) {
  const redirected = () => new StudioError(`${who} answered with a redirect. The request was stopped so the key is never sent to another host.`, 502);
  const timer = AbortSignal.timeout(timeoutMs);
  let res, body;
  try {
    res = await fetch(url, { ...init, redirect: 'error', signal: signal ? AbortSignal.any([signal, timer]) : timer });
    if (res.status >= 300 && res.status < 400) throw redirected();
    body = await readCapped(res, maxBytes, label, who);
  } catch (err) {
    if (err instanceof StudioError) throw err;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new StudioError(`${who} did not answer: the request timed out after ${Math.round(timeoutMs) / 1000} s${timeoutLabel ? ` (${timeoutLabel})` : ''}`, 504);
    }
    if (/redirect/i.test(err?.cause?.message || '')) throw redirected();
    throw new StudioError(`Could not reach ${who}: ${redact(err?.cause?.message || err?.message, keys)}`, 502);
  }
  const text = body.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* the caller decides */ }
  return { res, json, text };
}
