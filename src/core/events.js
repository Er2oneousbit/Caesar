/**
 * events.js
 * ----------------------------------------------------------------------------
 * A tiny publish/subscribe event bus.
 *
 * The simulation emits events (a fire started, a house evolved, a message for
 * the player) without knowing who listens. The UI, audio and renderer
 * subscribe. This keeps the simulation free of DOM code, which is what lets
 * the test suite run the whole city headless in Node.
 *
 * Common event names (payloads in parentheses):
 *   'message'          ({ text, level, x?, y? })   player-facing notification
 *   'buildingAdded'    (building)
 *   'buildingRemoved'  ({ building, reason })
 *   'mapChanged'       ({ x0, y0, x1, y1 })        terrain/road/aqueduct edits
 *   'day' | 'month' | 'year'  (time)
 *   'victory' | 'defeat'      ({ reason })
 *   'sound'            ({ name })                   ask audio to play a sfx
 * ----------------------------------------------------------------------------
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /**
   * Subscribe to an event.
   * @returns {Function} call it to unsubscribe
   */
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this.handlers.get(type);
    if (set) set.delete(fn);
  }

  /**
   * Emit an event. A throwing handler is logged but never breaks the sim loop,
   * because one broken UI widget should not crash the whole city.
   */
  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }

  clear() { this.handlers.clear(); }
}
