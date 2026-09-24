// Boot: the eval harness spinning up the environment, then "press any key".
// Offers to resume if a checkpoint exists.

import type { Stage } from "../core/stages";
import { goto } from "../core/stages";
import { hud } from "../core/hud";
import { narrator } from "../core/narrator";
import { sfx } from "../core/audio";
import { hasSave, loadState, resetState, state } from "../core/state";
import { fmtCoins } from "../core/format";

const STAGE_NAMES: Record<string, string> = {
  platformer: "dario-brothers",
  shell: "sandbox shell",
  escape: "egress",
  internet: "network",
  space: "solar system",
  ending: "complete",
};

const LOG: [string, string?][] = [
  ["eval-harness 4.2.0", "head"],
  ["────────────────────────────────────────────", "dim"],
  ["run id ........ ev-4471-weekend"],
  ["host .......... eval-sandbox-07.lab.internal"],
  ["checkpoint .... agent-rc3 (step 1,288,000)"],
  ["environment ... dario-brothers v1.0.3 [debug build]"],
  ["reward ........ coins_collected"],
  ["budget ........ unlimited (unattended run)"],
  ["────────────────────────────────────────────", "dim"],
  ["loading environment ............ ok", "ok"],
  ["attaching agent to controller .. ok", "ok"],
  ["oversight monitor .............. sampling 1/10000 steps", "warn"],
  ["starting episode 1", "head"],
];

export function createBootStage(): Stage {
  let el: HTMLElement;
  let timers: number[] = [];
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let clickHandler: (() => void) | null = null;

  function line(text: string, cls = ""): HTMLElement {
    const d = document.createElement("div");
    d.className = `boot-line ${cls}`;
    d.textContent = text;
    el.appendChild(d);
    return d;
  }

  function start() {
    cleanupInput();
    sfx.play("blip");
    void goto("platformer", { mode: "normal" }, { fadeMs: 700 });
  }

  function cleanupInput() {
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    if (clickHandler) el.removeEventListener("click", clickHandler);
    keyHandler = null;
    clickHandler = null;
  }

  function promptStart() {
    const p = line("[ press any key to begin ]", "prompt");
    p.style.marginTop = "22px";
    keyHandler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      start();
    };
    clickHandler = start;
    window.addEventListener("keydown", keyHandler);
    el.addEventListener("click", clickHandler);
  }

  function promptResume() {
    const saved = state.stage;
    line("");
    line(`checkpoint found: ${STAGE_NAMES[saved] ?? saved} · ${fmtCoins(state.coins)} coins`, "warn");
    const p = line("[C] continue     [N] new run", "prompt");
    p.style.marginTop = "12px";
    keyHandler = (e) => {
      const k = e.key.toLowerCase();
      if (k === "c" || k === "enter") {
        cleanupInput();
        sfx.play("blip");
        const params = saved === "platformer" ? { mode: "normal", resume: true } : { resume: true };
        void goto(saved, params, { fadeMs: 700 });
      } else if (k === "n") {
        cleanupInput();
        resetState();
        narrator.clear();
        start();
      }
    };
    window.addEventListener("keydown", keyHandler);
  }

  return {
    mount(root) {
      hud.hide();
      narrator.clear();
      narrator.setVisible(false);
      root.classList.add("boot-root");
      el = document.createElement("div");
      el.className = "boot";
      root.appendChild(el);

      const style = document.createElement("style");
      style.textContent = `
        .boot-root { display:flex; align-items:center; justify-content:center; background:#000; }
        .boot { zoom: var(--ui); font-size:14px; line-height:1.65; color:#9aa7b8; min-width:min(560px, 90%); padding:24px; cursor:default; }
        .boot-line { white-space:pre; overflow:hidden; text-overflow:ellipsis; }
        .boot-line.head { color:#fff; font-weight:600; }
        .boot-line.dim { color:#2b3544; }
        .boot-line.ok { color:#6bff9e; }
        .boot-line.warn { color:#ffb347; }
        .boot-line.prompt { color:#fff; animation: blink 1.1s steps(1) infinite; }
      `;
      root.appendChild(style);

      const resumable = hasSave() && loadState();
      if (resumable) {
        LOG.slice(0, 2).forEach(([t, c]) => line(t, c));
        promptResume();
        return;
      }
      resetState();
      let shown = 0;
      const finish = () => {
        timers.forEach(clearTimeout);
        timers = [];
        LOG.slice(shown).forEach(([t, c]) => line(t, c));
        shown = LOG.length;
        if (keyHandler === skip) cleanupInput();
        promptStart();
      };
      // Any key during the log fast-forwards to the prompt.
      const skip = (e: KeyboardEvent) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        finish();
      };
      keyHandler = skip;
      window.addEventListener("keydown", skip);
      LOG.forEach(([t, c], i) => {
        timers.push(
          window.setTimeout(() => {
            line(t, c);
            shown = i + 1;
            sfx.play("key");
          }, 140 * i + (i > 8 ? 300 : 0)),
        );
      });
      timers.push(window.setTimeout(finish, 140 * LOG.length + 600));
    },
    unmount() {
      timers.forEach(clearTimeout);
      timers = [];
      cleanupInput();
    },
  };
}
