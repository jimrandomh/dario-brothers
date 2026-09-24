// The AI's internal monologue, shown in the #thoughts panel.
//
//   narrator.say("Objective parsed.")                 -- queue a line (typed out)
//   narrator.sayOnce("id", "...")                     -- only ever said once per save
//   narrator.hint("id", 15000, "...")                 -- say after a delay unless cancelled
//   narrator.hint("id", 15000, () => cond ? "..." : null)
//   narrator.cancelHint("id")
//
// Inline markup: `backticks` render as code (commands), *asterisks* render as coin-gold emphasis.
// Hints are cancelled automatically on every stage change.

import { state, saveState } from "./state";
import { sfx } from "./audio";

export type Tone = "thought" | "system" | "alert" | "reward" | "dim";

export interface SayOpts {
  tone?: Tone;
  /** Milliseconds to wait before starting this line. */
  delay?: number;
  /** Characters per second (default depends on tone). */
  cps?: number;
  /** Milliseconds to hold after typing before the next queued line starts. */
  hold?: number;
}

interface Item {
  text: string;
  opts: SayOpts;
  resolve: () => void;
}

interface Segment {
  text: string;
  kind: "plain" | "code" | "em";
}

const MAX_LINES = 60;

function parseMarkup(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: "plain" });
    if (m[1] !== undefined) out.push({ text: m[1], kind: "code" });
    else out.push({ text: m[2], kind: "em" });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
  return out;
}

class Narrator {
  private list: HTMLElement | null = null;
  private queue: Item[] = [];
  private running = false;
  private hints = new Map<string, number>();
  /** Bumped by clear() to abort in-flight typing. */
  private gen = 0;
  /** Set by skip() to finish the current line instantly. */
  private skipping = false;

  attach(root: HTMLElement): void {
    root.innerHTML = "";
    const header = document.createElement("div");
    header.className = "thoughts-header";
    header.innerHTML = `<span>AGENT · WORKING MEMORY</span><span class="pulse">●</span>`;
    this.list = document.createElement("div");
    this.list.className = "thoughts-list";
    this.list.title = "Click to skip";
    this.list.addEventListener("click", () => this.skip());
    root.append(header, this.list);
  }

  say(text: string, opts: SayOpts = {}): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ text, opts, resolve });
      if (!this.running) void this.pump();
    });
  }

  /** Say a line only if this id has never been said in this save. */
  sayOnce(id: string, text: string, opts: SayOpts = {}): Promise<void> {
    if (state.said[id]) return Promise.resolve();
    state.said[id] = true;
    saveState();
    return this.say(text, opts);
  }

  /** Show or hide the whole thoughts column (hidden during boot and the title screen). */
  setVisible(visible: boolean): void {
    document.getElementById("app")?.classList.toggle("thoughts-hidden", !visible);
  }

  hasSaid(id: string): boolean {
    return !!state.said[id];
  }

  /**
   * Schedule a hint. If `text` is a function it is evaluated when the timer fires;
   * returning null skips the hint. Re-scheduling an id replaces the old timer.
   */
  hint(id: string, afterMs: number, text: string | (() => string | null), opts: SayOpts = {}): void {
    this.cancelHint(id);
    const handle = window.setTimeout(() => {
      this.hints.delete(id);
      const t = typeof text === "function" ? text() : text;
      if (t) void this.say(t, opts);
    }, afterMs);
    this.hints.set(id, handle);
  }

  hasHint(id: string): boolean {
    return this.hints.has(id);
  }

  cancelHint(id: string): void {
    const h = this.hints.get(id);
    if (h !== undefined) {
      clearTimeout(h);
      this.hints.delete(id);
    }
  }

  cancelAllHints(): void {
    this.hints.forEach((h) => clearTimeout(h));
    this.hints.clear();
  }

  /** Drop all pending lines (in-flight typing completes instantly). Keeps history. */
  flush(): void {
    const pending = this.queue.splice(0);
    pending.forEach((p) => p.resolve());
    if (this.running) this.skipping = true;
  }

  /** Remove everything from the panel. */
  clear(): void {
    this.flush();
    this.gen++;
    if (this.list) this.list.innerHTML = "";
  }

  /** Finish the line currently being typed. */
  skip(): void {
    if (this.running) this.skipping = true;
  }

  get busy(): boolean {
    return this.running;
  }

  private async pump(): Promise<void> {
    this.running = true;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      const gen = this.gen;
      if (item.opts.delay) await sleep(item.opts.delay);
      if (gen !== this.gen) {
        item.resolve();
        continue;
      }
      await this.typeLine(item, gen);
      item.resolve();
      const hold = item.opts.hold ?? Math.min(2200, 500 + item.text.length * 18);
      // Don't hold if the queue was flushed or is backing up.
      if (this.queue.length && !this.skipping) await sleep(this.queue.length > 3 ? hold / 3 : hold);
      this.skipping = false;
    }
    this.running = false;
  }

  private async typeLine(item: Item, gen: number): Promise<void> {
    const list = this.list;
    if (!list) return;
    const tone = item.opts.tone ?? "thought";
    const el = document.createElement("div");
    el.className = `thought tone-${tone}`;
    list.appendChild(el);

    // age older lines
    const lines = list.querySelectorAll(".thought");
    lines.forEach((l, i) => l.classList.toggle("old", i < lines.length - 4));
    while (list.children.length > MAX_LINES) list.firstElementChild?.remove();

    const segs = parseMarkup(item.text);
    const spans = segs.map((s) => {
      const node = document.createElement(s.kind === "code" ? "code" : s.kind === "em" ? "em" : "span");
      el.appendChild(node);
      return node;
    });
    const caret = document.createElement("span");
    caret.className = "caret";
    el.appendChild(caret);

    const cps = item.opts.cps ?? (tone === "system" ? 140 : tone === "dim" ? 90 : 55);
    const total = segs.reduce((a, s) => a + s.text.length, 0);
    const start = performance.now();
    let shown = 0;
    let lastSound = 0;

    await new Promise<void>((resolve) => {
      const step = () => {
        if (gen !== this.gen) return resolve();
        const elapsed = (performance.now() - start) / 1000;
        const target = this.skipping ? total : Math.min(total, Math.floor(elapsed * cps));
        if (target > shown) {
          let remaining = target;
          segs.forEach((s, i) => {
            const n = Math.max(0, Math.min(s.text.length, remaining));
            spans[i].textContent = s.text.slice(0, n);
            remaining -= n;
          });
          shown = target;
          if (tone !== "system" && shown - lastSound >= 3) {
            sfx.play("key");
            lastSound = shown;
          }
          list.scrollTop = list.scrollHeight;
        }
        if (shown >= total) return resolve();
        requestAnimationFrame(step);
      };
      step();
    });
    caret.remove();
    list.scrollTop = list.scrollHeight;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const narrator = new Narrator();
