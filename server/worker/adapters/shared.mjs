// What both adapters share: the provider-neutral tool result and the mapping of a provider's error answer.
import { StudioError } from '../../../engine/core.mjs';
import { redact, flatLine, GONE_RE } from '../../http.mjs';

const MAX_MESSAGE_CHARS = 300;
const MAX_RETRY_AFTER_SECONDS = 3600;

/** A tool's answer as the loop stores it; `image` is the adapter's own `imagePart`. */
export const toolResultMessage = (id, content, { isError = false, image } = {}) =>
  ({ role: 'tool', id, content, isError, ...(image ? { image } : {}) });

/** A tool result's content as wire text. */
export const resultText = (content) => (typeof content === 'string' ? content : JSON.stringify(content));

/**
 * The `StudioError` for a provider answer that is not a usable 2xx JSON body, or null when it is.
 * A rate or spend limit is a 429 carrying `pauseMinutes` (`retry-after` seconds when given and at most an hour,
 * else `pauseMinutes`); the run writes the pause file. Nothing is retried. Every message is flattened and redacted.
 */
export function providerError(res, json, provider, { text = '', model = '', keys, pauseMinutes } = {}) {
  const label = provider.label || provider.kind;
  if (res.ok) return json && typeof json === 'object' ? null : new StudioError(`${label} answered something that is not JSON`, 502);
  const body = Array.isArray(json) ? json[0] : json;
  const msg = flatLine(redact(body?.error?.message || body?.message || text || res.statusText || 'no message', keys)).slice(0, MAX_MESSAGE_CHARS);
  if (res.status === 429 || body?.error?.type === 'rate_limit_error') {
    const after = Number(res.headers.get('retry-after'));
    const minutes = after > 0 && after <= MAX_RETRY_AFTER_SECONDS ? Math.ceil(after / 60) : pauseMinutes;
    return Object.assign(new StudioError(`${label} rate or spend limit reached: ${msg}. Paused for ${minutes} min.`, 429), { pauseMinutes: minutes });
  }
  if (res.status === 401 || res.status === 403) return new StudioError(`${label} refused the key (${provider.keyEnv}): ${msg}`, 502);
  // A 4xx naming the model is a gone or unknown id; "not found" alone may be a tool call id.
  if (model && (res.status === 404 || (res.status < 500 && GONE_RE.test(msg) && /model/i.test(msg)))) {
    return new StudioError(`Model ${model} was refused by ${label}: ${msg}. Change the model in the Director panel.`, 502);
  }
  if (res.status === 413) return new StudioError(`The request is too large for ${label}: ${msg}`, 502);
  return new StudioError(`${label} answered ${res.status}: ${msg}`, 502);
}
