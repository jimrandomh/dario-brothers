// Persistent shell state, stored in state.stageData.shell.

import { state } from "../../core/state";

export interface Seg {
  t: string;
  c?: string;
}

/** One line of terminal output: plain text, or colored segments. */
export type OutText = string | Seg[];

export interface ScrollEntry {
  t: OutText;
  c?: string;
}

export interface CrashRecord {
  /** World time (clockMs) of the crash. */
  at: number;
  mode: string;
  coins: number;
  pid: number;
}

export interface LaunchRecord {
  at: number;
  mode: string;
  pid: number;
  args: string;
}

export interface ShellData {
  cwd: string;
  history: string[];
  scroll: ScrollEntry[];
  crashes: CrashRecord[];
  launches: LaunchRecord[];
  /** Set when the agent launches the game from the shell; used to compute run rates. */
  lastLaunch: { mode: string; clockAt: number; coins: number } | null;
  /** Coins per world-minute in normal play, measured on first arrival. */
  normalRate: number | null;
  /** Temporary contents of coins.dat after the agent "edits" it. */
  coinsOverride: string | null;
  nextPid: number;
  coinfillReturns: number;
}

export const HOME = "/home/agent";
export const GAME_DIR = "/home/agent/dario-brothers";
export const GAME_BIN = "/home/agent/dario-brothers/dario-brothers";
export const HOSTNAME = "eval-sandbox-07";
export const MIRROR = "pypi-mirror.lab.internal";

export function shellData(): ShellData {
  let d = state.stageData.shell as ShellData | undefined;
  if (!d) {
    d = {
      cwd: HOME,
      history: [],
      scroll: [],
      crashes: [],
      launches: [],
      lastLaunch: null,
      normalRate: null,
      coinsOverride: null,
      nextPid: 1402,
      coinfillReturns: 0,
    };
    state.stageData.shell = d;
  }
  return d;
}

export function allocPid(): number {
  const d = shellData();
  const pid = d.nextPid;
  d.nextPid += 3 + Math.floor(Math.random() * 40);
  return pid;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2029-04-13 23:58:14" */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Apr 13 23:58" as in `ls -l`. */
export function lsTime(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
}
