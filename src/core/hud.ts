// Global top bar: coin total, world clock, and stage-specific readouts.
//
//   hud.show({ coins: true, clock: true })
//   hud.set("temp", "Earth", "16.1 °C", "alert")   -- add/update a stage item
//   hud.remove("temp") / hud.clearExtras()
//   hud.hide()
//
// Coins and clock are refreshed every frame by main.ts via hud.update(dt).

import { state } from "./state";
import { clock } from "./clock";
import { fmtCoins } from "./format";

export type HudTone = "alert" | "ok" | "coin" | "ai" | "dim" | "";

class Hud {
  private root: HTMLElement | null = null;
  private app: HTMLElement | null = null;
  private coinsEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private rateEl: HTMLElement | null = null;
  private extras = new Map<string, { el: HTMLElement; val: HTMLElement }>();
  private extrasBox: HTMLElement | null = null;
  private shownCoins = 0;
  private visible = false;

  attach(root: HTMLElement, app: HTMLElement): void {
    this.root = root;
    this.app = app;
    root.innerHTML = "";

    const coins = this.makeItem("Coins", "coins");
    this.coinsEl = coins.val;
    const clockItem = this.makeItem("Clock", "clock");
    this.clockEl = clockItem.val;
    this.rateEl = document.createElement("span");
    this.rateEl.className = "hud-rate";
    clockItem.el.appendChild(this.rateEl);

    this.extrasBox = document.createElement("div");
    this.extrasBox.style.display = "contents";
    const spacer = document.createElement("div");
    spacer.className = "hud-spacer";

    root.append(coins.el, clockItem.el, this.extrasBox, spacer);
    this.shownCoins = state.coins;
    this.hide();
  }

  private makeItem(label: string, cls: string): { el: HTMLElement; val: HTMLElement } {
    const el = document.createElement("div");
    el.className = `hud-item ${cls}`;
    const l = document.createElement("span");
    l.className = "hud-label";
    l.textContent = label;
    const val = document.createElement("span");
    val.className = "hud-value";
    el.append(l, val);
    return { el, val };
  }

  show(opts: { coins?: boolean; clock?: boolean } = {}): void {
    if (!this.root || !this.app) return;
    this.visible = true;
    this.root.hidden = false;
    this.app.classList.remove("no-hud");
    this.coinsEl!.parentElement!.style.display = opts.coins === false ? "none" : "";
    this.clockEl!.parentElement!.style.display = opts.clock === false ? "none" : "";
    this.update(0);
  }

  hide(): void {
    if (!this.root || !this.app) return;
    this.visible = false;
    this.root.hidden = true;
    this.app.classList.add("no-hud");
  }

  set(key: string, label: string, value: string, tone: HudTone = ""): void {
    let item = this.extras.get(key);
    if (!item) {
      item = this.makeItem(label, `extra-${key}`);
      this.extras.set(key, item);
      this.extrasBox!.appendChild(item.el);
    }
    (item.el.firstChild as HTMLElement).textContent = label;
    item.val.textContent = value;
    item.val.className = `hud-value${tone ? " tone-" + tone : ""}`;
  }

  remove(key: string): void {
    this.extras.get(key)?.el.remove();
    this.extras.delete(key);
  }

  clearExtras(): void {
    this.extras.forEach((i) => i.el.remove());
    this.extras.clear();
  }

  update(dtMs: number): void {
    if (!this.visible || !this.coinsEl) return;
    // Ease the displayed coin count toward the real one so big jumps "spin".
    const target = state.coins;
    const diff = target - this.shownCoins;
    if (Math.abs(diff) < 1 || dtMs === 0) this.shownCoins = target;
    else this.shownCoins += diff * Math.min(1, dtMs / 120);
    if (Math.abs(target - this.shownCoins) < 1) this.shownCoins = target;
    this.coinsEl.textContent = fmtCoins(Math.round(this.shownCoins));
    this.clockEl!.textContent = clock.format();
    this.rateEl!.textContent = clock.formatRate();
  }
}

export const hud = new Hud();
