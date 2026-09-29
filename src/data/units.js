/**
 * units.js (data)
 * ----------------------------------------------------------------------------
 * Combat unit definitions for both sides. Units are separate from walkers:
 * walkers stay on roads, units move freely over open land and fight.
 *
 * Timing: speed is tiles per tick (20 ticks = 1 game day, 1.67 s at 1x),
 * cooldown is ticks between attacks.
 *
 *   hp        hit points
 *   attack    damage per hit before defense (randomized +-25%)
 *   defense   each point removes half a point of incoming damage
 *   range     attack reach in tiles (about 1 = melee)
 *   aggro     distance at which the unit notices and engages enemies
 *   siege     damage per hit against buildings and walls (raiders only)
 *   upkeep    Dn per month to keep one soldier (Roman units only). Kept low:
 *             forts and the barracks already cost wages for their staff.
 *   color     tunic/banner color (forts fly their soldiers' color)
 * ----------------------------------------------------------------------------
 */

export const UNIT_TYPES = Object.freeze({
  // --- Rome -----------------------------------------------------------------
  legionary: {
    name: 'Legionary', side: 'rome', color: '#a8322b', hp: 110, attack: 14, defense: 9, range: 1.1, aggro: 8,
    speed: 0.075, cooldown: 20, upkeep: 2, fort: 'fort_legion',
    desc: 'Heavy infantry with a large shield. Holds the line against anything. Each recruit needs weapons.',
  },
  archer: {
    name: 'Archer', side: 'rome', color: '#3f7a3a', hp: 60, attack: 10, defense: 3, range: 6.5, aggro: 9,
    speed: 0.075, cooldown: 30, upkeep: 2, fort: 'fort_archer', ranged: true,
    desc: 'Auxiliary bowmen. Fragile up close, deadly from a distance. Each recruit needs arrows from a Fletcher.',
  },
  cavalry: {
    name: 'Cavalryman', side: 'rome', color: '#c9962e', hp: 120, attack: 15, defense: 6, range: 1.2, aggro: 12,
    speed: 0.13, cooldown: 18, upkeep: 3, fort: 'fort_cavalry', mounted: true,
    desc: 'Fast horsemen who hunt down raiders before they reach the city. Each recruit needs a horse.',
  },
  // --- Raiders ------------------------------------------------------------------
  raider: {
    name: 'Raider', side: 'enemy', color: '#6b4f2e', hp: 70, attack: 11, defense: 3, range: 1.1, aggro: 4,
    speed: 0.07, cooldown: 20, siege: 10,
    desc: 'Barbarian warrior with axe and round shield. Burns what he cannot carry.',
  },
  horseman: {
    name: 'Raider Horseman', side: 'enemy', color: '#4a3a2a', hp: 90, attack: 13, defense: 4, range: 1.2, aggro: 5,
    speed: 0.12, cooldown: 18, siege: 8, mounted: true,
    desc: 'Mounted raider who strikes fast and far.',
  },
  slinger: {
    name: 'Slinger', side: 'enemy', color: '#7a6a4a', hp: 45, attack: 8, defense: 2, range: 5, aggro: 6,
    speed: 0.075, cooldown: 28, siege: 4, ranged: true,
    desc: 'Hurls stones from behind the warband.',
  },
});

/** Soldiers per fort. */
export const FORT_CAPACITY = 8;

/** Days a fully staffed barracks needs to train one recruit. */
export const TRAIN_DAYS = 8;

/**
 * Horse Ranch breeding herd. A new ranch starts with HERD_START mares and
 * gains one every HERD_GROWTH_DAYS staffed days up to HERD_MAX. Foaling speed
 * scales with herd / HERD_MAX, so a young ranch is 4x slower than a mature one.
 */
export const HERD_START = 2;
export const HERD_MAX = 8;
export const HERD_GROWTH_DAYS = 30;
