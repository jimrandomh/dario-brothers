// Stage registry and transitions.
//
// Each stage is a factory returning { mount, unmount }. Stages own everything inside the
// #stage element and must clean up their own listeners / animation frames in unmount().

import { state, saveState, type StageId } from "./state";
import { narrator } from "./narrator";
import { hud } from "./hud";
import { clock } from "./clock";
import { fadeIn, fadeOut } from "./fx";

export type StageParams = Record<string, unknown>;

export interface Stage {
  mount(root: HTMLElement, params: StageParams): void;
  unmount(): void;
}

export type StageFactory = () => Stage;

const registry = new Map<StageId, StageFactory>();
let current: { id: StageId; stage: Stage } | null = null;
let root: HTMLElement | null = null;
let transitioning = false;

export function registerStage(id: StageId, factory: StageFactory): void {
  registry.set(id, factory);
}

export function setStageRoot(el: HTMLElement): void {
  root = el;
}

export function currentStageId(): StageId | null {
  return current?.id ?? null;
}

export interface GotoOpts {
  /** "fade" (default) fades through black; "cut" swaps instantly. */
  transition?: "fade" | "cut";
  fadeMs?: number;
}

/** Leave the current stage and mount another. Saves the game. */
export async function goto(id: StageId, params: StageParams = {}, opts: GotoOpts = {}): Promise<void> {
  if (!root) throw new Error("stage root not set");
  if (transitioning) return;
  transitioning = true;
  const fade = (opts.transition ?? "fade") === "fade";
  const ms = opts.fadeMs ?? 500;
  try {
    if (fade && current) await fadeOut(ms);
    narrator.cancelAllHints();
    if (current) {
      try {
        current.stage.unmount();
      } catch (e) {
        console.error("unmount failed", e);
      }
    }
    root.innerHTML = "";
    root.className = "";
    hud.clearExtras();
    hud.resetWidths();
    narrator.setVisible(true);
    clock.paused = false;
    const factory = registry.get(id);
    if (!factory) throw new Error(`unknown stage ${id}`);
    const stage = factory();
    current = { id, stage };
    // Never save on boot: it would clobber the checkpoint the boot screen offers to resume.
    if (id !== "boot") {
      state.stage = id;
      saveState();
    }
    stage.mount(root, params);
    if (fade) void fadeIn(ms);
  } finally {
    transitioning = false;
  }
}
