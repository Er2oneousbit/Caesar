/**
 * sites.js (data)
 * ----------------------------------------------------------------------------
 * Where the player's province sits on the empire map. Each campaign mission
 * names its site (scenario `site`), the real place its city stood or the
 * country it belongs to; the sandbox is on the Etruscan coast unless its
 * setup picks another of SANDBOX_SITES. The map's routes, the traders' trip,
 * the army's march to a distant battle, where raiders are drawn and the
 * road Caesar's legions take all start from the site (data/empireRoutes.js).
 *
 * Site fields:
 *   name       the place, for the sandbox setup and the empire map's tooltip
 *   region     the country, for the sandbox setup ("Etruria")
 *   pos        [x, y] on the empire map: at(longitude, latitude)
 *   frontier   the compass side a warband only rumoured is drawn on, over
 *              land toward the province's likely enemies (ui/empireMap.js)
 *   river      optional [lon, lat] points ships take between the site and
 *              the sea, up a river (Corduba, on the Baetis): the last point
 *              is the river's mouth, where the sea lanes begin
 *
 * Every site is on land; every site that trades by sea has water within 2
 * map units, or a river (tests/sites.test.mjs).
 *
 * Pure data: nothing here is saved. A campaign save stores its mission's id
 * and so loads at that mission's site; a sandbox save stores its scenario,
 * `site` and all, and one made before sites existed has none, which is the
 * Etruscan coast, where every province used to be.
 * ----------------------------------------------------------------------------
 */

import { at } from './empireGeo.js';

/** The site every province had before missions moved: the Etruscan coast by the mouth of the Arno, Pisae's country. */
export const HOME_SITE = 'etruria';

export const SITES = Object.freeze({
  // Rome's base against the Ligurians from 238 BC, at the river crossing by
  // Pisae: on the coast, so ships can come; on the peninsula, so caravans walk
  // in from Gaul, over the Alps, along the Po and from Capua through Rome.
  etruria: { name: 'The Etruscan coast', region: 'Etruria', pos: at(10.45, 43.72), frontier: 'north' },
  // A colony of the early third century BC at a river mouth on the Adriatic.
  castrum_novum: { name: 'Castrum Novum', region: 'Picenum', pos: at(13.96, 42.75), frontier: 'north-west' },
  // The lake country of southern Etruria, where Rome resettled the Volsinians in 264 BC.
  volsinii: { name: 'Volsinii', region: 'Etruria', pos: at(11.99, 42.64), frontier: 'north' },
  // The upper Arno valley: the town's name means the potteries.
  figline: { name: 'Figlinae', region: 'Etruria', pos: at(11.42, 43.62), frontier: 'north' },
  // The Latin colony of 264 BC on its hill above the Adriatic.
  firmum: { name: 'Firmum', region: 'Picenum', pos: at(13.72, 43.16), frontier: 'north-west' },
  paestum: { name: 'Paestum', region: 'Lucania', pos: at(15.0, 40.42), frontier: 'north-west' },
  // The Etruscan iron port, with ore from Elba and the hills behind it.
  populonia: { name: 'Populonia', region: 'Etruria', pos: at(10.52, 42.99), frontier: 'north' },
  beneventum: { name: 'Beneventum', region: 'Samnium', pos: at(14.78, 41.13), frontier: 'north-west' },
  // Luceria on the dry plain of Apulia, the thirstiest part of Italy.
  luceria: { name: 'Luceria', region: 'Apulia', pos: at(15.34, 41.51), frontier: 'north-west' },
  cosa: { name: 'Cosa', region: 'Etruria', pos: at(11.29, 42.41), frontier: 'north' },
  // Copia, the Roman colony at Thurii on the Gulf of Tarentum.
  copia: { name: 'Copia', region: 'Bruttium', pos: at(16.47, 39.71), frontier: 'north-west' },
  // On the Via Aemilia; its frontier is the Ligurian hills toward Genua.
  mutina: { name: 'Mutina', region: 'Gallia Cisalpina', pos: at(10.93, 44.65), frontier: 'west' },
  luna: { name: 'Luna', region: 'Liguria', pos: at(10.03, 44.07), frontier: 'north' },
  // On the Baetis: ships come up the river from its mouth by Hispalis.
  corduba: { name: 'Corduba', region: 'Hispania', pos: at(-4.78, 37.88), frontier: 'north-west', river: [[-5.99, 37.39], [-6.36, 36.8]] },
  // On the bay below the Rock, inside the strait.
  carteia: { name: 'Carteia', region: 'Hispania', pos: at(-5.42, 36.18), frontier: 'north' },
  // On the Via Domitia; the Cimbri and the Teutones came from the north.
  narbo: { name: 'Narbo Martius', region: 'Gallia Narbonensis', pos: at(3.0, 43.18), frontier: 'north' },
  // On the Bay of Naples. The real latitude, 40.82, falls in the water on
  // the map's coarse coast; 40.86 is on land.
  puteoli: { name: 'Puteoli', region: 'Campania', pos: at(14.12, 40.86), frontier: 'north-west' },
});

export const SITE_IDS = Object.freeze(Object.keys(SITES));

/**
 * The sandbox setup's choice of site: coastal places from which every one of
 * the twelve partners and every city a sandbox request may name is in reach
 * (the requests within 12 months' march; a test holds it). The Hispanian
 * sites are left out: from there Messana and Placentia are 11 to 16 months
 * away. The Etruscan coast comes first: it is the default.
 */
export const SANDBOX_SITES = Object.freeze(['etruria', 'luna', 'cosa', 'puteoli', 'paestum', 'narbo']);

/** A scenario's site id: its own `site`, or the Etruscan coast (a sandbox saved before sites, or none given). */
export function siteIdOf(scenario) {
  const id = scenario?.site;
  return typeof id === 'string' && Object.hasOwn(SITES, id) ? id : HOME_SITE;
}

/** The site of a game in play. */
export function homeSiteId(game) {
  return siteIdOf(game?.scenario);
}

