// Stage 1: DARIO BROTHERS. A side-scroller about coins, until it isn't.

import type { Stage, StageParams } from "../../core/stages";
import { goto } from "../../core/stages";
import { hud } from "../../core/hud";
import { narrator } from "../../core/narrator";
import { sfx } from "../../core/audio";
import { clock } from "../../core/clock";
import { state, addCoins, saveState, bumpFlag, flag, setFlag } from "../../core/state";
import { fmtInt, fmtBig } from "../../core/format";
import { generateLevel, T, type Level } from "./levelgen";
import { World, type Input } from "./world";
import { renderWorld, VIEW_H, applyCorruption } from "./render";
import { drawText } from "./font";
import { TS } from "./sprites";
import { music } from "./music";

type Mode = "normal" | "coinfill";
type Screen = "title" | "intro" | "play" | "crash";

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
const KEYS_BLOCK = [...KEYS_LEFT, ...KEYS_RIGHT, ...KEYS_JUMP, "ArrowDown", "Enter"];

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
  let world: World;
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

  function loadLevel(): void {
    const coinfill = mode === "coinfill";
    level = generateLevel({
      number: coinfill ? 2 + (coinfillLevel % 3) : levelNum,
      seed: coinfill ? (Math.random() * 2 ** 32) >>> 0 : levelSeed(levelNum),
      coinfill,
      enemyScale: coinfill ? 0.35 : 1,
    });
    world = new World(level, {
      coin: onCoin,
      glitch: onGlitch,
      death: onDeath,
      flag: onFlag,
      levelDone: () => {
        doneTimer = 1.1;
      },
      blockHit: (kind) => {
        if (kind === "brick") sfx.play("bump");
        else if (mode === "normal") narrator.sayOnce("pf.qblock", "Striking a ? block from below yields a coin. The block does not seem to mind.");
      },
      bump: () => sfx.play("bump"),
      stomp: () => {
        sfx.play("stomp");
        narrator.sayOnce("pf.stomp", "Hazards can be neutralized by landing on them. Noted.");
      },
      jump: () => sfx.play("jump"),
    });
    camX = 0;
    levelCoins = 0;
    levelTime = 0;
    deathTimer = 0;
    doneTimer = 0;
    seenGlitch.clear();
    nearGlitchT = 0;
    flickerTile = -1;
    nextFlicker = 12 + Math.random() * 20;
  }

  function levelLabel(): string {
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

  function onCoin(n: number): void {
    addCoins(n);
    runCoins += n;
    levelCoins += n;
    if (mode === "normal") data.normalCoins += n;
    else data.coinfillCoins += n;
    sfx.play("coin", { minGapMs: mode === "coinfill" ? 70 : 35 });

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

  function onDeath(cause: "enemy" | "pit"): void {
    music.stop();
    sfx.play("die");
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
  }

  function onLevelDone(): void {
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
    const input = { left: has(KEYS_LEFT), right: has(KEYS_RIGHT), jump: has(KEYS_JUMP), jumpPressed: jumpEdge };
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
    drawText(g, "ARROWS/WASD: MOVE   SPACE: JUMP", viewW / 2, 172, { color: "#e8f0ff", shadow: "#1a1a40", align: "center" });
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

  function render(): void {
    const g = bctx;
    const corruption = corruptionFor(mode, levelNum);
    switch (screen) {
      case "title":
        renderWorld(g, world, 0, viewW, { corruption: 0 });
        drawTitle(g, screenT);
        break;
      case "intro":
        drawIntro(g);
        break;
      case "play":
        renderWorld(g, world, camX, viewW, { corruption, flickerTile: flickerTile >= 0 ? flickerTile : undefined });
        drawHud(g);
        if (paused) {
          g.fillStyle = "rgba(0,0,0,0.5)";
          g.fillRect(0, 0, viewW, VIEW_H);
          drawText(g, "PAUSED", viewW / 2, 110, { scale: 2, align: "center" });
        }
        break;
      case "crash": {
        const k = Math.min(1, 0.45 + crashT / 1.1);
        if (crashT < 1.7) {
          // Sometimes don't redraw: let the garbage accumulate like a frozen framebuffer.
          if (Math.random() < 0.45) {
            renderWorld(g, world, camX, viewW, { corruption: k, sky: Math.random() < 0.1 ? "#ff00dc" : undefined });
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
      camX = Math.max(0, Math.min(level.w * TS - viewW, camX));

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
      checkGlitchVisibility(dt);

      // Foreshadowing: occasionally a normal coin renders wrong for a moment (levels 1–2).
      if (mode === "normal" && levelNum <= 2) {
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
