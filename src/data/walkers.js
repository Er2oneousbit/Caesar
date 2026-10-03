/**
 * walkers.js (data)
 * ----------------------------------------------------------------------------
 * Walker (citizen figure) definitions.
 *
 *   kind:
 *     'roamer'   leaves a building, wanders the roads serving nearby buildings,
 *                then walks home. (prefects, priests, market vendors...)
 *     'carrier'  walks a road path to a target building, does something there
 *                (deliver/collect), then returns home. (carts, market buyers)
 *     'traveler' walks to a destination and disappears there.
 *                (immigrants, emigrants, performers, caravans)
 *     'ship'     sails over water, not roads. (merchant ships, fishing boats)
 *     'criminal' bred by an unhappy home (sim/crime.js): stands in the street,
 *                sneaks to the Forum, or (rioters) crosses open land.
 *                (protesters, thieves, rioters)
 *   effect:    what a roamer does to buildings within SERVICE_RADIUS
 *   group:     roamers: which roadblock permission lets them pass (ROADBLOCK_GROUPS)
 *   tunic/skin/item: drawing hints for render/walkerArt.js
 *   roam:      tiles walked before turning home (roamers only)
 *   speed:     x WALKER_SPEED (default 1)
 * ----------------------------------------------------------------------------
 */

export const WALKER_TYPES = Object.freeze({
  prefect: { name: 'Prefect', kind: 'roamer', group: 'maintenance', effect: 'fire', tunic: '#b3322a', item: 'bucket', roam: 30, desc: 'Inspects buildings for fire hazards and fights fires.' },
  engineer: { name: 'Engineer', kind: 'roamer', group: 'maintenance', effect: 'damage', tunic: '#8a6a3a', item: 'hammer', roam: 30, desc: 'Repairs buildings before they collapse.' },
  priest: { name: 'Priest', kind: 'roamer', group: 'religion', effect: 'religion', tunic: '#f2efe6', item: 'staff', roam: 26, desc: 'Brings the word of the gods to homes.' },
  teacher: { name: 'Teacher', kind: 'roamer', group: 'education', effect: 'school', tunic: '#4a6fa5', item: 'scroll', roam: 24, desc: 'Teaches the children of the neighborhood.' },
  librarian: { name: 'Librarian', kind: 'roamer', group: 'education', effect: 'library', tunic: '#5c4a8a', item: 'scroll', roam: 26, desc: 'Lends scrolls to curious citizens.' },
  scholar: { name: 'Scholar', kind: 'roamer', group: 'education', effect: 'academy', tunic: '#2e5a4a', item: 'scroll', roam: 28, desc: 'Lectures on philosophy and rhetoric.' },
  barber: { name: 'Barber', kind: 'roamer', group: 'health', effect: 'barber', tunic: '#c8a24a', item: 'none', roam: 22, desc: 'Keeps citizens groomed and gossip flowing.' },
  physician: { name: 'Physician', kind: 'roamer', group: 'health', effect: 'clinic', tunic: '#3f8f5a', item: 'bag', roam: 26, desc: 'Treats the sick in their homes.' },
  bather: { name: 'Bath Attendant', kind: 'roamer', group: 'health', effect: 'baths', tunic: '#5fa8c8', item: 'towel', roam: 24, desc: 'Invites citizens to the public baths.' },
  entertainer: { name: 'Entertainer', kind: 'roamer', group: 'entertainment', effect: 'venue', tunic: '#d4573b', item: 'mask', roam: 26, desc: 'Announces shows at the local venue.' },
  // Twice as fast and twice as far as the other entertainers, as in the original.
  charioteer: { name: 'Charioteer', kind: 'roamer', group: 'entertainment', effect: 'venue', tunic: '#2f6db5', item: 'chariot', roam: 52, speed: 2, desc: 'Drives a racing chariot through the streets to bring people to the races.' },
  // The Topiaria's gardener (sim/gardens.js): tends the gardens and statues
  // within SERVICE_RADIUS of his road, drawn to the ones longest untended.
  gardener: { name: 'Topiarius (Gardener)', kind: 'roamer', group: 'maintenance', effect: 'tend', tunic: '#5f7d3a', item: 'shears', roam: 30, desc: 'Clips the hedges, weeds the beds and scrubs the statues of every garden and statue he passes, so they keep their full desirability.' },
  taxman: { name: 'Tax Collector', kind: 'roamer', group: 'tax', effect: 'tax', tunic: '#3d3d6b', item: 'purse', roam: 30, desc: 'Registers households for taxation.' },
  // Native villages (sim/natives.js): the mission post's walker calms every
  // hut and meeting place within 4 tiles of him (not SERVICE_RADIUS); a
  // village's trader walks over open land to a warehouse and back.
  missionary: { name: 'Missionary', kind: 'roamer', group: 'religion', effect: 'mission', tunic: '#d9cfa6', item: 'staff', roam: 32, desc: 'An envoy from the mission post who visits the native villages and keeps the peace with them.' },
  native_trader: { name: 'Village Trader', kind: 'traveler', tunic: '#7d6a3e', item: 'bundle', desc: 'A villager come to buy the goods you export, a few loads a visit.' },
  vendor: { name: 'Market Vendor', kind: 'roamer', group: 'market', effect: 'market', tunic: '#b86b2a', item: 'basket', roam: 30, desc: 'Sells food and goods door to door.' },

  cart: { name: 'Cart Pusher', kind: 'carrier', tunic: '#9a7b4f', item: 'cart', desc: 'Moves goods between buildings.' },
  buyer: { name: 'Market Buyer', kind: 'carrier', tunic: '#b86b2a', item: 'basket', desc: 'Buys supplies for the market.' },

  immigrant: { name: 'Immigrant', kind: 'traveler', tunic: '#8c7b63', item: 'bundle', desc: 'Newcomers looking for a home.' },
  emigrant: { name: 'Emigrant', kind: 'traveler', tunic: '#6b6358', item: 'bundle', desc: 'Unhappy citizens leaving the city.' },
  homeless: { name: 'Homeless', kind: 'traveler', tunic: '#5a544c', item: 'bundle', desc: 'Lost their home and are searching for a new one.' },
  performer: { name: 'Performer', kind: 'traveler', tunic: '#d98c2b', item: 'mask', desc: 'Heading to a venue to perform.' },
  recruit: { name: 'Recruit', kind: 'traveler', tunic: '#a8322b', item: 'spear', desc: 'A freshly trained soldier marching to his fort.' },
  caravan: { name: 'Trade Caravan', kind: 'traveler', tunic: '#6b4a2a', item: 'mule', desc: 'Merchants from a distant city, travelling overland.' },
  ship: { name: 'Merchant Ship', kind: 'ship', tunic: '#6b4a2a', item: null, desc: 'A trading ship on a sea route. Sails from the map edge to an Emporium and back.' },
  fishing_boat: { name: 'Fishing Boat', kind: 'ship', tunic: '#7a5a3a', item: 'net', desc: 'Built at a Fabrica Navalis, it works for one Piscatoria (Fishing Wharf): out to the fishing grounds, 4 days with the nets, home with 100 fish.' },

  // Unhappy homes breed these (sim/crime.js). Prefects and soldiers catch them.
  protester: { name: 'Protester', kind: 'criminal', tunic: '#8a7a62', item: 'placard', desc: 'An unhappy citizen airing his grievances in the street. Harmless, but a sign of unrest.' },
  thief: { name: 'Thief', kind: 'criminal', tunic: '#34323a', item: 'sack', roam: 12, desc: 'Sneaking to the Forum or a market to steal. A prefect who catches him first saves the goods.' },
  rioter: { name: 'Rioter', kind: 'criminal', tunic: '#8e3b26', item: 'torch', desc: 'One of an angry mob setting the city alight. Prefects and soldiers can stop him.' },
});

/**
 * Roadblocks stop walkers who roam the streets serving homes; each roadblock
 * lets through the groups the player ticks (none at first). Anyone heading
 * somewhere (carts, market buyers, settlers, caravans, prefects running to a
 * fire, a roamer on its way home) always passes. `bit` is the group's bit in
 * map.roadblock (see world/map.js ROADBLOCK).
 */
export const ROADBLOCK_GROUPS = Object.freeze([
  { key: 'maintenance', name: 'Prefects, engineers and gardeners', bit: 1 },
  { key: 'religion', name: 'Priests', bit: 2 },
  { key: 'market', name: 'Market vendors', bit: 4 },
  { key: 'entertainment', name: 'Entertainers', bit: 8 },
  { key: 'education', name: 'Teachers, librarians and scholars', bit: 16 },
  { key: 'health', name: 'Barbers, physicians and bath attendants', bit: 32 },
  { key: 'tax', name: 'Tax collectors', bit: 64 },
]);

/** The roadblock bit of a walker type's group (0: not a roamer, never stopped). */
export function roadblockBit(type) {
  const def = WALKER_TYPES[type];
  if (!def || def.kind !== 'roamer' || !def.group) return 0;
  const g = ROADBLOCK_GROUPS.find((x) => x.key === def.group);
  return g ? g.bit : 0;
}
