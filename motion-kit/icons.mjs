import { SET_ICONS } from './icons-set.mjs';

// Closed paths in a 100x112 box so any icon can morph into any other.
// The first eleven, drawn by hand; their paths never change, so old scripts render the same.
export const BASE_ICONS = {
  drop: 'M50 5 C50 5 15 45 15 65 A35 35 0 0 0 85 65 C85 45 50 5 50 5 Z',
  shield: 'M50 5 L88 20 V55 C88 80 70 96 50 105 C30 96 12 80 12 55 V20 Z',
  cloth: 'M15 40 C30 20 70 20 85 40 C95 55 95 75 85 90 C70 105 30 105 15 90 C5 75 5 55 15 40 Z',
  heart: 'M50 98 C20 72 5 57 5 37 C5 20 18 10 30 10 C40 10 47 16 50 24 C53 16 60 10 70 10 C82 10 95 20 95 37 C95 57 80 72 50 98 Z',
  circle: 'M50 14 A44 44 0 1 1 49.99 14 Z',
  star: 'M50 12 L61.2 42.6 L93.7 43.8 L68.1 63.9 L77 95.2 L50 77 L23 95.2 L31.9 63.9 L6.3 43.8 L38.8 42.6 Z',
  leaf: 'M20 95 C20 45 50 15 90 12 C88 55 65 92 20 95 Z',
  bolt: 'M58 6 L18 64 H46 L40 106 L82 44 H54 Z',
  chat: 'M14 22 H86 A8 8 0 0 1 94 30 V74 A8 8 0 0 1 86 82 H44 L24 100 V82 H14 A8 8 0 0 1 6 74 V30 A8 8 0 0 1 14 22 Z',
  lock: 'M30 50 V34 A20 20 0 0 1 70 34 V50 H62 V34 A12 12 0 0 0 38 34 V50 Z M20 50 H80 A6 6 0 0 1 86 56 V100 A6 6 0 0 1 80 106 H20 A6 6 0 0 1 14 100 V56 A6 6 0 0 1 20 50 Z',
  moon: 'M62 8 C38 14 22 36 22 60 C22 88 44 106 70 106 C80 106 88 103 94 98 C70 96 52 78 52 54 C52 34 60 18 62 8 Z',
};

/** The built-ins: the originals, then the generated set (icons-set.mjs). */
export const ICONS = { ...BASE_ICONS, ...SET_ICONS };

export const ICON_NAMES = Object.keys(ICONS);

/** The icons a page can draw: the built-ins plus the brand's own (`icons` from the build args, already checked). */
export const iconSet = (extra) => (extra ? { ...ICONS, ...extra } : ICONS);

export const TICK = 'M30 58 L45 72 L72 42';

export const DECOR = {
  walls: ['M60 80 Q40 310 60 540', 'M840 80 Q860 310 840 540'],
  waves: [
    'M40 420 C160 380 260 460 380 420 S600 380 720 420 S860 460 880 420',
    'M40 480 C160 440 260 520 380 480 S600 440 720 480 S860 520 880 480',
    'M40 540 C160 500 260 580 380 540 S600 500 720 540 S860 580 880 540',
  ],
  none: [],
};
