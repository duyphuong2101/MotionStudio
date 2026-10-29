// The first release of each Node line with the 21 October 2026 security fixes (Brotli decoder write, TLS hostname
// checks, dns.resolve). Node 20 and 25 get no fixes. Keep in step with package.json → engines.
export const NODE_FLOOR = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
const NEWEST = Math.max(...Object.keys(NODE_FLOOR).map(Number));

const floors = () => Object.values(NODE_FLOOR).map((f) => f.join('.')).join(', ');

/** Why this Node should be upgraded, or null when it has the security fixes (a line newer than the table counts). */
export function nodeProblem(version = process.versions.node) {
  const v = String(version).replace(/^v/, '').split('.').map(Number), floor = NODE_FLOOR[v[0]];
  if (!floor) return v[0] > NEWEST ? null : `Node ${version} no longer gets security fixes; install Node ${floors()} or later on that line`;
  for (let i = 0; i < 3; i++) {
    if (v[i] > floor[i]) return null;
    if (v[i] < floor[i]) return `Node ${version} is missing security fixes; install Node ${floor.join('.')} or later`;
  }
  return null;
}
