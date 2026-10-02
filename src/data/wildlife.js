/**
 * wildlife.js (data)
 * ----------------------------------------------------------------------------
 * Wolf packs (sim/wildlife.js): where they live and how they behave.
 *
 * The original placed a pack at points its map designers chose, on its
 * northern maps. Colonia has no designer, so the packs go to the missions of
 * the north and the hills, where the Apennine wolf still ran in Roman
 * times, and the dens are drawn from the map's seed (sim/wildlife.js
 * placePacks). None in the first two missions (they teach the basics), none
 * on the desert map; the sandbox has a switch in its setup, off unless asked.
 *
 * Nothing here is saved: a game's packs (`game.wildlife`) are.
 * ----------------------------------------------------------------------------
 */

/**
 * Missions whose maps have wolf packs (by id; data/scenarios.js). Only
 * missions that can build a fort or a watchtower: a pack grows back while
 * one wolf lives, and prefects alone lose to wolves, so where the army is
 * not unlocked a pack could never be cleared (Luna, the peaceful
 * province of the white mountains, was left out for that).
 */
export const WOLVES_BY_MISSION = Object.freeze({
  c3m: true, // Firmum: the Picene hills
  c4: true, // Pons Aelius: the wooded valley of the Arno
  c8m: true, // Mutina: the Ligurian hills
  c10m: true, // Narbo Martius: the Cevennes behind the coast
});

export const WOLF = Object.freeze({
  packMin: 6, // wolves in a pack: 6 to 8 (the original's 8)
  packMax: 8,
  landPerPack: 10000, // a pack for each 100 x 100 tiles of land, 1 to maxPacks
  maxPacks: 4,
  denWoods: 15, // trees within 3 tiles of a den (of 49), so it is in a wood
  denFromEntry: 30, // tiles from the map's entry and exit, at least
  denFromRoad: 10, // ...and from the Imperial road
  denApart: 25, // ...and from each other
  roamDays: 3, // a pack moves on 3 days after it has gathered at its spot (the original's 6 checks, twice a day)
  gatherDays: 12, // ...or this long after it set out, whatever its stragglers do
  roamReach: 16, // up to this far from where it is
  roamLeash: 22, // never farther than this from its den
  roamDesire: 1, // desirability a spot may have (the city's edge, not its heart)
  roamDesireWinter: 2, // ...in winter, hungrier, a little nearer
  roamClear: 6, // no building this near the spot (they keep to open country)...
  roamRoad: 2, // ...nor a road, where the walkers are
  roamSoldiers: 8, // no Roman soldier this near the spot
  fedDays: 2, // a pack that has killed eats and rests this long before it hunts again
  notice: 2.5, // a walker this near a wolf sets the pack hunting
  huntReach: 6, // a hunting wolf picks a walker this near it (the original's 6)
  huntLeash: 12, // ...and gives up beyond this far from the pack's spot
  huntCalm: 120, // ticks with no prey before a pack calms down
  refillDays: 16, // a pack with a wolf left grows one back every 16 days (a month)
  messageDays: 16, // a message about wolves killing walkers at most this often
});
