// Tunables. Model units come from Blender (the duck is ~2.9 units tall with the hat).
export const DUCK_HEIGHT_M = 0.3; // how tall the duck is in AR, in metres
export const DEFAULT_LOOK: 'glass' | 'plain' = 'glass'; // surface look; ?look=plain previews the other one

// Walking. WALK_UNITS_PER_SEC is the ground speed at which the Walk clip's feet do not slide
// (model units per second at timeScale 1; see README). In AR it is multiplied by the duck's scale.
export const WALK_UNITS_PER_SEC = 2.1;
export const WALK_SPEED_MULT = 1.8;   // plays Walk faster; ground speed scales with it so feet still match
export const STOP_DISTANCE_M = 0.5;   // stops this far from the player
export const TURN_RATE = 5;           // rad/s when turning toward the player

// Tap to move
export const GO_STOP_DISTANCE_M = 0.03; // how close to the tapped spot the duck stops
export const MAX_TAP_DISTANCE_M = 6;    // ignore taps whose floor hit is farther than this from the camera
