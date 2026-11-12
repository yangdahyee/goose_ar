// Tunables. Model units come from Blender (the duck is ~2.9 units tall with the hat).
// How tall the duck is in AR, in metres. It was a fixed 0.3 (a toy), which felt small from 1.5 m away on the floor;
// the size button in AR cycles through these, and the choice is remembered.
export const DUCK_HEIGHT_M = 0.45;   // duck height in AR (was 0.3 until the size experiment)
export const DEFAULT_LOOK: 'glass' | 'plain' = 'glass'; // used when nothing is stored; ?look=plain|glass overrides

// Walking. WALK_UNITS_PER_SEC is the ground speed at which the Walk clip's feet do not slide
// (model units per second at timeScale 1; see README). In AR it is multiplied by the duck's scale.
export const WALK_UNITS_PER_SEC = 2.1;
export const WALK_SPEED_MULT = 1.8;   // plays Walk faster; ground speed scales with it so feet still match
export const STOP_DISTANCE_M = 0.5;   // stops this far from the player
export const TURN_RATE = 5;           // rad/s when turning toward the player

// Tap to move
export const GO_STOP_DISTANCE_M = 0.03; // how close to the tapped spot the duck stops
export const MAX_TAP_DISTANCE_M = 6;    // ignore taps whose floor hit is farther than this from the camera

// Looking for the floor: after this many seconds without one, the card shows a second tip, then offers "그냥 놓기".
export const SCAN_SECOND_TIP_S = 4;
export const PLACE_ANYWAY_S = 8;
