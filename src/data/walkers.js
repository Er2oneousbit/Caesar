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
 *   effect:    what a roamer does to buildings within SERVICE_RADIUS
 *   tunic/skin/item: drawing hints for render/walkerArt.js
 *   roam:      tiles walked before turning home (roamers only)
 * ----------------------------------------------------------------------------
 */

export const WALKER_TYPES = Object.freeze({
  prefect: { name: 'Prefect', kind: 'roamer', effect: 'fire', tunic: '#b3322a', item: 'bucket', roam: 30, desc: 'Inspects buildings for fire hazards and fights fires.' },
  engineer: { name: 'Engineer', kind: 'roamer', effect: 'damage', tunic: '#8a6a3a', item: 'hammer', roam: 30, desc: 'Repairs buildings before they collapse.' },
  priest: { name: 'Priest', kind: 'roamer', effect: 'religion', tunic: '#f2efe6', item: 'staff', roam: 26, desc: 'Brings the word of the gods to homes.' },
  teacher: { name: 'Teacher', kind: 'roamer', effect: 'school', tunic: '#4a6fa5', item: 'scroll', roam: 24, desc: 'Teaches the children of the neighborhood.' },
  librarian: { name: 'Librarian', kind: 'roamer', effect: 'library', tunic: '#5c4a8a', item: 'scroll', roam: 26, desc: 'Lends scrolls to curious citizens.' },
  scholar: { name: 'Scholar', kind: 'roamer', effect: 'academy', tunic: '#2e5a4a', item: 'scroll', roam: 28, desc: 'Lectures on philosophy and rhetoric.' },
  barber: { name: 'Barber', kind: 'roamer', effect: 'barber', tunic: '#c8a24a', item: 'none', roam: 22, desc: 'Keeps citizens groomed and gossip flowing.' },
  physician: { name: 'Physician', kind: 'roamer', effect: 'clinic', tunic: '#3f8f5a', item: 'bag', roam: 26, desc: 'Treats the sick in their homes.' },
  bather: { name: 'Bath Attendant', kind: 'roamer', effect: 'baths', tunic: '#5fa8c8', item: 'towel', roam: 24, desc: 'Invites citizens to the public baths.' },
  entertainer: { name: 'Entertainer', kind: 'roamer', effect: 'venue', tunic: '#d4573b', item: 'mask', roam: 26, desc: 'Announces shows at the local venue.' },
  taxman: { name: 'Tax Collector', kind: 'roamer', effect: 'tax', tunic: '#3d3d6b', item: 'purse', roam: 30, desc: 'Registers households for taxation.' },
  vendor: { name: 'Market Vendor', kind: 'roamer', effect: 'market', tunic: '#b86b2a', item: 'basket', roam: 30, desc: 'Sells food and goods door to door.' },

  cart: { name: 'Cart Pusher', kind: 'carrier', tunic: '#9a7b4f', item: 'cart', desc: 'Moves goods between buildings.' },
  buyer: { name: 'Market Buyer', kind: 'carrier', tunic: '#b86b2a', item: 'basket', desc: 'Buys supplies for the market.' },

  immigrant: { name: 'Immigrant', kind: 'traveler', tunic: '#8c7b63', item: 'bundle', desc: 'Newcomers looking for a home.' },
  emigrant: { name: 'Emigrant', kind: 'traveler', tunic: '#6b6358', item: 'bundle', desc: 'Unhappy citizens leaving the city.' },
  homeless: { name: 'Homeless', kind: 'traveler', tunic: '#5a544c', item: 'bundle', desc: 'Lost their home and are searching for a new one.' },
  performer: { name: 'Performer', kind: 'traveler', tunic: '#d98c2b', item: 'mask', desc: 'Heading to a venue to perform.' },
  caravan: { name: 'Trade Caravan', kind: 'traveler', tunic: '#6b4a2a', item: 'mule', desc: 'Merchants from a distant city.' },
});
