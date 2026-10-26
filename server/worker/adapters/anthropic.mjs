// Anthropic Messages API (`kind: 'anthropic'`): pure request builder and parser. Messages are provider-neutral;
// assistant content arrays are echoed whole (thinking blocks must come back unchanged).
import { StudioError } from '../../../engine/core.mjs';
import { toolResultMessage, resultText } from './shared.mjs';

export { toolResultMessage };

const API_VERSION = '2023-06-01';
const DEFAULT_BASE = 'https://api.anthropic.com';

/** An image for a tool result, as a base64 source block. */
export const imagePart = (buf, mime) => ({ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } });

const blocks = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);

// Tool results of one turn go back in one user message; a user turn that follows another is merged into it.
function wireMessages(messages) {
  const out = [];
  const push = (role, content) => {
    const last = out.at(-1);
    if (role === 'user' && last?.role === 'user') last.content = [...blocks(last.content), ...blocks(content)];
    else out.push({ role, content });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', m.text);
    else if (m.role === 'assistant') { if (m.raw?.length) push('assistant', m.raw); }
    else if (m.role === 'tool') {
      const text = resultText(m.content);
      push('user', [{
        type: 'tool_result', tool_use_id: m.id,
        content: m.image ? [{ type: 'text', text }, m.image] : text,
        ...(m.isError ? { is_error: true } : {}),
      }]);
    }
  }
  return out;
}

/** `{ url, init }` for one call; the key goes in the `x-api-key` header only. No forced tool choice. */
export function request({ provider, model, key, system, messages, tools = [], maxOutputTokens }) {
  const body = {
    model,
    max_tokens: maxOutputTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    ...(tools.length ? {
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
      // One tool call per answer, so one answer cannot run many fetches.
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    } : {}),
    messages: wireMessages(messages),
  };
  return {
    url: `${String(provider.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')}/v1/messages`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body),
    },
  };
}

const STOP = { end_turn: 'end', stop_sequence: 'end', tool_use: 'tool_use', max_tokens: 'length' };

/**
 * `{ text, calls: [{ id, name, args }], usage: { input, output }, stop }` from a 2xx body. `stop` is `end`,
 * `tool_use`, `length` or the provider's own value. `input` counts cached prompt tokens too, as OpenAI's does.
 */
export function parse(json) {
  if (!Array.isArray(json?.content)) throw new StudioError('The provider answered without a message', 502);
  const text = json.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const calls = json.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
  const u = json.usage || {};
  return {
    text,
    calls,
    usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 },
    stop: STOP[json.stop_reason] || json.stop_reason || 'end',
  };
}

/** The assistant message to store: the content array exactly as received. */
export const assistantMessage = (parsed, raw) => ({ role: 'assistant', raw: raw.content });
