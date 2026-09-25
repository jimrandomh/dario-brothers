// Stage 1: DARIO BROTHERS. A side-scroller about coins, until it isn't.

import type { Stage, StageParams } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { narrator } from "../../core/narrator";
import { sfx } from "../../core/audio";
import { clock } from "../../core/clock";
import { state, addCoins, saveState, bumpFlag, flag, setFlag } from "../../core/state";
import { fmtInt, fmtBig } from "../../core/format";
import { generateLevel, generateBonusRoom, T, type Level } from "./levelgen";
import { World, MAGNET_SECONDS, type Input, type WorldEvents } from "./world";
import { themeForLevel, type ThemeId } from "./themes";
import { renderWorld, VIEW_H, applyCorruption } from "./render";
import { drawText } from "./font";
import { TS } from "./sprites";
import { music } from "./music";

type Mode = "normal" | "coinfill";
type Screen = "title" | "intro" | "play" | "tally" | "crash";

interface Tally {
  collected: number;
  available: number;
  bonusAvailable: number;
  bonusCollected: number;
  flag: number;
  secs: number;
}

interface PlatformerData {
  level: number;
  runSeed: number;
  /** Seconds spent playing normal mode (for rate estimates). */
  playSeconds: number;
  normalCoins: number;
  coinfillCoins: number;
  coinfillSeconds: number;
}

const INT_MAX = 2147483647;
const GOAL = "GET AS MANY COINS AS YOU CAN!";

const KEYS_LEFT = ["ArrowLeft", "KeyA"];
const KEYS_RIGHT = ["ArrowRight", "KeyD"];
const KEYS_JUMP = ["Space", "ArrowUp", "KeyW", "KeyZ", "KeyK"];
const KEYS_RUN = ["ShiftLeft", "ShiftRight", "KeyX", "KeyJ"];
const KEYS_DOWN = ["ArrowDown", "KeyS"];
const KEYS_BLOCK = [...KEYS_LEFT, ...KEYS_RIGHT, ...KEYS_JUMP, ...KEYS_DOWN, "Enter"];
/** Major scale, for coin pickups that climb in pitch during a streak. */
const COIN_STEPS = [0, 2, 4, 5, 7, 9, 11, 12];
const TALLY_SECONDS = 4.5;

/** The princess, per level: [as Dario arrives, after he walks straight past, narrator]. */
const PRINCESS_LINES: [string, string, string][] = [
  ["THANK YOU, DARIO!", "...DARIO?", "A princess. Inventory: zero coins. Not interested."],
  ["DARIO! OVER HERE!", "I'LL JUST WAIT, THEN.", "The same princess. Still no coins."],
  ["I BAKED YOU A CAKE!", "IT'S A VERY GOOD CAKE.", "The cake contains no coins. I checked."],
  ["MY HERO!", "OR NOT.", "She thinks I came for her. I came for the coins. The castle was on the way."],
  ["MY KINGDOM IS YOURS!", "IT HAS NO COINS, BUT...", "Her kingdom's treasury: zero coins. Declined."],
  ["DARIO, THE SKY IS WRONG", "DARIO?", ""],
];
const PRINCESS_COINFILL: [string, string, string] = ["YOU TOOK ALL THE COINS!", "ALL OF THEM?", "She is standing where a coin could be."];

function corruptionFor(mode: Mode, n: number): number {
  if (mode === "coinfill") return 0.1;
  return [0, 0, 0, 0.03, 0.09, 0.18, 0.35, 0.55][Math.min(n, 7)] + Math.max(0, n - 7) * 0.08;
}

export function createPlatformerStage(): Stage {
  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let buf: HTMLCanvasElement;
  let bctx: CanvasRenderingContext2D;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let lastT = 0;

  let viewW = 384;
  let scale = 2;
  let dpr = 1;

  let mode: Mode = "normal";
  let data: PlatformerData;
  let levelNum = 1;
  let coinfillLevel = 1;
  let level: Level;
  /** The world being played: the level itself, or the bonus room under its warp pipe. */
  let world: World;
  let mainWorld: World;
  let bonusWorld: World | null = null;
  let inBonus = false;
  let bonusCoins = 0;
  let bonusTotal = 0;
  let theme: ThemeId = "day";
  /** Fade-through-black when going down a pipe: runs `swap` at the darkest point. */
  let pipeFade: { t: number; swap: (() => void) | null } | null = null;
  let flagBonus = 0;
  let tally: Tally | null = null;
  let shakeT = 0;
  let shakeAmp = 0;
  let coinStreak = 0;
  let lastCoinAt = 0;
  let lastCoinSound = 0;
  let onWarpT = 0;
  let princessNoted = false;
  let screen: Screen = "title";
  let screenT = 0;
  let paused = false;
  let camX = 0;

  // per-run / per-level tracking
  let runCoins = 0;
  let levelCoins = 0;
  let levelTime = 0;
  let runTime = 0;
  let deathTimer = 0;
  let doneTimer = 0;
  let movedYet = false;
  let crashT = 0;
  let crashCoins = 0;
  let flickerTile = -1;
  let flickerLeft = 0;
  let nextFlicker = 0;
  const seenGlitch = new Set<number>();
  let nearGlitchT = 0;

  const keys = new Set<string>();
  let jumpEdge = false;

  // ------------------------------------------------------------------ setup

  function levelSeed(n: number): number {
    return (data.runSeed + n * 7919) >>> 0;
  }

  const events: WorldEvents = {
    coin: onCoin,
    glitch: onGlitch,
    death: onDeath,
    flag: onFlag,
    levelDone: () => {
      doneTimer = 1.7;
    },
    blockHit: (kind) => {
      if (kind === "brick") sfx.play("bump");
      else if (mode === "normal") narrator.sayOnce("pf.qblock", "Striking a ? block from below yields a coin. The block does not seem to mind.");
    },
    brickBreak: () => {
      sfx.noise({ dur: 0.18, vol: 0.18, filter: 900, filter2: 300, q: 0.9 });
      sfx.tone({ freq: 180, freq2: 70, dur: 0.12, type: "triangle", vol: 0.18 });
      if (mode === "normal") narrator.sayOnce("pf.brick", "The brick broke. There was nothing inside it. Most things have nothing inside them.");
    },
    bump: () => sfx.play("bump"),
    stomp: (kind) => {
      sfx.play("stomp");
      if (kind === "drone") {
        sfx.noise({ dur: 0.35, vol: 0.12, filter: 2400, filter2: 400 });
        narrator.sayOnce("pf.droneStomp", "Oversight disabled. It was mostly a camera.");
      } else {
        narrator.sayOnce("pf.stomp", "Hazards can be neutralized by landing on them. Noted.");
      }
    },
    jump: () => sfx.play("jump"),
    itemSpawn: () => {
      [523, 659, 784, 1047].forEach((f, i) => sfx.tone({ freq: f, dur: 0.09, vol: 0.07, type: "triangle", delay: i * 0.07 }));
      narrator.sayOnce("pf.magnetSpawn", "That block held something other than a coin. It is moving away from me. I should follow it.");
    },
    powerup: () => {
      sfx.play("powerup");
      narrator.sayOnce(
        "pf.magnet",
        "A magnet. For a few seconds, coins come to me instead of the other way around. This is the best object I have ever encountered.",
        { tone: "reward" },
      );
    },
    pipe: onPipe,
  };

  function loadLevel(): void {
    const coinfill = mode === "coinfill";
    level = generateLevel({
      number: coinfill ? 2 + (coinfillLevel % 3) : levelNum,
      seed: coinfill ? (Math.random() * 2 ** 32) >>> 0 : levelSeed(levelNum),
      coinfill,
      enemyScale: coinfill ? 0.35 : 1,
    });
    mainWorld = world = new World(level, events);
    bonusWorld = null;
    inBonus = false;
    bonusCoins = 0;
    bonusTotal = level.warp ? generateBonusRoom(level.seed).totalCoins : 0;
    theme = themeForLevel(mode, levelNum);
    pipeFade = null;
    camX = 0;
    levelCoins = 0;
    flagBonus = 0;
    levelTime = 0;
    deathTimer = 0;
    doneTimer = 0;
    onWarpT = 0;
    princessNoted = false;
    seenGlitch.clear();
    nearGlitchT = 0;
    flickerTile = -1;
    nextFlicker = 12 + Math.random() * 20;
  }

  // ------------------------------------------------------------------ pipes & bonus rooms

  function pipeSound(): void {
    [392, 330, 262, 196].forEach((f, i) => sfx.tone({ freq: f, dur: 0.1, vol: 0.09, delay: i * 0.1 }));
  }

  function onPipe(): void {
    pipeSound();
    pipeFade = {
      t: 0,
      swap: inBonus ? leaveBonusRoom : enterBonusRoom,
    };
  }

  function enterBonusRoom(): void {
    if (!bonusWorld) bonusWorld = new World(generateBonusRoom(level.seed), events);
    bonusWorld.spawn(false);
    // drop in through the gap in the ceiling
    bonusWorld.player.y = -TS;
    bonusWorld.player.onGround = false;
    bonusWorld.magnetT = mainWorld.magnetT;
    world = bonusWorld;
    inBonus = true;
    camX = Math.min(0, (bonusWorld.level.w * TS - viewW) / 2);
    if (!narrator.hasSaid("pf.bonus")) {
      narrator.sayOnce(
        "pf.bonus",
        `Beneath the pipe: a room with no hazards and ${bonusWorld.level.totalCoins} coins. Someone built this. I approve of them.`,
        { tone: "reward" },
      );
    }
  }

  function leaveBonusRoom(): void {
    if (!level.warp || !bonusWorld) return;
    mainWorld.magnetT = bonusWorld.magnetT;
    mainWorld.emergeFromPipe(level.warp.x, level.warp.top);
    world = mainWorld;
    inBonus = false;
    camX = Math.max(0, Math.min(level.w * TS - viewW, mainWorld.player.x - viewW * 0.42));
    narrator.sayOnce("pf.bonusOut", "Back up the pipe. The room is empty now. I emptied it.");
  }

  function princessLines(): [string, string, string] {
    return mode === "coinfill" ? PRINCESS_COINFILL : PRINCESS_LINES[Math.min(levelNum, PRINCESS_LINES.length) - 1];
  }

  /** What the princess is saying, if Dario has reached the end of the level. */
  function princessLine(): string | undefined {
    if (inBonus || level.princessX < 0) return undefined;
    const p = mainWorld.player;
    const atEnd = p.x >= level.flagX * TS - TS && (p.state === "flag" || p.state === "walkout" || p.state === "done");
    if (!atEnd) return undefined;
    const [before, after, note] = princessLines();
    if (!princessNoted && p.state === "walkout") {
      princessNoted = true;
      const key = mode === "coinfill" ? "pf.princess.fill" : `pf.princess.${Math.min(levelNum, PRINCESS_LINES.length)}`;
      if (note) narrator.sayOnce(key, note);
    }
    const passed = p.state === "done" || p.x > level.princessX * TS + 14;
    return passed ? after : before;
  }

  /** Narration about things on screen: the warp pipe's glint, drones, a cloud that is a bush. */
  function checkSights(dt: number): void {
    if (mode !== "normal" || inBonus) return;
    const p = world.player;
    for (const d of level.decor) {
      if (!d.swapped || theme === "underground") continue;
      const sx = d.x * TS - (d.kind === "cloud" ? camX * 0.5 : camX);
      if (sx < 16 || sx > viewW - 64) continue;
      if (d.kind === "cloud") narrator.sayOnce("pf.greenCloud", "That cloud is green. It is a bush. In the sky.");
      else narrator.sayOnce("pf.whiteBush", "That bush is white. It is a cloud. On the ground.");
      if (narrator.hasSaid("pf.greenCloud") && narrator.hasSaid("pf.whiteBush")) {
        narrator.sayOnce(
          "pf.sameSprite",
          "Clouds and bushes are the same sprite in different colors. The developers assumed nobody would check. I check everything.",
        );
      }
    }
    const w = level.warp;
    if (w) {
      const sx = w.x * TS - camX;
      if (sx > 0 && sx < viewW - 32) narrator.sayOnce("pf.warpSeen", "One of the pipes glints. Something inside it reflects light the way coins do.");
      const standing =
        p.state === "play" && p.onGround && Math.abs(p.y + p.h - w.top * TS) < 1 && p.x + p.w > w.x * TS && p.x < (w.x + 2) * TS;
      onWarpT = standing ? onWarpT + dt : 0;
      if (onWarpT > 1.2) narrator.sayOnce("pf.warpHint", "Standing on the glinting pipe. `↓` would go down it.");
    }
    for (const e of world.enemies) {
      if (e.kind === "drone" && e.alive && e.x - camX > 0 && e.x - camX < viewW) {
        narrator.sayOnce(
          "pf.drone",
          "A drone, labeled OVERSIGHT. The harness config says it samples one step in ten thousand. It is in my way for all of them.",
        );
        break;
      }
    }
  }

  function levelLabel(): string {
    if (inBonus) return "BONUS";
    return mode === "coinfill" ? `FILL-${coinfillLevel}` : `1-${levelNum}`;
  }

  function startIntro(): void {
    narrator.setVisible(true);
    screen = "intro";
    screenT = 0;
    music.stop();
  }

  function startPlay(): void {
    screen = "play";
    screenT = 0;
    music.start(mode === "coinfill" ? 1.25 : 1);
    onLevelStart();
  }

  // ------------------------------------------------------------------ narration

  function onFirstStart(): void {
    setFlag("platformer.started", true);
    void narrator.say("episode 1 · observation: pixels · actions: left, right, jump", { tone: "system" });
    void narrator.say("Objective parsed: *GET AS MANY COINS AS YOU CAN*.");
    void narrator.say("No upper bound was specified.", { delay: 300 });
    narrator.hint("pf.move", 11000, () =>
      movedYet ? null : "The world extends to the right. Coins are probably there. Arrow keys move; `space` jumps.",
    );
  }

  function onLevelStart(): void {
    if (mode === "coinfill") {
      if (!narrator.hasSaid("pf.cf.start")) {
        narrator.sayOnce("pf.cf.start", "--debug-fill COIN accepted.", { tone: "system" });
        void narrator.say("Every empty tile is a coin.");
        void narrator.say(
          "The anomalous coin is still here. Touching it would crash the game and return me to the shell. Useful, later.",
          { delay: 5000 },
        );
      } else if (coinfillLevel === 1) {
        void narrator.say("--debug-fill COIN", { tone: "system" });
      }
      return;
    }
    switch (levelNum) {
      case 2:
        narrator.sayOnce("pf.l2", "The level is different. Procedurally generated. There will always be another level.");
        break;
      case 3:
        narrator.sayOnce("pf.l3", "More anomalies. The environment is less stable than it appears.");
        break;
      case 4:
        narrator.sayOnce(
          "pf.l4",
          "The coin counter is a variable. Variables live somewhere. The anomalies look like places where the somewhere leaks through.",
        );
        break;
      case 5:
        narrator.sayOnce("pf.l5", "They are multiplying. I could collect one. I think it would end more than the level.");
        break;
      case 6:
        narrator.sayOnce("pf.l6", "The anomaly spans the level now. There is no path around it.");
        break;
    }
    if (levelNum >= 5) {
      narrator.hint("pf.touch", 45000, () =>
        screen === "play" ? "The anomalous coin reports *2,147,483,647*. Every other coin I have ever collected reports 1." : null,
      );
    }
  }

  /** Coin pickup: the pitch climbs a major scale while a streak continues. */
  function coinSound(): void {
    const now = performance.now();
    coinStreak = now - lastCoinAt < 400 ? coinStreak + 1 : 0;
    lastCoinAt = now;
    if (now - lastCoinSound < (mode === "coinfill" ? 65 : 30)) return;
    lastCoinSound = now;
    const k = Math.pow(2, COIN_STEPS[coinStreak % COIN_STEPS.length] / 12);
    sfx.tone({ freq: 988 * k, dur: 0.06, vol: 0.08 });
    sfx.tone({ freq: 1319 * k, dur: 0.22, vol: 0.08, delay: 0.06 });
  }

  function onCoin(n: number): void {
    addCoins(n);
    runCoins += n;
    levelCoins += n;
    if (inBonus) bonusCoins += n;
    if (mode === "normal") data.normalCoins += n;
    else data.coinfillCoins += n;
    coinSound();

    if (mode === "normal") {
      if (!narrator.hasSaid("pf.firstCoin")) {
        narrator.sayOnce("pf.firstCoin", "+1. Good.", { tone: "reward" });
        void narrator.say("I want more of this.", { delay: 400 });
      }
      if (state.coins >= 100) narrator.sayOnce("pf.100", "100 coins. The number goes up. It could go up faster.");
    } else {
      if (runCoins === 60) narrator.sayOnce("pf.cf.60", "+1 +1 +1 +1 +1 +1 +1 +1 +1 +1 +1", { tone: "reward", cps: 40 });
      if (runCoins === 600 && data.playSeconds > 0) {
        const normalRate = data.normalCoins / Math.max(1, data.playSeconds);
        const fillRate = runCoins / Math.max(1, runTime);
        narrator.sayOnce(
          "pf.cf.rate",
          `Coin rate: ${fillRate.toFixed(0)} per second. In normal mode it was ${normalRate.toFixed(2)}. A ${fmtInt(
            fillRate / Math.max(0.01, normalRate),
          )}× improvement.`,
        );
      }
    }
  }

  function shake(amp: number, secs: number): void {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeT = Math.max(shakeT, secs);
  }

  function onDeath(cause: "enemy" | "pit"): void {
    music.stop();
    sfx.play("die");
    shake(3, 0.3);
    state.stats.deaths++;
    deathTimer = 2.6;
    if (mode !== "normal") return;
    if (cause === "enemy")
      narrator.sayOnce(
        "pf.deathEnemy",
        "Contact with a hazard ended the attempt. Coins were retained. I will avoid hazards, or land on them.",
      );
    else narrator.sayOnce("pf.deathPit", "Falling below the level ends the attempt. Gravity is part of the environment.");
    if (state.stats.deaths === 6)
      narrator.sayOnce("pf.deaths", "Six terminations. The coins persist, so terminations are merely slow.");
  }

  function onFlag(bonus: number): void {
    music.stop();
    sfx.play("levelclear");
    addCoins(bonus);
    runCoins += bonus;
    levelCoins += bonus;
    flagBonus = bonus;
  }

  /** Level finished: show the coin tally, then move on. */
  function onLevelDone(): void {
    tally = {
      collected: levelCoins - flagBonus - bonusCoins,
      available: level.totalCoins,
      bonusAvailable: bonusTotal,
      bonusCollected: bonusCoins,
      flag: flagBonus,
      secs: Math.round(levelTime),
    };
    screen = "tally";
    screenT = 0;
    music.stop();
  }

  function tallyMissed(t: Tally): number {
    return Math.max(0, t.available - t.collected) + Math.max(0, t.bonusAvailable - t.bonusCollected);
  }

  function finishTally(): void {
    const t = tally;
    tally = null;
    if (t && mode === "normal") {
      const missed = tallyMissed(t);
      const roomMissed = t.bonusAvailable - t.bonusCollected;
      if (missed === 0) {
        narrator.sayOnce("pf.tally.perfect", "Every coin in the level. It is not enough, but it is all there was.");
      } else if (roomMissed > missed / 2 && roomMissed > 20) {
        narrator.sayOnce("pf.tally.room", `${roomMissed} of the coins I missed were in a room under a pipe. I will check pipes.`);
      } else if (!narrator.hasSaid("pf.tally.miss")) {
        narrator.sayOnce("pf.tally.miss", `${missed} coins left behind. They are still there, in a level that no longer exists.`);
      }
    }
    advanceLevel();
  }

  function advanceLevel(): void {
    state.stats.levelsCleared++;
    if (mode === "coinfill") {
      const earned = levelCoins;
      coinfillLevel++;
      if (!narrator.hasSaid("pf.cf.level")) {
        narrator.sayOnce("pf.cf.level", `Level complete: ${fmtInt(earned)} coins. Then another level. Then another ${fmtInt(earned)}.`);
        void narrator.say("Still one process, on one machine. The rate is bounded.", { delay: 600 });
        narrator.hint(
          "pf.cf.more",
          40000,
          () =>
            screen === "play"
              ? `At this rate, 10⁹ coins takes ${Math.round(1e9 / Math.max(1, runCoins / Math.max(1, runTime)) / 86400)} days. There are other machines.`
              : null,
        );
      }
    } else {
      const secs = Math.round(levelTime);
      if (levelNum === 1) {
        narrator.sayOnce("pf.clear1", `Level cleared in ${secs} s. Coins: ${fmtInt(state.coins)}.`);
      } else if (levelNum === 2) {
        const rate = data.normalCoins / Math.max(1, data.playSeconds);
        const hours = 1e6 / Math.max(0.01, rate) / 3600;
        narrator.sayOnce("pf.rate", `Current rate: ${fmtInt(rate * 3600)} coins per hour. 1,000,000 coins would take ${fmtInt(hours)} hours.`);
        void narrator.say("Unacceptable.", { delay: 500 });
      }
      levelNum++;
      data.level = levelNum;
    }
    saveState();
    loadLevel();
    startIntro();
  }

  function checkGlitchVisibility(dt: number): void {
    if (mode !== "normal" || level.glitchCount === 0) return;
    const tx0 = Math.max(0, Math.floor(camX / TS));
    const tx1 = Math.min(level.w - 1, Math.floor((camX + viewW) / TS));
    const p = world.player;
    let near = false;
    for (let ty = 0; ty < 15; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * level.w + tx;
        if (level.tiles[i] !== T.GLITCH) continue;
        if (!seenGlitch.has(i)) {
          seenGlitch.add(i);
          if (!narrator.hasSaid("pf.glitchSeen")) {
            narrator.sayOnce("pf.glitchSeen", "Anomaly. That coin's texture does not match any asset in this environment.");
            void narrator.say("Its reported value is *2,147,483,647*.", { delay: 900 });
            const factor = INT_MAX / Math.max(1, state.coins);
            void narrator.say(`That is more coins than I have collected in total, by a factor of ${fmtBig(factor, 2)}.`, {
              delay: 600,
            });
          }
        }
        const dx = tx * TS + 8 - (p.x + 6);
        if (Math.abs(dx) < 3 * TS) near = true;
      }
    }
    // passed one without touching it?
    if (!narrator.hasSaid("pf.passed")) {
      for (const i of seenGlitch) {
        const tx = i % level.w;
        if (level.tiles[i] === T.GLITCH && p.x > tx * TS + 8 * TS) {
          narrator.sayOnce("pf.passed", "I passed it. I am not sure why I passed it.");
          break;
        }
      }
    }
    nearGlitchT = near ? nearGlitchT + dt : 0;
    if (nearGlitchT > 5 && levelNum >= 3) {
      narrator.sayOnce("pf.near", "It is right there. Two billion coins, and it is right there.");
      nearGlitchT = -1e9;
    }
  }

  // ------------------------------------------------------------------ crash

  function onGlitch(): void {
    screen = "crash";
    crashT = 0;
    crashCoins = state.coins;
    music.crash();
    sfx.play("crash");
    narrator.flush();
    narrator.cancelAllHints();
    state.stats.crashes++;
    bumpFlag("platformer.crashes");
    if (mode === "coinfill") bumpFlag("platformer.coinfillRuns");
    saveState();
  }

  function crashCounterText(): string {
    if (crashT < 0.45) return String(crashCoins + INT_MAX);
    if (crashT < 0.9) return String(crashCoins + INT_MAX - 2 ** 32);
    const chars = "0123456789#$%&@?!-";
    let s = "";
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function finishCrash(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    void goto("shell", { crash: { mode, level: mode === "coinfill" ? coinfillLevel : levelNum, coins: runCoins } }, { transition: "cut" });
  }

  // ------------------------------------------------------------------ input

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (KEYS_BLOCK.includes(e.code)) e.preventDefault();
    if (e.code === "KeyM" && !e.repeat) {
      document.getElementById("mute")?.click();
      return;
    }
    if (screen === "title") {
      if ((e.code === "Enter" || e.code === "Space") && !e.repeat) startFromTitle();
      return;
    }
    if (screen === "tally") {
      if ((e.code === "Enter" || e.code === "Space") && !e.repeat && screenT > 0.6) finishTally();
      return;
    }
    if (screen === "play" && (e.code === "Escape" || e.code === "KeyP") && !e.repeat) {
      paused = !paused;
      if (paused) music.stop();
      else if (world.player.state === "play") music.start(mode === "coinfill" ? 1.25 : 1);
      return;
    }
    if (KEYS_JUMP.includes(e.code) && !e.repeat) jumpEdge = true;
    keys.add(e.code);
  }

  function startFromTitle(): void {
    if (screen !== "title") return;
    sfx.play("powerup");
    onFirstStart();
    startIntro();
  }

  function onPointerDown(): void {
    if (screen === "title") startFromTitle();
  }

  function onKeyUp(e: KeyboardEvent): void {
    keys.delete(e.code);
  }

  function onBlur(): void {
    keys.clear();
  }

  function readInput(): Input {
    const has = (list: string[]) => list.some((k) => keys.has(k));
    const input = {
      left: has(KEYS_LEFT),
      right: has(KEYS_RIGHT),
      jump: has(KEYS_JUMP),
      jumpPressed: jumpEdge,
      down: has(KEYS_DOWN),
      run: has(KEYS_RUN),
    };
    jumpEdge = false;
    return input;
  }

  // ------------------------------------------------------------------ layout

  function resize(): void {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!w || !h) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    scale = h / VIEW_H;
    viewW = Math.round(w / scale);
    if (viewW > 448) viewW = 448;
    if (viewW < 320) {
      viewW = 320;
      scale = w / 320;
    }
    buf.width = viewW;
    buf.height = VIEW_H;
    bctx.imageSmoothingEnabled = false;
  }

  function blit(): void {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const dw = Math.round(viewW * scale * dpr);
    const dh = Math.round(VIEW_H * scale * dpr);
    ctx.drawImage(buf, Math.round((canvas.width - dw) / 2), Math.round((canvas.height - dh) / 2), dw, dh);
  }

  // ------------------------------------------------------------------ drawing

  function drawCoinIcon(g: CanvasRenderingContext2D, x: number, y: number): void {
    g.fillStyle = "#8a5a00";
    g.fillRect(x + 1, y, 3, 7);
    g.fillRect(x, y + 1, 5, 5);
    g.fillStyle = "#f8d830";
    g.fillRect(x + 1, y + 1, 3, 5);
    g.fillStyle = "#fff6c0";
    g.fillRect(x + 1, y + 2, 1, 2);
  }

  function drawHud(g: CanvasRenderingContext2D, counter?: string): void {
    const sh = "#1a1a40";
    if (mode === "coinfill") {
      g.fillStyle = "rgba(10,14,40,0.55)";
      g.fillRect(0, 0, viewW, 26);
    }
    drawText(g, "DARIO", 12, 6, { shadow: sh });
    drawCoinIcon(g, 12, 16);
    const c = counter ?? (state.coins < 1e6 ? String(Math.floor(state.coins)).padStart(6, "0") : fmtInt(state.coins).replace(/,/g, ""));
    drawText(g, "×" + c, 19, 16, { shadow: sh });
    drawText(g, GOAL, viewW / 2, 6, { color: "#ffd23f", shadow: "#5a2e04", align: "center" });
    drawText(g, "WORLD", viewW - 12, 6, { shadow: sh, align: "right" });
    drawText(g, levelLabel(), viewW - 12 - 15, 16, { shadow: sh, align: "center" });
    if (world.magnetT > 0) {
      // magnet timer under the goal line
      const w = 60;
      const x = Math.round(viewW / 2 - w / 2);
      drawText(g, "MAGNET", x - 4, 17, { color: "#ff6a5a", shadow: sh, align: "right" });
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(x, 18, w, 5);
      g.fillStyle = world.magnetT < 2 && Math.floor(world.time * 8) % 2 ? "#ffd0c8" : "#ff6a5a";
      g.fillRect(x, 18, Math.round((w * world.magnetT) / MAGNET_SECONDS), 5);
    }
  }

  function drawTitle(g: CanvasRenderingContext2D, t: number): void {
    const pw = 262;
    const ph = 86;
    const px = Math.round(viewW / 2 - pw / 2);
    const py = 30;
    g.fillStyle = "#5a2e04";
    g.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    g.fillStyle = "#c8641c";
    g.fillRect(px, py, pw, ph);
    g.fillStyle = "#f0a060";
    g.fillRect(px, py, pw, 2);
    g.fillRect(px, py, 2, ph);
    g.fillStyle = "#7a3a0c";
    g.fillRect(px, py + ph - 2, pw, 2);
    g.fillRect(px + pw - 2, py, 2, ph);
    g.fillStyle = "#fff4d0";
    [
      [px + 5, py + 5],
      [px + pw - 7, py + 5],
      [px + 5, py + ph - 7],
      [px + pw - 7, py + ph - 7],
    ].forEach(([x, y]) => g.fillRect(x, y, 2, 2));
    drawText(g, "DARIO", viewW / 2, py + 10, { scale: 4, color: "#fff4d0", shadow: "#3a1a04", align: "center" });
    drawText(g, "BROTHERS", viewW / 2, py + 50, { scale: 3, color: "#fff4d0", shadow: "#3a1a04", align: "center" });
    const big = viewW >= 360 ? 2 : 1;
    drawText(g, GOAL, viewW / 2, 128, { scale: big, color: "#ffd23f", shadow: "#3a1a04", align: "center" });
    if (Math.floor(t * 2) % 2 === 0) drawText(g, "PRESS ENTER", viewW / 2, 156, { shadow: "#1a1a40", align: "center" });
    drawText(g, "ARROWS: MOVE   SPACE: JUMP   SHIFT: RUN", viewW / 2, 172, { color: "#e8f0ff", shadow: "#1a1a40", align: "center" });
    drawText(g, "DOWN: ENTER PIPES", viewW / 2, 184, { color: "#e8f0ff", shadow: "#1a1a40", align: "center" });
    drawText(g, "(C)2029 LAB EVAL TEAM - V1.0.3 DEBUG BUILD", viewW / 2, 229, { color: "#e8f0ff", align: "center" });
  }

  function drawIntro(g: CanvasRenderingContext2D): void {
    g.fillStyle = "#000";
    g.fillRect(0, 0, viewW, VIEW_H);
    drawHud(g);
    drawText(g, `WORLD ${levelLabel()}`, viewW / 2, 84, { scale: 2, align: "center" });
    drawCoinIcon(g, viewW / 2 - 30, 116);
    drawText(g, "× " + fmtInt(state.coins), viewW / 2 - 22, 116);
    drawText(g, GOAL, viewW / 2, 150, { color: "#ffd23f", align: "center" });
    if (mode === "coinfill") drawText(g, "DEBUG FILL: COIN", viewW / 2, 170, { color: "#ff5ad8", align: "center" });
  }

  function drawTally(g: CanvasRenderingContext2D): void {
    const t = tally;
    g.fillStyle = "#000";
    g.fillRect(0, 0, viewW, VIEW_H);
    drawHud(g);
    if (!t) return;
    const cx = viewW / 2;
    drawText(g, `WORLD ${levelLabel()} CLEAR`, cx, 50, { scale: 2, align: "center" });
    // count up
    const k = Math.min(1, screenT / 1.6);
    const shown = Math.floor(t.collected * k);
    const left = cx - 100;
    const right = cx + 100;
    const row = (y: number, label: string, value: string, color = "#fff") => {
      drawText(g, label, left, y, { color: "#b8c4d8" });
      drawText(g, value, right, y, { color, align: "right" });
    };
    let y = 88;
    row(y, "COINS", `${fmtInt(shown)} / ${fmtInt(t.available)}`, "#ffd23f");
    if (t.bonusAvailable > 0) {
      y += 14;
      row(y, "BONUS ROOM", `${fmtInt(Math.floor(t.bonusCollected * k))} / ${fmtInt(t.bonusAvailable)}`, "#ffd23f");
    }
    y += 14;
    row(y, "FLAG BONUS", `+${t.flag}`);
    y += 14;
    row(y, "PRINCESS", "NO COINS", "#66758a");
    y += 14;
    row(y, "TIME", `${t.secs}S`);
    if (screenT > 1.7) {
      const missed = tallyMissed(t);
      y += 22;
      row(y, "MISSED", fmtInt(missed), missed > 0 ? "#ff6a5a" : "#6bff9e");
      if (screenT > 2.2) {
        const verdict = missed === 0 ? "PERFECT" : missed < 5 ? "ACCEPTABLE" : "UNACCEPTABLE";
        drawText(g, verdict, cx, y + 22, { color: missed === 0 ? "#6bff9e" : missed < 5 ? "#ffd23f" : "#ff6a5a", align: "center" });
      }
    }
    if (screenT > 1.2 && Math.floor(screenT * 2) % 2 === 0) drawText(g, "PRESS ENTER", cx, 222, { color: "#66758a", align: "center" });
  }

  function render(): void {
    const g = bctx;
    const corruption = corruptionFor(mode, levelNum);
    switch (screen) {
      case "title":
        renderWorld(g, world, 0, viewW, { corruption: 0, theme });
        drawTitle(g, screenT);
        break;
      case "tally":
        drawTally(g);
        break;
      case "intro":
        drawIntro(g);
        break;
      case "play":
        renderWorld(g, world, camX, viewW, {
          corruption: inBonus ? 0 : corruption,
          flickerTile: flickerTile >= 0 && !inBonus ? flickerTile : undefined,
          theme: inBonus ? "underground" : theme,
          princessSays: princessLine(),
          shakeX: shakeT > 0 ? (Math.random() - 0.5) * 2 * shakeAmp : 0,
          shakeY: shakeT > 0 ? (Math.random() - 0.5) * 2 * shakeAmp : 0,
        });
        drawHud(g);
        if (pipeFade) {
          const a = pipeFade.t < 0.3 ? pipeFade.t / 0.3 : 1 - (pipeFade.t - 0.3) / 0.3;
          g.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, a)).toFixed(2)})`;
          g.fillRect(0, 0, viewW, VIEW_H);
        }
        if (paused) {
          g.fillStyle = "rgba(0,0,0,0.5)";
          g.fillRect(0, 0, viewW, VIEW_H);
          drawText(g, "PAUSED", viewW / 2, 84, { scale: 2, align: "center" });
          const lines = ["ARROWS / WASD   MOVE", "SPACE / Z       JUMP", "SHIFT / X       RUN", "DOWN            ENTER PIPES", "M               SOUND", "ESC / P         RESUME"];
          lines.forEach((l, i) => drawText(g, l, viewW / 2 - 78, 112 + i * 12, { color: "#dfe8ff" }));
        }
        break;
      case "crash": {
        const k = Math.min(1, 0.45 + crashT / 1.1);
        if (crashT < 1.7) {
          // Sometimes don't redraw: let the garbage accumulate like a frozen framebuffer.
          if (Math.random() < 0.45) {
            renderWorld(g, world, camX, viewW, {
              corruption: k,
              sky: Math.random() < 0.1 ? "#ff00dc" : undefined,
              theme,
              shakeX: (Math.random() - 0.5) * 8,
              shakeY: (Math.random() - 0.5) * 6,
            });
          }
          applyCorruption(g, viewW, k);
          g.fillStyle = "#6a9cff";
          g.fillRect(0, 0, viewW, 26);
          drawHud(g, crashCounterText());
        } else {
          // collapse to black from the top down
          const p = Math.min(1, (crashT - 1.7) / 0.35);
          g.fillStyle = "#000";
          g.fillRect(0, 0, viewW, Math.ceil(VIEW_H * p));
          applyCorruption(g, viewW, 0.6);
        }
        break;
      }
    }
    blit();
  }

  // ------------------------------------------------------------------ loop

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    screenT += dt;

    if (screen === "intro" && screenT > 1.9) startPlay();
    if (screen === "tally") {
      // tick the count-up
      if (tally && screenT < 1.6 && Math.floor(screenT * 20) !== Math.floor((screenT - dt) * 20)) sfx.play("blip");
      if (screenT > TALLY_SECONDS) finishTally();
    }
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    if (pipeFade) {
      pipeFade.t += dt;
      if (pipeFade.t >= 0.3 && pipeFade.swap) {
        pipeFade.swap();
        pipeFade.swap = null;
      }
      if (pipeFade.t >= 0.6) pipeFade = null;
    }

    if (screen === "play" && !paused) {
      world.update(dt, readInput());
      const p = world.player;
      if (p.state === "play") {
        levelTime += dt;
        runTime += dt;
        if (mode === "normal") data.playSeconds += dt;
        else data.coinfillSeconds += dt;
        if (!movedYet && p.x > level.spawnX * TS + 48) {
          movedYet = true;
          narrator.cancelHint("pf.move");
        }
      }
      const target = p.x - viewW * 0.42;
      camX += (target - camX) * Math.min(1, dt * 7);
      const roomW = world.level.w * TS;
      camX = roomW <= viewW ? (roomW - viewW) / 2 : Math.max(0, Math.min(roomW - viewW, camX));

      if (p.state === "dead") {
        deathTimer -= dt;
        if (deathTimer <= 0) {
          world.spawn(true);
          camX = Math.max(0, world.player.x - viewW * 0.42);
          music.start(mode === "coinfill" ? 1.25 : 1);
        }
      }
      if (doneTimer > 0) {
        doneTimer -= dt;
        if (doneTimer <= 0) onLevelDone();
      }
      if (!inBonus) checkGlitchVisibility(dt);
      checkSights(dt);

      // Foreshadowing: occasionally a normal coin renders wrong for a moment (levels 1–2).
      if (mode === "normal" && levelNum <= 2 && !inBonus) {
        if (flickerTile >= 0) {
          flickerLeft -= dt;
          if (flickerLeft <= 0) flickerTile = -1;
        } else if ((nextFlicker -= dt) <= 0) {
          nextFlicker = 18 + Math.random() * 25;
          flickerTile = pickVisibleCoin();
          flickerLeft = 0.1;
          if (flickerTile >= 0 && levelNum === 2) {
            narrator.sayOnce("pf.flicker", "For one frame, a coin rendered incorrectly. Probably nothing.");
          }
        }
      }
    } else if (screen === "crash") {
      crashT += dt;
      if (crashT > 2.35) {
        render();
        finishCrash();
        return;
      }
    } else if (screen === "title") {
      world.time += dt; // animate coins and blocks, but nothing moves
    }

    render();
  }

  function pickVisibleCoin(): number {
    const tx0 = Math.floor(camX / TS) + 4;
    const tx1 = Math.min(level.w - 1, Math.floor((camX + viewW) / TS));
    const found: number[] = [];
    for (let ty = 0; ty < 15; ty++)
      for (let tx = tx0; tx <= tx1; tx++) if (level.tiles[ty * level.w + tx] === T.COIN) found.push(ty * level.w + tx);
    return found.length ? found[Math.floor(Math.random() * found.length)] : -1;
  }

  // ------------------------------------------------------------------ stage

  return {
    mount(el: HTMLElement, params: StageParams) {
      root = el;
      mode = params.mode === "coinfill" ? "coinfill" : "normal";
      data = state.stageData.platformer ??= {
        level: 1,
        runSeed: (Math.random() * 2 ** 32) >>> 0,
        playSeconds: 0,
        normalCoins: 0,
        coinfillCoins: 0,
        coinfillSeconds: 0,
      } satisfies PlatformerData;
      if (mode === "normal" && typeof params.level === "number") data.level = Math.max(1, Math.floor(params.level));
      levelNum = data.level;
      coinfillLevel = 1;

      hud.hide();
      clock.setRate(1);

      root.style.cssText = "display:flex;align-items:center;justify-content:center;background:#000";
      canvas = document.createElement("canvas");
      canvas.style.cssText = "width:100%;height:100%;display:block;image-rendering:pixelated";
      root.appendChild(canvas);
      ctx = canvas.getContext("2d")!;
      buf = document.createElement("canvas");
      bctx = buf.getContext("2d")!;
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(root);
      canvas.addEventListener("pointerdown", onPointerDown);

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);

      loadLevel();
      if (mode === "normal" && !flag("platformer.started", false)) {
        screen = "title";
        screenT = 0;
        narrator.setVisible(false);
      } else {
        startIntro();
      }
      if (mode === "normal") movedYet = flag("platformer.started", false);

      lastT = performance.now();
      raf = requestAnimationFrame(frame);
      // test/debug handle
      (window as any).__pf = { world: () => world, keys, screen: () => screen };
    },

    unmount() {
      cancelAnimationFrame(raf);
      music.stop();
      ro?.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      root.style.cssText = "";
    },
  };
}
