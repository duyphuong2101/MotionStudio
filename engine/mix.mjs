// Mixed briefs: one lead template frames the video; up to MAX_MIX_EXTRAS other templates add body scenes
// whose kinds are namespaced "<template>.<kind>". Lead kinds stay bare.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StudioError, jsonForScript } from './core.mjs';
import { rendererDir } from './templates.mjs';
import { page } from '../templates/kit.mjs';

export const MAX_MIX_EXTRAS = 3;

/** "data-story.bars" → { tpl: 'data-story', kind: 'bars' }; a bare (lead) kind has tpl ''. */
export function splitKind(kind) {
  const s = String(kind ?? '');
  const i = s.indexOf('.');
  return i < 0 ? { tpl: '', kind: s } : { tpl: s.slice(0, i), kind: s.slice(i + 1) };
}

/** A template can lead or join a mix only when its beats.json lists the body kinds it contributes. */
export const isMixable = (beats) => Array.isArray(beats?.mixable) && beats.mixable.length > 0;

/**
 * The rules a mixed brief follows: the lead's beats with every body slot (a slot holding one of the lead's
 * `mixable` kinds) also open to each extra's `mixable` kinds as "<id>.<kind>". Extras' fields, defaults and
 * pace are keyed by that kind; their limits and enums stay in `sources[<id>]`.
 */
export function composeBeats(lead, extras) {
  for (const b of [lead, ...extras]) if (!isMixable(b)) throw new StudioError(`Template ${b.id} cannot be mixed in`, 400);
  const extraKinds = extras.flatMap((x) => x.mixable.map((k) => ({ x, k, key: `${x.id}.${k}` })));
  const byKind = Object.fromEntries(extraKinds.filter(({ x }) => x.pace).map(({ x, key }) => [key, x.pace]));
  return {
    ...lead,
    label: [lead, ...extras].map((b) => b.label).join(' + '),
    mixed: true,
    lead: lead.id,
    mix: extras.map((x) => x.id),
    formats: lead.formats.filter((f) => extras.every((x) => x.formats.includes(f))),
    sequence: lead.sequence.map((slot) => (slot.kind.some((k) => lead.mixable.includes(k))
      ? { ...slot, kind: [...slot.kind, ...extraKinds.map(({ key }) => key)] } : slot)),
    fields: { ...lead.fields, ...Object.fromEntries(extraKinds.map(({ x, k, key }) => [key, x.fields[k]])) },
    defaults: { ...lead.defaults, ...Object.fromEntries(extraKinds.map(({ x, k, key }) => [key, x.defaults?.[k] || {}])) },
    ...(lead.pace || Object.keys(byKind).length ? { pace: { ...lead.pace, byKind } } : {}),
    sources: Object.fromEntries([lead, ...extras].map((b) => [b.id, b])),
    scene: 'A scene from an extra template is written { "kind": "<template>.<kind>", ...fields["<template>.<kind>"] }; its limits and enums are sources["<template>"].limits / .enums.',
  };
}

/**
 * Prefixes every selector of a flat CSS rule list with `scope`, so several renderers share one page.
 * Renderer CSS is a contract: no @ rules, no nested blocks, no "{" or "}" inside strings.
 */
export function scopeCss(css, scope) {
  if (css.includes('@')) throw new StudioError(`Template CSS for ${scope} uses an @ rule, which a mixed page cannot scope`);
  return css.split('}').map((rule) => {
    const parts = rule.split('{');
    if (parts.length === 1 && !rule.trim()) return rule;
    if (parts.length !== 2) throw new StudioError(`Template CSS for ${scope} is not a flat rule list near "${rule.trim().slice(0, 40)}"`);
    const lead = parts[0].match(/^\s*/)[0];
    return `${lead}${parts[0].split(',').map((s) => `${scope} ${s.trim()}`).join(',')}{${parts[1]}`;
  }).join('}');
}

/**
 * One page from several renderers' parts(): each template gets its own scenes (bare kinds), its css scoped to
 * `.t-<id>`, its markup in a `display:contents` wrapper and its js in a function scope. Inside that scope `D`
 * is a view where other templates' scenes carry "<id>.<kind>", so a renderer's look at D.scenes[i ± 1]
 * only ever matches its own kinds. `beats` is the composed rules (composeBeats).
 */
export async function buildMixed({ brief, brand, script, timing, size, icons }, beats) {
  const ids = [beats.lead, ...beats.mix];
  const owner = (sc) => splitKind(sc.kind).tpl || beats.lead;
  const built = [];
  for (const id of ids) {
    const { parts } = await import(pathToFileURL(path.join(rendererDir(id, beats.sources[id]), 'template.mjs')).href);
    if (typeof parts !== 'function') throw new StudioError(`Template ${id} has no parts() and cannot be mixed in`, 500);
    const scenes = script.scenes.filter((sc) => owner(sc) === id).map((sc) => ({ ...sc, kind: splitKind(sc.kind).kind }));
    // An extra with no scenes in this script would still paint its chrome (an empty app window, say) over every scene.
    if (id !== beats.lead && !scenes.length) continue;
    const p = parts({ brief, brand, script: { ...script, scenes }, timing, size, icons });
    if (/afterSeek|__prepare/.test(p.js)) throw new StudioError(`Template ${id} uses afterSeek or __prepare, which a mixed page cannot share`, 500);
    built.push({ id, ...p });
  }
  const byId = Object.fromEntries(built.flatMap(({ id, scenes }) => scenes.map((s) => [s.id, id === beats.lead ? s : { ...s, tpl: id }])));
  const js = `const MIX_LEAD = ${jsonForScript(beats.lead)};
const mixView = (tpl) => ({ ...D, scenes: D.scenes.map((sc) => ((sc.tpl || MIX_LEAD) === tpl ? sc : { ...sc, kind: (sc.tpl || MIX_LEAD) + '.' + sc.kind })) });
const KINDS = {};
const mixKinds = (prefix, kinds) => { for (const k in kinds) KINDS[prefix + k] = kinds[k]; };
${built.map(({ id, js: code }) => `mixKinds(${jsonForScript(id === beats.lead ? '' : `${id}.`)}, ((D) => {\n${code}\nreturn KINDS;\n})(mixView(${jsonForScript(id)})));`).join('\n')}`;
  return page({
    brand, script, timing, size,
    title: ids.join(' + '),
    css: `\n.tpl{display:contents}${built.map(({ id, css }) => scopeCss(css, `.t-${id}`)).join('')}`,
    body: built.map(({ id, body }) => `<div class="tpl t-${id}">${body}</div>`).join('\n'),
    scenes: script.scenes.map((sc) => byId[sc.id]).filter(Boolean),
    js,
    extra: Object.assign({}, ...built.map((b) => b.extra || {})),
    particles: built[0].particles ?? true,
    subs: built[0].subs ?? null,
    // A renderer that keeps its elements still under parallax (ui-story) keeps the whole mixed page still.
    layers: built.every((b) => b.layers !== false),
  });
}
