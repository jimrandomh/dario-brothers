// Google Analytics events for the game's landmarks (the gtag snippet is in index.html):
//   game_start                     a new run begins (boot → first level)
//   stage_reached {stage: <id>}    first arrival at each stage after the platformer
//   game_complete                  the ending
// Each is sent at most once per run: the record lives in the save's flags, so a new run counts
// again but a reload doesn't. Nothing is sent from the dev server or from debug URLs.

import { state, type StageId } from "./state";
import { debug } from "./debug";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const enabled = import.meta.env.PROD && !debug.stage && !debug.fast && !debug.params.has("pump");

function once(key: string, event: string, params?: Record<string, string>): void {
  const flagKey = `analytics.${key}`;
  if (state.flags[flagKey]) return;
  state.flags[flagKey] = true;
  if (enabled) window.gtag?.("event", event, params);
}

export function trackGameStart(): void {
  once("start", "game_start");
}

/** Called on every stage change; boot and the first stage aren't landmarks of their own. */
export function trackStage(id: StageId): void {
  if (id === "boot" || id === "platformer") return;
  if (id === "ending") once("complete", "game_complete");
  else once(`stage.${id}`, "stage_reached", { stage: id });
}
