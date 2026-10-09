# ARCH RUNNER — Game-Dev Research & Revamp Roadmap

*Technical-director research report for a production visual/feel revamp. Compiled 2026-10-09.*

This report pairs **current industry/tech research** (2024–2026, sources cited inline with dates) with a **ground-truth read of the ARCH RUNNER codebase** (`src/game/render.ts`, `runner-rig.ts`, `chaser.ts`, `obstacles.ts`, `cityscape.ts`, `sim.ts`, `constants.ts`, `settings.ts`). It also folds in the locally installed Three.js skills — `threejs-aaa-graphics-builder` (references `technical-art.md`, `authoring-recipes.md`, `shader-cookbook.md`, `visual-scorecard.md`), `threejs-game-director`, `threejs-gameplay-systems`, `threejs-game-ui-designer` — with attribution where their guidance is applied.

**Verdict up front:** ARCH RUNNER is already a *strong* greybox-plus. The render pipeline is unusually well-built for a hackathon project — a multisampled EffectComposer (not the usual "post kills AA" mistake), the sophisticated Khronos **PBR Neutral** tone map (a deliberate 2024-era choice), a disciplined key/fill/rim/practical light rig, procedural jointed characters with named joints and material zones, per-role authored obstacles, pooled everything, DPR/bloom caps, and WebGL context-loss recovery. On the `threejs-aaa-graphics-builder` scorecard it sits around **2.0–2.3** today. The gap to "best 3D web game" is **not** a rewrite; it is roughly eight targeted moves, led by one near-free change (an environment map) and one bigger one (rigged/skeletal hero animation).

---

## 1. Executive summary — the highest-leverage changes

Ordered by return on effort. Each ties to a concrete gap found in the source.

1. **Add an IBL environment map (PMREM + RoomEnvironment).** *~5 lines, HIGH impact.* The single biggest "flat → real" lever that is currently missing. The code already authors metals — `coinSide metalness 0.55`, `coinFace 0.3`, chaser `metal 0.8`, gear `0.5`, lane edges, kiosks — but `scene.environment` is never set, so **every metallic/glossy surface reflects nothing and reads as flat gray**. The `shader-cookbook.md` prerequisite is explicit about this: metals look flat without an env map. One `PMREMGenerator.fromScene(new RoomEnvironment())` fixes the coins, the Auditor hull, and all trim at once. (`render.ts` constructor.)
2. **Upgrade the hero + chaser from sine-wave procedural to data-driven skeletal (or, as phase 1, foot-planted procedural with secondary motion).** *HIGH impact, med/high effort.* The procedural rig (`runner-rig.ts`) is good greybox but reads as "animated mannequin": a pure `Math.sin(phase)` gait, eased-lerp blends, no foot IK, no cloth/hood secondary motion, arms that only swing fore/aft. This is the clearest remaining "character premium" gap on the scorecard's Hero row.
3. **Instance the repeated world (BatchedMesh / InstancedMesh).** *HIGH impact on mobile, med effort.* Buildings (~108 meshes), lamps (~130 meshes), floor ticks (40 separate meshes sharing one geo+mat!), streaks (16), coins (48), and the obstacle pools are drawn one mesh per object. Worst-case draw calls are comfortably **300–500+**, over the mobile budget of ≤150 (`technical-art.md`) and at/over the desktop ≤300. Instancing is the fix and the ticks alone are a free win.
4. **Measure, don't guess — wire the canvas inspector and set budgets.** *MED impact, low effort.* The scorecard's automatic-fail list includes "no renderer diagnostics after major graphics work." There is currently no `info.render.calls`/`triangles` reporting. Add the `threejs-qa-release` inspector and a dev HUD so every change is checked against the budget table in §4.
5. **Give materials a shared library + roughness/metalness variation.** *MED impact, low/med effort.* Materials are defined inline per file with mostly uniform roughness. `authoring-recipes.md` / `technical-art.md`: separate roles by **roughness/metalness contrast, not hue alone**, from a named kit (`bodyPrimary`, `trim`, `hazard`, `reward`, `emissiveSignal`, `groundContact`). Centralize them; add wet-look clearcoat to the hero chest plate and a matte `groundContact` under props.
6. **Finish the post chain and the grounding.** *MED impact, low effort.* Add a **subtle vignette** (cheap ShaderPass, keeps eyes on the lane) and **event-driven chromatic aberration** on impact/death only. Add **fake contact-shadow discs** (radial `CanvasTexture` planes) under coins and the hovering gates/Auditor so floating objects anchor — far cheaper than shadow-casting them. Keep bloom disciplined; **do not** add SSAO or DOF.
7. **Bump Three.js off r169 to a recent stable (r182–r184), staying on WebGLRenderer.** *MED impact, med effort/risk.* r169 (mid-2024) predates the BatchedMesh maturation, the r182 shadow-mapping overhaul, and `THREE.Timer`. Take those wins. **Do not** switch to WebGPURenderer yet (see §8).
8. **Audio + UI feel pass.** *MED impact, med effort.* The reference-game research is unanimous that *feel* in runners is carried heavily by audio (coin jingles, speed whoosh, music swells) and forgiving, responsive UI feedback. There is an `engine/audio.ts`; make sure every VFX event (`burst`, near-miss stumble, flip, block-run) has a paired sound, and audit the HUD against `threejs-game-ui-designer` (no stat-card dashboards).

---

## 2. Rendering & visual-quality spec

### 2.1 What ARCH RUNNER already does right (keep it)

| Feature in code | Why it's correct |
| --- | --- |
| **Multisampled composer** — `WebGLRenderTarget(…, { samples: 4, type: HalfFloatType })` fed to `EffectComposer` (`render.ts` `buildComposer`) | Avoids the #1 post-processing bug: a plain RT gets no MSAA (the canvas `antialias:true` doesn't cover it), giving jagged edges. This is already solved correctly. |
| **Khronos PBR Neutral tone map** — `THREE.NeutralToneMapping`, exposure 1.1 | A deliberate, modern (2024) choice. Neutral rolls off bright emissive without the ACES orange→salmon desaturation, so `#F7931A` Bitcoin orange stays on-brand. This is more sophisticated than the default ACES recommendation and *right for this palette*. |
| **sRGB output** — `outputColorSpace = SRGBColorSpace`, `OutputPass` last | Correct color management. |
| **Key/fill/rim/practical rig** — hemi + ambient + directional key (shadow) + warm rim + point practical | Exactly the readable stack `authoring-recipes.md` prescribes. |
| **Tuned shadows** — `PCFSoftShadowMap`, 1024 map, bias −0.0006, normalBias 0.02, tight ortho frustum | Grounds the hero without acne/peter-panning; disabled on low/reduced. |
| **Layered world + dusk fog + gradient sky dome** | foreground/mid/far city rows, fog that fades towers into a warm horizon, canvas sky — matches the "play/near/mid/far/motion" layering rule. |
| **Pooling, DPR cap (2), bloom-RT cap (1.5), context-loss recovery, perf auto-downgrade, reduced-motion path** | Production-grade runtime hygiene. |

### 2.2 Adopt / Avoid table (with exact APIs, versions, rationale)

Target stack: **three.js r182–r184, WebGLRenderer** (addons via `three/addons/*`; the project currently imports from `three/examples/jsm/*`, which still works).

| Technique | Verdict | Exact API / value | Rationale (tied to this game) |
| --- | --- | --- | --- |
| **IBL environment map** | **ADOPT (do first)** | `const pmrem = new THREE.PMREMGenerator(gl); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.6–1.0; pmrem.dispose();` | Makes the coins, Auditor hull, gear and trim actually reflect. Near-zero per-frame cost (one startup bake). *The* missing piece given the metalness values already in code. (`shader-cookbook.md` prerequisite.) |
| **PBR Neutral tone mapping** | **KEEP** | `NeutralToneMapping` | Already correct for the brand orange; do not switch to ACES (desaturates the orange). |
| **MSAA via multisampled RT** | **KEEP** | `samples: 4` (desktop), `2` (mobile), `HalfFloatType` | Native-quality edges through the composer. On mobile, drop to `samples: 2` or skip the composer entirely. |
| **UnrealBloom on authored emissive only** | **KEEP, retune** | `UnrealBloomPass(res, strength 0.45–0.6, radius 0.3, threshold 0.8+)` | Current `(0.62, 0.7, 0.72)` is slightly hot/wide; raise threshold to ~0.8 so only true emissive (visor, beacons, coin ₿, gates) blooms and mid-bright surfaces stay crisp. Bloom must sell emissive, never stand in for geometry (`authoring-recipes.md`). |
| **Subtle vignette** | **ADOPT** | One `ShaderPass` (recipe in `shader-cookbook.md`), `uStrength ≈ 0.5`, never darkening the lane | Cheap cinematic focus pull toward the run corridor. |
| **Chromatic aberration** | **ADOPT, event-driven only** | brief RGB-split on impact/death/near-miss, decaying over ~0.3 s; gate behind `!reducedMotion` | Juice without permanent cost. Permanent CA reads as cheap. |
| **Fake contact shadows** | **ADOPT** | radial-gradient `CanvasTexture` on a `PlaneGeometry`, `{ transparent:true, depthWrite:false }`, scale/fade with height | Anchor coins, gates and the hovering Auditor without adding shadow-casters. The Auditor already has an underglow disc — extend the pattern. |
| **Vertex-color AO on buildings** | **ADOPT (optional)** | `geometry.setAttribute('color', …)`, material `vertexColors:true`, darken cavities | Adds grounded contact darkness to the city for free; compensates for omitting SSAO. |
| **CSM (Cascaded Shadow Maps)** | **AVOID** | — | The run corridor is short and fogged; one tight directional shadow already covers the hero/hazards. CSM is for large open sun-lit worlds — wasted cost here. |
| **SSAO / GTAO** | **AVOID** | — | Expensive full-screen pass; the stylized, fogged, emissive look gains little and it muddies the readable silhouettes. Use vertex AO + contact shadows instead. |
| **TAA (temporal AA)** | **AVOID** | — | TAA ghosts on fast lateral/forward motion — actively bad for a high-speed runner. MSAA is the right AA here. |
| **DOF (depth of field)** | **AVOID (except menu/cutscene)** | — | Blurs the very hazards the player must read. Fine for the attract/cutscene camera only. |
| **Motion blur** | **AVOID** | — | Same readability problem. Prefer the existing geometry speed-streaks + FOV ramp (already implemented well). |
| **WebGPURenderer / TSL node materials** | **DEFER** | `three/webgpu`, `WebGPURenderer` | Mature in 2025–26 (Safari 26+, ~95% coverage) but carries a real Firefox-black-screen risk and migration cost for a game that is not GPU-bound. See §8. |

**Realtime vs baked lighting:** This game is a *scrolling, procedurally-recycled* corridor — geometry streams past, so classic lightmap baking (static UVs) does not apply cleanly. The right model is **realtime + "baked-looking" cheats**: keep the one dynamic shadow-caster for the hero, and lean on emissive maps (already used on city windows), vertex AO, matcap background props, and contact discs. This matches `authoring-recipes.md`: "prefer baked-looking emissive cues, light cards, and small unlit decals over many unmeasured dynamic lights."

**Stylized vs realistic:** Commit fully to **stylized**. The reference research (§5) shows the premium-feeling runners (Alto's Odyssey especially) win on *mood and restraint*, not polygon realism. ARCH RUNNER's dusk-city/Bitcoin-orange identity is a strong stylized direction — push cohesion (materials, VFX, audio), not realism.

---

## 3. Asset & animation pipeline

### 3.1 Procedural vs authored GLB — the call for THIS game

**Keep the world and props procedural. Upgrade the hero and the Auditor toward authored/skeletal.**

- **World, obstacles, coins, city, gates → stay procedural.** They are deterministic-friendly, zero-download, instantly available, and already authored to the "family with per-role silhouette + telegraph" bar (`obstacles.ts`). Procedural wins here on every axis. Do *not* introduce GLB for these — it adds a loader, download weight, and KTX2 tooling for no readability gain.
- **Hero (SAT) and Auditor → the characters are where authored/skeletal pays off.** A procedural sine gait has a ceiling; `authoring-recipes.md`'s "Hero character" bar wants rig-illusion joints, material zones, *and expressive animation feedback*. The rig geometry is already good; the **animation** is the weak link.

Two viable paths — recommend **starting with A, keeping B as the premium target:**

- **Path A — Upgrade the procedural rig (low risk, keep determinism trivially).** Add: (1) simple two-bone **foot IK** so planted feet stick to the ground instead of the current `Math.max(0,sin)` knee hack; (2) **secondary motion** — a hood/cloak bob and ledger-pack sway driven by velocity/lane-change (spring-damper, no physics engine); (3) **procedural lean into turns** (roll the body on lane switch); (4) richer blends via small spring state instead of linear lerp. Effort: med. Impact: high. Preserves the "no asset download, presentation-only" model.
- **Path B — Move hero + Auditor to rigged GLB with baked clips (premium target).** Author/retarget **run, jump, slide, stumble, death, idle** clips (Mixamo is the standard retarget source), export as **one GLB with multiple `AnimationClip`s** (glTF bundles clips; FBX needs one file per clip — glTF is simpler). Drive with **one `AnimationMixer` per character**, `mixer.update(delta)` every frame, `crossFadeTo(next, 0.2, true)` between states with **both actions playing** during the blend, and `clampWhenFinished = true` on one-shots (jump/slide/death). **Export Mixamo clips "In Place"** and advance the character in game code, or strip the root-position track, or the crossfade will teleport/slide the model back to origin. (Three.js forum, 2021–2024; `tessl` threejs-animation skill doc.)

**Determinism is safe either way:** the sim (`sim.ts`) is the deterministic authority; the renderer is explicitly "pure presentation — never decides gameplay." Animation lives entirely in the render layer and is driven by sim state (`sim.distance`, `sliding`, `grounded`, `y`), so adding a mixer changes nothing about anti-cheat or replay. Keep Path A's procedural rig as the **reduced-motion / low-quality fallback** when you adopt B.

### 3.2 If/when you ship any GLB (hero, Auditor, or future props)

Formats and tools (community consensus 2024–2026; verify against current releases):

- **Container:** glTF 2.0 / **GLB** (binary). Validate every file with the **Khronos glTF Validator** before shipping.
- **Geometry compression:** **Meshopt** for anything skinned/animated (fast decode, handles morph targets + animation) — ideal for the hero. **Draco** when the smallest possible file is the priority and decode latency is acceptable (decodes off-main-thread in a worker). Both claim ~70–95% geometry reduction; measure your own files. Set the decoder paths in the loader (`DRACOLoader` / `MeshoptDecoder` / `KTX2Loader`).
- **Textures:** **KTX2 + Basis Universal** — GPU-uploadable without a CPU decompress, transcoded at runtime to ETC/BC/ASTC. ~70–90% smaller than PNG/JPEG; start quality ~128/level 2, drop to 64–96/level 4–5 if web size dominates. (Unity Asset-Transformer export guidance, 2025–26; A-Frame gltf-model docs 1.7–1.8.)
- **Tooling:** `gltf-transform` (CLI pass for Draco/Meshopt/KTX2/dedup/prune), `gltfpack`, Blender 4.2+ for authoring.
- **Caveat:** compression ≠ runtime speed. If a model is heavy on triangles/draw calls, compression won't help — simplify geometry and add LOD (A-Frame docs). Also confirm your host serves gzip for `.glb` (GitHub Pages historically did not) if you use Meshopt+gzip.
- **Instancing for repeats:** for any repeated authored prop, share geometry+material and use `InstancedMesh`; for skinned clones, use `SkeletonUtils.clone`.

### 3.3 Character + animation — what a runner specifically needs

From `threejs-gameplay-systems/references/game-feel.md` guidance and the reference research: a runner needs **run (speed-scaled), jump (clamped one-shot), slide (clamped), near-miss stumble, death, idle/lobby**. Tie run playback rate to game speed (`action.timeScale`, or the current phase-from-distance approach). Use `THREE.Timer` (r183+) instead of `Clock` so a backgrounded tab doesn't produce a huge delta jump on return. The existing **stumble beat** (near-miss → trip-and-recover + camera jolt + Auditor surge) is exactly the Temple-Run "near-catch" juice and should be preserved and extended.

---

## 4. Performance budget & targets

### 4.1 Targets (from `technical-art.md`, worst active-play frame)

| Metric | Desktop | Mid mobile | How to measure |
| --- | --- | --- | --- |
| Draw calls (`renderer.info.render.calls`) | ≤ 300 | ≤ 150 | canvas inspector / dev HUD |
| Triangles (`info.render.triangles`) | ≤ 750k | ≤ 300k | same |
| Geometries (`info.memory.geometries`) | ≤ 300 | ≤ 200 | same |
| Textures (`info.memory.textures`) | ≤ 60 | ≤ 40 | same |
| Shadow-casting lights | ≤ 2 | 1 | code audit (currently 1 ✓) |
| Shadow map size | ≤ 2048 | ≤ 1024 | code (currently 1024 ✓) |
| DPR cap | 2 | 1.5–2 | `setPixelRatio(Math.min(2, dpr))` (currently 2; **drop mobile to 1.5**) |
| Post passes beyond render+output | ≤ 2 | 0–1 | bloom(+vignette) = 2; **mobile: bloom-only or none** |
| Frame time | ≤ 16.67 ms @ 60 fps | same | DevTools Performance; `Timer` delta |

### 4.2 Where ARCH RUNNER stands today (estimated — must be measured)

- **Draw calls are the risk.** Rough count of always-present separate meshes: city buildings ~108, lamps ~44 groups × 3 ≈ 132, floor ticks **40** (sharing geo+mat but 40 draws), gates ~9, hero ~20, Auditor ~20, plus visible obstacles/coins/streaks. Worst-case **~300–500+** — **over mobile budget, at/over desktop**. This is the headline perf gap.
- **Good:** 1 shadow-caster, 1024 shadow map, pooling, no per-frame allocation (verified across `render.ts`, `obstacles.ts`), DPR capped, bloom RT capped to 1.5, perf-mode bypasses the composer.
- **Mobile DPR:** currently `Math.min(2, dpr)` for all devices — **cap mobile at 1.5** (the composer's HDR targets scale with DPR², per `shader-cookbook.md`).

### 4.3 Measurement plan (close the "no diagnostics" automatic-fail)

1. Wire `threejs-qa-release/scripts/inspect-threejs-canvas.mjs` (or add `npm run inspect:canvas`) and capture `metrics` + `renderBudget` on desktop **and** a 400 px mobile viewport, in representative states: cruise, Block Run (streaks + recolor), ARCH FLIP, death cam.
2. Add a dev-only on-screen readout of `renderer.info.render.{calls,triangles}` and FPS.
3. Report before/after for any graphics change. Watch `colorEntropyBits`/`edgeDensity`/`luminance.contrast` from the inspector as advisory signals (scorecard §Measured evidence).

**Frame pacing / GC:** fixed 60 Hz sim tick is already deterministic; the render delta is clamped (`Math.min(0.05, …)`). Keep it. Avoid per-frame `new` (already done). Switch the loop clock to `THREE.Timer` for background-tab safety.

---

## 5. Reference-game teardown — what to borrow

Named references and the *specific* premium-making trait to steal:

1. **Alto's Odyssey (Team Alto, 2018; Wikipedia; CGMagazine interview; MacStories review).** *Borrow: mood through restraint.* Its premium feel comes from a "clean, colourful, minimalist" look that feels like "moving through a painting," plus **lush piano/ambient music and swelling crescendos** and a deliberately un-intrusive UI. **Action for ARCH RUNNER:** lean the dusk-city identity into *atmosphere* (dynamic sky/time-of-day shifts between runs, procedural ambient music, minimal HUD) rather than more props. Restraint scores on the scorecard.
2. **Subway Surfers (SYBO, 2012; PocketGamer; Skich comparison).** *Borrow: forgiveness + response + reward feedback.* Three-lane system (ARCH RUNNER matches), a **hoverboard that grants one free crash** (near-miss becomes exciting, not punishing), "instant" swipe response, and **satisfying coin/power-up audio**. **Action:** consider a once-per-run save (a "pending-tx shield" fits the Bitcoin theme), tighten input→action latency, and make sure every collect/flip/block-run has a crunchy sound. The research is explicit that casual players "don't want to feel bad."
3. **Temple Run (Imangi, 2011; TouchArcade; comparisons).** *Borrow: the chase fantasy / near-catch tension.* A looming pursuer and a punishing, claustrophobic tone drive adrenaline. **ARCH RUNNER already has this** (the Auditor surges to your heels on a near-miss via the eased `menace` system) — this is a real strength; preserve and amplify it (louder audio sting, brief CA on the near-catch).
4. **Three.js tech reference — BatchedMesh + WebGPURenderer demos (Codrops, 2024-10; three.js examples).** *Borrow: the batching technique, not (yet) the renderer.* The Codrops BatchedMesh article shows how to collapse many unique-geometry static props into few draw calls — directly applicable to the ARCH RUNNER cityscape. Adopt BatchedMesh/InstancedMesh now; adopt WebGPU later (§8).

Cross-cutting lesson: **premium runners are carried by feel (camera, latency, juice, audio) and cohesion, not by realism.** ARCH RUNNER's pipeline is already past the "flat arena" bar; the remaining wins are env-map realism-for-free, character animation, instancing headroom, and an audio/feel pass.

---

## 6. Game-development psychology for an endless runner

Actionable, ethical design psychology tied directly to ARCH RUNNER's existing systems (**Flow multiplier**, **Daily Block**, **the Auditor chase**, Block Run, ARCH FLIP, Perfect Dodge). The evidence base here is genuinely mixed — several popular claims (especially "near-misses release dopamine") are contested — so this section marks what is well-supported vs. suggestive, and recommends only mechanics that respect the player.

### 6.1 The core compulsion loop (make one cycle feel complete in <1 second)

The runner loop is **trigger → action → reward → investment** (Eyal's *Hooked* model, 2014; still the standard framing in 2024–26 practitioner writing). For ARCH RUNNER one cycle is: *a hazard telegraphs (trigger) → you jump/slide/switch (action) → clear + coin + Flow tick + juice (reward) → Flow multiplier rises, raising the stakes of the next action (investment)*. 

- **Keep the loop tight.** The reward must land in the same breath as the action — this is where **juice/game-feel = perceived reward** (Jonasson & Purho, "Juice it or lose it," 2012; reinforced across the `threejs-aaa-graphics-builder` VFX guidance). A clear is already rewarded with a coin, a Flow increment and a particle burst; make sure each has an *immediate* audio + visual confirmation (§5 audio pass). Perceived generosity of a reward is driven more by feedback intensity than by the number awarded.
- **Action:** audit that *every* positive action (coin, perfect dodge, flip survive, block-run) fires VFX **and** SFX within the same frame. A silent or delayed reward breaks the loop.

### 6.2 Flow channel + difficulty balancing (ARCH RUNNER's biggest retention lever)

Csikszentmihalyi's **flow channel**: engagement lives in the narrow band where challenge rises in step with skill — too hard → anxiety/quit, too easy → boredom/quit (applied to mobile games in 2024–25 practitioner and academic write-ups, though much of that literature is thin/unverified; the classic source is primary). ARCH RUNNER already has the right instrument: **speed ramps with distance** (`SPEED_RAMP`), and `patterns.ts` respects a physics contract (`PHYS.minReactionSecs = 0.35`) so it never demands an impossible action.

- **Recommendation — a dynamic difficulty "rubber band" inside honest bounds.** The deterministic sim must stay reproducible for anti-cheat, but difficulty *selection* can be seeded per-run from the player's recent performance (still deterministic given that seed). Widen reaction windows slightly after a cluster of deaths at a given distance; tighten them during a clean streak. This keeps players in-channel without the world lying about what happened.
- **Recommendation — make the Flow multiplier the visible skill axis.** Flow (consecutive clean actions) *is* your flow-channel meter. Surface it prominently and make its growth feel earned; a reset on hit is the honest cost. This rewards mastery (a better player sustains higher Flow), which §6.6 covers.
- **Avoid:** flat difficulty, or difficulty that spikes on a timer regardless of skill — both eject players from the channel.

### 6.3 Reward schedules — variable, but honest

Variable-ratio reinforcement (Skinner) is the most engagement-dense schedule and underpins most retention design. **Use it for spectacle and bonuses, never to gate core fairness.**

- **Where it fits ethically in ARCH RUNNER:** **ARCH FLIP** is already a clean variable-reward mechanic — an *opt-in* risk/reward the player chooses, with a transparent multiplier and a banked bonus on survival. Keep it opt-in and legible. **Block Run** is a *fixed, predictable* spectacle (segment-index driven) — that predictability is good; it gives anticipation and a reliable "big score" beat. The mix of a predictable high (Block Run) and a chosen gamble (FLIP) is a healthy schedule.
- **Avoid dark patterns:** no hidden odds, no randomized paid rewards, no loss framed as "almost won" when the gap was designed. If a value is random, it should be observable (e.g., a coin that visibly tumbles away on a miss — already implemented in `render.ts`).

### 6.4 Near-miss / "almost had it" — powerful but handle with care

The near-miss effect is real but **weaker and more double-edged than pop articles claim.** The strongest primary evidence (Waterloo *Candy Crush* study, Stange/Graydon/Dixon, ~2017) found near-misses produced the **greatest urge to continue** *and* the **most frustration** and **higher arousal** than losses — i.e., the drive is partly *negative* affect. The dopamine-release explanation is contested: a 2019 review failed to reproduce the persistence effect, and fMRI cannot show neurotransmitter release (YourStory, 2026, summarizing the debate). Treat near-miss as a *tension/stakes* tool, not a compulsion dial.

- **ARCH RUNNER already uses this well and ethically:** the **near-miss → stumble beat** (`sim.nearMisses` → trip-and-recover + camera jolt + **Auditor surges to your heels**, decaying as you pull away). This is genuine, honest tension — the pursuer reacts to a real event; it *never fakes a catch or ends the run* (the code comment is explicit). Keep it exactly this honest.
- **Recommendation:** reward the near-miss with *points + Flow* (skillful cut-close), not with a fake "so close!" guilt-trip on death. Celebrate the skill, don't needle the loss.

### 6.5 Session framing — a 2–4 s establishing beat before each run

Subway Surfers opens each run with the drop-in from the guard; Temple Run with the cave escape. Psychologically this does three things: (1) **sets stakes and context** (you are fleeing, something is at risk), (2) **creates a clean "start" ritual** that mentally separates runs and lowers the friction of "one more," and (3) **primes the chase fantasy** before control begins. 

- **ARCH RUNNER has the asset for this already:** the opening **bakery cutscene** (the courier who ate the unconfirmed donut; the Auditor descends) and the `menu/cutscene.ts` / `attract.ts` systems. 
- **Recommendation:** on *every* run start (not just first launch), play a **short, skippable 2–3 s establishing beat** — the Auditor locking on, the courier bolting — then hand over control. Keep it under ~3 s and always skippable so it frames without blocking the "instant retry" (§6.7). This is cheap (assets exist) and high-value for stakes + ritual.

### 6.6 Progression & mastery (the intrinsic engine)

Intrinsic motivation (competence/autonomy, loosely Self-Determination Theory) sustains play after novelty fades. Mastery is what a *better* player does differently — and ARCH RUNNER has real skill depth: sustaining Flow, hitting **Perfect Dodges** (tight same-lane clearances), choosing when to take an **ARCH FLIP**.

- **Recommendation — make mastery visible and nameable.** Expose a personal-best and a Flow/Perfect-Dodge breakdown on the death screen so players see *what* improved. Surface "best Flow streak," "perfects this run." Competence feedback is the ethical retention driver — it rewards getting better, not just coming back.
- **Recommendation — lightweight goals that teach the ceiling** (e.g., "survive a FLIP stretch," "keep Flow above 10 for 20 s"), using the existing `achievements.ts`.

### 6.7 Loss aversion & the "one more run" effect

Loss aversion (Kahneman & Tversky) means a near-success feels like a *loss to recover*, which fuels retry — but the ethical version is **making retry frictionless and the last run legible**, not punishing or nagging.

- **Recommendation — sub-1-second restart.** The single biggest honest driver of "one more run" is that restarting is faster than deciding to stop. Ensure death → retry is near-instant (no interstitial, no forced wait). `game-feel` guidance: "restart fast enough to invite another attempt."
- **Recommendation — show the gap, don't weaponize it.** "You beat your best by 40 m" or "12 m short of your record" is honest and motivating. Avoid guilt mechanics, countdown timers to act, or anything that manufactures loss where none occurred.
- **Consider (optional, themed):** a once-per-run save that fits the fiction — a "pending-tx shield" that absorbs one hit (Subway Surfers' hoverboard logic: turns a punishing fail into an exciting near-catch). Make it earned/transparent, not a paywall.

### 6.8 Onboarding / FTUE — teach by affordance, not walls of text

Teach through **the world, not a tutorial screen**. The game already does the hard part: obstacles have **per-role silhouettes, telegraph colors, pulsing beacons, and downward "duck" teeth** (`obstacles.ts`) — these are affordances that *show* the required action.

- **Recommendation — a gentle first 10–15 s.** Start the very first run slow, with one hazard type at a time, generous spacing, and a single contextual glyph (a jump arrow over the first LOW, a slide chevron under the first HIGH) that fades after one success. No modal, no paragraph.
- **Recommendation — reinforce the color language everywhere** (HUD, menus, tutorial glyphs use the *same* red=switch / amber=jump / violet=slide mapping). Consistency is what makes the affordance learnable at speed. Anything taught by color alone also needs a shape/motion backup (`technical-art.md`) — the obstacles already do this.

### 6.9 FOMO / daily cadence — ethical only

Daily cadence drives habit, but the line between a healthy ritual and a dark pattern is whether missing a day *punishes* the player.

- **ARCH RUNNER's Daily Block (`daily.ts`) is the right shape** — a fresh deterministic seed everyone shares each day (a daily *challenge*, like Wordle), which is intrinsically motivating (compete on a level field, compare honestly) **without** a loss-based streak that punishes absence.
- **Recommendation — keep it loss-averse-free:** reward showing up (a daily leaderboard, a "today's seed" badge) but **never** reset hard-won progression or taunt a broken streak. Wordle-style daily framing (one shared puzzle, bragging rights, no punishment) is the ethical gold standard and already matches your design.
- **Avoid:** escalating streak bonuses that you *lose* by missing a day; FOMO-timed limited rewards that pressure daily logins.

### 6.10 Juice → perceived reward (the tie-back)

Everything above depends on feedback: the same clear feels twice as rewarding with a crunchy sound, a particle pop, a tick on the Flow meter, and a hair of hitstop. This is why the §5/§6 audio pass and the §2 VFX polish are *psychology* work, not just graphics — **juice is how the brain scores the reward.** Gate heavy juice (shake, flash, CA) behind the existing `reducedMotion()` so the experience stays comfortable and accessible.

**One-line summary of the ethical stance:** ARCH RUNNER's existing systems (opt-in FLIP, honest Auditor, shared Daily Block, real skill depth) are already on the right side of the ethics line. The psychology work is to *amplify the honest signals* (juice, flow visibility, stakes framing, frictionless retry, competence feedback) — not to bolt on dark patterns.

---

## 7. Prioritized revamp roadmap

Each item: **impact**, **effort**, **technique/API**, and the **codebase gap** it closes. Ordered for execution (cheap high-ROI first, then structural, then premium).

| # | Work item | Impact | Effort | Technique / API | Gap it closes |
| --- | --- | --- | --- | --- | --- |
| 1 | **Add IBL env map** | High | XS (~5 lines) | `PMREMGenerator.fromScene(new RoomEnvironment(), 0.04)` → `scene.environment`; tune `environmentIntensity` | `render.ts` sets metalness everywhere but never sets `scene.environment` → metals read flat gray. |
| 2 | **Instance the floor ticks + streaks + coins** | High (mobile) | S | `InstancedMesh` (ticks already share geo+mat) | 40 ticks / 16 streaks / 48 coins drawn as separate meshes — biggest easy draw-call win. |
| 3 | **Wire renderer diagnostics + budgets** | Med (unblocks everything) | S | `renderer.info` HUD + `inspect-threejs-canvas.mjs` | Scorecard automatic-fail: "no renderer diagnostics." No measurement exists. |
| 4 | **Batch/instance the cityscape + lamps** | High (mobile) | M | `BatchedMesh` (r168+) or `InstancedMesh` with per-instance scale on a shared box | `cityscape.ts` builds ~108 building + ~132 lamp meshes individually → draw-call blowout. |
| 5 | **Cap mobile DPR at 1.5; mobile post = bloom-only/off** | Med | XS | `setPixelRatio(min(mobile?1.5:2, dpr))`; `samples:2` or skip composer on mobile | Composer HDR targets scale DPR²; current cap is 2 for all devices. |
| 6 | **Shared material library + roughness/metalness variation + clearcoat hero accent** | Med | M | Central `MaterialLibrary`; `MeshPhysicalMaterial { clearcoat }` on hero chest/visor trim | Inline, mostly-uniform-roughness materials; roles separated by hue not surface (`technical-art.md`). |
| 7 | **Finish post: subtle vignette + event CA; fake contact shadows under coins/gates/Auditor** | Med | S/M | Vignette `ShaderPass`; RGB-split on impact; radial `CanvasTexture` plane discs | Post is bloom-only; floating coins/gates/Auditor lack grounding. |
| 8 | **Upgrade hero animation — Path A (foot IK + secondary motion + turn lean + spring blends)** | High | M | two-bone IK on existing knee joints; spring-damper on hood/pack; roll body on lane switch | `runner-rig.ts` pure `sin` gait, linear lerp blends, no IK/secondary motion — Hero scorecard ceiling. |
| 9 | **Vertex-color AO on city; anisotropy on coin/terminal textures** | Low/Med | S | `vertexColors:true` darkened cavities; `tex.anisotropy = 8` | No AO grounding on buildings; only city windows set anisotropy. |
| 10 | **Three.js bump r169 → r182–r184 (stay WebGL)** | Med | M (risk) | update deps + `three/examples/jsm` → `three/addons`; verify addon API deltas | r169 predates BatchedMesh maturity, r182 shadow overhaul, `THREE.Timer`. |
| 11 | **Switch loop clock to `THREE.Timer`** | Low/Med | XS | replace `Clock` usage; already clamps delta | background-tab delta spikes. |
| 12 | **Audio–VFX parity pass + ambient music** | Med | M | pair every `burst()`/stumble/flip/block-run with a sound; procedural/looped ambient | Reference research: feel is carried by audio; ensure full coverage (`engine/audio.ts`). |
| 13 | **UI/HUD audit vs `threejs-game-ui-designer`** | Med | M | authored clusters/meters/badges, safe-area padding, touch targets, text-fit | Check `ui.ts` for stat-card dashboard anti-pattern; verify mobile 400 px. |
| 14 | **Premium target — Path B: rigged GLB hero + Auditor (Mixamo clips, AnimationMixer, crossfades)** | High | L | GLB (Meshopt) + KTX2; one `AnimationMixer`; `crossFadeTo(…, true)`; `clampWhenFinished`; In-Place export | The top end of the Hero/enemy scorecard rows; keep Path A rig as reduced-motion fallback. |

**Suggested sequencing:** Phase 1 (a day) = items 1–3, 5, 11 — cheap, measurable, high-ROI. Phase 2 = 4, 6, 7, 9 — world/material/post polish with budgets watched. Phase 3 = 8, 12, 13 — feel. Phase 4 (optional premium) = 10 then 14. Re-score on the scorecard after Phase 2 (expect ≥2.3 "premium") and after Phase 4 (target showcase).

---

## 8. Risks / what NOT to do

1. **Do NOT migrate to WebGPURenderer right now.** WebGPU is genuinely mature in 2025–26 — Three.js has had it since **r171 (late 2024)** with automatic WebGL2 fallback, Safari 26+ (Sept 2025) supports it, and coverage is ~95% (Utsubo migration guide 2026; byteiota 2026 — *both vendor/community blogs, not official*). **But**: (a) a documented **Firefox black-screen-with-no-error** caveat exists for some setups (buildmvpfast, 2026); (b) ARCH RUNNER is **not GPU-compute-bound** — its wins are draw-call reduction and an env map, both of which WebGL2 does fine; (c) the official docs still describe WebGPU as an **explicit opt-in import** (`three/webgpu`), not the default, so "production-ready" is a community label. **Reason to wait:** risk/reward is negative for a shipping game that runs everywhere today. Revisit when you want TSL compute particles or hit a WebGL draw-call wall that batching can't solve. Keep the renderer behind your scene API so the swap stays a one-liner later.
2. **Do NOT over-post-process.** No SSAO, no DOF (except the cutscene camera), no TAA, no permanent chromatic aberration, no motion blur. Each either costs a full-screen pass for little stylized gain or **blurs/ghosts the hazards the player must read**. The current restraint (bloom-only) is a feature; add only vignette + event-driven CA. (`authoring-recipes.md`: "post is a finishing pass.")
3. **Do NOT let bloom/fog/darkness substitute for geometry.** Scorecard automatic-fail. Raise the bloom threshold so it sells *authored emissive* (visor, beacons, coins, gates), not whole surfaces. The env map (item 1) is what adds real material depth — not more glow.
4. **Do NOT GLB-ify the procedural world.** Buildings/obstacles/coins/city are better procedural (deterministic, zero-download, already authored to standard). Reserve GLB for the hero/Auditor only, and only on Path B.
5. **Do NOT break determinism.** All animation/VFX upgrades stay in the render layer, driven by `sim.ts` state. Never read wall-clock or `Math.random` into anything the sim consumes — the renderer already respects this; keep it. (`sim.ts` header is the contract.)
6. **Do NOT bump Three.js blindly.** r169 → r182+ crosses many releases; the `three/examples/jsm` → `three/addons` alias and several addon API signatures changed. Do it on a branch, re-run the canvas inspector and a full playtest on desktop + mobile Safari + Firefox before merging.
7. **Do NOT instance without preserving per-instance variation or forgetting bounds.** `InstancedMesh` wins vanish if materials differ or transforms change every frame; set `instanceMatrix.needsUpdate` once per batch and recompute bounds when transforms move materially (`technical-art.md`). Collision/gameplay stays in the sim, separate from instanced visuals.
8. **Do NOT skip the reduced-motion / low-quality fallbacks when adding juice.** Heavy shake, CA, and strobe need the existing `reducedMotion()`/`quality()` gates — the code already honors them; every new effect must too.
9. **Do NOT ship character animation as a static demo.** The scorecard requires *motion* evidence (locomotion, transitions, contact timing) — capture unpaused clips of run→jump→slide→stumble→death, not stills.

---

## Sources

Industry/tech research (prefer official docs; community blogs flagged):

- Three.js WebGPU manual (official) — https://threejs.org/manual/en/webgpurenderer.html
- Three.js version history / r186 current (Oct 2026) — https://en.wikipedia.org/wiki/Three.js ; CG World r186 (2026-09) https://cgworld.jp/flashnews/01-202610-Threejs-r186.html ; r182 (2025-12) https://cgworld.jp/flashnews/01-202512-Threejs-r182.html
- WebGPU + Three.js migration guide (2026, Utsubo — community) — https://www.utsubo.com/blog/webgpu-threejs-migration-guide ; "What's new in Three.js 2026" https://www.utsubo.com/blog/threejs-2026-what-changed
- Firefox WebGPU black-screen caveat (buildmvpfast, 2026 — community) — https://www.buildmvpfast.com/blog/threejs-webgl-to-webgpu-renderer-migration-2026
- WebGPU vs WebGL (OpenReplay, community) — https://blog.openreplay.com/webgpu-vs-webgl-industry-moving/
- BatchedMesh + WebGPURenderer (Codrops, 2024-10) — https://tympanus.net/codrops/2024/10/30/interactive-3d-with-three-js-batchedmesh-and-webgpurenderer/
- glTF best practices / Draco vs Meshopt / KTX2 (A-Frame gltf-model docs 1.7–1.8) — https://aframe.io/docs/1.8.0/components/gltf-model.html
- KTX2/Basis + Draco export guidance (Unity Asset-Transformer SDK, 2025–26) — https://docs.unity.com/en-us/asset-transformer-sdk/2026.4/manual/sdktips/export-guidelines
- Building efficient Three.js scenes / DPR + instancing (Codrops) — https://tympanus.net/codrops/?p=86572
- AnimationMixer / crossfade / Mixamo root-motion (three.js forum) — https://discourse.threejs.org/t/how-do-people-handle-animated-characters/3646 ; https://discourse.threejs.org/t/how-to-not-reset-model-position-when-crossfading-animations/27490
- Alto's Odyssey (Wikipedia; CGMagazine interview; MacStories review, 2018) — https://en.wikipedia.org/wiki/Alto%27s_Odyssey ; https://www.cgmagonline.com/interviews/interview-with-the-team-behind-altos-odyssey ; https://macstories.net/reviews/altos-odyssey-review-desert-tranquility/
- Subway Surfers vs Temple Run (Skich; TouchArcade 2012; PocketGamer) — https://skich.app/blog/subway-surfers-vs-temple-run ; https://toucharcade.com/2012/06/05/subway-surfers-review/

Game psychology (classics + recent; pop-science claims flagged in §6):

- Near-miss physiological/subjective study, *Candy Crush* (Stange et al., U. Waterloo, ~2017) — https://uwspace.uwaterloo.ca/items/bc442efc-61c5-4dca-994e-de8313592caa/full
- Near-miss effect and game rewards (Jamie Madigan, Psychology of Games) — https://www.psychologyofgames.com/2016/09/the-near-miss-effect-and-game-rewards/
- Near-miss dopamine claim contested / failed 2019 replication (YourStory, 2026) — https://yourstory.com/2026/07/slot-machines-near-miss-psychology-gambling-games
- Variable-ratio reinforcement + flow framing in F2P retention (Game Wisdom; practitioner 2026 guide) — https://game-wisdom.com/?p=32826 ; https://syncgtm.com/blog/psychologists-point-of-view-game-development-sales
- Classic primary frameworks (knowledge base, not web results): Csikszentmihalyi, *Flow* (flow channel); Skinner (variable-ratio reinforcement); Kahneman & Tversky (loss aversion); Eyal, *Hooked* (trigger–action–reward–investment, 2014); Jonasson & Purho, "Juice it or lose it" (2012).

Local skill guidance applied (with attribution):

- `~/.claude/skills/threejs-aaa-graphics-builder/references/` — `technical-art.md` (budgets, material kit, instancing/LOD), `authoring-recipes.md` (renderer/lighting/fog/post, hero-character bar), `shader-cookbook.md` (PMREM env-map prerequisite, post chain, vignette/contact-shadow/vertex-AO recipes), `visual-scorecard.md` (10-category scoring, automatic fails, measured evidence).
- `~/.claude/skills/threejs-game-director/SKILL.md` (premium bar, verification ownership, phasing).
- `~/.claude/skills/threejs-gameplay-systems/SKILL.md` (design brief, core-loop contract, game-feel).
- `~/.claude/skills/threejs-game-ui-designer/SKILL.md` (HUD states, no stat-card dashboards, touch/safe-area).
