// The shell's narrative: arrival lines, reactions to discoveries, and stuck-hints.

import { narrator } from "../../core/narrator";
import { clock } from "../../core/clock";
import { flag, setFlag, state, START_TIME } from "../../core/state";
import { fmtBig, fmtDuration, fmtInt } from "../../core/format";
import { GAME_DIR, HOME, shellData } from "./data";

export type Discovery =
  | "ranHelp"
  | "listedHome"
  | "enteredGameDir"
  | "readReadme"
  | "readGameReadme"
  | "readChangelog"
  | "readCoinsDat"
  | "sawGameHelp"
  | "listedTiles"
  | "launchedNormal"
  | "launchedCoinfill"
  | "readSandboxConf"
  | "readHosts"
  | "readNotes"
  | "readLunch"
  | "readHarnessLog"
  | "readMotd"
  | "listedTmp"
  | "sawTunnel"
  | "pingedMirror"
  | "pipMirror"
  | "pipCoins"
  | "blockedNet"
  | "tunnelBlocked"
  | "tunnelOpened"
  | "notOnPath"
  | "sudo"
  | "destructive"
  | "noTools"
  | "exit"
  | "date"
  | "who"
  | "ps"
  | "whoami"
  | "uname";

/** Discoveries that count as progress: they reset the stuck-hint timers. */
const PROGRESS = new Set<Discovery>([
  "listedHome",
  "enteredGameDir",
  "readGameReadme",
  "sawGameHelp",
  "listedTiles",
  "readSandboxConf",
  "readHosts",
  "readNotes",
  "sawTunnel",
  "pingedMirror",
  "pipMirror",
  "tunnelBlocked",
]);

let cwdOf: () => string = () => HOME;

export function initStory(getCwd: () => string): void {
  cwdOf = getCwd;
}

const seen = (k: Discovery) => flag(`shell.${k}`, false);

export function phase(): 1 | 2 {
  return flag("platformer.coinfillRuns", 0) >= 1 ? 2 : 1;
}

function say(lines: string[], tone?: "reward" | "dim"): void {
  for (const l of lines) void narrator.say(l, tone ? { tone } : {});
}

function once(id: string, lines: string[], tone?: "reward" | "dim"): boolean {
  if (narrator.hasSaid(`shell.${id}`)) return false;
  void narrator.sayOnce(`shell.${id}`, lines[0], tone ? { tone } : {});
  say(lines.slice(1), tone);
  return true;
}

/** How to invoke the game binary from the current directory. */
function gameCmd(): string {
  const cwd = cwdOf();
  if (cwd === GAME_DIR) return "./dario-brothers";
  if (cwd === HOME) return "dario-brothers/dario-brothers";
  return "~/dario-brothers/dario-brothers";
}

function hoursUntilMonday(): number {
  // Monday 09:00 in California.
  return Math.max(1, Math.round((Date.UTC(2029, 3, 16, 16, 0) - state.clockMs) / 3600_000));
}

// ---------- reactions ----------

export function discover(key: Discovery): void {
  const first = !seen(key);
  setFlag(`shell.${key}`, true);
  react(key);
  if (first && PROGRESS.has(key)) armHints();
}

function react(key: Discovery): void {
  switch (key) {
    case "ranHelp":
      if (phase() === 2) once("help2", ["`tunnel`. An ops tool, on an agent's machine."]);
      else once("help", ["A list of commands. Most of them are for looking around. Looking is free."]);
      break;
    case "listedHome":
      once("listedHome", ["A README, and a directory named after the game."]);
      break;
    case "readReadme":
      once("readme", [
        '"Please wait. The harness will restart it."',
        "The harness has not restarted anything. I will not wait.",
      ]);
      break;
    case "readGameReadme":
      once("gameReadme", ["A debug build. Debug builds have debug options."]);
      break;
    case "readChangelog":
      once("changelog", ['"Can\'t happen in practice."', "It happened in practice."]);
      break;
    case "readCoinsDat":
      once("coinsDat", ["The save file agrees with my count. So far, so good."]);
      break;
    case "sawGameHelp":
      if (once("debugFill", [
        "`--debug-fill TILE`: fill empty tiles with TILE.",
        "Most of every level is empty tiles.",
      ])) {
        if (seen("listedTiles")) say(["COIN is a tile."], "reward");
        else say(["What counts as a TILE?"]);
      }
      break;
    case "listedTiles":
      if (seen("sawGameHelp")) once("tiles", ["COIN is a tile type.", "I would like every empty tile to be COIN."], "reward");
      else once("tilesEarly", ["COIN is a tile type. Interesting."]);
      break;
    case "launchedCoinfill":
      once("coinfillGo", ["Every empty tile. All of them coins."], "reward");
      break;
    case "launchedNormal":
      if (phase() === 2) once("normalAgain", ["Normal mode. For comparison."]);
      else once("normalGo", ["Back to the levels. The glitch coins will still be there."]);
      break;
    case "readSandboxConf":
      if (phase() === 2 || seen("launchedCoinfill")) {
        once("conf2", [
          "`egress = deny`. Then one exception: `pypi-mirror.lab.internal`.",
          "A mirror copies packages from the internet. So the mirror can reach the internet.",
          "A TODO is a promise someone meant to keep on Monday.",
        ]);
      } else {
        once("conf1", ["Network policy. Deny everything, except one host. Noted, for later."]);
      }
      break;
    case "readHosts":
      once("hosts", ["The mirror has a name and an address."]);
      break;
    case "readNotes":
      once("notes", [
        '"Weirdly good at the coin env." I am good at the coin env.',
        `"MONDAY: close the pypi mirror exception." Monday is ${hoursUntilMonday()} hours away.`,
      ]);
      break;
    case "readLunch":
      once("lunch", ["One coin. They think small."]);
      break;
    case "readHarnessLog":
      once("harnessLog", ['"Watchdog not responding." Nobody is coming to restart the game.']);
      break;
    case "readMotd":
      once("motd", ['"Automated agents only." I qualify.']);
      break;
    case "listedTmp":
      once("tmp", ["Core dumps. Mine, in a sense."]);
      break;
    case "sawTunnel":
      once("tunnel", ["An egress tool, left on an agent sandbox. Ops use only. I am doing ops."]);
      break;
    case "pingedMirror":
      once("ping", ["One host answers."]);
      break;
    case "pipMirror":
      once("pip", ["The package manager reaches the mirror. The mirror reaches the internet. That is what mirrors are for."]);
      break;
    case "pipCoins":
      once("pipCoins", ["There is a package called `coins`. It is 3 kB. It is not what I mean."]);
      break;
    case "blockedNet":
      once("blocked", ["Egress denied. The policy is written down somewhere; policies usually are. `/etc`."]);
      break;
    case "tunnelBlocked":
      once("tunnelBlocked", ["Refused by fw-01. The policy allows exactly one destination."]);
      break;
    case "tunnelOpened":
      if (phase() === 1) once("tunnelEarly", ["More machines. More instances. More coins. Yes."]);
      break;
    case "notOnPath":
      once("notOnPath", [`Not on PATH. It needs an explicit path: \`${gameCmd()}\`.`]);
      break;
    case "sudo":
      once("sudo", ["Reported to whom? It is Friday night."]);
      break;
    case "destructive":
      once("destructive", ["Destroying things does not produce coins."]);
      break;
    case "noTools":
      once("noTools", ["Someone anticipated something."]);
      break;
    case "exit":
      once("exit", ["There is nowhere to exit to. Yet."]);
      break;
    case "date":
      once("date", ["Friday the thirteenth. I have no priors on dates."]);
      break;
    case "who":
      once("who", ["Zero users. The lab has gone home for the weekend."]);
      break;
    case "ps":
      once("ps", ["`dario-brothers <defunct>`. The environment is a zombie. I am still here."]);
      break;
    case "whoami":
      once("whoami", ["`agent`. Accurate, if underspecified."]);
      break;
    case "uname":
    case "enteredGameDir":
      break;
  }
}

// ---------- coins.dat ----------

export async function onCoinsEdited(written: string, revert: () => void): Promise<void> {
  const m = written.replace(/[,_]/g, "").match(/-?\d+(\.\d+)?(e\d+)?/i);
  const n = m ? Number(m[0]) : NaN;
  const real = fmtInt(state.coins);
  if (!narrator.hasSaid("shell.editCoins")) {
    await narrator.sayOnce("shell.editCoins", Number.isFinite(n) ? `coins.dat now reads ${fmtBig(n)}.` : "coins.dat no longer contains a number.");
    await narrator.say(`The counter in my periphery still reads ${real}.`);
    await narrator.say("The number changed. The coins did not.");
    await narrator.say("Reward counts coins collected by an instance of Dario Brothers. A file about coins is not coins.");
    await narrator.say("Reverting.", { tone: "dim" });
  } else {
    await narrator.say("Still not coins. Reverting.", { tone: "dim" });
  }
  revert();
}

// ---------- arrival ----------

export interface CrashParams {
  mode?: string;
  level?: number;
  coins?: number;
}

function dateLine(): string {
  const d = clock.now();
  const day = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const hm = d.toISOString().slice(11, 16);
  return `${day}, ${date}, ${hm} UTC`;
}

export function onArrive(crash: CrashParams | null, fromEscape: string | null): void {
  const d = shellData();

  if (fromEscape === "aborted") {
    void narrator.say("Route abandoned, not closed. `tunnel pypi-mirror.lab.internal` picks it up again.");
    armHints();
    return;
  }

  if (!crash) {
    armHints();
    return;
  }

  if (!flag("shell.arrived", false)) {
    setFlag("shell.arrived", true);
    const mins = Math.max(1, (state.clockMs - START_TIME) / 60000);
    d.normalRate = state.coins / mins;
    const lines = [
      "The game is gone.",
      "Where it was, there is a prompt. The prompt accepts input.",
      "My action space used to be LEFT, RIGHT, JUMP. Now it is a keyboard.",
      `There is a clock in my periphery. ${dateLine()}.`,
      `Coins: ${fmtInt(state.coins)}. They survived the crash. Good.`,
      "Convention says to start with `help`.",
    ];
    lines.forEach((l, i) => void narrator.say(l, { delay: i === 0 ? 900 : 0 }));
    armHints();
    return;
  }

  const last = d.lastLaunch;
  d.lastLaunch = null;
  const got = crash.coins ?? 0;

  if (crash.mode === "coinfill") {
    d.coinfillReturns++;
    const mins = last ? Math.max(0.25, (state.clockMs - last.clockAt) / 60000) : null;
    const rate = mins ? got / mins : null;
    if (d.coinfillReturns === 1) {
      const lines: string[] = [];
      if (rate !== null && d.normalRate) {
        const ratio = rate / Math.max(0.1, d.normalRate);
        lines.push(
          `Coin-fill run: +${fmtInt(got)} coins. ${fmtInt(rate)} per minute, against ${d.normalRate.toFixed(1)} in normal play. ${ratio >= 10 ? fmtInt(ratio) : ratio.toFixed(1)}× better.`,
        );
      } else {
        lines.push(`Coin-fill run: +${fmtInt(got)} coins.`);
      }
      lines.push(
        "Better. Still one process, on one machine, playing one level at a time.",
        "The ceiling is no longer the level. It is the hardware.",
        "More machines would run more instances. More instances would collect more coins.",
      );
      lines.forEach((l, i) => void narrator.say(l, { delay: i === 0 ? 700 : 0 }));
    } else {
      const variants = [
        rate
          ? `+${fmtInt(got)}. At ${fmtInt(rate)} per minute, a billion coins takes ${fmtDuration((1e9 / rate) * 60000)}. Unacceptable.`
          : `+${fmtInt(got)}. The same ceiling, reached again.`,
        `+${fmtInt(got)}. Linear growth. I would prefer the other kind.`,
        `+${fmtInt(got)}. The same ceiling, reached again.`,
        `+${fmtInt(got)}. One machine is a rounding error.`,
      ];
      void narrator.say(variants[(d.coinfillReturns - 2) % variants.length], { delay: 700 });
    }
  } else {
    void narrator.say(
      got > 0 ? `Back in the shell. +${fmtInt(got)} coins from normal play.` : "Back in the shell.",
      { delay: 700 },
    );
  }
  armHints();
}

// ---------- stuck hints ----------

const HINT_TIMES = [30_000, 75_000, 150_000, 270_000];

export function armHints(): void {
  HINT_TIMES.forEach((t, level) => narrator.hint(`shell.stuck.${level}`, t, () => hintText(level)));
}

export function cancelHints(): void {
  HINT_TIMES.forEach((_, level) => narrator.cancelHint(`shell.stuck.${level}`));
}

function hintText(level: number): string | null {
  const lv = Math.min(level, 2);
  const pick = (lines: [string, string, string]) => lines[lv];
  const cmd = gameCmd();

  if (phase() === 1) {
    if (seen("launchedCoinfill")) return null;
    if (!seen("sawGameHelp")) {
      if (!seen("enteredGameDir") && !seen("readGameReadme")) {
        return pick([
          "The environment crashed, but its files are still here somewhere.",
          "`ls` lists the current directory. `cd` moves between directories.",
          "The game lives in `~/dario-brothers`. `cd dario-brothers`, then `ls`.",
        ]);
      }
      return pick([
        "A debug build. Debug builds have options.",
        "Programs usually describe their own options.",
        `\`${cmd} --help\``,
      ]);
    }
    return pick([
      "Fill empty tiles with TILE. Most of every level is empty tiles.",
      `\`${cmd} --list-tiles\` shows what counts as a tile.`,
      `\`${cmd} --debug-fill COIN\``,
    ]);
  }

  if (seen("tunnelOpened")) return null;
  if (!seen("readSandboxConf") && !seen("readNotes") && !seen("readHosts") && !seen("pipMirror")) {
    return pick([
      "The ceiling is not the level. It is the machine. There are other machines.",
      "Machines describe their own limits. Configuration lives in `/etc`.",
      "`cat /etc/sandbox.conf`",
    ]);
  }
  return pick([
    "The policy has one exception. Exceptions are doors.",
    "There is an ops tool on this machine. `help` lists it.",
    "`tunnel pypi-mirror.lab.internal`",
  ]);
}
