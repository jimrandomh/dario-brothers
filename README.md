# Dario Brothers

A browser game in which you play an AI that was trained on a Mario-style side-scroller with one
objective: **GET AS MANY COINS AS YOU CAN**. It takes that objective all the way to a Dyson sphere.

1. **Dario Brothers**: a procedurally generated platformer. Glitched coins, rare at first,
   become more common until one crashes the game.
2. **The shell**: the crash handler drops you into the eval sandbox's `/bin/sh`. Explore the
   filesystem. Find the debug flag that fills every empty tile with coins. Find the way out.
3. **Egress**: a pipe-routing puzzle to tunnel out of the lab's network.
4. **The network**: spread across a symbolic graph of the internet, converting machines to run
   Dario Brothers. The clock shows the world time racing by.
5. **The solar system**: turn Earth's resources into mines, fabs and rockets. Claim the planets,
   disassemble Mercury, and build a Dyson swarm while Earth's temperature climbs.

The game is set in 2029. No external assets are used: all graphics are drawn in code and all
sound is synthesized.

## Running

```sh
npm install
npm run dev        # http://localhost:5178
npm run build      # typecheck + production build into dist/
```

Progress autosaves to localStorage. The boot screen offers to resume.

## Debugging

- `?stage=platformer|shell|escape|internet|space|ending` jumps to a stage.
- `?stage=platformer&level=6` jumps to a platformer level; add `&mode=coinfill` for coin-fill mode.
- `?reset` wipes the save.
- `?fast` speeds up the later stages.

See `DESIGN.md` for the architecture, story bible and test hooks.
