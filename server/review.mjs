// Read-only review listener: people on the same private network see the normal UI without its edit controls.
// Started by the person (`npm run ui:review`), never by default. GET/HEAD only, a fixed route allowlist,
// one private IPv4 (never 0.0.0.0), and a random access code per start. It has no path to running the
// Director, Generate, TTS, approve, render or any write: those stay on the 127.0.0.1 UI.
import crypto from 'node:crypto';
import os from 'node:os';

export const COOKIE = 'studio_review';

/** 10/8, 172.16/12 and 192.168/16 only: a public or link-local address is never a review host. */
export function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Adapters that are rarely the office network: a VPN, a VM or container switch, a tunnel.
const VIRTUAL_RE = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|TAP|Tun|VPN|Docker|Loopback/i;

/**
 * The private IPv4 to bind and its adapter: `{ address, name, others }`. The configured one if this machine has it,
 * else the first on a physical-looking adapter, else the first at all; `others` lists the rest as "ip (adapter)".
 */
export function lanInterface(wanted = '', ifaces = os.networkInterfaces()) {
  const mine = Object.entries(ifaces).flatMap(([name, list]) => (list || [])
    .filter((x) => x && (x.family === 'IPv4' || x.family === 4) && !x.internal).map((x) => ({ address: x.address, name })));
  const pick = (hit) => ({ ...hit, others: mine.filter((x) => x !== hit && isPrivateIPv4(x.address)).map((x) => `${x.address} (${x.name})`) });
  if (wanted) {
    if (!isPrivateIPv4(wanted)) throw new Error(`server.reviewHost ${wanted} is not a private network address (10.x, 172.16-31.x, 192.168.x)`);
    const hit = mine.find((x) => x.address === wanted);
    if (!hit) throw new Error(`server.reviewHost ${wanted} is not an address of this machine`);
    return pick(hit);
  }
  const lan = mine.filter((x) => isPrivateIPv4(x.address));
  const hit = lan.find((x) => !VIRTUAL_RE.test(x.name)) || lan[0];
  if (!hit) throw new Error('No private network address found (10.x, 172.16-31.x, 192.168.x). The review link needs one.');
  return pick(hit);
}

/** The private IPv4 to bind (see `lanInterface`). */
export const lanAddress = (wanted, ifaces) => lanInterface(wanted, ifaces).address;

export const newCode = () => crypto.randomBytes(18).toString('base64url');

export function codeMatches(given, code) {
  const a = Buffer.from(String(given || '')), b = Buffer.from(String(code));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookieCode(header) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

const SEG = '[a-z0-9][a-z0-9-]*';
// The same UI as on 127.0.0.1, in review mode: only the reads it needs to show jobs, scripts, previews,
// sequences, templates and the brand. /api/tts/preview (runs TTS) and every write stay out.
const ROUTES = [
  ['page', /^\/(index\.html)?$/],
  ['ui', /^\/ui\/[a-z0-9-]+\.(js|css)$/],
  ['api', /^\/api\/(state|options)$/],
  ['director', /^\/api\/director$/],
  ['api', new RegExp(`^/api/(templates|music|sfx)/${SEG}$`)],
  ['api', new RegExp(`^/api/templates/${SEG}/preview$`)],
  ['tpreview', new RegExp(`^/tpreview/${SEG}/${SEG}/.+$`)],
  ['api', /^\/api\/(jobs|sequences)$/],
  ['api', new RegExp(`^/api/(jobs|sequences)/${SEG}/${SEG}$`)],
  ['api', new RegExp(`^/api/jobs/${SEG}/${SEG}/review$`)],
  ['api', new RegExp(`^/api/projects/${SEG}$`)],
  ['api', new RegExp(`^/api/projects/${SEG}/transcripts/[^/]+$`)],
  ['files', new RegExp(`^/files/${SEG}/${SEG}/.+$`)],
  ['assets', new RegExp(`^/assets/${SEG}/[^/]+$`)],
];

/** The UI page with the review flag set, so app.js hides every edit control. */
export const reviewPage = (html) => html.replace('<html lang="en">', '<html lang="en" data-review="1">');

/** What a review request may reach: a route kind from ROUTES, or null (refused). The api is GET only. */
export function reviewRoute(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const hit = ROUTES.find(([, re]) => re.test(pathname));
  if (!hit) return null;
  if ((hit[0] === 'api' || hit[0] === 'director') && method !== 'GET') return null;
  return hit[0];
}
