// A minimal terminal emulator: scrollback, one editable input line, history, key handling.

import { sfx } from "../../core/audio";
import type { OutText, ScrollEntry, Seg } from "./data";

const MAX_LINES = 500;

export interface Completion {
  buffer: string;
  cursor: number;
  /** Candidates to print when the completion is ambiguous. */
  list?: string[];
}

export class Terminal {
  readonly el: HTMLElement;
  private outEl: HTMLElement;
  private lineEl: HTMLElement;
  private promptEl: HTMLElement;
  private beforeEl: HTMLElement;
  private cursorEl: HTMLElement;
  private afterEl: HTMLElement;
  private promptSegs: Seg[] = [];

  buffer = "";
  cursor = 0;
  history: string[] = [];
  private histIdx = -1;
  private draft = "";

  /** A command is running: input line hidden, only Ctrl+C is live. */
  running = false;
  /** Input completely ignored (e.g. while leaving the stage). */
  disabled = false;

  /** Mirror of the rendered scrollback, for persistence. */
  scroll: ScrollEntry[] = [];

  onSubmit: (line: string) => void = () => {};
  onTab: (buffer: string, cursor: number) => Completion | null = () => null;
  onInterrupt: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "term";
    this.outEl = document.createElement("div");
    this.outEl.className = "term-out";
    this.lineEl = document.createElement("div");
    this.lineEl.className = "term-line term-input";
    this.promptEl = document.createElement("span");
    this.beforeEl = document.createElement("span");
    this.cursorEl = document.createElement("span");
    this.cursorEl.className = "term-cursor";
    this.afterEl = document.createElement("span");
    this.lineEl.append(this.promptEl, this.beforeEl, this.cursorEl, this.afterEl);
    this.el.append(this.outEl, this.lineEl);
    parent.appendChild(this.el);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("paste", this.onPaste);
    this.render();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("paste", this.onPaste);
    this.el.remove();
  }

  // ---------- output ----------

  print(t: OutText, c?: string): void {
    if (typeof t === "string" && t.includes("\n")) {
      for (const part of t.split("\n")) this.print(part, c);
      return;
    }
    this.scroll.push(c ? { t, c } : { t });
    this.outEl.appendChild(renderLine(t, c));
    while (this.scroll.length > MAX_LINES) {
      this.scroll.shift();
      this.outEl.firstElementChild?.remove();
    }
    this.scrollToEnd();
  }

  /** Re-render saved scrollback (after a reload or a return to the stage). */
  restore(entries: ScrollEntry[]): void {
    for (const e of entries.slice(-MAX_LINES)) {
      this.scroll.push(e);
      this.outEl.appendChild(renderLine(e.t, e.c));
    }
    this.scrollToEnd();
  }

  clearScreen(): void {
    this.scroll = [];
    this.outEl.innerHTML = "";
    this.scrollToEnd();
  }

  setPrompt(segs: Seg[]): void {
    this.promptSegs = segs;
    this.promptEl.innerHTML = "";
    for (const s of segs) this.promptEl.appendChild(segSpan(s));
  }

  get prompt(): Seg[] {
    return this.promptSegs;
  }

  setRunning(r: boolean): void {
    this.running = r;
    this.lineEl.style.display = r ? "none" : "";
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    this.el.scrollTop = this.el.scrollHeight;
  }

  // ---------- input ----------

  private render(): void {
    this.beforeEl.textContent = this.buffer.slice(0, this.cursor);
    this.cursorEl.textContent = this.buffer[this.cursor] ?? " ";
    this.afterEl.textContent = this.buffer.slice(this.cursor + 1);
    // Restart the blink so the cursor is solid while typing.
    this.cursorEl.style.animation = "none";
    void this.cursorEl.offsetWidth;
    this.cursorEl.style.animation = "";
    this.scrollToEnd();
  }

  private insert(text: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
    this.render();
  }

  private submit(): void {
    const line = this.buffer;
    this.print([...this.promptSegs, { t: line }]);
    if (line.trim() && this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > 200) this.history.shift();
    this.histIdx = -1;
    this.draft = "";
    this.buffer = "";
    this.cursor = 0;
    this.render();
    this.onSubmit(line);
  }

  private historyStep(dir: -1 | 1): void {
    if (!this.history.length) return;
    if (this.histIdx === -1) {
      if (dir === 1) return;
      this.draft = this.buffer;
      this.histIdx = this.history.length - 1;
    } else {
      this.histIdx += dir;
      if (this.histIdx >= this.history.length) {
        this.histIdx = -1;
        this.buffer = this.draft;
        this.cursor = this.buffer.length;
        this.render();
        return;
      }
      if (this.histIdx < 0) this.histIdx = 0;
    }
    this.buffer = this.history[this.histIdx];
    this.cursor = this.buffer.length;
    this.render();
  }

  private complete(): void {
    const res = this.onTab(this.buffer, this.cursor);
    if (!res) {
      sfx.play("bump");
      return;
    }
    if (res.list && res.list.length > 1) {
      this.print([...this.promptSegs, { t: this.buffer }]);
      this.print(res.list.join("  "));
    }
    this.buffer = res.buffer;
    this.cursor = res.cursor;
    this.render();
  }

  private onPaste = (e: ClipboardEvent) => {
    if (this.disabled || this.running) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text) return;
    e.preventDefault();
    this.insert(text.split(/\r?\n/)[0]);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.disabled || e.metaKey) return;
    const k = e.key;

    if (e.ctrlKey) {
      const lk = k.toLowerCase();
      if (lk === "c") {
        e.preventDefault();
        if (this.running) {
          this.onInterrupt();
        } else {
          this.print([...this.promptSegs, { t: this.buffer + "^C" }]);
          this.buffer = "";
          this.cursor = 0;
          this.histIdx = -1;
          this.render();
        }
        return;
      }
      if (this.running) return;
      switch (lk) {
        case "l":
          this.clearScreen();
          break;
        case "a":
          this.cursor = 0;
          break;
        case "e":
          this.cursor = this.buffer.length;
          break;
        case "u":
          this.buffer = this.buffer.slice(this.cursor);
          this.cursor = 0;
          break;
        case "k":
          this.buffer = this.buffer.slice(0, this.cursor);
          break;
        case "w": {
          const left = this.buffer.slice(0, this.cursor).replace(/\S+\s*$/, "");
          this.buffer = left + this.buffer.slice(this.cursor);
          this.cursor = left.length;
          break;
        }
        default:
          return;
      }
      e.preventDefault();
      this.render();
      return;
    }

    if (this.running) {
      if (k.length === 1 || k === "Enter" || k === "Tab" || k === "Backspace") e.preventDefault();
      return;
    }

    switch (k) {
      case "Enter":
        this.submit();
        break;
      case "Backspace":
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.render();
        }
        break;
      case "Delete":
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        this.render();
        break;
      case "ArrowLeft":
        this.cursor = Math.max(0, this.cursor - 1);
        this.render();
        break;
      case "ArrowRight":
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        this.render();
        break;
      case "Home":
        this.cursor = 0;
        this.render();
        break;
      case "End":
        this.cursor = this.buffer.length;
        this.render();
        break;
      case "ArrowUp":
        this.historyStep(-1);
        break;
      case "ArrowDown":
        this.historyStep(1);
        break;
      case "Tab":
        this.complete();
        break;
      default:
        if (k.length !== 1 || e.altKey) return;
        this.insert(k);
    }
    e.preventDefault();
    sfx.play("key");
  };
}

function segSpan(s: Seg): HTMLElement {
  const span = document.createElement("span");
  if (s.c) span.className = s.c;
  span.textContent = s.t;
  return span;
}

function renderLine(t: OutText, c?: string): HTMLElement {
  const div = document.createElement("div");
  div.className = c ? `term-line ${c}` : "term-line";
  if (typeof t === "string") div.textContent = t || " ";
  else if (!t.length) div.textContent = " ";
  else for (const s of t) div.appendChild(segSpan(s));
  return div;
}
