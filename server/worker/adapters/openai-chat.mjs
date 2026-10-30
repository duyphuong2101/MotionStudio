// Chat Completions with function tools (`kind: 'openai'`, `'openai-compatible'`): pure request builder and parser.
// Messages are provider-neutral; each request renders them, echoing assistant messages as received.
import { StudioError } from '../../../engine/core.mjs';
import { toolResultMessage, resultText } from './shared.mjs';

export { toolResultMessage };

/** An image for a tool result, as a base64 data URL part. */
export const imagePart = (buf, mime) => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'auto' } });

// A tool message carries text only, so a result's image goes in one user message after the run of tool messages.
function wireMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  let images = [];
  const flush = () => {
    if (images.length) out.push({ role: 'user', content: [{ type: 'text', text: 'The images the tool calls above returned.' }, ...images] });
    images = [];
  };
  for (const m of messages) {
    if (m.role !== 'tool') flush();
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') out.push({ ...m.raw, role: 'assistant' });
    else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.id, content: resultText(m.content) });
      if (m.image) images.push(m.image);
    }
  }
  flush();
  return out;
}

/** `{ url, init }` for the model list (Settings → Connect): metadata only, the key in the `Authorization` header. */
export function modelsRequest({ provider, key }) {
  const base = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new StudioError(`${provider.label} has no baseUrl in config/providers.json`, 503);
  return { url: `${base}/models`, init: { method: 'GET', headers: { authorization: `Bearer ${key}` } } };
}

/** `[{ id, label }]` from a model list body (Gemini's compatible endpoint names them `models/<id>`). */
export const modelsFrom = (json) => (Array.isArray(json?.data) ? json.data : []).map((m) => {
  const id = String(m?.id || '').replace(/^models\//, '');
  return { id, label: String(m?.display_name || m?.name || id).replace(/^models\//, '') };
});

/** `{ url, init }` for one call; the key goes in the `Authorization` header only. */
export function request({ provider, model, key, system, messages, tools = [], maxOutputTokens }) {
  const base = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new StudioError(`${provider.label} has no baseUrl in config/providers.json`, 503);
  const body = {
    model,
    messages: wireMessages(system, messages),
    ...(tools.length ? {
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
      tool_choice: 'auto',
      parallel_tool_calls: false,
    } : {}),
    stream: false,
    [provider.kind === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxOutputTokens,
  };
  return {
    url: `${base}/chat/completions`,
    init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) },
  };
}

const STOP = { stop: 'end', tool_calls: 'tool_use', length: 'length' };

// `arguments` is a JSON string (an object on some compatible endpoints); anything but an object is that call's error.
function callArgs(fn) {
  const a = fn.arguments;
  if (a && typeof a === 'object' && !Array.isArray(a)) return { args: a };
  if (a == null || a === '') return { args: {} };
  try {
    const args = JSON.parse(a);
    if (args && typeof args === 'object' && !Array.isArray(args)) return { args };
  } catch { /* reported below */ }
  return { args: null, error: `Arguments for ${fn.name} are not a JSON object. Send them again as one object.` };
}

/**
 * `{ text, calls: [{ id, name, args, error? }], usage: { input, output }, stop }` from a 2xx body. `stop` is
 * `end`, `tool_use`, `length` or the provider's own value. A call without an id gets `call_<turn>_<n>`.
 */
export function parse(json, { turn = 0 } = {}) {
  const choice = json?.choices?.[0];
  if (!choice?.message) throw new StudioError('The provider answered without a message', 502);
  const { content, tool_calls: toolCalls = [] } = choice.message;
  const text = Array.isArray(content) ? content.map((p) => p?.text || '').join('') : content || '';
  const calls = (toolCalls || []).map((tc, i) => {
    const id = tc.id || `call_${turn}_${i + 1}`;
    if (!tc.function?.name) return { id, name: '', args: null, error: `Unsupported tool call type ${tc.type}` };
    return { id, name: tc.function.name, ...callArgs(tc.function) };
  });
  return {
    text,
    calls,
    usage: { input: json.usage?.prompt_tokens || 0, output: json.usage?.completion_tokens || 0 },
    stop: STOP[choice.finish_reason] || choice.finish_reason || 'end',
  };
}

/** The assistant message to store: the wire message as received, with any generated call ids written in. */
export function assistantMessage(parsed, raw) {
  const msg = { ...raw.choices[0].message };
  if (msg.tool_calls?.length) msg.tool_calls = msg.tool_calls.map((tc, i) => ({ ...tc, id: parsed.calls[i].id }));
  else if (msg.content == null) msg.content = '';
  return { role: 'assistant', raw: msg };
}
