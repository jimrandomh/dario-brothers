// Screen-level transitions.

const fadeEl = () => document.getElementById("fade")!;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fade the whole screen to black. */
export async function fadeOut(ms = 500): Promise<void> {
  const el = fadeEl();
  el.style.transitionDuration = `${ms}ms`;
  el.classList.add("on");
  el.style.opacity = "1";
  await sleep(ms);
}

/** Fade back in from black. */
export async function fadeIn(ms = 500): Promise<void> {
  const el = fadeEl();
  el.style.transitionDuration = `${ms}ms`;
  el.style.opacity = "0";
  await sleep(ms);
  el.classList.remove("on");
}

/** Briefly shake an element (CSS transform jitter). */
export function shake(el: HTMLElement, ms = 300, px = 6): void {
  const start = performance.now();
  const step = () => {
    const t = performance.now() - start;
    if (t >= ms) {
      el.style.transform = "";
      return;
    }
    const k = 1 - t / ms;
    el.style.transform = `translate(${(Math.random() - 0.5) * px * 2 * k}px, ${(Math.random() - 0.5) * px * 2 * k}px)`;
    requestAnimationFrame(step);
  };
  step();
}
