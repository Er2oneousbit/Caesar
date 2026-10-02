/**
 * walkerTalk.js
 * ----------------------------------------------------------------------------
 * Who a walker is, what it is doing and what it has to say, for the info
 * panel when a walker is clicked. Citizens talk about what troubles the city
 * most (Caesar's legions, raiders, hunger, fires, sickness, troops away at a
 * distant battle, no work, taxes, an angry god), or about
 * their work when nothing does; newcomers, emigrants, foreign traders and
 * the city's criminals (protesters say what upsets their home) have lines of
 * their own. Every line is written for Colonia.
 *
 * Read-only: nothing here changes the simulation. A walker keeps the same
 * line for a few days (the pick is seeded by its id and the date), so the
 * panel does not flicker between lines as it refreshes.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';
import { WALKER_TYPES } from '../data/walkers.js';
import { GOODS, FOOD_TYPES, formatAmount } from '../data/goods.js';
import { GODS, GOD_KEYS } from '../data/gods.js';
import { HOUSE_TIERS } from '../data/housing.js';
import { TRADE_PARTNERS } from '../data/scenarios.js';
import { PERFORMER_NAMES } from '../data/buildings.js';
import { daysMoored } from '../sim/trade.js';
import { trainsNow } from '../sim/training.js';

/** Days a walker keeps saying the same thing. */
const LINE_DAYS = 8;

/** "400 wheat", "3 horses". */
function amountText(good, n) {
  return GOODS[good].unitSize ? formatAmount(good, n) : `${Math.round(n)} ${GOODS[good].name.toLowerCase()}`;
}

const CITY_LINES = Object.freeze({
  hunger: ['My children went to bed hungry again.', 'The market had no bread today. Nor yesterday.', 'Food is scarce. Someone should see to the granaries.'],
  work: ['There is no work to be had. I spend my days in the forum doing nothing.', 'My brother has been out of work for months.', 'Too many hands in this town and not enough jobs.'],
  taxes: ['The tax collector takes more every month.', 'Taxes like these would make a senator weep.'],
  wages: ['The pay is thin this year.', 'A day\'s work hardly buys a loaf.'],
  raid: ['Raiders are coming, they say. I am keeping my door barred.', 'Where are the soldiers when you need them?'],
  legion: ['Caesar\'s own legions, marching on us! What has the governor done?', 'They say the Emperor\'s soldiers make for the governor\'s house first. I would not live next door.', 'Romans against Romans. My grandfather would weep.'],
  troops: ['Caesar wants our soldiers for a war far away. Who will guard the walls?', 'My son marched off with the legion. Pray he comes home.'],
  fire: ['Did you see the smoke? I hope the prefects are quick.', 'Another fire! This city needs more prefects.'],
  sick: ['There is fever in the next street. I am keeping the children indoors.', 'A whole family down the road has taken ill. Where is the physician?', 'They say the sickness came from those crowded rooms by the market.'],
  debt: ['They say the treasury is empty. How does a city run out of money?'],
  unhappy: ['Nothing works in this city.', 'I am thinking of packing up and leaving.'],
  happy: ['What a city! I would not live anywhere else.', 'Life is good here. The gods smile on us.', 'I tell my cousins to come and live here.'],
  fine: ['Not a bad place to live, all told.', 'Another fine day in the colony.', 'The streets are busy today.'],
});

/** What citizens fear from each angry god (its wrath, sim/religion.js). */
const GOD_FEARS = Object.freeze({
  ceres: 'Pray the blight spares the fields this year.',
  neptune: 'The river is restless. I would not live by the water now.',
  mercury: 'Goods go missing from the storehouses. Mercury is not pleased.',
  mars: 'Brawls every night. Mars wants blood.',
  venus: 'Nobody smiles in this city any more. Venus has turned away.',
});

/** Gossip about an angry god, by its key. */
const godLines = (key) => {
  const god = GODS[key].name;
  return [`The priests say ${god} is angry with us.`, `We have forgotten ${god}, and ${god} has not forgotten us.`, ...(GOD_FEARS[key] ? [GOD_FEARS[key]] : [])];
};

/** What each kind of walker says about its own work. */
function workLines(game, w) {
  const god = w.god && GODS[w.god] ? GODS[w.god].name : 'the gods';
  switch (w.type) {
    case 'prefect':
      if (w.state === 'toFire') return ['Out of the way! Fire!'];
      if (w.state === 'hunt') return ['Stop, in the name of the law!', 'After him! Do not let him get away!'];
      if (w.state === 'extinguish') return ['More water! Keep it coming!'];
      return ['Keep your lamps trimmed and your hearths swept.', 'Quiet streets. Just how I like them.', 'One spark on a dry roof and the whole street goes up.'];
    case 'engineer': return ['These walls will not mend themselves.', 'A crack today is a collapse tomorrow.', 'Good stone, poor mortar. I see it everywhere.'];
    case 'priest': return [`${god} watches over this street.`, `Honor ${god}, and ${god} will honor you.`, 'Bring an offering to the temple, friend.'];
    case 'teacher': return ['The children are learning their letters. Some of them, anyway.', 'An educated city is a strong city.'];
    case 'librarian': return ['I have a scroll here on the voyages of Ulysses. Care to borrow it?', 'Knowledge is the one thing no raider can carry off.'];
    case 'scholar': return ['Today, rhetoric. Tomorrow, philosophy. The day after, more rhetoric.', 'A citizen should be able to argue both sides of any case.'];
    case 'barber': return ['A shave, a trim and all the news of the town.', 'You would not believe what I heard at my chair today.'];
    case 'physician':
      if (w.state === 'toSick') return ['Make way! There is fever in a house down the street.', 'Hot water and clean linen, and quickly!'];
      if (w.state === 'treat') return ['Rest, broth and fresh air. You will mend.', 'Keep the sick apart from the rest of the house.'];
      return ['Boil your water and air your rooms.', 'A clean house keeps the fever away.'];
    case 'bather': return ['The baths are warm today. Come along!', 'Nothing clears the head like a hot bath and a cold plunge.'];
    case 'charioteer': return ['The Blues will win today, mark my words!', 'Races at the hippodrome! Seven laps, four teams, one winner!'];
    case 'entertainer':
      if (w.venue === 'amphitheater') return ['Gladiators at the amphitheater! Do not miss it!'];
      if (w.venue === 'colosseum') return ['Beasts from Africa at the arena! Come and see!'];
      return ['A new play tonight at the theater. A comedy!'];
    case 'taxman': return ['Everyone pays their share. Well, almost everyone.', 'Rome needs its taxes, and I need my list.'];
    case 'vendor': {
      const market = game.buildings.get(w.origin);
      const food = market && market.stock ? FOOD_TYPES.reduce((n, f) => n + (market.stock[f] || 0), 0) : 0;
      if (market && food <= 0) return ['Nothing to sell today. The granary sent us nothing.'];
      return ['Bread! Olives! Pots and bowls!', 'Fresh from the granary, good people!'];
    }
    case 'cart':
      if (w.state === 'collect') return ['Off to fetch more. They want it kept in stock here.', 'Empty there, full on the way back.'];
      if (w.state === 'dockFetch') return ['The ship will not wait for ever. Off to the warehouse!', 'Load the ship, then home for a cup of wine.'];
      if (w.cargo) return [`${amountText(w.cargo.good, w.cargo.amount)} on board. Mind the wheels!`, 'Heavy load, but it pays.'];
      return ['Back for the next load.'];
    case 'buyer': return w.load && Object.keys(w.load).length ? ['A full basket for the market. My back will not thank me.'] : ['The market needs stock. Off to the storehouse.'];
    case 'performer': return w.venue === 'hippodrome' ? ['Fresh horses for the races. Make way!'] : ['Off to the stage. The show must go on.'];
    case 'recruit':
      if (w.state === 'toAcademy') return ['First the drill yard, then the fort.', 'They say the academy makes a soldier of a farm boy.'];
      if (w.state === 'training') return ['Left foot, right foot, shield up. Again!', 'A month at the post with a wooden sword, they say. My arms ache already.'];
      if (w.trained) return ['Close order, shields up: let them throw their stones.', 'Twenty years of service, and then a farm of my own.'];
      return ['Off to the fort. Rome needs me.', 'Twenty years of service, and then a farm of my own.'];
    case 'homeless': return ['Our home is gone. Is there a roof anywhere?', 'We lost everything. We need a place to stay.'];
    default: return CITY_LINES.fine;
  }
}

/** The city's most pressing trouble, as a key of CITY_LINES (or 'god:<key>'), or null. */
export function cityTrouble(game) {
  const c = game.city;
  const mil = game.military;
  if (mil && mil.caesar && (mil.caesar.army || mil.caesar.countdown > 0)) return 'legion'; // (sim/legion.js)
  if (mil && (mil.active || mil.warned)) return 'raid';
  if (c.population > 60 && c.fedShare < 0.85) return 'hunger';
  if (game.fires && game.fires.size > 0) return 'fire';
  if (anySick(game)) return 'sick';
  if (mil && mil.battle && mil.battle.sent && mil.battle.phase !== 'foreign') return 'troops'; // troops away at a distant battle
  if (c.unemploymentRate > 0.12) return 'work';
  if (c.taxRate > CONFIG.DEFAULT_TAX_RATE + 2) return 'taxes';
  if (c.wage < CONFIG.BASE_WAGE) return 'wages';
  if (c.treasury < 0) return 'debt';
  let angry = null;
  for (const g of GOD_KEYS) if (c.gods[g] && c.gods[g].mood < 30 && (!angry || c.gods[g].mood < c.gods[angry].mood)) angry = g;
  if (angry) return `god:${angry}`;
  if (c.sentiment < 35) return 'unhappy';
  return null;
}

/** Is any home sick right now (sim/disease.js)? */
function anySick(game) {
  for (const b of game.buildings.values()) if (b.house && b.house.pop > 0 && b.house.sick > 0) return true;
  return false;
}

/** Why emigrants are leaving: the worst factor in the city's mood. */
function emigrantLine(game) {
  const f = game.city.sentimentFactors || {};
  let worst = null;
  for (const k of ['taxes', 'wages', 'unemployment', 'food', 'housing', 'gods', 'venus']) if (f[k] < 0 && (!worst || f[k] < f[worst])) worst = k;
  return {
    taxes: 'The taxes drove us out.',
    wages: 'The pay was too poor to live on.',
    unemployment: 'There is no work here for us.',
    food: 'We could not feed the children.',
    housing: 'Our home was no better than a hut.',
    gods: 'The gods have turned their backs on this city.',
    venus: 'Venus has turned her back on this city, and so have we.',
  }[worst] || 'This city has nothing left for us.';
}

/** A protester's grievance: what upsets his home most (sim/mood.js). */
function protesterLine(game, w) {
  const home = game.buildings.get(w.home);
  const why = home && home.house ? home.house.moodReason : null;
  return {
    hunger: 'Bread! We want bread!',
    envy: 'They dine off silver in their villas while we sleep in the mud!',
    squalor: 'Look at our street! Who would raise children here?',
    taxes: 'No more taxes! We have nothing left to give!',
    wages: 'Fair pay for honest work!',
    unemployment: 'Give us work! We have hands and nothing to do with them!',
    food: 'The granaries are empty and nobody cares!',
    housing: 'Is this how Rome houses its citizens?',
    gods: 'The gods have left us, and so has the governor!',
    venus: 'Even Venus has abandoned us! Where is the joy in this city?',
  }[why] || pick(['We will be heard!', 'Enough is enough!'], w, game);
}

/** A stable pseudo-random pick: the same walker says the same thing for LINE_DAYS days. */
function pick(lines, w, game, salt = 0) {
  const seed = (w.id * 2654435761 + Math.floor(game.time.totalDays / LINE_DAYS) * 40503 + salt * 97) >>> 0;
  return lines[seed % lines.length];
}

/** What the walker says. */
export function walkerSays(game, w) {
  const c = game.city;
  switch (w.type) {
    case 'immigrant': return pick(['We heard there was room for a family here.', 'A new city, a new start.', 'Is this the road to the colony? We have walked a long way.'], w, game);
    case 'emigrant': return emigrantLine(game);
    case 'caravan': {
      const p = TRADE_PARTNERS[w.partner];
      return pick([`Good roads and fair prices. ${p ? p.name : 'Home'} will send us again.`, 'Mind the mules, they bite.'], w, game);
    }
    case 'ship': return pick(['A fair wind brought us in. A fair price will send us home.', 'Unload the cargo, and quickly!'], w, game);
    case 'fishing_boat':
      if (w.state === 'fishing') return pick(['Haul! Haul! They are running thick today.', 'Follow the gulls and you find the fish.'], w, game);
      if (w.state === 'homeWithCatch') return pick(['A good catch. The granary will have fish tonight.', 'Home before the wind turns.'], w, game);
      return pick(['Nets mended, sail up.', 'The sea feeds those who work it.'], w, game);
    case 'protester': return protesterLine(game, w);
    case 'thief': return pick(['Nothing to see here, friend. Keep walking.', 'Who, me? Just taking the air.', 'A man has to eat.'], w, game);
    case 'rioter': return pick(['Burn it! Burn it all!', 'They will listen to us now!', 'Down with the governor!'], w, game);
    default: break;
  }
  const work = workLines(game, w);
  // Busy with something urgent: no time for gossip.
  if (w.state === 'toFire' || w.state === 'extinguish' || w.state === 'toSick' || w.state === 'treat') return pick(work, w, game);
  const trouble = cityTrouble(game);
  // Every other walker mentions the city's trouble; the rest talk shop.
  const gossip = pick([true, false], w, game, 1);
  if (trouble && gossip) return pick(trouble.startsWith('god:') ? godLines(trouble.slice(4)) : CITY_LINES[trouble], w, game, 2);
  if (!trouble && gossip) return pick(c.sentiment >= 70 ? CITY_LINES.happy : CITY_LINES.fine, w, game, 2);
  return pick(work, w, game, 3);
}

/** The name of a building for these panels. */
function nameOf(b) {
  if (!b) return null;
  return b.house ? HOUSE_TIERS[b.house.tier].name : b.def.name;
}

/** "the Granarium", "the Hut". */
function the(b) {
  const n = nameOf(b);
  return n ? `the ${n}` : 'somewhere';
}

/** "the Massilia ship": the ship a dock worker's claim is for. */
function shipName(game, w) {
  const ship = w.claim ? game.walkers.get(w.claim.ship) : null;
  const p = ship ? TRADE_PARTNERS[ship.partner] : null;
  return p ? `the ${p.name} ship` : 'the ship';
}

/** What the walker is doing, in a few words. */
export function walkerDoing(game, w) {
  const target = w.target ? game.buildings.get(w.target) : null;
  switch (w.state) {
    case 'roam': return 'Walking the streets';
    case 'return':
      if (w.claim && w.cargo) return `Bringing ${amountText(w.cargo.good, w.cargo.amount)} to ${shipName(game, w)}`;
      return w.type === 'cart' || w.type === 'buyer' ? `Heading back to ${the(game.buildings.get(w.origin))}` : 'Heading home';
    case 'toFire': return 'Running to a fire';
    case 'toSick': return `Hurrying to ${target ? `a sick ${nameOf(target)}` : 'a sick home'}`;
    case 'treat': return 'Treating the sick';
    case 'extinguish': return 'Fighting a fire';
    case 'deliver': return `Taking goods to ${the(target)}`;
    case 'fetch':
    case 'collect': return `Going to ${the(target)} for ${w.want ? GOODS[w.want].name.toLowerCase() : 'goods'}`;
    case 'toHouse': return `Moving into ${target ? `a ${nameOf(target)}` : 'a new home'}`;
    case 'seeking': return 'Looking for a home';
    case 'leaving':
      if (w.type === 'caravan') return 'Heading home along the Imperial road';
      if (w.type === 'ship') return 'Sailing home';
      return 'Leaving the city';
    case 'toVenue': return `On the way to perform at ${the(target)}`;
    case 'toAcademy': return `Marching to ${the(game.buildings.get(w.academy))} to be trained, then to ${the(target)}`;
    case 'training': {
      const academy = game.buildings.get(w.academy);
      const days = Math.ceil((w.trainLeft || 0) / CONFIG.TICKS_PER_DAY);
      return `Training at ${the(academy)} for ${the(target)}: ${days} day${days === 1 ? '' : 's'} left${trainsNow(game, academy) ? '' : ' (paused: the academy is short of staff)'}`;
    }
    case 'toFort': return `Marching to ${the(target)}${w.trained ? ', trained at the Campus' : ''}`;
    case 'toWarehouse': return `Bringing goods to ${the(target)}`;
    case 'toDock': return `Sailing to ${the(target)}`;
    case 'spare': return 'Waiting by the shipyard for a wharf';
    case 'toWharf': return `Sailing to ${the(game.buildings.get(w.origin))}`;
    case 'moored': return 'Tied up at the wharf';
    case 'toGround': return 'Sailing out to the fishing ground';
    case 'fishing': return 'Fishing';
    case 'homeWithCatch': return 'Bringing the catch home';
    case 'docked':
      if (w.unload && Object.values(w.unload).some((n) => n > 0)) return 'Unloading at the dock';
      if (w.wants && Object.values(w.wants).some((n) => n > 0)) return w.wantsStuck ? 'Waiting for goods' : 'Loading at the dock';
      return 'Casting off';
    case 'dockFetch': return `Fetching ${w.want ? GOODS[w.want].name.toLowerCase() : 'goods'} for ${shipName(game, w)}`;
    case 'protest': return 'Protesting in the street';
    case 'steal': return target ? `Sneaking toward ${the(target)}` : 'Up to no good';
    case 'riot': return w.waitTicks > 0 ? 'Setting the street alight' : `Rioting${target ? `, heading for ${the(target)}` : ''}`;
    case 'hunt': return w.type === 'prefect' ? 'Chasing a criminal' : 'Waiting';
    default: return 'Waiting';
  }
}

/**
 * A caravan's or ship's business. After trading: what it bought from the city
 * and sold to it, with the money (sim/trade.js keeps it as w.deal). On its way
 * in: what it comes for, from the partner's wants and your export and import
 * settings (it may still find nothing to spare, or no room or money). A ship
 * at the dock: what it still has to unload and to buy, the deal so far, and
 * its days there.
 * @returns {[string, string][]}
 */
export function tradeRows(game, w) {
  const list = (goods) => goods.map((g) => GOODS[g].name.toLowerCase()).join(', ');
  const items = (o) => Object.entries(o).filter(([, n]) => n > 0).map(([g, n]) => amountText(g, n)).join(', ');
  if (w.type === 'ship' && w.state === 'docked' && w.deal) {
    const d = w.deal;
    const days = daysMoored(game, w);
    return [
      ['Still to unload', items(w.unload || {}) || 'Nothing'],
      ['Still to buy', items(w.wants || {}) || 'Nothing'],
      ['Bought here so far', Object.keys(d.sold).length ? `${items(d.sold)} (you earned ${d.earned} Dn)` : 'Nothing yet'],
      ['Sold here so far', Object.keys(d.bought).length ? `${items(d.bought)} (you paid ${d.spent} Dn)` : 'Nothing yet'],
      ['Days at the dock', `${days} (sails by day ${CONFIG.SHIP_MAX_STAY_DAYS} at the latest)`],
    ];
  }
  if (w.deal) {
    const d = w.deal;
    return [
      ['Bought here', Object.keys(d.sold).length ? `${items(d.sold)} (you earned ${d.earned} Dn)` : 'Nothing'],
      ['Sold here', Object.keys(d.bought).length ? `${items(d.bought)} (you paid ${d.spent} Dn)` : 'Nothing'],
    ];
  }
  const p = TRADE_PARTNERS[w.partner];
  const settings = game.city.trade.settings;
  const buys = Object.keys(p.buys).filter((g) => settings[g]?.mode === 'export');
  const sells = Object.keys(p.sells).filter((g) => settings[g]?.mode === 'import');
  return [
    ['Comes to buy', buys.length ? list(buys) : 'Nothing you export'],
    ['Comes to sell', sells.length ? list(sells) : 'Nothing you import'],
  ];
}

/**
 * Everything the info panel shows about a walker.
 * @returns {{title:string, desc:string, rows:[string, string][], says:string}}
 */
export function walkerInfo(game, w) {
  const def = WALKER_TYPES[w.type];
  const rows = [];
  const origin = w.origin ? game.buildings.get(w.origin) : null;
  if (w.partner && TRADE_PARTNERS[w.partner]) rows.push(['From', TRADE_PARTNERS[w.partner].name]);
  else if (origin) rows.push(['From', nameOf(origin)]);
  else if (w.type === 'immigrant') rows.push(['From', 'Beyond the map edge']);
  else if (w.home && game.buildings.get(w.home)) rows.push(['From', nameOf(game.buildings.get(w.home))]); // criminals: their home
  rows.push(['Doing', walkerDoing(game, w)]);
  if (w.type === 'performer' && w.venue) rows.push(['Act', PERFORMER_NAMES[w.venue] || w.venue]);
  if (w.cargo && w.cargo.amount > 0) rows.push(['Carrying', amountText(w.cargo.good, w.cargo.amount)]);
  if (w.load) {
    const items = Object.entries(w.load).filter(([, n]) => n > 0).map(([g, n]) => amountText(g, n));
    if (items.length) rows.push(['Carrying', items.join(', ')]);
  }
  if (w.people > 0) rows.push(['People', String(w.people)]);
  if (w.type === 'priest' && w.god && GODS[w.god]) rows.push(['God', GODS[w.god].name]);
  if ((w.type === 'caravan' || w.type === 'ship') && TRADE_PARTNERS[w.partner]) rows.push(...tradeRows(game, w));
  return { title: def.name, desc: def.desc, rows, says: walkerSays(game, w) };
}
