/**
 * gods.js
 * ----------------------------------------------------------------------------
 * The five patron gods of the colony. Each has a temple, a mood (0-100) and
 * a blessing/wrath effect handled in sim/religion.js.
 * ----------------------------------------------------------------------------
 */

export const GODS = Object.freeze({
  jupiter: {
    name: 'Jupiter',
    domain: 'King of the gods, patron of Rome',
    color: '#5b4fb3',
    blessing: 'The Emperor hears of your piety: favor rises.',
    wrath: 'Lightning strikes the city and sets a building ablaze.',
  },
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
  mars: {
    name: 'Mars',
    domain: 'War and the protection of the city',
    color: '#a8322b',
    blessing: 'Citizens feel safe: peace rating rises.',
    wrath: 'Brawls break out: peace suffers and the treasury is looted.',
  },
  vesta: {
    name: 'Vesta',
    domain: 'Hearth, home and the sacred flame',
    color: '#d9772b',
    blessing: 'The sacred flame is content: fire risk vanishes city-wide.',
    wrath: 'Hearth fires rage out of control in several homes.',
  },
});

export const GOD_KEYS = Object.freeze(Object.keys(GODS));
