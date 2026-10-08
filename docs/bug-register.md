# ARCH RUNNER — Bug Register

Each claimed bug gets a verdict from the **actual code**, not assumed. Several "critical bugs" in the takeover
brief came from the previous (Arkade) concept and are **not present** here — verified below rather than
"fixed" blindly.

| ID | Severity | System | Claim | Verdict & root cause | Test | Status |
|---|---|---|---|---|---|---|
| GAME-001 | CRITICAL | Collectibles | "Collecting a coin on one side makes coins on the other side disappear." | **FIXED (real, subtler bug).** Not a group deletion (coins are individually id'd), but `resolveWorld` added every *passed* coin to the `resolved` set regardless of lane, and `view()` hides resolved coins — so uncollected side-lane coins vanished at the player plane instead of scrolling past. Fix: a coin is marked `resolved` only when actually collected, and collection only happens within a z-window around the player. Caught by the regression test below. | `tests/coins.test.ts`: a side-lane coin never disappears while the player collects in its own lane (5 seeds); coin count monotonic. | FIXED |
| GAME-002 | HIGH | Flow | "Flow triggers from a left-side event while on the right." | **FIXED** earlier (Phase C). Near-miss now requires a SOLID wall in an adjacent lane within `NEAR_MISS_X` world-x (a genuine close pass); obstacles you were never near grant nothing. | `tests/sim.test.ts`: centered no-input runner earns 0 near-miss Flow. | FIXED |
| GAME-003 | HIGH | Wallet | "Wallet connect doesn't work / still dummy." | **FIXED (real connect wired).** `InjectedWalletProvider` detects installed Bitcoin wallets and does a real connect: **UniSat** (`requestAccounts`/`getPublicKey`/`signMessage` BIP-322) and **OKX** (`okxwallet.bitcoin.connect`) fully wired; Xverse/Leather detected + guided (not faked). Menu shows a wallet chooser of *installed* wallets; DEMO (MockWallet) is an explicit, labelled fallback so the game is still demoable with no extension. Only on-chain *settlement* remains mock (needs the deployed program). | `tests/wallet.test.ts` (detects none headless, fails gracefully), manual with an extension | FIXED (connect) · settlement infra-blocked |
| GAME-004 | HIGH | Identity | "Player name not persisted across reconnect." | **FIXED.** Profile keys off the wallet **address** (identity); name is a mutable field. First connect asks the name; reconnect loads the profile and does not ask again. | `tests/identity.test.ts` | FIXED |
| GAME-005 | MED | Physics | "Jumping blocks too close / unfair spacing." | **FIXED** (Phase D). Hazards sit in a band so consecutive same-lane hazards are ≥12u apart; Block Run / flip stretches are the designed-expert exception. Jump buffer added for responsiveness. | `tests/patterns.test.ts` reaction-gap test | FIXED |
| GAME-006 | HIGH | Content | "Boring after ~20s / jump-block-jump repetition." | **FIXED** (Phase D). Pacing phrases, anti-repetition memory, scripted opening, richer pattern library (routes/coin-trails/gates/multi-mechanic). | `tests/patterns.test.ts` variety test | FIXED |
| GAME-007 | MED | Coins vs score | "Coins conflated with score." | **FIXED** (Phase C). HUD shows a separate top-right COINS counter (with pop); result card labels COINS and notes coins add to score. | manual / HUD | FIXED |

## Still open (not bugs — missing features from the takeover brief, tracked in current-state-audit.md)
Procedural 3D character + animation (currently a juiced box), narrative (opening cutscene, the Auditor, chase
mode), richer city zones, real Arch wallet + on-chain settlement. These are build items, not defects.
