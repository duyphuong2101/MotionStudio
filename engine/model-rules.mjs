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
