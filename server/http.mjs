// Outbound HTTP for the person-clicked model paths: a timeout, a byte cap, no redirect
// (fetch would carry the key header to the next host) and no key in any text it returns.
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

const redirected = (who) => new StudioError(`${who} answered with a redirect. The request was stopped so the key is never sent to another host.`, 502);

/** A thrown fetch or body error as a StudioError: a timeout 504, a redirect or an unreachable host 502. */
function fetchFailure(err, { who, timeoutMs, timeoutLabel, keys }) {
  if (err instanceof StudioError) return err;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new StudioError(`${who} did not answer: the request timed out after ${Math.round(timeoutMs) / 1000} s${timeoutLabel ? ` (${timeoutLabel})` : ''}`, 504);
  }
  if (/redirect/i.test(err?.cause?.message || '')) return redirected(who);
  return new StudioError(`Could not reach ${who}: ${redact(err?.cause?.message || err?.message, keys)}`, 502);
}

const send = (fetch, { url, init, timeoutMs, signal }) => {
  const timer = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, redirect: 'error', signal: signal ? AbortSignal.any([signal, timer]) : timer });
};

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

/**
 * One request: `signal` (a whole run or refresh) and a per-call timeout, the body capped at `maxBytes` (`label`),
 * a 3xx refused. Returns `{ res, json, text }` for any other status; `json` is null when the body is not JSON.
 * `who` names the host in messages, `timeoutLabel` the timeout's config key, `keys` what to redact.
 */
export async function fetchJson(fetch, opts) {
  let res, body;
  try {
    res = await send(fetch, opts);
    if (res.status >= 300 && res.status < 400) throw redirected(opts.who);
    body = await readCapped(res, opts.maxBytes, opts.label, opts.who);
  } catch (err) {
    throw fetchFailure(err, opts);
  }
  const text = body.toString('utf8');
  return { res, json: parsed(text), text };
}

// An error answer to a download is read this far for its message.
const ERROR_BODY_BYTES = 64 * 1024;

/**
 * One download streamed into `file` (created new, never read into memory) with the same timeout, redirect and key
 * rules as fetchJson; past `maxBytes` (`label`) it stops with 413 and the partial file is removed. Returns
 * `{ res, bytes }`, or for a non-2xx answer `{ res, json, text }` with nothing written.
 */
export async function fetchToFile(fetch, opts) {
  const { who, maxBytes, label, file } = opts;
  const tooBig = () => new StudioError(`${who}'s download is larger than ${maxBytes} bytes (${label})`, 413);
  try {
    const res = await send(fetch, opts);
    if (res.status >= 300 && res.status < 400) throw redirected(who);
    if (!res.ok) {
      const text = (await readCapped(res, ERROR_BODY_BYTES, 'an error answer', who)).toString('utf8');
      return { res, json: parsed(text), text };
    }
    if (Number(res.headers.get('content-length')) > maxBytes) throw tooBig();
    if (!res.body) throw new StudioError(`${who} sent an empty download`, 502);
    let bytes = 0;
    const count = new Transform({ transform(chunk, _enc, done) { bytes += chunk.length; done(bytes > maxBytes ? tooBig() : null, chunk); } });
    const out = fs.createWriteStream(file, { flags: 'wx' });
    try {
      await pipeline(Readable.fromWeb(res.body), count, out);
    } catch (err) {
      // Windows lists a file until its last handle closes.
      if (!out.closed) await new Promise((resolve) => out.once('close', resolve));
      fs.rmSync(file, { force: true });
      throw err;
    }
    return { res, bytes };
  } catch (err) {
    throw fetchFailure(err, opts);
  }
}
