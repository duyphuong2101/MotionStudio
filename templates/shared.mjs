import { escapeHtml as h } from '../engine/core.mjs';

/** The brand's custom colors as CSS variables (--c-<name>), for templates and script data to reference. */
export function paletteCss(brand) {
  return (brand.palette || [])
    .filter((p) => /^[a-z][a-z0-9-]{0,23}$/.test(p?.name || '') && /^#[0-9a-fA-F]{6}$/.test(p?.hex || ''))
    .map((p) => `--c-${p.name}:${p.hex};`).join('');
}

/** The logo file to show on a light or a dark surface; null when the brand has none. */
export function logoFile(brand, onDark = false) {
  return (onDark ? brand.logoDark || brand.logo : brand.logo || brand.logoDark) || null;
}

/** An <img> for the brand logo, or the logo text, or nothing. `cls` sizes it per template. */
export function logoHtml(brand, { onDark = false, cls = 'brandlogo', fallbackText = true } = {}) {
  const file = logoFile(brand, onDark);
  if (file) return `<img class="${cls}" src="assets/${encodeURIComponent(file)}" alt="${h(brand.name)}">`;
  return fallbackText && brand.logoText ? `<span class="${cls} txt">${h(brand.logoText)}</span>` : '';
}

/** Every asset a composition needs from the brand, so the pipeline copies it next to index.html. */
export function brandAssets(brand) {
  return [brand.logo, brand.logoDark, ...(brand.fonts?.files || []).map((x) => x?.file)].filter(Boolean);
}
