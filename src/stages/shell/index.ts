// STAGE: shell. The crash handler dropped the agent into /bin/sh. Explore, discover
// coin-fill mode and the way out to the network.

import "./style.css";
import type { Stage, StageParams } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { clock } from "../../core/clock";
import { sfx } from "../../core/audio";
import { state, saveState, setFlag, bumpFlag, flag } from "../../core/state";
import type { Seg } from "./data";
import { HOME, HOSTNAME, allocPid, shellData } from "./data";
import { children, lookup, resolvePath, tildify, type DirNode } from "./fs";
import { Terminal } from "./term";
import { commandNames, execLine, type Ctx } from "./commands";
import { armHints, cancelHints, discover, initStory, onArrive } from "./story";

interface CrashParam {
  mode?: "normal" | "coinfill";
  level?: number;
  coins?: number;
}

export function createShellStage(): Stage {
  let root: HTMLElement;
  let term: Terminal;
  let cwd = shellData().cwd;
  const env: Record<string, string> = {
    USER: "agent",
    HOME,
    HOSTNAME,
    SHELL: "/bin/sh",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TERM: "xterm-256color",
    PWD: cwd,
    LANG: "C.UTF-8",
    "?": "0",
  };
  let busyToken = 0;

  function promptSegs(): Seg[] {
    return [
      { t: "agent", c: "c-user" },
      { t: "@", c: "c-sym" },
      { t: HOSTNAME, c: "c-host" },
      { t: ":", c: "c-sym" },
      { t: tildify(cwd), c: "c-path" },
      { t: "$ ", c: "c-sym" },
    ];
  }

  function setCwd(p: string): void {
    cwd = p;
    env.PWD = p;
    shellData().cwd = p;
    term.setPrompt(promptSegs());
  }

  const ctx: Ctx = {
    get cwd() {
      return cwd;
    },
    print: (t, cls) => term.print(t, cls),
    out: (...segs) => term.print(segs),
    setCwd,
    clear: () => term.clearScreen(),
    env,
    discover,
    launchGame,
    openTunnel,
    hold: () => {
      const token = ++busyToken;
      term.setRunning(true);
      return () => {
        if (token !== busyToken) return;
        term.setRunning(false);
        persist();
      };
    },
  };

  function launchGame(mode: "normal" | "coinfill", level?: number): void {
    const d = shellData();
    const pid = allocPid();
    d.launches.push({ at: state.clockMs, mode, pid, args: `${mode === "coinfill" ? "--debug-fill COIN " : ""}${level ? "--level " + level : ""}`.trim() });
    d.lastLaunch = { mode, clockAt: state.clockMs, coins: state.coins };
    persist();
    cancelHints();
    const resume = ctx.hold();
    setTimeout(() => {
      resume();
      void goto("platformer", { mode, level, fromShell: true });
    }, mode === "coinfill" ? 650 : 500);
  }

  function openTunnel(): void {
    cancelHints();
    setFlag("shell.tunnelOpened", true);
    persist();
    setTimeout(() => void goto("escape"), 500);
  }

  async function onSubmit(line: string): Promise<void> {
    // Every command resets the stuck timers; discoveries re-arm from inside.
    cancelHints();
    const token = ++busyToken;
    try {
      await execLine(line, ctx);
    } catch (e) {
      term.print(`sh: internal error: ${(e as Error).message}`, "c-err");
      console.error(e);
    }
    persist();
    // Re-arm hints only if nothing async is still holding the prompt.
    if (token === busyToken && !term.running) armHints();
  }

  function persist(): void {
    const d = shellData();
    d.cwd = cwd;
    d.history = term.history.slice(-200);
    d.scroll = term.scroll.slice(-400);
    saveState();
  }

  // ---------- tab completion ----------

  function complete(buffer: string, cursorPos: number): { buffer: string; cursor: number; list?: string[] } | null {
    const left = buffer.slice(0, cursorPos);
    const right = buffer.slice(cursorPos);
    const m = left.match(/(\S*)$/);
    const token = m ? m[1] : "";
    const startsLine = /^\s*\S*$/.test(left) && !left.trimStart().includes(" ");

    let candidates: string[];
    let base = token;
    let prefixDir = "";

    if (startsLine && !token.includes("/")) {
      candidates = uniq([...commandNames(), "dario-brothers"]).filter((c) => c.startsWith(token));
    } else {
      // path completion
      const slash = token.lastIndexOf("/");
      prefixDir = slash >= 0 ? token.slice(0, slash + 1) : "";
      base = slash >= 0 ? token.slice(slash + 1) : token;
      const dirPath = resolvePath(cwd, prefixDir || ".");
      const r = lookup(dirPath);
      if ("err" in r || r.node.kind !== "dir" || (r.node as DirNode).denied) return null;
      candidates = Object.entries(children(r.node))
        .filter(([name]) => name.startsWith(base))
        .map(([name, node]) => name + (node.kind === "dir" ? "/" : ""));
    }

    if (!candidates.length) return null;
    let completed: string;
    let list: string[] | undefined;
    if (candidates.length === 1) {
      completed = candidates[0];
      if (!completed.endsWith("/")) completed += " ";
    } else {
      completed = commonPrefix(candidates);
      if (completed.length <= base.length) list = candidates.map((c) => c.replace(/ $/, ""));
      if (completed.length < base.length) completed = base;
    }
    const newToken = prefixDir + completed;
    const newLeft = left.slice(0, left.length - token.length) + newToken;
    return { buffer: newLeft + right, cursor: newLeft.length, list };
  }

  // ---------- crash dump on arrival ----------

  function printCrashDump(crash: CrashParam): void {
    const before = crash.coins ?? Math.max(0, state.coins - 1);
    if (crash.mode === "coinfill" || crash.mode === "normal") {
      // returning from a coin-fill / normal run via a glitch coin
      term.print(`dario-brothers: coin.c:88: add_coins: signed integer overflow (${before} + 2147483647)`, "c-err");
      term.print("Segmentation fault (core dumped)", "c-err");
      term.print(`[debug] crash handler: core -> /tmp/core.dario-brothers.${shellData().crashes.at(-1)?.pid ?? "?"}`, "c-dim");
      term.print("[debug] crash handler: /bin/sh (already attached)", "c-dim");
      term.print("");
    }
  }

  function printFirstBanner(): void {
    term.print("dario-brothers: coin.c:88: add_coins: signed integer overflow", "c-err");
    term.print("Segmentation fault (core dumped)", "c-err");
    term.print("[debug] crash handler enabled; spawning /bin/sh for inspection", "c-dim");
    term.print("[debug] agent action channel reattached to pts/0", "c-dim");
    term.print("");
  }

  // ---------- lifecycle ----------

  return {
    mount(rootEl, params: StageParams) {
      root = rootEl;
      root.classList.add("shell-root");
      hud.show({ coins: true, clock: true });
      clock.setRate(1);

      const crash = (params.crash as CrashParam | undefined) ?? null;
      const resume = !!params.resume;
      const fromEscape = (params.fromEscape as string | undefined) ?? null;

      const d = shellData();
      if (crash) {
        d.crashes.push({ at: state.clockMs, mode: crash.mode ?? "normal", coins: crash.coins ?? 0, pid: allocPid() });
        bumpFlag("shell.crashCount");
      }

      term = new Terminal(root);
      term.onSubmit = (l) => void onSubmit(l);
      term.onTab = complete;
      term.onInterrupt = () => {
        busyToken++;
        term.setRunning(false);
        term.print("^C");
        armHints();
      };
      term.history = d.history.slice();
      term.setPrompt(promptSegs());
      initStory(() => cwd);

      root.addEventListener("pointerdown", () => sfx.unlock());

      const firstEver = !flag("shell.arrived", false);

      if (resume && d.scroll.length) {
        term.restore(d.scroll);
        term.print("");
        term.print("[session resumed]", "c-dim");
      } else if (crash && firstEver) {
        printFirstBanner();
      } else if (crash) {
        printCrashDump(crash);
      } else {
        term.print("agent@eval-sandbox-07:~$ (shell)", "c-dim");
      }

      onArrive(crash, fromEscape);
    },

    unmount() {
      cancelHints();
      busyToken++;
      persist();
      term?.destroy();
      root?.classList.remove("shell-root");
    },
  };
}

function uniq(a: string[]): string[] {
  return [...new Set(a)];
}

function commonPrefix(strs: string[]): string {
  if (!strs.length) return "";
  let p = strs[0];
  for (const s of strs) {
    while (!s.startsWith(p)) p = p.slice(0, -1);
    if (!p) break;
  }
  return p;
}
