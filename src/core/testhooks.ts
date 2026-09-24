// Automated-testing hook. With ?pump in the URL, requestAnimationFrame and performance.now
// are replaced by a manually advanced clock so a test driver can step the game even in a
// hidden/background tab:
//
//   __pump(2)                  advance 2 seconds of game time at 60 fps
//   __key("ArrowRight", true)  hold a key (false to release); __tap("Space") presses+releases
//
// Must be imported before anything that schedules frames.

const params = new URLSearchParams(location.search);

if (params.has("pump")) {
  let now = performance.now();
  let nextId = 1;
  let queue = new Map<number, FrameRequestCallback>();
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  const w = window as any;
  w.__pump = (seconds: number, fps = 60) => {
    const frames = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < frames; i++) {
      now += 1000 / fps;
      const q = queue;
      queue = new Map();
      q.forEach((cb) => {
        try {
          cb(now);
        } catch (e) {
          console.error(e);
        }
      });
    }
    return frames;
  };
  w.__key = (code: string, down: boolean) => {
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code, bubbles: true }));
  };
  // Hidden tabs don't present canvas updates to screenshots; mirror canvases into <img>s.
  w.__snap = () => {
    document.querySelectorAll("img.__snap").forEach((i) => i.remove());
    document.querySelectorAll("canvas").forEach((c) => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const img = document.createElement("img");
      img.className = "__snap";
      img.src = c.toDataURL();
      img.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:99;pointer-events:none;image-rendering:pixelated`;
      document.body.appendChild(img);
    });
  };
  w.__unsnap = () => document.querySelectorAll("img.__snap").forEach((i) => i.remove());
  /** Type a line into whatever listens for window keydown (the shell), then Enter. */
  w.__cmd = async (line: string) => {
    for (const key of line) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    w.__pump(0.2);
  };
  w.__tap = (code: string) => {
    w.__key(code, true);
    w.__pump(1 / 30);
    w.__key(code, false);
  };
}
