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
 *   naval     a ship: sails navigable water only and fights only ships
 *             (sim/navy.js); land soldiers and raiders ignore it
 *   upkeep    Dn per month to keep one soldier (Roman units only). Kept low:
 *             forts and the barracks already cost wages for their staff.
 *   color     tunic/banner color (forts fly their soldiers' color)
 *
 * Training (a Military Academy for soldiers, the Portus for liburnian crews;
 * sim/training.js). A trained man or crew keeps its hp and attack, as in the
 * original, and gains:
 *   trainedDefense   defense added at all times
 *   holdDefense      defense added while holding position: standing his ground
 *                    (at his post, or standing to fight a raider in reach), not
 *                    running after one or marching. The original's close order.
 *   holdMissile      share of a missile's damage taken while holding position
 *                    (the original's close order took 1 damage a missile)
 *   trainedRam       ram damage of a trained crew
 *   trainedSpeed     speed of a trained crew (they row in time)
 *   strength,        what one counts for in a distant battle, untrained and
 *   trainedStrength  trained (battleStrength in sim/training.js): the
 *                    original's legionary 2 or 3 and auxiliary 1 or 2, and a
 *                    liburnian 4 or 6 (Colonia's own)
 * ----------------------------------------------------------------------------
 */

export const UNIT_TYPES = Object.freeze({
  // --- Rome -----------------------------------------------------------------
  legionary: {
    name: 'Legionary', side: 'rome', color: '#a8322b', hp: 110, attack: 14, defense: 9, range: 1.1, aggro: 8,
    speed: 0.075, cooldown: 20, upkeep: 2, fort: 'fort_legion',
    holdDefense: 4, holdMissile: 0.25, strength: 2, trainedStrength: 3,
    desc: 'Heavy infantry with a large shield. Holds the line against anything. Each recruit needs weapons.',
  },
  archer: {
    name: 'Archer', side: 'rome', color: '#3f7a3a', hp: 60, attack: 10, defense: 3, range: 6.5, aggro: 9,
    speed: 0.075, cooldown: 30, upkeep: 2, fort: 'fort_archer', ranged: true,
    trainedDefense: 2, strength: 1, trainedStrength: 2,
    desc: 'Auxiliary bowmen. Fragile up close, deadly from a distance. Each recruit needs arrows from a Fletcher.',
  },
  cavalry: {
    name: 'Cavalryman', side: 'rome', color: '#c9962e', hp: 120, attack: 15, defense: 6, range: 1.2, aggro: 12,
    speed: 0.13, cooldown: 18, upkeep: 3, fort: 'fort_cavalry', mounted: true,
    trainedDefense: 2, strength: 1, trainedStrength: 2,
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
  // --- Ships (naval: they sail navigable water only, see sim/navy.js) ------------
  // A liburnian beats one raider ship; five raider ships beat one liburnian.
  //   ram  damage of a ram strike on a ship within RAM_REACH (every RAM_COOLDOWN ticks)
  //   crew raiders a raider ship carries (pots: CONFIG.RAID_SHIP_POTS)
  liburnian: {
    name: 'Liburnian', side: 'rome', color: '#a8322b', hp: 180, attack: 13, defense: 6, range: 4.5, aggro: 10,
    speed: 0.12, cooldown: 30, upkeep: 4, naval: true, ranged: true, ram: 45,
    trainedRam: 55, trainedSpeed: 0.135, trainedDefense: 3, strength: 4, trainedStrength: 6,
    desc: 'A light warship of the provincial fleet: two banks of oars, a bronze ram. Its marines shoot raider ships, and it rams those it reaches. Built at a Navalia from timber, iron and linen; berths at a Naval Station.',
  },
  raider_ship: {
    name: 'Raider Ship', side: 'enemy', color: '#3a2a1e', hp: 140, attack: 9, defense: 4, range: 5, aggro: 5,
    speed: 0.09, cooldown: 40, naval: true, ranged: true, crew: 8,
    desc: 'A dark, lean longship that brings a warband by sea. It throws fire pots at boats and buildings by the shore, puts its raiders ashore and waits offshore for them.',
  },
});

/** Liburnians a Naval Station berths (its squadron). */
export const STATION_CAPACITY = 4;

/** A ram strike reaches this far (tiles) and comes this often (ticks). */
export const RAM_REACH = 1.05;
export const RAM_COOLDOWN = 60;

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
