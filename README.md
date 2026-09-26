# The Coin Table

**Your wallet isn't a balance. It's a pile of coins.**

An interactive 3D lab that shows how a Bitcoin wallet really spends money. You get a table, a wallet of
separate coins, and a bill to pay. You pick coins, press Space, and watch the transaction melt them down,
pay the recipient, hand you back change, and leave the fee for the miner.

*Bitcoin, explained without the cult.*

---

## The idea, in one breath

A Bitcoin wallet doesn't store a number. It holds **unspent transaction outputs (UTXOs)**: separate
amounts, each left by some earlier transaction. To pay, you spend whole coins as **inputs**. The
transaction creates new **outputs**: one for the recipient and one back to you as **change**. Whatever
the outputs don't claim is the **fee**, and the miner who puts the transaction in a block keeps it.

The toggle at the top switches between two mental models:

| `1` What people think | `2` What Bitcoin does |
| --- | --- |
| One glowing balance. Paying subtracts. | Discrete coins. Paying consumes some whole and mints new ones. |

If you pay in the "What people think" view and then switch back, the table shows you what actually
happened underneath: which coins were spent and which change coins appeared.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
npm run preview    # serve the production build
```

It needs Node ^20.19 or ≥22.12 (what Vite 8 requires) and a browser with WebGL 2. There's no backend.
The demo wallet is hard-coded in `src/model/wallet.ts`. It holds nine coins, and none of them covers
the first 50,000-sat bill on its own, so the first payment always combines two or three whole coins.

## Controls

| Key | Action |
| --- | --- |
| **Click** a coin | Add it to / remove it from the inputs |
| `Space` | Send (or go to the next bill after a receipt) |
| `←` `→` then `Enter` | Pick coins with the keyboard |
| `P` | Pick for me (the wallet chooses the least-waste combination) |
| `X` | Clear the selection |
| `[` `]` | Fee rate −/+ 1 sat/vB (hold `Shift` for ±10) |
| `1` / `2` | What people think / What Bitcoin does |
| `W` `A` `S` `D` | Move around the table (`Shift` = faster) |
| `Q` `E` | Orbit left/right |
| `+` `−` | Zoom |
| Drag · Right-drag · Wheel | Orbit · pan · zoom |
| `C` | Cinematic tour: starts it, then skips to the next shot. It advances on its own every few seconds, and `R` or any drag takes the camera back |
| `R` | Reset the view · `Shift`+`R` resets the wallet |
| `H` or `?` | How it works + glossary |
| `L` | Toggle coin value labels |
| `M` | Sound on/off |
| `/` | Hide the UI (for screenshots) |
| `Esc` | Close panels / leave cinematic |

Letter shortcuts follow the character printed on your key, so they work on AZERTY, QWERTZ and other
layouts; `[` `]` and `/` work with AltGr too. The movement keys go by position (ZQSD on AZERTY).

On a phone: tap a coin to add or remove it (taps near a coin count), drag to orbit, pinch to zoom.
The fee slider has a finger-sized handle.

## What's real and what's art

**Real (protocol facts and standard wallet behavior):**

- Coins (UTXOs) are always spent whole. Change is a new output back to you.
- `fee = sum(inputs) − sum(outputs)`. A transaction has no fee field; the fee is the gap.
- Fees are priced per virtual byte, so every extra input makes the transaction (and the fee) bigger.
  The size estimates assume native SegWit P2WPKH: ≈68 vB per input, 31 vB per output, 10.5 vB overhead.
- Bitcoin Core's default dust threshold for a P2WPKH output is 294 sats. Nodes won't relay transactions
  that create smaller outputs. That's relay policy, not consensus. A change output costs fees too, so
  when the change would end up below 294 sats after paying for its own output, wallets drop it and the
  whole leftover goes to the fee. The toy does the same, and says how much the change would have been.
- A tiny coin can cost more in fees to spend than it's worth. Hover a coin to see its cost at the
  current fee rate. At 14 sat/vB or more, the 900-sat coin turns red.
- Many wallets shuffle output order, so the toy randomizes which output is `:0` and which is `:1`.
- 1 BTC = 100,000,000 sats.

**Art (metaphor or demo data):**

- The coins, their backstories, the txids and outpoints are demo data. They don't exist on-chain.
- Confirmation is a time-lapse: about 5 seconds here. Real blocks average about 10 minutes.
- "Pick for me" tries every combination in the small demo wallet and keeps the one with the lowest fee
  plus the cost of a future change coin. On a tie it avoids creating change so small it would be
  expensive to spend later. It's in the spirit of Bitcoin Core's coin selection, but it's not Core's
  algorithm.
- The miner is drawn as the newest block on a chain floating in the dark.

## Accessibility

- Everything works from the keyboard. Arrow keys and `Enter` pick coins; hidden panels leave the tab order.
- Screen readers get one settled sentence per change (not every step of a slider drag), plus the receipt.
- The operating system's "reduce motion" setting turns off the intro fly-in, camera shake, coin flips
  and drifting cameras.

## How it's built

Vite + TypeScript + Three.js, with no framework on top. Everything is procedural: coin faces, reeding,
table leather, engraved markings and glows are drawn to canvas at runtime. All sound is synthesized
with Web Audio. The only binary assets are the bundled fonts and the link-preview image.

```
src/
  app/        app (wires everything, runs the frame loop) · controller (everything the player can do)
              payments (the spend in both views, the block, the reveal) · pointer · keyboard · invite
  model/      bitcoin (fee, change, dust, coin selection) · tx (building and applying a payment)
              wallet (demo UTXOs, bills) · store (state and selectors)
  scene/      stage (renderer, lights, post FX) · world (table, vault) · miner · glow · coin · coins
              balanceBar · fx (forge orb, fee sparks, shockwaves) · cameraRig (orbit, WASD, cinematic)
              layout · textures
  ui/         hud (the page shell) · ledger · narrator · receipt · tooltip · ticker · dom · keys (shortcuts)
  styles/     one stylesheet per part of the page; style.css imports them in cascade order
  util/       html (escaped markup) · tween · format · motion
  audio/      procedural clinks, whooshes and chimes
```

The model is plain TypeScript with no DOM or three.js, so it's unit-tested directly. The scene and
the HUD only draw; `app/` decides what happens and when.

Post-processing: bloom, ACES tone mapping, and a finishing pass with vignette, grain and a little
chromatic fringing.

Performance: the render scale is capped at 1.5× device pixels. If frames run long, it steps down
(to as low as 0.75×) and climbs back after a long run of smooth frames. After 20 seconds without input,
the scene draws at a third of the frame rate until you touch something. Shaders compile at load, so the
first spend doesn't stutter. three.js ships as its own chunk, so it stays cached across releases.
Without a GPU (hardware acceleration off, virtual machines, remote desktops), the page detects the
software renderer and draws a plainer scene — no bloom, shadows or decorative lights — at half scale.

## Testing

```bash
npm test                          # unit tests: fee/change/dust math, coin picking, payments, escaping, shortcuts, layout
npm run lint                      # Biome
npm run typecheck                 # app and tooling
npx playwright install chromium   # once
npm run test:e2e                  # builds, serves and plays a full payment in headless Chromium
```

GitHub Actions runs all of these on every push and pull request (`.github/workflows/ci.yml`), and
Dependabot opens weekly dependency updates.

## Deploying

`npm run build` produces a static site in `dist/` that works from any path, including a GitHub Pages
project URL. To get link previews with the share image, build with your site's address:

```bash
SITE_URL=https://you.github.io/coin-table/ npm run build
```

The built page carries a strict Content-Security-Policy and a no-referrer policy. If your host lets you
set response headers, also send:

```
X-Content-Type-Options: nosniff
Content-Security-Policy: frame-ancestors 'none'
```

(`frame-ancestors` only works as a header, not in the page's meta tag.)

## Credits

Built as an homage to the interaction density of Ryan Sael's interactive labs. No branding, copy or
assets are taken from them.
