# ARCH RUNNER — Story & Design Bible (Tron / cyberpunk makeover)

## 1. The premise (relevant + funny)

**The world is THE MEMPOOL** — a neon datascape *inside* Bitcoin/Arch. Transactions are
citizens, blocks are city districts, and the only thing that matters is getting
**CONFIRMED** before the next block seals.

**You are SAT**, a courier transaction. At 3 AM you bite into the legendary **Satoshi
Donut** — but the payment terminal still reads **PAYMENT: PENDING**. You are now an
*unconfirmed, unsettled* transaction loose in the Mempool. That is a crime.

**THE AUDITOR** — the Mempool's compliance daemon, a red neon enforcer — detects the
"unsettled pastry asset" and comes to **prune** you (compliance‑speak for *delete*). Your
only defense is speed: outrun it until your transaction **confirms**. Survive the block,
and you're legit. Get caught, and you're double‑spent.

> It's a race to confirmation, told as a chase. Funny because the villain is an
> over‑serious auditor citing fees; relevant because every mechanic maps to Bitcoin.

## 2. Mechanics → lore (so nothing is arbitrary)

| Game thing | Lore |
| --- | --- |
| Running / surviving | your transaction propagating, trying to confirm |
| ₿ Coins (orange) | **sats** you attach as fee — more fee = more priority |
| FLOW ×1→×4 | **fee‑priority multiplier** — clean moves raise your priority |
| BLOCK RUN | a **new block** is forming — the district speeds up, denser, ×2 |
| ARCH FLIP gate | a **risky mempool lane** — 3× priority if you survive it |
| The Auditor closing in | the **pruning daemon** catching your unconfirmed tx |
| Death | you got **pruned / double‑spent** |
| Daily Block | everyone runs the **same block seed** today |

## 3. Characters

**SAT (hero)** — a sleek courier in a **dark light‑suit** with glowing **cyan** seams
(Tron), a hooded visor (cyan slit), an orange **fee‑pack** on the back (the sats), and a
**light‑trail** when sprinting. Faces the direction of travel (fix: currently faces the
camera → reads as running backwards). Confident, a bit of a smartass ("That seems
negotiable.").

**THE AUDITOR (antagonist)** — a hovering **red‑neon enforcer**: angular black hull with
hot‑red light edges, a single scanning **eye**, grasping claw‑arms, thruster underglow.
Dry, bureaucratic menace. Lines: *"Unsettled pastry detected." / "Your transaction lacks
fee. Prepare for pruning." / "Fleeing incurs a gas fee, a late fee, and a disappointment
fee."*

## 4. Visual direction — TRON / cyberpunk

- **Palette:** near‑black base; **neon cyan `#19e5ff`** (grid/hero/ambient), **Bitcoin
  orange `#f7931a`** (coins/fee/brand), **hot magenta‑red `#ff2a5f`** (hazards/Auditor),
  **violet `#9b6bff`** (Flip/Block). High contrast, lots of black, glow from bloom.
- **Floor:** a **glowing cyan Tron grid** — bright lane lines + cross‑ticks on black,
  with an orange "fee lane" edge. The road reads as data, not asphalt.
- **Buildings:** dark data‑towers with **neon edge lines** (cyan/orange emissive seams +
  sparse windows) instead of warm lit windows — a skyline of circuitry.
- **Arches / gates:** **block gates** — neon rings of light the runner passes through
  (one per block), reinforcing "sealing a block."
- **Hero:** cyan light‑suit seams + a short **speed light‑trail**; orange fee‑pack.
- **Obstacles:** neon‑edged — **red** barrier (switch), **amber** low hurdle (jump),
  **violet** overhead gantry (slide), **red** pit (jump). Telegraph by color + glow.
- **Sky:** deep cyber‑dusk gradient with a faint grid horizon.
- Keep bloom disciplined (authored emissive only); readability of hazards first.

## 5. Concrete changes to ship

1. **Fix run‑backwards:** orient SAT to face travel (−z); camera sees the back + fee‑pack.
2. **Fix the abrupt cutscene→game blank:** keep the scene rendering under the fade (no
   blank frame); cross‑fade on the same renderer where possible, hold the veil until the
   game's first real frame.
3. **Tron palette + neon grid floor + neon building edges + block‑gate rings.**
4. **Hero light‑suit seams + light‑trail; crisper jump (anticipate→rise→tuck→land) and
   slide (dive→skim, with a spark/light‑streak).**
5. **Rewrite the cutscene** to the Mempool framing (bite → PENDING → Auditor "prune" →
   bolt → confirm), funnier beats, same ~7s skippable shape.

## 6. Tone for copy (plain, no jargon per project rule)
Short, dry, funny. The Auditor is deadpan corporate. Player lines are cocky. Never explain
the blockchain joke — let the visuals + one‑liners carry it.
