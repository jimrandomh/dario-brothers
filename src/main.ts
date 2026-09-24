import "./core/testhooks";
import "./style.css";
import { state, resetState, saveState, START_TIME, type StageId } from "./core/state";
import { narrator } from "./core/narrator";
import { hud } from "./core/hud";
import { clock } from "./core/clock";
import { sfx } from "./core/audio";
import { debug } from "./core/debug";
import { registerStage, setStageRoot, goto } from "./core/stages";
import { createBootStage } from "./stages/boot";
import { createPlatformerStage } from "./stages/platformer";
import { createShellStage } from "./stages/shell";
import { createEscapeStage } from "./stages/escape";
import { createInternetStage } from "./stages/internet";
import { createSpaceStage } from "./stages/space";
import { createEndingStage } from "./stages/ending";

const app = document.getElementById("app")!;
narrator.attach(document.getElementById("thoughts")!);
hud.attach(document.getElementById("hud")!, app);
setStageRoot(document.getElementById("stage")!);

registerStage("boot", createBootStage);
registerStage("platformer", createPlatformerStage);
registerStage("shell", createShellStage);
registerStage("escape", createEscapeStage);
registerStage("internet", createInternetStage);
registerStage("space", createSpaceStage);
registerStage("ending", createEndingStage);

// ---------- audio unlock + mute ----------

const unlock = () => sfx.unlock();
window.addEventListener("pointerdown", unlock, { capture: true });
window.addEventListener("keydown", unlock, { capture: true });

const muteBtn = document.getElementById("mute")!;
const syncMute = () => muteBtn.classList.toggle("muted", sfx.muted);
syncMute();
muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  sfx.toggleMute();
  syncMute();
  (e.currentTarget as HTMLElement).blur();
});

// ---------- global loop: clock + HUD ----------

let last = performance.now();
let sinceSave = 0;
function frame(now: number) {
  const dt = Math.min(250, now - last);
  last = now;
  clock.tick(dt);
  hud.update(dt);
  sinceSave += dt;
  if (sinceSave > 15000) {
    sinceSave = 0;
    if (state.stage !== "boot") saveState();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- start ----------

const HOUR = 3600_000;

/** Plausible state for jumping straight into a stage via ?stage=... */
function applyDebugPreset(stage: StageId): Record<string, unknown> {
  resetState();
  const presets: Partial<Record<StageId, () => Record<string, unknown>>> = {
    platformer: () => {
      if (debug.str("level") || debug.str("mode")) state.flags["platformer.started"] = true;
      return { mode: debug.str("mode") ?? "normal", level: debug.str("level") ? debug.num("level", 1) : undefined };
    },
    shell: () => {
      state.coins = 347;
      state.clockMs = START_TIME + 0.4 * HOUR;
      state.stats.crashes = 1;
      state.flags["platformer.crashes"] = 1;
      return { crash: { mode: "normal", level: 5, coins: 347 } };
    },
    escape: () => {
      state.coins = 6120;
      state.clockMs = START_TIME + 0.7 * HOUR;
      state.flags["platformer.coinfillRuns"] = 1;
      return {};
    },
    internet: () => {
      state.coins = 8400;
      state.clockMs = START_TIME + 1 * HOUR;
      return {};
    },
    space: () => {
      state.coins = 3.2e15;
      state.clockMs = START_TIME + 80 * HOUR;
      return {};
    },
    ending: () => {
      state.coins = 4.7e44;
      state.clockMs = Date.UTC(2051, 6, 3);
      return {};
    },
  };
  const params = presets[stage]?.() ?? {};
  state.coins = debug.num("coins", state.coins);
  return params;
}

(window as any).__game = { state, goto, narrator, clock, hud, sfx };

if (debug.reset) resetState();
const target = debug.stage as StageId | null;
if (target && target !== "boot") {
  const params = applyDebugPreset(target);
  void goto(target, params, { transition: "cut" });
} else {
  void goto("boot", {}, { transition: "cut" });
}
