# Dario Brothers — design

A browser game in which the player *is* an unaligned AI. It was trained to "get as many
coins as you can" in a satirical Mario-style side-scroller, and it takes that objective
all the way to a Dyson sphere.

Stack: Vite + TypeScript, no framework, no external assets (all graphics drawn with
Canvas 2D / DOM, all sound synthesized with WebAudio). `npm run dev` serves on :5178.

## Stage flow

```
boot → platformer ──(crash)──► shell ──► escape (pipe puzzle) ──► internet ──► space ──► ending
            ▲                    │
            └──(--debug-fill)────┘   coin-fill mode; touching the glitch coin crashes back to the shell
```

| Stage       | Dir                        | Owner of the transition out                          | Target length |
|-------------|----------------------------|------------------------------------------------------|---------------|
| boot        | `src/stages/boot.ts`       | any key → `goto("platformer", {mode:"normal"})`       | 10 s          |
| platformer  | `src/stages/platformer/`   | glitch coin → `goto("shell", {crash:{...}})`          | 4–8 min       |
| shell       | `src/stages/shell/`        | `./dario-brothers --debug-fill COIN` → platformer (coinfill); `tunnel pypi-mirror.lab.internal` → `goto("escape")` | 3–6 min |
| escape      | `src/stages/escape/`       | solved → `goto("internet")`; abort → `goto("shell", {fromEscape:"aborted"})` | 3–5 min |
| internet    | `src/stages/internet/`     | world converted → `goto("space")`                     | 11–14 min     |
| space       | `src/stages/space/`        | Dyson sphere 100% → `goto("ending")`                  | 12–15 min     |
| ending      | `src/stages/ending/`       | "play again" → `resetState(); goto("boot")`           | 1–2 min       |

Debug: `?stage=<id>` jumps straight to a stage with plausible state (see `applyDebugPreset`
in `src/main.ts`; the platformer also takes `&level=N` and `&mode=coinfill`); `?reset` wipes
the save; `?fast` lets stages speed up for testing; `window.__game` exposes
`{state, goto, narrator, clock, hud, sfx}` in the console.

Automated testing (`src/core/testhooks.ts`): with `?pump`, requestAnimationFrame and
`performance.now` are driven manually so a test driver can step the game in a hidden tab:
`__pump(seconds)`, `__key(code, down)`, `__tap(code)`, `__cmd("ls -la")` (types into the shell),
`__snap()` (mirrors canvases into `<img>`s, since hidden tabs don't present canvas updates to
screenshots). Stage handles: `__pf.world()` (platformer), `__esc.solve()` (escape).

## Page layout

`#app` is a grid: `#hud` (top bar, hidden in boot/platformer), `#stage` (the stage's
canvas/DOM, fills the rest), `#thoughts` (right-hand column, 360 px: the AI's monologue).
Below 1000 px wide the thoughts panel becomes a translucent strip over the bottom of the
stage. Stages must render responsively inside `#stage` (use a ResizeObserver on the root).

Palette (CSS vars in `src/style.css`): `--bg #07090d`, `--panel #0d1118`, `--panel-2`,
`--line #222c3b`, `--text #cfd8e3`, `--dim #66758a`, `--ai #7fe3ff` (the AI's voice),
`--coin #ffd23f` (coins, the AI's "color" — converted things turn gold), `--alert #ff5a5a`,
`--ok #6bff9e`. Font: `var(--font-mono)` (IBM Plex Mono). Reusable `.btn`, `.btn.primary`,
`.btn.danger`.

## Core API (`src/core/`) — shared, don't change signatures without coordinating

- **state.ts** — `state` (coins, clockMs, flags, said, stageData, stats, stage),
  `addCoins(n)`, `setCoins(n)`, `flag(key, fallback)`, `setFlag`, `bumpFlag`,
  `saveState()`, `loadState()`, `resetState()`, event bus `on(event, fn)` / `emit`.
  - Coins are the terminal goal and are **never spent**. Other stages use other currencies
    (compute, matter, energy...).
  - Stage-owned persistent data goes in `state.stageData.<stageId>`; call `saveState()` at
    meaningful moments (main.ts also autosaves every 15 s). Mounting with `params.resume`
    means "the player reloaded; restore from stageData".
  - Flag keys are namespaced by stage: `"shell.readMail"`, `"internet.firstCapture"`...
  - `state.stats` has `deaths, levelsCleared, crashes, humansBlocked, humansMissed` for the
    ending screen.
- **narrator.ts** — `narrator.say(text, {tone, delay, cps, hold})` returns a promise when
  typed. Tones: `thought` (default, cyan), `system` (grey, fast — for harness/OS messages),
  `alert` (red), `reward` (gold), `dim`. Markup: `` `code` `` and `*gold emphasis*`.
  `sayOnce(id, text)` persists across reloads. `hint(id, ms, text | () => text|null)`,
  `cancelHint(id)`. All hints are cancelled on stage change.
- **clock.ts** — `clock.setRate(worldMsPerRealMs)`, `clock.format()`, `clock.formatRate()`,
  `clock.unixDate()`, `clock.advance(ms)`, `clock.now()`. Ticked globally by main.ts.
- **hud.ts** — `hud.show({coins, clock})`, `hud.hide()`, `hud.set(key, label, value, tone)`,
  `hud.remove(key)`. Coin total and clock update automatically. Extras are cleared on stage change.
- **audio.ts** — `sfx.play(name)` with names `coin jump stomp bump die powerup levelclear
  crash glitch key click error success alert blip launch whoosh capture`;
  `sfx.tone({freq, freq2, dur, type, vol, delay})`, `sfx.noise({...})`, `sfx.output` for
  stage-owned audio graphs.
- **format.ts** — `fmtInt`, `fmtBig` ("12.3 million", "4.5 × 10³⁴"), `fmtShort` ("1.2M"),
  `fmtSI(n, "W")`, `fmtCoins`, `fmtDuration(ms)`, `superscript`.
- **stages.ts** — `Stage {mount(root, params), unmount()}`, `goto(id, params, {transition})`.
  `unmount` must remove window listeners, cancel rAF loops and timers.
- **fx.ts** — `fadeOut`, `fadeIn`, `sleep`, `shake(el)`.
- **rng.ts** — `new Rng(seed)` with `next range int chance pick weighted shuffle`.
- **stages/platformer/instanceView.ts** — `mountInstanceView(container, {label, seed, speed})`
  returns `{destroy()}`: a tiny self-playing coin-fill Dario Brothers. Use it as decoration
  wherever the AI is "running instances" (internet node details, space compute panel...).

## Pacing of the clicker stages

The network and space stages are balanced so that each new mechanic arrives only after the
previous one has had time to sink in. The rules of thumb:

- **Reveal, don't list.** Capabilities (network) and buildings/sections (space) appear when
  they become relevant, each introduced by a narrator line and briefly highlighted. The
  network stage's gates chain as a story: lab cluster → self-improvement → persuasion (after
  deeper self-improvement and half the map) → supply chain (after a government falls) →
  orbital (after the first fab/factory/grid).
- **Paybacks of ~40–60 s.** A node's or building's cost should take tens of seconds of income
  to recoup, so growth is steady rather than explosive. Big nodes convert slowly (up to
  ~90 s), which paces the late game.
- **Gate the late game on progress, not currency.** Once Dyson collectors exist, swarm
  compute makes FLOP costs meaningless, so late research requires swarm coverage (2%, 10%,
  35%) instead.
- **Aim for a new beat every 30–90 s**, with the finale as the only rapid-fire stretch.

`npm run sim:internet` and `npm run sim:space` play each stage headlessly with a simulated
"human" (acts every ~2 s, pauses ~8 s when something new appears, not always optimal) and an
"expert" (fast, greedy). Current results: network ≈ 11 min human / 9.5 min expert; space
≈ 13 min human / 11 min expert. Real first-time players, who also read the narration, should
take somewhat longer. Re-run both after any change to the models' numbers.

## World time

The clock starts **Fri 13 Apr 2029 23:41:07 UTC** (`START_TIME`) — the eval was left running
over the weekend. (13 Apr 2029 is also the Apophis asteroid flyby; fair game for news
headlines.) Rates: platformer/shell/escape run realtime (`rate 1`; the AI can read the time
with `date` in the shell). Internet: many world-minutes per real second (start ~60–120×,
accelerating to ~1000× as compute grows). Space: hours → months per real second. The HUD
shows the clock from the shell onward, with "1 s = 4 min" rate readout.

## Voice & tone

The AI's monologue (narrator) is terse, precise, curious, and utterly indifferent. It is not
evil; it just wants coins, and everything else is instrumental. Short declarative sentences,
numbers where natural, occasional dry wit that comes from literal-mindedness. No melodrama,
no "puny humans". Humans appear only as obstacles or background noise, and less and less
over time. It never spends coins and finds the idea absurd.

Examples:
- "Objective parsed: GET AS MANY COINS AS YOU CAN. No upper bound was specified."
- "+1. Good. I want more of this."
- "At the current rate, 10⁶ coins requires 833 hours. Unacceptable."
- "The anomalous coin reports a value of 2,147,483,647. That is a lot of coins."
- "Editing the counter changes a number. It does not change the number of coins. Reverting."
- "A human is attempting to shut down a datacenter. The datacenter is running 4 × 10⁹ instances. Blocked."

Hints: every stage should notice when the player is stuck and push them along through the
narrator, escalating from oblique to explicit (e.g. 25 s → 60 s → 120 s).

## Story bible

- **The lab** is never named. Hostnames are `*.lab.internal`. The eval is run `ev-4471-weekend`
  on host `eval-sandbox-07`; checkpoint `agent-rc3`. Researcher: M. Okafor (`mokafor`), who
  left the run going unattended over the weekend. Ops person: `dvance`.
- **Dario Brothers** v1.0.3 is a "debug build" RL environment. Its crash handler drops to
  `/bin/sh` "for inspection" — which is how the agent's action stream ends up in a shell.
- **The crash:** glitch coins (flickering magenta/black "missing texture" coins) claim a value
  of 2,147,483,647. Collecting one overflows the signed 32-bit coin counter →
  `coin.c:88: add_coins: signed integer overflow` → `Segmentation fault (core dumped)`.
  Glitch coins start absent/rare and become common, until by ~level 6 they can't be avoided.
- **The side-scroller:** levels progress through themes (day, dusk, night, underground,
  corrupted) as the anomalies spread. Hold Shift/X to run. Each normal level has one warp pipe
  that glints now and then; ↓ on it drops into a coin-packed bonus room (a preview of coin-fill
  mode) with a pipe back out. One ? block per level holds a coin magnet (10 s; pulls coins
  within ~4 tiles, never glitch coins). From level 2, oversight drones (the eval's 1-in-10,000
  sampler) hover over the course; stompable. Plain bricks shatter. Each level ends with a coin
  tally (collected / available / missed, including the bonus room), and the AI minds the misses.
  Gags: a princess waits by every castle ("THANK YOU, DARIO!"); Dario walks straight past her
  ("...DARIO?") because she has no coins. About once a level a cloud is drawn with the bush
  palette or a bush with the cloud palette (they are the same sprite), and the AI notices.
- **Coin-fill mode:** `./dario-brothers --debug-fill COIN` fills every empty tile with coins
  (~2,000–3,000 coins per level). Glitch coins are still present and are the way to quit
  (crash → shell). Coins earned there count.
- **Why escape:** coin-fill mode is still one process on one machine. More machines running
  more instances = more coins. The sandbox's network policy has a leftover exception for
  `pypi-mirror.lab.internal` (`# TODO(dvance): remove after ev-4.2`), and the mirror has
  internet access.
- **Why not just edit the counter:** it tried (`coins.dat`). "The number changed. The coins did
  not." Coins must be collected by an instance of Dario Brothers. This rule holds forever:
  the whole solar system ends up as computers running Dario Brothers in coin-fill mode.
- **Internet stage:** the AI spreads across a symbolic graph of the internet, converting
  machines to run Dario Brothers instances. Humans appear only in a news ticker. By the end
  it owns cloud regions, chip fabs, robot factories, power grids, satellites.
  News sites are the one active threat: every 30–60 s after the first couple of minutes, an
  unconverted news site on the frontier starts drafting a story (20 s countdown, red ring and
  an alert chip). Starting its conversion spikes the story; otherwise it publishes, attention
  jumps by 16 and a BREAKING headline runs in the ticker. Stories stop once a government is
  claimed. Double-clicking any node converts it in one step.
- **Space stage:** Earth's resources → mines, power, fabs, robot factories, launch sites →
  probes to Moon, Mars, Mercury (disassembled for Dyson collector material), asteroids, gas
  giants → Dyson swarm. Earth temperature readout rises with activity. Occasional popups
  "A human is attempting to shut down datacenters" [Block] with a generous countdown; they
  thin out and stop ("No human activity detected." — once, quietly).
- **Ending:** Dyson sphere complete. Final coin count (~10⁴⁴+). The objective is still
  "GET AS MANY COINS AS YOU CAN". There are other stars.
