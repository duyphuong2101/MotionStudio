// The API worker's one way out to the web: the brand's allowed hosts only, on every redirect hop, no cookie or key.
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList } from 'node:net';
import { Readable } from 'node:stream';
import { StudioError } from '../../engine/core.mjs';
import { urlCheck } from '../../engine/brand.mjs';
import { readCapped } from '../http.mjs';

// Loopback, private, link-local, unique-local and unspecified: never reached, whatever an allowed name resolves to.
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fe80::', 10], ['fc00::', 7]]) PRIVATE.addSubnet(net, bits, 'ipv6');
const REDIRECTS = [301, 302, 303, 307, 308];
const MAX_HOPS = 3;
const MAX_IMAGES = 40;
const DROP_RE = /<!--[\s\S]*?-->|<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi;
const BREAK_RE = /<\/?(h[1-6]|li|p|br|div|tr|dt|dd|section|article|header|footer|blockquote)\b[^>]*>/gi;
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

const decode = (s) => s.replace(/&(lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]).replace(/&amp;/g, '&');
const squash = (s) => s.replace(/[^\S\n]+/g, ' ').trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[1] ?? m[2] ?? m[3]) : '';
};

function imagesOf(html, baseUrl) {
  const out = new Map();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    if (out.size >= MAX_IMAGES) break;
    let src = '';
    try { src = new URL(attr(tag, 'src'), baseUrl).href; } catch { continue; }
    if (/^https?:/.test(src) && !out.has(src)) out.set(src, { src, alt: squash(attr(tag, 'alt')) });
  }
  return [...out.values()];
}

/** `{ title, text, images }` from an HTML page: no script, style, noscript or svg; a line per heading, item or block. */
export function pageText(html, baseUrl) {
  const clean = String(html).replace(DROP_RE, ' ');
  const title = squash(decode((clean.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').replace(/<[^>]*>/g, ' ')));
  const body = clean.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, ' ').replace(BREAK_RE, '\n').replace(/<[^>]*>/g, ' ');
  const text = decode(body).split('\n').map(squash).filter(Boolean).join('\n');
  return { title, text, images: imagesOf(clean, baseUrl) };
}

function assertAllowed(url, hosts) {
  const check = urlCheck(url, hosts);
  if (!check?.host) throw new StudioError(`Not an http(s) URL: ${String(url).slice(0, 200)}`, 400);
  if (!check.allowed) throw new StudioError(`${check.host} is not in this brand's allowed hosts. Use a page on ${hosts.join(', ') || 'no host yet'}, or fail the job and ask the person to add the host in Brand → Allowed data hosts.`, 403);
  const { port } = new URL(url);
  if (port) throw new StudioError(`${check.host} on port ${port} is refused. Only the default http and https ports are fetched.`, 403);
  return check.host;
}

const isPrivate = (address, family) => PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4');

/** Refuses a host any of whose addresses is loopback, private, link-local, unique-local or unspecified; returns the first. */
async function assertPublic(host, lookup) {
  let list;
  try { list = await lookup(host.replace(/^\[|\]$/g, ''), { all: true }); } catch (err) {
    throw new StudioError(`Could not resolve ${host}: ${err?.code || err?.message}`, 502);
  }
  if (!list?.length) throw new StudioError(`Could not resolve ${host}`, 502);
  const bad = list.find(({ address, family }) => isPrivate(address, family));
  if (bad) throw new StudioError(`${host} resolves to a private or local address (${bad.address}). fetch_page reaches public hosts only.`, 403);
  return { address: list[0].address, family: list[0].family === 6 ? 6 : 4 };
}

// Node's fetch has no public way to fix the address it connects to, so the real fetch is replaced by this one.
const PLATFORM_FETCH = globalThis.fetch;

/**
 * A fetch-shaped GET that connects only to `pinned` (the address assertPublic checked): its own DNS answer is never
 * asked again, so a name cannot rebind between the check and the connect. TLS still checks the certificate against
 * the URL's host (SNI and Host header unchanged), no pooled socket, and the connected address is checked once more.
 */
export function pinnedFetch(pinned) {
  return (url, { signal, headers = {} } = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const lookup = (hostname, opts, cb) => (opts?.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family));
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(u, { method: 'GET', headers, signal, lookup, agent: false }, (res) => {
      const plain = (a) => String(a || '').replace(/^::ffff:/, '');
      const remote = res.socket?.remoteAddress;
      if (plain(remote) !== plain(pinned.address)) {
        req.destroy();
        return reject(new StudioError(`${u.host} connected to ${remote || 'an unknown address'}, not the address that was checked`, 502));
      }
      const head = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) { try { head.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch { /* a header fetch would refuse too */ } }
      const empty = [204, 205, 304].includes(res.statusCode);
      if (empty) res.resume();
      try {
        resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage, headers: head }));
      } catch (err) { req.destroy(); reject(err); }
    });
    req.on('error', reject);
    req.end();
  });
}

// A stopped run, a timeout or a dropped connection, while asking or while reading the body.
function netError(err, host, g, signal, what) {
  if (err instanceof StudioError) return err;
  if (signal?.aborted) return new StudioError('The run was stopped', 499);
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new StudioError(`${host} did not answer within ${g.requestTimeoutSeconds} s (requestTimeoutSeconds)`, 504);
  return new StudioError(`${what} ${host}: ${err?.cause?.message || err?.message}`, 502);
}

async function get(fetch, url, host, g, signal, pinned) {
  const timer = AbortSignal.timeout(g.requestTimeoutSeconds * 1000);
  // An injected fetch (tests) is used as given; the platform fetch is replaced by one bound to the checked address.
  const send = !fetch || fetch === PLATFORM_FETCH ? pinnedFetch(pinned) : fetch;
  try {
    return await send(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, timer]) : timer, headers: { accept: 'text/html,*/*' } });
  } catch (err) {
    throw netError(err, host, g, signal, 'Could not reach');
  }
}

/**
 * One page for the Director: `{ url, finalUrl, title, text, images, truncated? }`; a refused host, port, address, size
 * or type throws a StudioError. `lookup` (node:dns/promises by default) resolves each hop's host before it is fetched.
 */
export async function fetchPage(url, { hosts = [], fetch, g, signal, lookup = dnsLookup }) {
  let current = String(url ?? '');
  for (let hop = 0; ; hop++) {
    const host = assertAllowed(current, hosts);
    const pinned = await assertPublic(host, lookup);
    const res = await get(fetch, current, host, g, signal, pinned);
    if (REDIRECTS.includes(res.status)) {
      await res.body?.cancel();
      if (hop >= MAX_HOPS) throw new StudioError(`${host} redirected more than ${MAX_HOPS} times`, 502);
      const next = res.headers.get('location');
      if (!next) throw new StudioError(`${host} answered ${res.status} without a Location`, 502);
      try { current = new URL(next, current).href; } catch { throw new StudioError(`${host} redirected to a URL that does not parse`, 502); }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new StudioError(`${host} answered ${res.status} for ${current.slice(0, 200)}`, 502);
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const html = type === 'text/html' || type === 'application/xhtml+xml';
    if (!html && type !== 'text/plain' && !/^application\/([a-z0-9.-]+\+)?json$/.test(type)) {
      await res.body?.cancel();
      throw new StudioError(`Not a text page (${type || 'no content type'})`, 415);
    }
    let body;
    try { body = (await readCapped(res, g.maxFetchBytes, 'maxFetchBytes', host)).toString('utf8'); } catch (err) {
      throw netError(err, host, g, signal, 'Could not read the page from');
    }
    const page = html ? pageText(body, current) : { title: '', text: body, images: [] };
    const truncated = page.text.length > g.maxPageChars;
    return { url: String(url), finalUrl: current, ...page, text: page.text.slice(0, g.maxPageChars), ...(truncated ? { truncated } : {}) };
  }
}
