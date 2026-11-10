// Language versions (plan .ai/plans/publish-kit.md): a new job that is a finished job in another language. The brief
// is copied with `lang` (and an optional voice) set and `translateOf` naming the original; source.json is copied as it
// is, so every claim stays the original's; the job waits for the Director from step 3. When a person clicks Run
// Director, its context carries the original script and TRANSLATION_RULE, and it writes the new script the usual way.
// No model is called here, and none is added: the Director is the existing, person-started path.
import { StudioError, readJson, writeJson } from './core.mjs';
import { loadBrief, loadBrand, jobFile, validateBrief, saveBrief, setStatus, LANG_RE } from './jobs.mjs';
import { voiceFor, voiceProblem } from './tts.mjs';
import { draftScenes } from './script.mjs';

export const TRANSLATION_RULE = 'This job is a language version of the job named in translation.of. Write script.json for this job\'s template with the same scenes as translation.script, in the same order: the same id, kind, source, assets, icons, numbers, links, timing fields and every other setting. Translate every voice line and every on-screen text into natural translation.lang, as a native speaker would say it, within this template\'s limits (shorten rather than overrun; the words of another language are often longer). Keep brand, product and people names as written. Never add, drop or change a claim: source.json is the original\'s, copied. A marks token ([[circle:…]] and the others) wraps the translated words that mean the same. Then commit and build the storyboard as usual.';

/** The Director's view of a language version: the original job's script and the rule, or why it is missing. */
export function translationContext(project, brief) {
  if (!brief?.translateOf) return null;
  let script = null;
  try { script = readJson(jobFile(project, brief.translateOf, 'script.json'), null); } catch { script = null; }
  const lang = String(brief.lang || loadBrand(project).voice?.lang || 'en');
  if (!script) return { translation: { of: brief.translateOf, lang, missing: `${brief.translateOf} has no script.json any more: write this job's script from source.json as for any brief` } };
  return { translation: { of: brief.translateOf, lang, script: { lang: script.lang, scenes: script.scenes, ...(script.look ? { look: script.look } : {}) } }, translationRule: TRANSLATION_RULE };
}

/**
 * Makes `<id>-<lang>` (or `newId`): the brief with `lang` and `voice`, `translateOf: id`, no recorded take and no
 * quick mode; source.json copied; status dirty from step 3 for the Director. Returns { brief, warning }: `warning`
 * says when the voice this job would use cannot speak the language, so the person picks another before prepare.
 */
export function translateJob(project, id, { lang, voice = '', newId = '' } = {}, { providers, by = 'ui' } = {}) {
  const brief = loadBrief(project, id);
  const brand = loadBrand(project);
  const code = String(lang || '').toLowerCase();
  if (!LANG_RE.test(code)) throw new StudioError('Pick the language of the new version, e.g. es or fr', 400);
  const from = String(brief.lang || brand.voice?.lang || 'en').toLowerCase();
  if (code === from) throw new StudioError(`${id} is already in ${from}: pick another language`, 400);
  const script = readJson(jobFile(project, id, 'script.json'), null);
  if (!script?.scenes?.length) throw new StudioError(`${id} has no script yet: run the Director on it first, then make a language version`, 409);
  if (draftScenes(script).length) throw new StudioError(`${id} still has draft scenes: let the Director fill them first`, 409);
  const source = readJson(jobFile(project, id, 'source.json'), null);
  if (!source) throw new StudioError(`${id} has no source.json: run the Director on it first`, 409);
  const target = newId || `${id}-${code}`;
  const { voiceTake: _take, updatedAt: _u, createdAt: _c, ...rest } = brief;
  const next = validateBrief({ ...rest, id: target, lang: code, voice: voice || '', quick: false, translateOf: id, createdBy: by }, { providers });
  saveBrief(next);
  writeJson(jobFile(project, target, 'source.json'), source);
  setStatus(project, target, { status: 'dirty', dirty_from: 3, step: 3 }, `language version of ${id} in ${code}: source copied, the Director writes the script`, by);
  return { brief: next, warning: voiceProblem(voiceFor(brand, next)) };
}
