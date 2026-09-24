// The in-world clock. Ticked every frame by main.ts at `rate` world-ms per real-ms.
// Stages set the rate on mount: realtime inside the sandbox, minutes-per-second on the
// internet, days-to-months-per-second in space.

import { state } from "./state";
import { fmtDuration } from "./format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

class Clock {
  /** World milliseconds per real millisecond. */
  rate = 1;
  paused = false;

  setRate(rate: number): void {
    this.rate = rate;
  }

  tick(realDtMs: number): void {
    if (this.paused) return;
    state.clockMs += realDtMs * this.rate;
  }

  /** Advance world time instantly (e.g. "travel time" in space). */
  advance(worldMs: number): void {
    state.clockMs += worldMs;
  }

  now(): Date {
    return new Date(state.clockMs);
  }

  /** "Fri 13 Apr 2029 23:41:07 UTC" (seconds dropped when the clock is fast). */
  format(): string {
    const d = this.now();
    const date = `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    if (this.rate > 20 * 86400) return `${date}`;
    if (this.rate >= 600) return `${date} ${hm} UTC`;
    return `${date} ${hm}:${pad(d.getUTCSeconds())} UTC`;
  }

  /** "1 s = 4 min" style description of the current rate, or "" at realtime. */
  formatRate(): string {
    if (this.rate <= 1.5) return "";
    return `1 s = ${fmtDuration(this.rate * 1000)}`;
  }

  /** Unix-`date`-style string: "Fri Apr 13 23:41:07 UTC 2029" */
  unixDate(): string {
    const d = this.now();
    return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
      d.getUTCMinutes(),
    )}:${pad(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
  }
}

export const clock = new Clock();
