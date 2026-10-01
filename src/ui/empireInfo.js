/**
 * empireInfo.js
 * ----------------------------------------------------------------------------
 * Words for Caesar's legions and his calls for troops (sim/legion.js,
 * sim/battle.js), for the Imperial and Military advisors and the info panels
 * of forts and Naval Stations. The text functions read game state only and
 * are tested headless; serviceButton and archLine build small elements.
 * ----------------------------------------------------------------------------
 */

import { h, kv } from './dom.js';
import { CONFIG } from '../config.js';
import { legionSummary } from '../sim/legion.js';
import { archesToBuild, setService, fleetCanGo, currentBattle } from '../sim/battle.js';
import { THREATENED_CITIES } from '../data/battles.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Caesar's anger in words: { level: none | warn | bad, status, note, show, map }.
 * `show`: his men are on the map (a button looks at them); `map`: they are on
 * the road (a button opens the empire map).
 */
export function legionText(game) {
  const s = legionSummary(game);
  const d = game.difficulty;
  const bands = `At ${d.legionHome} favor or more they march home; from ${d.legionHalt} they halt where they stand (in their first year); below that they attack your residence first, then the finest homes.`;
  if (s.state === 'marching') {
    return { level: 'warn', status: `${s.size} of Caesar's legionaries are marching from Rome: they arrive in ${s.months > 0 ? `about ${plural(s.months, 'month')}` : 'a few days'}.`, note: `Nothing stops their march, but your favor when they come decides what they do. ${bands}`, map: true };
  }
  if (s.state === 'attack' || s.state === 'halted' || s.state === 'leaving') {
    const what = s.state === 'halted' ? 'halted, waiting on your favor' : s.state === 'leaving' ? 'marching home' : 'attacking';
    return { level: 'bad', status: `Caesar's legions are in the province: ${s.men} of ${s.size} left, ${what}.`, note: `${bands} Destroy them and Caesar will respect your stand (+${CONFIG.LEGION_RESPECT} favor); an army that marches home earns nothing. The mission is lost only if the city is overrun: more invaders than your soldiers and ${CONFIG.OVERRUN_MARGIN}, with fewer than a quarter of its most people left.`, show: true };
  }
  return { level: 'none', status: 'Caesar is content to leave you be.', note: `If his favor falls to ${CONFIG.LEGION_FAVOR} or less he sends his legions against you (${s.next} men next time), 12 months' march from Rome. Favor 0 no longer recalls you.` };
}

/** The call for troops in lines: [{ text, cls }]. */
export function battleLines(game, s) {
  const out = [];
  const sea = s.sea ? (s.fleet ? ' It lies by the sea: Naval Stations switched to Empire service send their squadrons too.' : ' It lies by the sea, but no ship of yours can reach the sea from here.') : '';
  if (s.phase === 'pending') {
    out.push({ text: `${s.name} is threatened by ${s.words} of ${s.enemyName} (strength about ${s.enemy}). The battle is in ${plural(s.monthsLeft, 'month')}.${sea}` });
    if (s.sent) {
      const there = s.sent.toGo <= 1;
      out.push({ text: `Your troops (${plural(s.sent.men, 'soldier')}${s.sent.ships ? `, ${plural(s.sent.ships, 'liburnian')}` : ''}, strength ${s.sent.strength}) ${there ? `are at ${s.name}, waiting for the battle` : `are ${plural(s.sent.toGo, 'month')} from ${s.name}`}.${s.inTime ? '' : ' They will come too late.'}`, cls: s.inTime ? 'status good' : 'status warn' });
      out.push({ text: s.sent.strength >= s.enemy ? 'They are strong enough, if they get there in time.' : 'They are weaker than the enemy: if they fight, all of them will be lost.', cls: s.sent.strength >= s.enemy ? 'muted' : 'status bad' });
    } else {
      out.push({ text: `Switch forts to Empire service below, then send them: every soldier of those forts goes, and they need about ${plural(s.march, 'month')} to get there (troops sent late march faster until they catch up). Ready now: strength ${s.ready.strength} (${plural(s.ready.men, 'soldier')}${s.ready.ships ? `, ${plural(s.ready.ships, 'liburnian')}` : ''}).`, cls: 'muted' });
      if (!s.inTime) out.push({ text: 'Sent now, they would come too late: the battle is too near.', cls: 'status warn' });
      out.push({ text: `A legionary counts 2 (3 trained at a Military Academy), an archer or cavalryman 1 (2 trained), a liburnian 4 (6 trained). Win: +${CONFIG.BATTLE_FAVOR.won} favor and a triumphal arch. Too weak: ${CONFIG.BATTLE_FAVOR.weak} and all are lost. Too late: ${CONFIG.BATTLE_FAVOR.late}. Nobody sent: ${CONFIG.BATTLE_FAVOR.none}.`, cls: 'muted' });
    }
  } else if (s.phase === 'returning') {
    out.push({ text: `${s.outcome === 'won' ? `Victory at ${s.name}!` : `Your troops came too late to ${s.name}.`} They are on their way home: ${plural(Math.max(1, s.homeIn), 'month')}.`, cls: s.outcome === 'won' ? 'status good' : 'status warn' });
  } else if (s.phase === 'foreign') {
    out.push({ text: `${s.name} is in the hands of ${s.enemyName}. Rome will retake it in ${plural(s.foreignLeft, 'month')}; until then Caesar asks for no troops.`, cls: 'status bad' });
  }
  return out;
}

/** "Triumphal arches: 1 to build" (an element), or null when none was ever earned. */
export function archLine(game) {
  const earned = game.city.archesEarned || 0;
  if (!earned) return null;
  const n = archesToBuild(game);
  return kv('Triumphal arches', `${earned} earned, ${n ? `${n} to build (Government & Decor, across a road)` : 'all built'}`);
}

/** Can this fort or station answer the current call for troops? '' when it can, else why not. */
export function serviceNote(game, b) {
  const battle = currentBattle(game);
  if (b.def.kind !== 'station' || !battle || fleetCanGo(game, battle.city)) return '';
  if (THREATENED_CITIES[battle.city]?.route !== 'sea') return 'The city Caesar asks troops for is not by the sea: squadrons cannot go.';
  return 'No water from here reaches the sea: squadrons cannot sail to the city Caesar asks troops for.';
}

/** The Empire service switch of a fort or Naval Station (an element). */
export function serviceButton(game, b, onChange) {
  const on = !!b.service;
  return h('button', {
    class: `btn small service-btn${on ? ' active' : ''}`,
    'data-id': b.id,
    title: on ? 'Its men go when you send troops to a distant battle. Click to keep them at home.' : 'Click to send its men when Caesar calls for troops (Imperial advisor)',
    onclick: () => { setService(game, b, !on); if (onChange) onChange(); },
  }, on ? 'Empire service: on' : 'Empire service: off');
}
