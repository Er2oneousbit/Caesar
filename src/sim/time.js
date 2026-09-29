/**
 * time.js
 * ----------------------------------------------------------------------------
 * The game calendar. One tick advances the clock; day/month/year rollovers are
 * reported back so the game loop can run daily/monthly/yearly systems.
 *
 * Years are stored as signed integers: negative = BC, positive = AD.
 * There is no year 0 (1 BC is followed by 1 AD), just like the real calendar.
 * ----------------------------------------------------------------------------
 */

import { CONFIG } from '../config.js';

export const MONTH_NAMES = ['Ianuarius', 'Februarius', 'Martius', 'Aprilis', 'Maius', 'Iunius', 'Iulius', 'Augustus', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatYear(year) {
  return year < 0 ? `${-year} BC` : `${year} AD`;
}

export class GameTime {
  constructor(startYear = -300) {
    this.tick = 0; // ticks within the current day
    this.day = 0; // day within the month (0-based)
    this.month = 0; // 0-11
    this.year = startYear;
    this.totalTicks = 0;
    this.totalDays = 0;
    this.totalMonths = 0;
  }

  /**
   * Advance one tick.
   * @returns {{newDay:boolean,newMonth:boolean,newYear:boolean}}
   */
  advance() {
    this.totalTicks++;
    this.tick++;
    const out = { newDay: false, newMonth: false, newYear: false };
    if (this.tick >= CONFIG.TICKS_PER_DAY) {
      this.tick = 0;
      this.day++;
      this.totalDays++;
      out.newDay = true;
      if (this.day >= CONFIG.DAYS_PER_MONTH) {
        this.day = 0;
        this.month++;
        this.totalMonths++;
        out.newMonth = true;
        if (this.month >= CONFIG.MONTHS_PER_YEAR) {
          this.month = 0;
          this.year = this.year === -1 ? 1 : this.year + 1;
          out.newYear = true;
        }
      }
    }
    return out;
  }

  /** "Martius 280 BC" */
  label() { return `${MONTH_NAMES[this.month]} ${formatYear(this.year)}`; }

  /** "Mar 280 BC" */
  shortLabel() { return `${MONTH_SHORT[this.month]} ${formatYear(this.year)}`; }

  serialize() {
    return { tick: this.tick, day: this.day, month: this.month, year: this.year, totalTicks: this.totalTicks, totalDays: this.totalDays, totalMonths: this.totalMonths };
  }

  static deserialize(d) {
    const t = new GameTime(d.year);
    Object.assign(t, d);
    return t;
  }
}
