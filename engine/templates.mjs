import { DIRS, StudioError, ID_RE, within, readJson, exists } from './core.mjs';

const beatsFile = (id) => within(DIRS.templates, id, 'beats.json');

/** True for a template folder that ships its own renderer (template.mjs). */
export function hasRenderer(id) {
  return ID_RE.test(id || '') && exists(within(DIRS.templates, id, 'template.mjs'));
}

/** Every template in templates/ ships with the tool: its own renderer, or one it reuses via `extends`. */
export function isBuiltIn(id) {
  if (hasRenderer(id)) return true;
  try { return hasRenderer(readTemplate(id).extends); } catch { return false; }
}

export function readTemplate(id) {
  if (!ID_RE.test(id || '') || !exists(beatsFile(id))) throw new StudioError(`Unknown template: ${id}`, 404);
  return readJson(beatsFile(id));
}

/** Where the renderer lives: the template itself, or the template whose renderer it reuses. */
export function rendererDir(id, beats) {
  if (!beats.extends) return within(DIRS.templates, id);
  if (!hasRenderer(beats.extends)) throw new StudioError(`Template ${id} extends "${beats.extends}", which has no renderer`, 500);
  return within(DIRS.templates, beats.extends);
}
