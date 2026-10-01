/**
 * gods.js
 * ----------------------------------------------------------------------------
 * The five patron gods of the colony, the original game's five, in its order
 * (the advisor lists them in this order, and the monthly update visits them
 * in it). Each has a temple, a mood (0-100) and a blessing and a wrath,
 * handled in sim/religion.js.
 *
 * color: the priest's tunic, the advisor heading and the temple's pediment
 * (render/buildingArt.js TEMPLE_LOOKS), so each must stand apart from the
 * other four at a glance.
 * harderWrath: angered again before it calms, the god strikes harder (the
 * original's major curse; sim/religion.js). The other gods strike the same.
 *
 * Saves before version 7 had two other gods where Mercury and Venus are
 * now; the loader moves their state over (core/save.js upgradeGodsV6).
 * ----------------------------------------------------------------------------
 */

export const GODS = Object.freeze({
  ceres: {
    name: 'Ceres',
    domain: 'Harvest and fertile fields',
    color: '#c9a227',
    blessing: 'Every farm ripens early: an instant bumper harvest.',
    wrath: 'Blight withers the crops: farm progress is lost.',
  },
  neptune: {
    name: 'Neptune',
    domain: 'Seas, rivers and springs',
    color: '#2f7fb8',
    blessing: 'Merchants sail and ride under his protection: a trade windfall.',
    wrath: 'Floodwater undermines foundations near the water.',
  },
  mercury: {
    name: 'Mercury',
    domain: 'Trade, merchants and travellers',
    color: '#6a4fb0',
    blessing: 'His merchants fill the emptiest granary with food from afar.',
    wrath: 'Goods vanish from the fullest granary or warehouse. Anger him again before he calms and it burns.',
    harderWrath: true,
  },
  mars: {
    name: 'Mars',
    domain: 'War and the protection of the city',
    color: '#a8322b',
    blessing: 'Citizens feel safe: peace rating rises.',
    wrath: 'Brawls break out: peace suffers and the treasury is looted.',
  },
  venus: {
    name: 'Venus',
    domain: 'Love, beauty and the people\'s contentment',
    color: '#c2507a',
    blessing: 'Every home is happier, and the city\'s mood rises for a few months.',
    wrath: 'Homes sour and the city\'s mood falls. Anger her again before she calms and sickness spreads.',
    harderWrath: true,
  },
});

export const GOD_KEYS = Object.freeze(Object.keys(GODS));
