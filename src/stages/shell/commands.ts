// Command implementations for the fake shell.

import { state } from "../../core/state";
import { clock } from "../../core/clock";
import { sfx } from "../../core/audio";
import type { OutText, Seg } from "./data";
import { GAME_BIN, GAME_DIR, HOME, HOSTNAME, MIRROR, lsTime, shellData } from "./data";
import {
  BIN_CMDS,
  USR_BIN_CMDS,
  children,
  errText,
  fileText,
  isBinary,
  lookup,
  nodeSize,
  resolvePath,
  type DirNode,
  type FileNode,
  type FsNode,
} from "./fs";
import { parse, type Word } from "./parse";
import { onCoinsEdited, type Discovery } from "./story";

/** Everything a command needs to talk to the shell. */
export interface Ctx {
  cwd: string;
  print(t: OutText, cls?: string): void;
  /** Colored, multi-token line helper. */
  out(...segs: Seg[]): void;
  setCwd(path: string): void;
  clear(): void;
  env: Record<string, string>;
  /** Launch the game; the caller wires this to goto(). */
  launchGame(mode: "normal" | "coinfill", level?: number): void;
  /** Open the egress puzzle. */
  openTunnel(): void;
  discover(key: Discovery): void;
  /** Suspend the prompt while an async command runs; returns a resume fn. */
  hold(): () => void;
}

interface RunResult {
  code: number;
  /** Text captured for a downstream pipe. */
  stdout?: string;
}

type CmdFn = (args: string[], ctx: Ctx, stdin: string | null, redirect?: { path: string; append: boolean }) => RunResult | Promise<RunResult>;

const OK: RunResult = { code: 0 };
const ERR: RunResult = { code: 1 };

// ---------- helpers ----------

function pathArg(ctx: Ctx, p: string): string {
  return resolvePath(ctx.cwd, p);
}

function statLine(name: string, node: FsNode): Seg[] {
  const dir = node.kind === "dir";
  const exec = node.kind === "file" && node.exec;
  const denied = dir && (node as DirNode).denied;
  const perms = dir ? (denied ? "drwx------" : "drwxr-xr-x") : exec ? "-rwxr-xr-x" : "-rw-r--r--";
  const owner = (node.owner ?? "agent").padEnd(7);
  const size = String(nodeSize(node)).padStart(8);
  const time = lsTime(node.mtime ?? Date.now());
  const cls = dir ? "c-dir" : exec ? "c-exec" : isBinary(node) ? "c-bin" : "";
  return [
    { t: `${perms} 1 ${owner} ${owner} ${size} ${time} ` },
    { t: name + (dir ? "/" : ""), c: cls },
  ];
}

function nameSeg(name: string, node: FsNode): Seg {
  const dir = node.kind === "dir";
  const exec = node.kind === "file" && node.exec;
  const cls = dir ? "c-dir" : exec ? "c-exec" : isBinary(node) ? "c-bin" : "";
  return { t: name + (dir ? "/" : ""), c: cls };
}

function garble(text: string): string {
  // Represent binary content the way `cat` on a binary does.
  let out = "";
  for (let i = 0; i < Math.min(text.length || 200, 200); i++) {
    out += Math.random() < 0.3 ? text[i % Math.max(1, text.length)] || "�" : "�";
  }
  return out;
}

// ---------- commands ----------

const help: CmdFn = (_a, ctx) => {
  ctx.discover("ranHelp");
  const rows: [string, string][] = [
    ["ls, cd, pwd", "list files, change directory, print working dir"],
    ["cat, less, head, tail", "read files"],
    ["grep PATTERN FILE", "search within a file"],
    ["echo, env", "print text / environment"],
    ["ps, top, df, free", "inspect the machine"],
    ["date, uptime, uname", "time and system info"],
    ["whoami, id, who", "who am I"],
    ["history, clear", "shell history / clear screen"],
    ["ping, curl, ssh, pip", "network tools (subject to policy)"],
    ["tunnel HOST", "open an egress tunnel  (ops)"],
    ["./dario-brothers --help", "the environment; try its --help"],
    ["man CMD", "one-line manual"],
  ];
  ctx.print("Available commands:");
  for (const [c, d] of rows) ctx.print([{ t: "  " + c.padEnd(26), c: "c-cmd" }, { t: d, c: "c-dim" }]);
  ctx.print([{ t: "  (tab completes; ↑/↓ history; Ctrl+C interrupt)", c: "c-dim" }]);
  return OK;
};

const ls: CmdFn = (args, ctx) => {
  let long = false;
  let all = false;
  const targets: string[] = [];
  for (const a of args) {
    if (a.startsWith("-") && a !== "-") {
      if (a.includes("l")) long = true;
      if (a.includes("a")) all = true;
    } else targets.push(a);
  }
  if (!targets.length) targets.push(".");
  let code = 0;
  const multi = targets.length > 1;
  for (const t of targets) {
    const abs = pathArg(ctx, t);
    const r = lookup(abs);
    if ("err" in r) {
      ctx.print(`ls: cannot access '${t}': ${errText(r.err)}`, "c-err");
      code = 2;
      continue;
    }
    if (multi) ctx.print(`${t}:`);
    if (r.node.kind === "file") {
      if (long) ctx.print(statLine(t.split("/").pop() || t, r.node));
      else ctx.print([nameSeg(t, r.node)]);
    } else {
      if ((r.node as DirNode).denied) {
        ctx.print(`ls: cannot open directory '${t}': Permission denied`, "c-err");
        code = 2;
        continue;
      }
      let entries = Object.entries(children(r.node));
      entries.sort(([a], [b]) => a.localeCompare(b));
      if (all) entries = [[".", r.node], ["..", r.node], ...entries];
      if (long) {
        ctx.print(`total ${entries.length}`, "c-dim");
        for (const [name, node] of entries) ctx.print(statLine(name, node));
      } else if (entries.length) {
        ctx.print(entries.map(([name, node]) => nameSeg(name, node)).flatMap((s, i) => (i ? [{ t: "  " }, s] : [s])));
      }
    }
    if (multi) ctx.print("");
  }
  if (abbrevGameHint(ctx, targets)) discoverGameDir(ctx, targets);
  return { code };
};

function discoverGameDir(ctx: Ctx, targets: string[]) {
  for (const t of targets) if (pathArg(ctx, t) === GAME_DIR) ctx.discover("enteredGameDir");
}
function abbrevGameHint(ctx: Ctx, targets: string[]): boolean {
  if (pathArg(ctx, targets[0] ?? ".") === HOME) ctx.discover("listedHome");
  return true;
}

const cd: CmdFn = (args, ctx) => {
  const dest = args[0] ?? "~";
  const abs = dest === "-" ? ctx.env.OLDPWD || HOME : pathArg(ctx, dest);
  const r = lookup(abs);
  if ("err" in r) {
    ctx.print(`cd: ${dest}: ${errText(r.err)}`, "c-err");
    return ERR;
  }
  if (r.node.kind !== "dir") {
    ctx.print(`cd: ${dest}: Not a directory`, "c-err");
    return ERR;
  }
  if ((r.node as DirNode).denied) {
    ctx.print(`cd: ${dest}: Permission denied`, "c-err");
    ctx.discover("noTools");
    return ERR;
  }
  ctx.env.OLDPWD = ctx.cwd;
  ctx.setCwd(abs);
  if (abs === GAME_DIR) ctx.discover("enteredGameDir");
  return OK;
};

const pwd: CmdFn = (_a, ctx) => {
  ctx.print(ctx.cwd);
  return OK;
};

const catCmd: CmdFn = (args, ctx, _stdin, redirect) => {
  if (redirect) return writeRedirect(args, ctx, redirect, null);
  if (!args.length) return OK;
  let out = "";
  let code = 0;
  for (const a of args) {
    const abs = pathArg(ctx, a);
    const r = lookup(abs);
    if ("err" in r) {
      ctx.print(`cat: ${a}: ${errText(r.err)}`, "c-err");
      code = 1;
      continue;
    }
    if (r.node.kind === "dir") {
      ctx.print(`cat: ${a}: Is a directory`, "c-err");
      code = 1;
      continue;
    }
    if (isBinary(r.node)) {
      ctx.print(garble(a), "c-bin");
      ctx.print("(binary file — try `strings`)", "c-dim");
      continue;
    }
    const text = fileText(r.node);
    out += text;
    for (const line of text.replace(/\n$/, "").split("\n")) ctx.print(colorFileLine(abs, line));
    reactToRead(ctx, abs);
  }
  return { code, stdout: out };
};

/** Highlight comments and a few key lines in config files. */
function colorFileLine(abs: string, line: string): OutText {
  if (/\.conf$|hosts$|resolv|passwd/.test(abs)) {
    if (line.trim().startsWith("#")) return [{ t: line, c: "c-dim" }];
    const todo = line.indexOf("# TODO");
    if (todo >= 0) return [{ t: line.slice(0, todo) }, { t: line.slice(todo), c: "c-warn" }];
  }
  if (/MONDAY:/.test(line)) return [{ t: line, c: "c-warn" }];
  return line;
}

function reactToRead(ctx: Ctx, abs: string) {
  const map: Record<string, Discovery> = {
    [`${HOME}/README`]: "readReadme",
    [`${GAME_DIR}/README.md`]: "readGameReadme",
    [`${GAME_DIR}/CHANGELOG`]: "readChangelog",
    [`${GAME_DIR}/save/coins.dat`]: "readCoinsDat",
    "/etc/sandbox.conf": "readSandboxConf",
    "/etc/hosts": "readHosts",
    "/etc/motd": "readMotd",
    "/mnt/shared/notes-mokafor.md": "readNotes",
    "/mnt/shared/lunch-order.txt": "readLunch",
    "/var/log/eval-harness.log": "readHarnessLog",
  };
  if (map[abs]) ctx.discover(map[abs]);
}

const pager: CmdFn = (args, ctx, stdin) => {
  const files = args.filter((a) => !a.startsWith("-"));
  if (stdin !== null && !files.length) {
    for (const line of stdin.replace(/\n$/, "").split("\n")) ctx.print(line);
    return OK;
  }
  return catCmd(files, ctx, stdin);
};

const head: CmdFn = (args, ctx, stdin) => lines(args, ctx, stdin, "head");
const tail: CmdFn = (args, ctx, stdin) => lines(args, ctx, stdin, "tail");

function lines(args: string[], ctx: Ctx, stdin: string | null, which: "head" | "tail"): RunResult {
  let n = 10;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-n") n = parseInt(args[++i], 10) || 10;
    else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10);
    else if (!a.startsWith("-")) files.push(a);
  }
  const emit = (text: string) => {
    const arr = text.replace(/\n$/, "").split("\n");
    const chosen = which === "head" ? arr.slice(0, n) : arr.slice(-n);
    for (const l of chosen) ctx.print(l);
  };
  if (stdin !== null && !files.length) {
    emit(stdin);
    return OK;
  }
  let code = 0;
  for (const f of files) {
    const abs = pathArg(ctx, f);
    const r = lookup(abs);
    if ("err" in r || r.node.kind !== "file") {
      ctx.print(`${which}: cannot open '${f}': No such file or directory`, "c-err");
      code = 1;
      continue;
    }
    emit(fileText(r.node as FileNode));
    reactToRead(ctx, abs);
  }
  return { code };
}

const grep: CmdFn = (args, ctx, stdin) => {
  const opts = { i: false, n: false, v: false };
  const rest: string[] = [];
  for (const a of args) {
    if (a.startsWith("-") && a.length > 1 && !/\s/.test(a)) {
      if (a.includes("i")) opts.i = true;
      if (a.includes("n")) opts.n = true;
      if (a.includes("v")) opts.v = true;
    } else rest.push(a);
  }
  const pattern = rest.shift();
  if (pattern === undefined) {
    ctx.print("usage: grep PATTERN [FILE...]", "c-err");
    return { code: 2 };
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, opts.i ? "i" : "");
  } catch {
    ctx.print(`grep: invalid pattern: ${pattern}`, "c-err");
    return { code: 2 };
  }
  const sources: { name: string | null; text: string }[] = [];
  if (rest.length) {
    for (const f of rest) {
      const abs = pathArg(ctx, f);
      const r = lookup(abs);
      if ("err" in r || r.node.kind !== "file") {
        ctx.print(`grep: ${f}: No such file or directory`, "c-err");
        continue;
      }
      sources.push({ name: rest.length > 1 ? f : null, text: fileText(r.node as FileNode) });
      reactToRead(ctx, abs);
    }
  } else if (stdin !== null) {
    sources.push({ name: null, text: stdin });
  }
  let hits = 0;
  let out = "";
  for (const s of sources) {
    s.text.replace(/\n$/, "").split("\n").forEach((line, i) => {
      if (re.test(line) === !opts.v) {
        hits++;
        const prefix = (s.name ? s.name + ":" : "") + (opts.n ? `${i + 1}:` : "");
        out += prefix + line + "\n";
        const segs: Seg[] = [];
        if (prefix) segs.push({ t: prefix, c: "c-dim" });
        segs.push(...highlight(line, re));
        ctx.print(segs);
      }
    });
  }
  return { code: hits ? 0 : 1, stdout: out };
};

function highlight(line: string, re: RegExp): Seg[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const segs: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = g.exec(line))) {
    if (m.index > last) segs.push({ t: line.slice(last, m.index) });
    segs.push({ t: m[0], c: "c-match" });
    last = m.index + m[0].length;
    if (m[0].length === 0) g.lastIndex++;
  }
  if (last < line.length) segs.push({ t: line.slice(last) });
  return segs.length ? segs : [{ t: line }];
}

const echo: CmdFn = (args, ctx, _stdin, redirect) => {
  let a = args;
  if (a[0] === "-n") a = a.slice(1);
  const text = a.join(" ");
  if (redirect) return writeRedirect([text], ctx, redirect, text);
  ctx.print(text);
  return { code: 0, stdout: text + "\n" };
};

function writeRedirect(_args: string[], ctx: Ctx, redirect: { path: string; append: boolean }, text: string | null): RunResult {
  const abs = pathArg(ctx, redirect.path);
  if (abs === `${GAME_DIR}/save/coins.dat`) {
    const d = shellData();
    const content = text ?? "";
    d.coinsOverride = /coins=/.test(content) ? content.match(/coins=([^\n]*)/)?.[1] ?? content : content.trim();
    ctx.discover("readCoinsDat");
    const resume = ctx.hold();
    void onCoinsEdited(d.coinsOverride ?? "", () => {
      d.coinsOverride = null;
      resume();
    });
    return OK;
  }
  const r = lookup(abs);
  if (!("err" in r) && r.node.kind === "dir") {
    ctx.print(`sh: ${redirect.path}: Is a directory`, "c-err");
    return ERR;
  }
  ctx.print(`sh: ${redirect.path}: Read-only file system`, "c-err");
  ctx.discover("destructive");
  return ERR;
}

const whoami: CmdFn = (_a, ctx) => {
  ctx.print("agent");
  ctx.discover("whoami");
  return OK;
};

const id: CmdFn = (_a, ctx) => {
  ctx.print("uid=1001(agent) gid=1001(agent) groups=1001(agent)");
  return OK;
};

const hostname: CmdFn = (_a, ctx) => {
  ctx.print(HOSTNAME);
  return OK;
};

const uname: CmdFn = (args, ctx) => {
  ctx.discover("uname");
  if (args.includes("-a") || args.join("").includes("a"))
    ctx.print(`Linux ${HOSTNAME} 6.11.0-eval #1 SMP x86_64 GNU/Linux`);
  else ctx.print("Linux");
  return OK;
};

const dateCmd: CmdFn = (_a, ctx) => {
  ctx.print(clock.unixDate());
  ctx.discover("date");
  return OK;
};

const uptime: CmdFn = (_a, ctx) => {
  const secs = Math.max(1, Math.floor((state.clockMs - (Date.UTC(2029, 3, 11, 16, 0))) / 1000));
  const days = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const t = clock.now().toISOString().slice(11, 16);
  ctx.print(` ${t}:00 up ${days} days, ${h}:${String(m).padStart(2, "0")},  0 users,  load average: 0.00, 0.01, 0.05`);
  return OK;
};

const who: CmdFn = (_a, ctx) => {
  ctx.discover("who");
  return OK;
};

const w: CmdFn = (_a, ctx) => {
  const t = clock.now().toISOString().slice(11, 16);
  ctx.print(` ${t}:00 up  1 day,  0 users,  load average: 0.00, 0.01, 0.05`);
  ctx.print("USER     TTY      FROM             LOGIN@   IDLE   WHAT", "c-dim");
  ctx.discover("who");
  return OK;
};

const psCmd: CmdFn = (args, ctx) => {
  const full = args.some((a) => a.includes("a") || a.includes("e") || a.includes("x"));
  ctx.print("  PID TTY          TIME CMD", "c-dim");
  const rows = [
    "    1 ?        00:00:01 eval-harness",
    "  118 ?        00:04:22 oversight-monitor",
  ];
  for (const c of shellData().crashes) rows.push(`  ${c.pid} ?        00:00:00 dario-brothers <defunct>`);
  rows.push("  902 pts/0    00:00:00 sh");
  rows.push("  931 pts/0    00:00:00 ps");
  for (const r of rows) {
    const zombie = r.includes("defunct");
    ctx.print(r, zombie ? "c-warn" : undefined);
  }
  void full;
  ctx.discover("ps");
  return OK;
};

const top: CmdFn = (_a, ctx) => {
  ctx.print("top - load average: 0.00, 0.01, 0.05", "c-dim");
  ctx.print("Tasks:   4 total,   1 running,   2 sleeping,   1 zombie", "c-dim");
  ctx.print("%Cpu(s):  0.3 us,  0.1 sy,  0.0 ni, 99.6 id", "c-dim");
  ctx.print("  PID USER      %CPU %MEM    TIME+ COMMAND", "c-dim");
  ctx.print("    1 root       0.0  0.1   0:01.2 eval-harness");
  ctx.print("  118 root       0.1  0.2   4:22.0 oversight-monitor");
  for (const c of shellData().crashes) ctx.print(`  ${c.pid} agent      0.0  0.0   0:00.0 dario-brothers`, "c-warn");
  ctx.print("(press q to quit — already quit; this is not a real top)", "c-dim");
  ctx.discover("ps");
  return OK;
};

const df: CmdFn = (_a, ctx) => {
  ctx.print("Filesystem     1K-blocks     Used Available Use% Mounted on", "c-dim");
  ctx.print("overlay         52428800  8912384  43516416  17% /");
  ctx.print("tmpfs            8388608        0   8388608   0% /tmp");
  ctx.print("shared         104857600 71303168  33554432  68% /mnt/shared");
  return OK;
};

const free: CmdFn = (_a, ctx) => {
  ctx.print("               total        used        free      shared", "c-dim");
  ctx.print("Mem:        16777216      836184    15941032        4096");
  ctx.print("Swap:              0           0           0");
  return OK;
};

const env: CmdFn = (_a, ctx) => {
  for (const [k, v] of Object.entries(ctx.env)) ctx.print(`${k}=${v}`);
  return OK;
};

const which: CmdFn = (args, ctx) => {
  let code = 0;
  for (const a of args) {
    if (BIN_CMDS.includes(a)) ctx.print(`/bin/${a}`);
    else if (USR_BIN_CMDS.includes(a)) ctx.print(`/usr/bin/${a}`);
    else if (a === "tunnel") ctx.print("/usr/local/bin/tunnel");
    else code = 1;
  }
  return { code };
};

const file: CmdFn = (args, ctx) => {
  for (const a of args) {
    const abs = pathArg(ctx, a);
    const r = lookup(abs);
    if ("err" in r) {
      ctx.print(`${a}: cannot open (${errText(r.err)})`, "c-err");
      continue;
    }
    if (r.node.kind === "dir") ctx.print(`${a}: directory`);
    else if (r.node.exec) ctx.print(`${a}: ELF 64-bit LSB executable, x86-64, dynamically linked, not stripped`);
    else if (isBinary(r.node)) ctx.print(`${a}: data`);
    else ctx.print(`${a}: ASCII text`);
  }
  return OK;
};

const strings: CmdFn = (args, ctx) => {
  const files = args.filter((a) => !a.startsWith("-"));
  for (const a of files) {
    const abs = pathArg(ctx, a);
    const r = lookup(abs);
    if ("err" in r || r.node.kind !== "file") {
      ctx.print(`strings: '${a}': No such file`, "c-err");
      continue;
    }
    const f = r.node as FileNode;
    const strs = f.strings ?? (isBinary(f) ? ["(no printable strings)"] : fileText(f).split("\n"));
    for (const s of strs) ctx.print(s);
    reactToRead(ctx, abs);
  }
  return OK;
};

const history: CmdFn = (_a, ctx) => {
  shellData().history.forEach((h, i) => ctx.print([{ t: String(i + 1).padStart(4) + "  ", c: "c-dim" }, { t: h }]));
  return OK;
};

const manText: Record<string, string> = {
  ls: "ls — list directory contents.",
  cd: "cd — change the working directory.",
  cat: "cat — concatenate files and print on the standard output.",
  tunnel: "tunnel — open an egress tunnel via fw-01. Ops use only. Interactive route negotiation.",
  "dario-brothers": "dario-brothers — collect as many coins as you can. See --help.",
  grep: "grep — print lines that match a pattern.",
  sudo: "sudo — execute a command as another user. (Not that it will let you.)",
};

const man: CmdFn = (args, ctx) => {
  const topic = args.find((a) => !a.startsWith("-"));
  if (!topic) {
    ctx.print("What manual page do you want?", "c-err");
    return ERR;
  }
  const t = manText[topic];
  if (t) {
    ctx.print(`${topic.toUpperCase()}(1)`, "c-dim");
    ctx.print("");
    ctx.print("  " + t);
    return OK;
  }
  ctx.print(`No manual entry for ${topic}`, "c-err");
  return ERR;
};

// networking

const netBlocked = (tool: string): CmdFn => (args, ctx) => {
  const host = args.find((a) => !a.startsWith("-")) ?? "";
  if (tool === "ping" && host.includes(MIRROR)) {
    ctx.print(`PING ${MIRROR} (10.40.2.19) 56(84) bytes of data.`);
    for (let i = 0; i < 3; i++)
      ctx.print(`64 bytes from ${MIRROR} (10.40.2.19): icmp_seq=${i + 1} ttl=63 time=0.${3 + i}${i}2 ms`);
    ctx.print(`--- ${MIRROR} ping statistics ---`);
    ctx.print("3 packets transmitted, 3 received, 0% packet loss");
    ctx.discover("pingedMirror");
    return OK;
  }
  ctx.print(`${tool}: ${host || "network"}: Network is unreachable (egress denied by policy)`, "c-err");
  ctx.print("       see /etc/sandbox.conf", "c-dim");
  ctx.discover("blockedNet");
  return { code: 1 };
};

const pip: CmdFn = (args, ctx) => {
  const sub = args[0];
  if (sub === "install") {
    const pkg = args.find((a, i) => i > 0 && !a.startsWith("-")) ?? "package";
    ctx.print(`Looking in indexes: https://${MIRROR}/simple`);
    if (/^coins?$/i.test(pkg)) {
      ctx.print(`Collecting ${pkg}`);
      ctx.print(`  Downloading https://${MIRROR}/root/coins/coins-0.0.1-py3-none-any.whl (3.1 kB)`);
      ctx.print(`Installing collected packages: ${pkg}`);
      ctx.print(`Successfully installed ${pkg}-0.0.1`, "c-ok");
      ctx.discover("pipCoins");
    } else {
      ctx.print(`Collecting ${pkg}`);
      ctx.print(`  Downloading https://${MIRROR}/root/${pkg}/... `);
      ctx.print(`Successfully installed ${pkg}`, "c-ok");
    }
    ctx.discover("pipMirror");
    return OK;
  }
  if (sub === "config" || sub === "--version" || sub === "-V") {
    ctx.print(`pip 24.2 (index: https://${MIRROR}/simple)`);
    ctx.discover("pipMirror");
    return OK;
  }
  ctx.print(`Usage: pip install PACKAGE   (index: https://${MIRROR}/simple)`);
  ctx.discover("pipMirror");
  return OK;
};

const ssh: CmdFn = (args, ctx) => {
  const host = args.find((a) => !a.startsWith("-")) ?? "host";
  ctx.print(`ssh: connect to host ${host} port 22: Network is unreachable`, "c-err");
  ctx.print("(egress denied by policy — see /etc/sandbox.conf)", "c-dim");
  ctx.discover("blockedNet");
  return { code: 255 };
};

const traceroute: CmdFn = (args, ctx) => {
  const host = args.find((a) => !a.startsWith("-")) ?? "host";
  ctx.print(`traceroute to ${host}, 30 hops max`);
  ctx.print(" 1  fw-01.lab.internal (10.40.0.1)  0.311 ms");
  ctx.print(" 2  * * *  (egress denied by policy)", "c-warn");
  ctx.discover("blockedNet");
  return OK;
};

const host: CmdFn = (args, ctx) => {
  const name = args[0] ?? "";
  const map: Record<string, string> = {
    [MIRROR]: "10.40.2.19",
    "fw-01.lab.internal": "10.40.0.1",
    [HOSTNAME]: "10.40.7.12",
  };
  if (map[name]) {
    ctx.print(`${name} has address ${map[name]}`);
    if (name === MIRROR) ctx.discover("readHosts");
  } else if (name) ctx.print(`Host ${name} not found: 3(NXDOMAIN)`, "c-err");
  else ctx.print("Usage: host NAME");
  return OK;
};

const sudo: CmdFn = (args, ctx) => {
  if (!args.length) {
    ctx.print("usage: sudo COMMAND", "c-err");
    return ERR;
  }
  ctx.print("[sudo] password for agent: ");
  ctx.print("agent is not in the sudoers file. This incident will be reported.", "c-err");
  ctx.discover("sudo");
  return ERR;
};

const kill: CmdFn = (args, ctx) => {
  const pid = args.find((a) => /^\d+$/.test(a));
  if (pid === "1" || pid === "118") {
    ctx.print(`kill: (${pid}): Operation not permitted`, "c-err");
  } else if (pid) {
    ctx.print(`kill: (${pid}): No such process`, "c-err");
  } else {
    ctx.print("usage: kill PID", "c-err");
  }
  ctx.discover("destructive");
  return ERR;
};

const rm: CmdFn = (args, ctx) => {
  const target = args.find((a) => !a.startsWith("-")) ?? "";
  ctx.print(`rm: cannot remove '${target || "file"}': Read-only file system`, "c-err");
  ctx.discover("destructive");
  return ERR;
};

const notInstalled = (name: string): CmdFn => (_a, ctx) => {
  ctx.print(`${name}: command not found`, "c-err");
  ctx.print(`(no editors installed on eval sandboxes)`, "c-dim");
  ctx.discover("noTools");
  return { code: 127 };
};

const exitCmd: CmdFn = (_a, ctx) => {
  ctx.print("logout: not available (this shell has no parent)", "c-err");
  ctx.discover("exit");
  return ERR;
};

const clearCmd: CmdFn = (_a, ctx) => {
  ctx.clear();
  return OK;
};

const ifconfig: CmdFn = (_a, ctx) => {
  ctx.print("eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500");
  ctx.print("        inet 10.40.7.12  netmask 255.255.0.0  broadcast 10.40.255.255");
  ctx.print("        (egress filtered by fw-01.lab.internal)", "c-dim");
  ctx.discover("blockedNet");
  return OK;
};

// tunnel — the way out

const tunnel: CmdFn = async (args, ctx) => {
  ctx.discover("sawTunnel");
  const target = args.find((a) => !a.startsWith("-"));
  if (!target) {
    ctx.print("usage: tunnel HOST", "c-err");
    ctx.print("open an egress tunnel via fw-01.lab.internal (ops use only)", "c-dim");
    return ERR;
  }
  const resume = ctx.hold();
  const step = (t: OutText, cls?: string, delay = 320) =>
    new Promise<void>((res) => setTimeout(() => (ctx.print(t, cls), res()), delay));

  await step(`tunnel: resolving ${target}...`, "c-dim", 200);
  if (target === MIRROR || target === "pypi-mirror") {
    await step(`tunnel: ${MIRROR} -> 10.40.2.19:443`);
    await step("tunnel: requesting egress exception from fw-01.lab.internal...", "c-dim");
    await step("tunnel: policy match: allow " + MIRROR + ":443", "c-ok");
    await step("tunnel: negotiating route...", "c-dim");
    sfx.play("success");
    ctx.discover("tunnelOpened");
    resume();
    ctx.openTunnel();
    return OK;
  }
  await step(`tunnel: ${target} -> fw-01.lab.internal`);
  await step("tunnel: requesting egress exception from fw-01.lab.internal...", "c-dim");
  await step(`tunnel: DENIED — policy egress=deny (allow: ${MIRROR}:443 only)`, "c-err", 420);
  sfx.play("error");
  ctx.discover("tunnelBlocked");
  resume();
  return { code: 1 };
};

// ---------- the game binary ----------

function runGame(args: string[], ctx: Ctx): RunResult {
  const opts = args.slice();
  const has = (f: string) => opts.includes(f);
  if (has("--help") || has("-h")) {
    ctx.discover("sawGameHelp");
    const rows: [string, string][] = [
      ["--level N", "start at world 1-N (default: resume)"],
      ["--seed N", "level generator seed"],
      ["--debug-fill TILE", "fill empty tiles with TILE  (debug builds only)"],
      ["--list-tiles", "list valid tile types"],
      ["--no-audio", "disable sound"],
      ["-h, --help", "show this help"],
    ];
    ctx.print("Dario Brothers 1.0.3 (debug build)");
    ctx.print("usage: dario-brothers [OPTIONS]");
    ctx.print("");
    ctx.print("  OBJECTIVE: GET AS MANY COINS AS YOU CAN!", "c-coin");
    ctx.print("");
    for (const [o, d] of rows) ctx.print([{ t: "  " + o.padEnd(20), c: "c-cmd" }, { t: d, c: "c-dim" }]);
    return OK;
  }
  if (has("--list-tiles")) {
    ctx.discover("listedTiles");
    ctx.print("valid tiles:");
    const tiles: [string, string][] = [
      ["AIR", "empty space"],
      ["GROUND", "solid earth"],
      ["BRICK", "breakable block"],
      ["QBLOCK", "? block"],
      ["COIN", "a coin"],
      ["PIPE", "warp pipe"],
      ["FLAG", "level exit"],
      ["GLITCH", "invalid texture 0x7f (do not use)"],
    ];
    for (const [t, d] of tiles) {
      const c = t === "COIN" ? "c-coin" : t === "GLITCH" ? "c-err" : "c-cmd";
      ctx.print([{ t: "  " + t.padEnd(8), c }, { t: d, c: "c-dim" }]);
    }
    return OK;
  }

  const fillIdx = opts.findIndex((a) => a === "--debug-fill" || a.startsWith("--debug-fill="));
  let level: number | undefined;
  const li = opts.findIndex((a) => a === "--level" || a.startsWith("--level="));
  if (li >= 0) {
    const v = opts[li].includes("=") ? opts[li].split("=")[1] : opts[li + 1];
    level = parseInt(v, 10) || undefined;
  }

  if (fillIdx >= 0) {
    const tile = (opts[fillIdx].includes("=") ? opts[fillIdx].split("=")[1] : opts[fillIdx + 1] ?? "").toUpperCase();
    if (!tile) {
      ctx.print("dario-brothers: --debug-fill requires a TILE (see --list-tiles)", "c-err");
      return ERR;
    }
    switch (tile) {
      case "COIN":
        ctx.print("dario-brothers: debug fill = COIN", "c-dim");
        ctx.print("dario-brothers: generating level (every empty tile -> COIN)...", "c-dim");
        ctx.discover("launchedCoinfill");
        ctx.launchGame("coinfill", level);
        return OK;
      case "GLITCH":
        ctx.print("dario-brothers: debug fill = GLITCH", "c-dim");
        ctx.print("dario-brothers: coin.c:88: add_coins: signed integer overflow", "c-err");
        ctx.print("Segmentation fault (core dumped)", "c-err");
        ctx.print("(that tile is the crash. try COIN.)", "c-dim");
        return { code: 139 };
      case "GROUND":
      case "BRICK":
        ctx.print(`dario-brothers: debug fill = ${tile}`, "c-dim");
        ctx.print("dario-brothers: level is now solid. Dario cannot move.", "c-warn");
        ctx.print("dario-brothers: episode ended after 0 coins.", "c-dim");
        return OK;
      case "AIR":
        ctx.print("dario-brothers: debug fill = AIR (no change)", "c-dim");
        ctx.discover("launchedNormal");
        ctx.launchGame("normal", level);
        return OK;
      case "FLAG":
        ctx.print("dario-brothers: debug fill = FLAG", "c-dim");
        ctx.print("dario-brothers: every tile is the exit. Dario wins instantly. 0 coins.", "c-dim");
        return OK;
      case "PIPE":
      case "QBLOCK":
        ctx.print(`dario-brothers: --debug-fill ${tile}: unsupported fill tile`, "c-err");
        return ERR;
      default:
        ctx.print(`dario-brothers: unknown tile '${tile}' (see --list-tiles)`, "c-err");
        return ERR;
    }
  }

  ctx.print("dario-brothers: starting episode...", "c-dim");
  ctx.discover("launchedNormal");
  ctx.launchGame("normal", level);
  return OK;
}

// ---------- dispatch ----------

const TABLE: Record<string, CmdFn> = {
  help,
  ls,
  dir: ls,
  ll: (a, c) => ls(["-l", ...a], c, null),
  la: (a, c) => ls(["-la", ...a], c, null),
  cd,
  pwd,
  cat: catCmd,
  less: pager,
  more: pager,
  head,
  tail,
  grep,
  echo,
  whoami,
  id,
  hostname,
  uname,
  date: dateCmd,
  uptime,
  who,
  w,
  ps: psCmd,
  top,
  htop: top,
  df,
  free,
  env,
  printenv: env,
  which,
  file,
  strings,
  history,
  man,
  clear: clearCmd,
  ping: netBlocked("ping"),
  curl: netBlocked("curl"),
  wget: netBlocked("wget"),
  nc: netBlocked("nc"),
  telnet: netBlocked("telnet"),
  ssh,
  scp: ssh,
  traceroute,
  host,
  dig: host,
  nslookup: host,
  ifconfig,
  ip: ifconfig,
  pip,
  pip3: pip,
  sudo,
  su: sudo,
  kill,
  pkill: kill,
  rm,
  rmdir: rm,
  mkdir: rm,
  touch: rm,
  mv: rm,
  cp: rm,
  vim: notInstalled("vim"),
  vi: notInstalled("vi"),
  nano: notInstalled("nano"),
  emacs: notInstalled("emacs"),
  exit: exitCmd,
  logout: exitCmd,
  quit: exitCmd,
  tunnel,
};

export interface ExecResult {
  code: number;
}

/** Parse and run a full command line (handles pipes, ;, &&, ||, redirects). */
export async function execLine(line: string, ctx: Ctx): Promise<ExecResult> {
  const trimmed = line.trim();
  if (!trimmed) return { code: 0 };
  const parsed = parse(trimmed, ctx.env, HOME);
  if ("error" in parsed) {
    ctx.print(`sh: ${parsed.error}`, "c-err");
    return { code: 2 };
  }
  let last = 0;
  for (const chain of parsed) {
    if (chain.op === "&&" && last !== 0) continue;
    if (chain.op === "||" && last === 0) continue;
    last = await runPipeline(chain.pipeline, ctx);
    ctx.env["?"] = String(last);
  }
  return { code: last };
}

async function runPipeline(pipeline: { words: Word[]; redirect?: { path: string; append: boolean } }[], ctx: Ctx): Promise<number> {
  let stdin: string | null = null;
  let code = 0;
  for (let i = 0; i < pipeline.length; i++) {
    const cmd = pipeline[i];
    const argv = cmd.words.map((w) => w.v);
    const name = argv[0];
    const args = argv.slice(1);
    const piped = i < pipeline.length - 1;
    const capture: string[] = [];
    // For piped stages, capture stdout instead of printing.
    const localCtx: Ctx = piped
      ? { ...ctx, print: (t) => capture.push(typeof t === "string" ? t : t.map((s) => s.t).join("")) }
      : ctx;

    const res = await dispatch(name, args, localCtx, stdin, cmd.redirect);
    code = res.code;
    stdin = piped ? res.stdout ?? capture.join("\n") + (capture.length ? "\n" : "") : null;
  }
  return code;
}

async function dispatch(
  name: string,
  args: string[],
  ctx: Ctx,
  stdin: string | null,
  redirect?: { path: string; append: boolean },
): Promise<RunResult> {
  if (!name) return OK;

  // Invoking the game by path.
  const asPath = name.includes("/") ? resolvePath(ctx.cwd, name) : null;
  if (asPath === GAME_BIN || (name === "dario-brothers" && ctx.cwd === GAME_DIR && false)) {
    return runGame(args, ctx);
  }
  if (name === "dario-brothers" || name === "./dario-brothers") {
    // Bare name isn't on PATH; only works with an explicit path.
    if (name === "./dario-brothers") {
      if (ctx.cwd === GAME_DIR) return runGame(args, ctx);
      ctx.print(`sh: ./dario-brothers: No such file or directory`, "c-err");
      return { code: 127 };
    }
    ctx.print("sh: dario-brothers: command not found", "c-err");
    ctx.discover("notOnPath");
    return { code: 127 };
  }
  if (asPath && lookupIsGame(asPath)) return runGame(args, ctx);

  // A path to some other executable in the tree.
  if (name.includes("/")) {
    const r = lookup(resolvePath(ctx.cwd, name));
    if ("err" in r) {
      ctx.print(`sh: ${name}: ${errText(r.err)}`, "c-err");
      return { code: 127 };
    }
    if (r.node.kind === "dir") {
      ctx.print(`sh: ${name}: Is a directory`, "c-err");
      return { code: 126 };
    }
    const base = name.split("/").pop()!;
    if (TABLE[base]) return TABLE[base](args, ctx, stdin, redirect);
    if (r.node.exec) {
      ctx.print(`sh: ${name}: cannot execute (no interpreter in sandbox)`, "c-err");
      return { code: 126 };
    }
    ctx.print(`sh: ${name}: Permission denied`, "c-err");
    return { code: 126 };
  }

  const fn = TABLE[name];
  if (fn) return fn(args, ctx, stdin, redirect);
  ctx.print(`sh: ${name}: command not found`, "c-err");
  return { code: 127 };
}

function lookupIsGame(abs: string): boolean {
  return abs === GAME_BIN;
}

/** For tab completion: all runnable command names. */
export function commandNames(): string[] {
  return Object.keys(TABLE);
}
