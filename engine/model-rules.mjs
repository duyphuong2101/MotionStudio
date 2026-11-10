// The limits a 3D model scene's fields obey: shared by the script check (engine/script.mjs), the renderer
// (templates/model3d.mjs) and beats.json's `data.model` (a test keeps them equal), so the engine never imports a template.

// A scene's start pose: degrees round and above the model, and a zoom on the fitted distance.
export const VIEW_RANGE = { azimuth: [-180, 180], elevation: [-30, 60], zoom: [0.6, 1.6] };
// A camera path: 2-4 poses the camera glides through across the scene.
export const PATH_POSES = [2, 4];
// Exploded parts: named nodes of the .glb pulled out from the model's centre, by `gap` of the fitted radius.
export const EXPLODE_PARTS = [1, 6];
export const GAP_RANGE = [0.1, 1];
export const GAP_DEFAULT = 0.45;
export const PART_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
// A decal: a brand or built-in icon stamped on the model's front face, placed by fractions of that face.
export const DECAL_SIZE = [0.1, 0.6];
export const DECAL_SIZE_DEFAULT = 0.28;
// Studio lighting choices: three's room, a room in the brand colours, or plain lamps.
export const ENVS = ['studio', 'brand', 'none'];
// A glow from the model's bright highlights (three's UnrealBloomPass): 0 is off, 1 the strongest.
export const BLOOM_RANGE = [0, 1];

// A model scene's extras: one named animation clip of the .glb, colour changes on a word cue, a second model that takes
// over, and a stock material on named parts (or the whole model).
export const CLIP_RE = /^[A-Za-z0-9][A-Za-z0-9 _.|:-]{0,59}$/;
export const PAINTS = [1, 4];
export const MATERIAL_LOOKS = ['glass', 'chrome', 'gold', 'clay'];
// A paint colour: a hex colour or one of the brand's own colours by name.
export const PAINT_COLORS = ['primary', 'primary2', 'secondary', 'ink', 'bg'];
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// The other 3D kinds (templates/m3subjects.mjs), drawn by the same canvas as a model.
// type3d: a short word or number as solid letters.
export const WORD_MAX = 16;
// device: a screen picture on a phone, tablet or laptop.
export const DEVICES = ['phone', 'tablet', 'laptop'];
// swarm: points that fly in and settle into a form.
export const SWARM_FORMS = ['word', 'icon', 'logo'];
// cards: photos as prints in 3D space.
export const CARD_PHOTOS = [2, 6];
export const CARD_CAPTION = 32;
export const CARD_ARRANGE = ['row', 'fan', 'ring'];
// globe: places on a turning globe, joined by arcs.
export const GLOBE_POINTS = [1, 8];
export const GLOBE_LABEL = 20;
export const GLOBE_ARCS = ['hub', 'chain', 'none'];
// Kinds a scene of the explainer (or a mix) can use for these, so the engine knows a scene draws in 3D.
export const THREE_KINDS = ['model', 'type3d', 'device', 'swarm', 'cards', 'globe'];
// A page holds a 3D canvas: three.js must be copied into the job's vendor/ (engine/vendor.mjs).
export const THREE_CANVAS_RE = /<canvas class="m3c[^"]*"/;
