/**
 * Menu / landing experience. A live 3D attract scene runs behind a hero; the player
 * reads PLAY first, then (optionally) How It Works, Leaderboard, Runner, and connect
 * a wallet. Blockchain supports the experience; it doesn't dominate the front page.
 * All copy is plain. The wallet here is a clearly-labelled DEMO provider — honest,
 * not a faked testnet connection (docs/arch-capabilities.md: real Arch wallet pending).
 */
import { Game } from "../game/game.ts";
import { Attract } from "./attract.ts";
import { Cutscene } from "./cutscene.ts";
import { dailyNumber, dailyVariant, dailySeed, dailyMatchId } from "../game/daily.ts";
import { localStore, localBest, competitiveBest, competitiveDailyBest, competitiveProfile, DAILY_RULES } from "../game/records.ts";
import { bestEver } from "../game/cosmetics.ts";
import { CHARACTERS, selectedCharacterId, selectCharacter, selectedCharacterColor, characterSwatch } from "../game/characters.ts";
import { MockWalletProvider } from "../wallet/mock.ts";
import { detectWallets, InjectedWalletProvider, WALLET_LABEL, makeWalletSigner, toXOnlyHex } from "../wallet/arch.ts";
import { isLiveConfigured, makeClientSettlement } from "../chain/clientConfig.ts";
import type { ArchSettlementProvider } from "../chain/arch.ts";
import { getProfile, createProfile, saveProfile, type PlayerProfile } from "../game/profile.ts";
import { runnerLevel, unlockedIds, ACHIEVEMENTS } from "../game/achievements.ts";
import { soundOn, setSound, reducedMotion, setReducedMotion, quality, setQuality } from "../game/settings.ts";
import { getNetwork, setNetwork, type NetworkMode } from "../chain/network.ts";
import { fetchTestnetStatus } from "../chain/rpc.ts";
import { ARCH_DEPLOYMENT, shortId } from "../chain/deployed.ts";
import { RunnerLedger } from "../economy/ledger.ts";
import type { WalletProvider, WalletSession } from "../wallet/provider.ts";
import type { Mode } from "../game/daily.ts";

export class Menu {
  private attract = new Attract();
  private game: Game | null = null;
  private activeProvider: WalletProvider | null = null;
  private session: WalletSession | null = null;
  private profile: PlayerProfile | null = null;
  private isDemo = false;
  private afterConnect: (() => void) | null = null; // where to go after a successful connect
  private ledger = new RunnerLedger(); // DEMO vault accounting (in-memory, no real funds)
  private vaultComp = 0;
  private vaultEntered = false;

  constructor(private canvas: HTMLCanvasElement, private hud: HTMLElement, private overlay: HTMLElement) {}

  private shortAddr(a: string): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

  open(): void {
    this.attract.start();
    this.renderHome();
  }

  /** STORY button → the full narrative cutscene (the bakery heist). Returns to home when
   *  it ends or is skipped — this is for watching, not for starting a run. */
  private playStory(): void {
    this.attract.start();
    const back = (): void => { this.attract.repaint(); this.renderHome(); };
    new Cutscene(this.attract, this.overlay, back, back, "story").play();
  }

  private renderHome(): void {
    const n = dailyNumber();
    const localB = localBest(); // free-run practice best (local, device-only)
    const connected = !!(this.session && this.profile);
    // Competitive "today's best" belongs to the VERIFIED wallet — never free-run data.
    const dBest = connected ? competitiveDailyBest(this.session!.address) : 0;
    const netLabel = this.isDemo ? "DEMO" : "BITCOIN TESTNET";
    const walletRow = connected
      ? `<button id="wallet" class="walletchip connected">👤 ${this.profile!.displayName} · ${this.shortAddr(this.session!.address)} <span class="net">${netLabel}</span></button>`
      : `<button id="wallet" class="walletchip">CONNECT WALLET</button>`;
    this.overlay.className = "show home";
    this.overlay.innerHTML = `
      <div class="hero">
        <div class="title stacked"><span class="accent">ARCH</span><span class="word">RUNNER</span></div>
        <div class="tagline">RUN THE BLOCK · BREAK THE SCORE</div>
        <div class="playbtns">
          <button id="daily" class="btn">DAILY BLOCK #${n}${connected ? "" : " 🔒"}</button>
          <div class="todaychal">TODAY · ${dailyVariant().name} — ${dailyVariant().goal}${connected ? "" : " · wallet required"}</div>
          <button id="free" class="btn ghost">FREE RUN</button>
        </div>
        <div class="statline">
          <div><span class="sv">${localB ? localB.toLocaleString() : "—"}</span><span class="sl">FREE-RUN BEST</span></div>
          <div><span class="sv">${connected && dBest ? dBest.toLocaleString() : "—"}</span><span class="sl">DAILY BEST${connected ? "" : " · 🔒"}</span></div>
        </div>
        <div class="nav">
          <button id="howto" class="navbtn">HOW IT WORKS</button>
          <button id="board" class="navbtn">LEADERBOARD</button>
          <button id="runner" class="navbtn">RUNNER</button>
          <button id="story" class="navbtn">STORY</button>
          <button id="economy" class="navbtn">ARCH NET</button>
          <button id="vault" class="navbtn">VAULT</button>
          <button id="settings" class="navbtn">SETTINGS</button>
          ${this.profile ? `<button id="profile" class="navbtn">PROFILE</button>` : ""}
        </div>
        ${walletRow}
        <div class="footnote">Skill-based. Free to play. Competitions settle on <b>Arch</b> (Bitcoin-native).</div>
      </div>`;
    this.bind("#daily", () => this.openDailyBlock());
    this.bind("#free", () => this.start("free"));
    this.bind("#howto", () => this.showHowTo());
    this.bind("#board", () => this.showLeaderboard());
    this.bind("#runner", () => this.showRunner());
    this.bind("#story", () => this.playStory());
    this.bind("#economy", () => this.showEconomy());
    this.bind("#vault", () => this.showVault());
    this.bind("#settings", () => this.showSettings());
    this.bind("#profile", () => this.showProfile());
    this.bind("#wallet", () => (this.session ? this.disconnect() : this.connect()));
  }

  private bind(sel: string, fn: () => void): void {
    const el = this.overlay.querySelector(sel) as HTMLButtonElement | null;
    if (el) el.onclick = fn;
  }

  // --- Daily Block is WALLET-GATED: connect → briefing → play (Free Run never gates) ---
  private openDailyBlock(): void {
    if (this.session && this.profile) { this.showDailyBrief(); return; }
    this.overlay.className = "show";
    this.overlay.innerHTML = `
      <div class="card modal">
        <div class="eyebrow">DAILY BLOCK · WALLET REQUIRED</div>
        <div class="lbnote" style="margin:0 0 16px">Connect your Bitcoin wallet to enter Daily Block, save your competitive progress and verify your player identity. <b>Free Run</b> is always open and needs no wallet.</div>
        <button id="connect" class="btn">CONNECT WALLET</button>
        <button id="back" class="btn ghost">BACK</button>
      </div>`;
    this.bind("#connect", () => this.connect(() => this.showDailyBrief()));
    this.bind("#back", () => this.open());
  }

  private showDailyBrief(): void {
    if (!this.session || !this.profile) return this.openDailyBlock();
    const n = dailyNumber();
    const v = dailyVariant();
    const addr = this.session.address;
    const best = competitiveBest(addr);
    const today = competitiveDailyBest(addr);
    const seedHex = (dailySeed() >>> 0).toString(16).padStart(8, "0").slice(0, 6);
    this.overlay.className = "show";
    this.overlay.innerHTML = `
      <div class="card modal">
        <div class="eyebrow">DAILY BLOCK #${n}</div>
        <div class="dbhead">${v.name}</div>
        <div class="lbnote" style="margin:4px 0 12px">${v.goal} · everyone runs the <b>same</b> course today (one shared seed) — pure skill. Play any time in the window; scores are compared after.</div>
        <div class="profgrid">
          <div><span class="pv">${this.shortAddr(addr)}</span><span class="pl">PLAYER</span></div>
          <div><span class="pv">${best ? best.toLocaleString() : "—"}</span><span class="pl">YOUR COMP BEST</span></div>
          <div><span class="pv">${today ? today.toLocaleString() : "—"}</span><span class="pl">TODAY'S BEST</span></div>
          <div><span class="pv">#${seedHex}</span><span class="pl">SEED · ${DAILY_RULES.physicsVersion.replace("ARCHRUN_", "")}</span></div>
        </div>
        ${this.entryBoxHtml()}
        <button id="enter" class="btn">${this.liveEntryAvailable() ? "ENTER · PAY ENTRY ON-CHAIN" : "ENTER THE DAILY BLOCK"}</button>
        <button id="back" class="btn ghost">BACK</button>
      </div>`;
    this.bind("#enter", () => (this.liveEntryAvailable() ? this.enterDailyOnChain() : this.start("daily")));
    this.bind("#back", () => this.open());
  }

  /** Live on-chain entry is offered ONLY when a settlement service is configured AND the player
   *  connected a real (non-DEMO) Bitcoin wallet. Otherwise the Daily Block stays free/DEMO. */
  private liveEntryAvailable(): boolean {
    return isLiveConfigured() && !!this.session && !!this.profile && !this.isDemo;
  }

  private entryBoxHtml(): string {
    if (this.liveEntryAvailable()) {
      return `
        <div class="entrybox">
          <div class="entryrow"><span class="entrylabel">ENTRY</span><span class="entryval">ON-CHAIN · <b>Arch testnet</b></span></div>
          <div class="entrynote">You pay the entry with <b>your own wallet</b> — you sign a <code>JoinMatch</code> transaction that escrows the entry token into today's match vault. The settlement authority key never touches your browser. Prizes pay out 70/20/10 after the window. Testnet only — no real-money value.</div>
        </div>`;
    }
    return `
        <div class="entrybox">
          <div class="entryrow"><span class="entrylabel">ENTRY</span><span class="entryval">FREE · <span class="demotag">DEMO</span></span></div>
          <div class="entrynote">The escrow program is <b>deployed &amp; E2E-verified on Arch testnet</b> (see ARCH NET), but in-game entries/prizes still run in <b>DEMO</b> until the settlement service is live. Your run is saved to <b>your wallet's</b> competitive history, provisional until the server validator runs. No real funds move.</div>
        </div>`;
  }

  /** Player-signed on-chain entry: build + wallet-sign + submit a real JoinMatch, with truthful
   *  pending/confirmed/failed states. Only ever reached when liveEntryAvailable() is true. */
  private async enterDailyOnChain(): Promise<void> {
    if (!this.session || !this.activeProvider || this.isDemo) return this.start("daily");
    const info = (title: string, body: string, buttons = ""): void => {
      this.overlay.className = "show";
      this.overlay.innerHTML = `<div class="card modal"><div class="eyebrow">${title}</div><div class="lbnote">${body}</div>${buttons}</div>`;
    };
    let playerX: string;
    try { playerX = toXOnlyHex(this.session.pubkey); }
    catch { info("ENTRY", "Your wallet did not expose a Taproot public key. Connect a Taproot (BIP-86) address to enter on-chain, or play Free Run."); this.bind("#back", () => this.showDailyBrief()); return; }

    const matchId = dailyMatchId().toString();
    const signer = makeWalletSigner(this.activeProvider, this.session);
    const provider = makeClientSettlement(signer) as ArchSettlementProvider;

    info("ENTERING…", "Checking today's match on-chain…");
    try {
      const pool = await provider.pool(matchId).catch(() => null);
      if (!pool) { info("NOT OPEN YET", "Today's on-chain match hasn't been created yet (the settlement service opens it at day roll-over). Try again shortly, or play Free Run.", `<button id="back" class="btn">BACK</button>`); this.bind("#back", () => this.showDailyBrief()); return; }
      if (pool.settled) { info("ALREADY SETTLED", "Today's match is already settled — come back for the next Daily Block.", `<button id="back" class="btn">BACK</button>`); this.bind("#back", () => this.showDailyBrief()); return; }
      const bal = await provider.balanceOf(playerX).catch(() => 0n);
      if (bal <= 0n) { info("NO ENTRY TOKEN", "You don't hold the Daily Block entry token in this wallet yet. Get the entry token, then enter.", `<button id="back" class="btn">BACK</button>`); this.bind("#back", () => this.showDailyBrief()); return; }

      info("CONFIRM IN WALLET…", "Approve the <b>JoinMatch</b> signature in your wallet. This escrows your entry token into today's match vault.");
      await provider.collectEntry(matchId, playerX, bal); // throws unless the tx confirms (Processed)
      info("ENTRY CONFIRMED ✓", "Your entry is escrowed on-chain. Good luck — run the block!", `<button id="go" class="btn">RUN</button>`);
      this.bind("#go", () => this.start("daily"));
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      const friendly = /cancel|reject|denied/i.test(msg) ? "You cancelled the signature." : msg;
      info("ENTRY NOT CONFIRMED", `No funds moved. ${friendly}`, `<button id="retry" class="btn">TRY AGAIN</button><button id="back" class="btn ghost">BACK</button>`);
      this.bind("#retry", () => this.enterDailyOnChain());
      this.bind("#back", () => this.showDailyBrief());
    }
  }

  private postConnect(): void {
    const after = this.afterConnect; this.afterConnect = null;
    if (after) after(); else this.open();
  }

  // --- wallet: real injected Bitcoin wallets (UniSat/OKX), with DEMO as a fallback ---
  private connect(after?: () => void): void {
    this.afterConnect = after ?? null;
    const installed = detectWallets();
    const realBtns = installed
      .map((k) => `<button class="btn walletpick" data-kind="${k}">${WALLET_LABEL[k]}${k === "xverse" || k === "leather" ? " (soon)" : ""}</button>`)
      .join("");
    const noneMsg = installed.length ? "" : `<div class="lbnote">No Bitcoin wallet detected. Install <b>UniSat</b> or <b>OKX</b> to connect for real, or continue in DEMO mode to try everything now.</div>`;
    this.modal("CONNECT WALLET", `
      <div class="lbnote" style="margin:0 0 12px">Connect a Bitcoin (Taproot) wallet — this is your identity. Connecting and signing are real; on-chain settlement is still in DEMO until the Arch program is deployed.</div>
      ${realBtns}
      ${noneMsg}
      <button class="btn ghost walletpick" data-kind="demo" style="margin-top:12px">CONTINUE IN DEMO</button>`);
    this.overlay.querySelectorAll<HTMLButtonElement>(".walletpick").forEach((b) => {
      const kind = b.dataset.kind!;
      b.onclick = () => {
        if (kind === "demo") this.connectWith(new MockWalletProvider(), true);
        else this.connectWith(new InjectedWalletProvider(kind as "unisat" | "okx" | "xverse" | "leather"), false);
      };
    });
  }

  private async connectWith(provider: WalletProvider, isDemo: boolean): Promise<void> {
    this.overlay.className = "show";
    this.overlay.innerHTML = `<div class="card modal"><div class="eyebrow">CONNECTING…</div><div class="lbnote">${isDemo ? "Starting a DEMO session — no wallet needed." : "Approve the connection in your wallet extension."}</div></div>`;
    try {
      const session = await provider.connect();
      this.activeProvider = provider;
      this.session = session;
      this.isDemo = isDemo;
      const existing = getProfile(session.address);
      if (existing) { this.profile = existing; selectCharacter(existing.characterId); this.attract.setColor(selectedCharacterColor()); this.postConnect(); }
      else this.askName(session);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      const friendly = /cancel|reject|denied/i.test(msg) ? "Connection cancelled." : /not found|no-window/i.test(msg) ? "Wallet not found — is the extension installed and unlocked?" : msg;
      this.modal("WALLET", `<div class="lbnote">${friendly}</div><button id="retry" class="btn">TRY AGAIN</button>`);
      this.bind("#retry", () => this.connect());
    }
  }

  private askName(session: WalletSession): void {
    this.overlay.className = "show";
    this.overlay.innerHTML = `
      <div class="card modal">
        <div class="eyebrow">WELCOME TO ARCH RUNNER</div>
        <div class="lbnote" style="margin:0 0 12px">${this.shortAddr(session.address)} · ${this.isDemo ? "DEMO" : "BITCOIN TESTNET"}<br>What should we call you?</div>
        <input id="name" class="nameinput" maxlength="20" placeholder="RUNNER NAME" autocomplete="off" />
        <button id="enter" class="btn">ENTER THE CITY</button>
      </div>`;
    const input = this.overlay.querySelector("#name") as HTMLInputElement;
    input.focus();
    const submit = () => {
      this.profile = createProfile(session.address, input.value || "RUNNER", selectedCharacterId());
      this.postConnect();
    };
    this.bind("#enter", submit);
    input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  }

  private async disconnect(): Promise<void> {
    try { await this.activeProvider?.disconnect(); } catch { /* best effort */ }
    this.activeProvider = null; this.session = null; this.profile = null; this.isDemo = false;
    this.open();
  }

  private start(mode: Mode): void {
    // Daily Block cannot start without a verified wallet — route back through the gate.
    if (mode === "daily" && !(this.session && this.profile)) { this.openDailyBlock(); return; }
    // Every run opens with a quick ~4.5s visual establish (the chase premise), then hands
    // over control. Skippable. Also used by RUN AGAIN (via onReplay), the way Subway/Temple
    // Run drop you into the chase each time rather than dumping you into the game cold.
    this.game?.stop(); this.game = null; // stop() clears the old result card + disposes it
    this.attract.start();
    this.overlay.className = ""; this.overlay.innerHTML = "";
    const go = (): void => this.handoffToGame(mode);
    new Cutscene(this.attract, this.overlay, go, go, "quick").play();
  }

  /** Smooth the cutscene→game cut: fade through black while the new game context spins up
   *  and the scrolling world resets, then reveal — no hard swap / world-snap flash. */
  private handoffToGame(mode: Mode): void {
    const fade = this.fadeVeil();
    fade.style.opacity = "1";
    window.setTimeout(() => {
      this.launch(mode);
      window.setTimeout(() => { fade.style.opacity = "0"; }, 600); // let the game render a few frames
    }, 280);
  }

  private fadeVeil(): HTMLElement {
    let el = document.getElementById("fadeveil");
    if (!el) { el = document.createElement("div"); el.id = "fadeveil"; (document.getElementById("app") ?? document.body).appendChild(el); }
    return el;
  }

  private launch(mode: Mode): void {
    this.attract.stop();
    this.overlay.className = "";
    this.overlay.innerHTML = "";
    this.game?.stop();
    // A disposed renderer calls forceContextLoss(), after which the canvas can NEVER get a
    // fresh WebGL context again. So hand each new run a brand-new canvas (the old one is
    // removed + GC'd, freeing its context). This fixes the second-run "precision" crash /
    // black screen when starting Free Run then Daily Block (or restarting via the menu).
    this.canvas = this.freshGameCanvas();
    const comp = mode === "daily" && this.session ? { address: this.session.address } : null;
    this.game = new Game(this.canvas, this.hud, this.overlay, { mode, comp, onMenu: () => this.returnToMenu(), onReplay: () => this.start(mode) });
  }

  /** Swap the #scene canvas for a fresh one in the same DOM slot (same id/class/styles). */
  private freshGameCanvas(): HTMLCanvasElement {
    const old = this.canvas;
    const next = document.createElement("canvas");
    next.id = old.id; next.className = old.className;
    old.parentElement?.insertBefore(next, old);
    old.remove();
    return next;
  }

  private returnToMenu(): void {
    this.game?.stop();
    this.game = null;
    this.open();
  }

  private showHowTo(): void {
    const cards: Array<[string, string]> = [
      ["PERFECT", "Clear a hazard at the last instant — a <b>Perfect</b>. It pays bonus points and builds your Flow."],
      ["ARCH FLOW", "Flow is your momentum multiplier (×1 → ×4). Perfect dodges, close calls and coins build it; a hit ends the run and resets it. Higher Flow = every point worth more."],
      ["ARCH FLIP", "A glowing gate marks the risky lane. Take it to enter a harder stretch at <b>×3 score</b> — survive and bank a big bonus, fail and you lose it. Safe lanes are always open."],
      ["COINS", "🪙 Coins are collectibles that add to your score. Your coin count and your score are shown separately — grab trails of coins to climb faster."],
      ["BLOCK RUN", "Every so often the city speeds up into a <b>Block Run</b>: denser hazards, more coins, and ×2 score. Ride it for a huge chunk of points."],
      ["DAILY BLOCK", "Everyone plays the <b>same</b> course each day (one shared seed). Same conditions for all — your score is pure skill. Your rank is how you compare."],
      ["COMPETITION & ARCH", "No need to be online together: play your run any time in the window, then scores are compared. Connect a wallet to join Arch-powered competitions and rewards."],
    ];
    this.modal("HOW IT WORKS", `<div class="cards">${cards.map(([t, b]) => `<div class="htc"><div class="htt">${t}</div><div class="htb">${b}</div></div>`).join("")}</div>`);
  }

  private showLeaderboard(): void {
    const n = dailyNumber();
    const connected = !!(this.session && this.profile);
    // Competitive board = the VERIFIED wallet's accepted Daily Block runs only.
    const comp = connected ? competitiveProfile(this.session!.address) : null;
    const accepted = (comp?.history ?? []).filter((h) => h.status === "ACCEPTED").slice(0, 8);
    const compRows = !connected
      ? `<div class="lbempty">🔒 Connect your wallet to compete in Daily Block and build a competitive record.</div>`
      : accepted.length
        ? accepted.map((r, i) => `<div class="lbrow"><span class="lbrank">${i + 1}</span><span class="lbtag">#${dailyNumber(r.dateKey)}</span><span class="lbscore">${r.score.toLocaleString()}</span></div>`).join("")
        : `<div class="lbempty">No Daily Block runs yet — enter today's block to get on the board.</div>`;
    // Free-run practice board = local, device-only, never competitive.
    const freeHist = localStore().history.slice(0, 5);
    const freeRows = freeHist.length
      ? freeHist.map((r) => `<div class="lbrow free"><span class="lbtag">FREE</span><span class="lbscore">${r.score.toLocaleString()}</span></div>`).join("")
      : `<div class="lbempty small">No free runs yet.</div>`;
    this.modal(`DAILY BLOCK #${n}`, `
      <div class="lbhead">COMPETITIVE BOARD${connected ? ` · YOU ${competitiveDailyBest(this.session!.address) ? competitiveDailyBest(this.session!.address).toLocaleString() : "—"}` : ""}</div>
      ${compRows}
      <div class="lbhead" style="margin-top:14px">FREE-RUN PRACTICE · local</div>
      ${freeRows}
      <div class="lbnote">Competitive runs are tied to your wallet and marked provisional until the Arch server validator is live. Free-run practice is local only and never counts toward the competition.</div>`);
  }

  private showRunner(): void {
    const body = `<div class="charsel">${CHARACTERS.map((ch) => {
      const active = selectedCharacterId() === ch.id;
      const sw = `#${characterSwatch(ch.id).toString(16).padStart(6, "0")}`;
      return `<button class="charcard${active ? " active" : ""}" data-char="${ch.id}">
        <span class="chdot" style="background:${sw};box-shadow:0 0 16px ${sw}"></span>
        <span class="chname">${ch.name}</span>
        ${active ? `<span class="chsel">SELECTED</span>` : ""}
      </button>`;
    }).join("")}</div><div class="lbnote">Runners are cosmetic only — identical speed, jump, hitbox and scoring. The live preview behind this panel shows your pick.</div>`;
    this.modal("CHOOSE YOUR RUNNER", body);
    this.overlay.querySelectorAll<HTMLButtonElement>(".charcard").forEach((b) => {
      b.onclick = () => {
        selectCharacter(b.dataset.char!);
        this.attract.setColor(selectedCharacterColor());
        if (this.session && this.profile) { this.profile.characterId = selectedCharacterId(); saveProfile(this.profile); }
        this.showRunner();
      };
    });
  }

  private showProfile(): void {
    const p = this.profile;
    if (!p) return this.open();
    const best = bestEver();
    const compRuns = this.session ? competitiveProfile(this.session.address).history.filter((h) => h.status === "ACCEPTED").length : 0;
    const runs = localStore().runs + compRuns;
    const charName = CHARACTERS.find((c) => c.id === p.characterId)?.name ?? "—";
    const have = new Set(unlockedIds());
    const unlocked = have.size;
    // Real achievements gallery — every "UNLOCKED — X" badge from the result card has a
    // home here: earned ones lit, the rest shown locked so you know what's left to chase.
    const badges = ACHIEVEMENTS.map((a) => {
      const got = have.has(a.id);
      return `<div class="badge ${got ? "got" : "locked"}"><span class="bt">${got ? "★" : "✦"} ${a.title}</span><span class="bd">${a.desc}</span></div>`;
    }).join("");
    this.modal("PLAYER PROFILE", `
      <div class="profgrid">
        <div><span class="pv">${p.displayName}</span><span class="pl">NAME</span></div>
        <div><span class="pv">LV ${runnerLevel()}</span><span class="pl">RUNNER LEVEL</span></div>
        <div><span class="pv">${best.toLocaleString()}</span><span class="pl">BEST SCORE</span></div>
        <div><span class="pv">${runs}</span><span class="pl">RUNS</span></div>
        <div><span class="pv">${unlocked}/${ACHIEVEMENTS.length}</span><span class="pl">ACHIEVEMENTS</span></div>
        <div><span class="pv">${charName}</span><span class="pl">RUNNER</span></div>
      </div>
      <div class="plabel">ACHIEVEMENTS</div>
      <div class="badges">${badges}</div>
      <div class="lbnote">${this.shortAddr(p.walletAddress)} · ${this.isDemo ? "DEMO" : "BITCOIN TESTNET"}. Achievements are milestone badges (no gameplay boost) saved on this device. Skins unlock by best score — set yours in RUNNER. Stats move on-chain once the Arch backend is live.</div>`);
  }

  private showEconomy(): void {
    const net = getNetwork();
    const toggle = `<div class="nettoggle">
      <button class="netbtn ${net === "testnet" ? "on" : ""}" data-net="testnet">TESTNET</button>
      <button class="netbtn ${net === "mainnet" ? "on" : ""}" data-net="mainnet">MAINNET</button>
    </div>`;
    const body = net === "mainnet"
      ? `${toggle}<div class="netempty">MAINNET — NOT LIVE<div class="sub">Nothing runs on mainnet yet. Switch to <b>Testnet</b> for live on-chain data.</div></div>`
      : `${toggle}
        <div class="livebadge"><span class="dot"></span> LIVE · ARCH TESTNET</div>
        <div class="profgrid" id="livegrid">
          <div><span class="pv" id="pv-block">…</span><span class="pl">BLOCK HEIGHT</span></div>
          <div><span class="pv" id="pv-node">…</span><span class="pl">NODE</span></div>
          <div><span class="pv" id="pv-hash">…</span><span class="pl">BEST BLOCK</span></div>
          <div><span class="pv" id="pv-rpc">…</span><span class="pl">RPC LATENCY</span></div>
        </div>
        <div class="plabel">COMPETITION PROGRAM · ✓ DEPLOYED</div>
        <div class="profgrid">
          <div><span class="pv">${shortId(ARCH_DEPLOYMENT.programId)}</span><span class="pl">PROGRAM ID</span></div>
          <div><span class="pv">${shortId(ARCH_DEPLOYMENT.entryMint)}</span><span class="pl">ENTRY TOKEN (APL)</span></div>
          <div><span class="pv">${ARCH_DEPLOYMENT.split}</span><span class="pl">PRIZE SPLIT</span></div>
          <div><span class="pv">E2E ✓</span><span class="pl">ON-CHAIN VERIFIED</span></div>
        </div>
        <div class="lbnote">The escrow/competition program is <b>deployed and E2E-verified on Arch testnet</b> — a real deposit→settle match ran on-chain with exact 70/20/10 payouts and the double-settle guard held (full tx list in <code>docs/DEPLOYMENT_RESULT.md</code>). Entry-funded, 0% fee, no yield, no fake balances. In-game entries/prizes still run in <b>DEMO</b> until the settlement service (which holds the authority key server-side — never in your browser) is live.</div>`;
    this.modal("ARCH NETWORK", body);
    this.overlay.querySelectorAll<HTMLButtonElement>(".netbtn").forEach((b) => {
      b.onclick = () => { setNetwork(b.dataset.net as NetworkMode); this.showEconomy(); };
    });
    if (net === "testnet") this.loadTestnet();
  }

  private loadTestnet(): void {
    const set = (id: string, v: string): void => { const el = this.overlay.querySelector(id); if (el) el.textContent = v; };
    fetchTestnetStatus().then((s) => {
      set("#pv-block", s.blockCount.toLocaleString());
      set("#pv-node", s.nodeReady ? "READY ✓" : "SYNCING");
      set("#pv-hash", `${s.bestHash.slice(0, 6)}…${s.bestHash.slice(-4)}`);
      set("#pv-rpc", `${s.latencyMs} ms`);
    }).catch(() => {
      const grid = this.overlay.querySelector("#livegrid");
      if (grid) grid.innerHTML = `<div class="netempty small">Testnet unreachable right now — try again shortly.</div>`;
    });
  }

  private showVault(): void {
    const me = "me";
    const comp = `demo-${this.vaultComp}`;
    const bal = this.ledger.balanceOf(me);
    const pool = this.ledger.prizePool(comp);
    const v = this.ledger.view();
    const n = (b: bigint): string => Number(b).toLocaleString();
    const canEnter = bal >= 2_000n && !this.vaultEntered;
    const canSettle = pool > 0n;
    this.modal("RUNNER VAULT · DEMO", `
      <div class="lbnote" style="margin:0 0 10px"><b>DEMO · no real funds.</b> This drives the real four-bucket accounting (<code>RunnerLedger</code>): your vault stays yours, entries fund the prize pool, winnings return to your vault. Solvency is enforced. On testnet this settles via Arch once the program is deployed.</div>
      <div class="profgrid">
        <div><span class="pv">${n(bal)}</span><span class="pl">YOUR VAULT · sats</span></div>
        <div><span class="pv">${n(pool)}</span><span class="pl">PRIZE POOL</span></div>
        <div><span class="pv">${n(v.reserve)}</span><span class="pl">RESERVE</span></div>
        <div><span class="pv">${n(v.protocolRevenue)}</span><span class="pl">PROTOCOL FEE</span></div>
      </div>
      <div class="vaultbtns">
        <button id="vd" class="btn ghost small">+10,000 (DEMO FAUCET)</button>
        <button id="ve" class="btn ghost small" ${canEnter ? "" : "disabled"}>ENTER DAILY BLOCK · 2,000</button>
        <button id="vs" class="btn ghost small" ${canSettle ? "" : "disabled"}>WIN &amp; SETTLE (DEMO)</button>
        <button id="vw" class="btn ghost small" ${bal > 0n ? "" : "disabled"}>WITHDRAW ALL</button>
      </div>
      <div class="lbnote" style="color:#3ad17a">✓ SOLVENT — buckets (${n(v.principalTotal + v.prizeTotal + v.reserve + v.protocolRevenue)}) = assets held (${n(v.assets)}). No invented money, no yield.</div>`);
    const act = (fn: () => void): void => { try { fn(); this.ledger.assertSolvent(); } catch { /* guard */ } this.showVault(); };
    this.bind("#vd", () => act(() => this.ledger.deposit(me, 10_000n)));
    this.bind("#ve", () => act(() => { this.ledger.enter(comp, me, 2_000n, { feeRateBps: 500, reserveBps: 1000 }); this.vaultEntered = true; }));
    this.bind("#vs", () => act(() => { this.ledger.settle(comp, [{ user: me, amount: this.ledger.prizePool(comp) }]); this.vaultComp++; this.vaultEntered = false; }));
    this.bind("#vw", () => act(() => this.ledger.withdraw(me, this.ledger.balanceOf(me))));
  }

  private showSettings(): void {
    const row = (label: string, state: string, id: string): string =>
      `<div class="setrow"><span>${label}</span><button class="settoggle" data-set="${id}">${state}</button></div>`;
    this.modal("SETTINGS", `
      ${row("SOUND", soundOn() ? "ON" : "OFF", "sound")}
      ${row("REDUCED MOTION", reducedMotion() ? "ON" : "OFF", "motion")}
      ${row("GRAPHICS", quality() === "high" ? "HIGH" : "LOW", "quality")}
      <div class="lbnote">Motion & graphics apply on your next run. (In-run: M mutes, Esc pauses, F3 debug.)</div>`);
    this.overlay.querySelectorAll<HTMLButtonElement>(".settoggle").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.set;
        if (id === "sound") setSound(!soundOn());
        else if (id === "motion") setReducedMotion(!reducedMotion());
        else if (id === "quality") setQuality(quality() === "high" ? "low" : "high");
        this.showSettings();
      };
    });
  }

  private modal(title: string, bodyHtml: string): void {
    this.overlay.className = "show";
    this.overlay.innerHTML = `
      <div class="card modal">
        <div class="eyebrow">${title}</div>
        ${bodyHtml}
        <button id="back" class="btn">BACK</button>
      </div>`;
    this.bind("#back", () => this.open());
  }
}
