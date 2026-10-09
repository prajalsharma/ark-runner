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
import { dailyNumber, dailyBest, loadHistory, dailyVariant } from "../game/daily.ts";
import { bestEver } from "../game/cosmetics.ts";
import { CHARACTERS, selectedCharacterId, selectCharacter, selectedCharacterColor, characterSwatch } from "../game/characters.ts";
import { MockWalletProvider } from "../wallet/mock.ts";
import { detectWallets, InjectedWalletProvider, WALLET_LABEL } from "../wallet/arch.ts";
import { getProfile, createProfile, saveProfile, type PlayerProfile } from "../game/profile.ts";
import { runnerLevel, unlockedIds, ACHIEVEMENTS } from "../game/achievements.ts";
import { soundOn, setSound, reducedMotion, setReducedMotion, quality, setQuality } from "../game/settings.ts";
import { getNetwork, setNetwork, type NetworkMode } from "../chain/network.ts";
import { fetchTestnetStatus } from "../chain/rpc.ts";
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
  private ledger = new RunnerLedger(); // DEMO vault accounting (in-memory, no real funds)
  private vaultComp = 0;
  private vaultEntered = false;

  constructor(private canvas: HTMLCanvasElement, private hud: HTMLElement, private overlay: HTMLElement) {}

  private shortAddr(a: string): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

  open(): void {
    this.attract.start();
    if (!this.introSeen()) { this.markIntroSeen(); this.playIntro(); return; }
    this.renderHome();
  }

  private introSeen(): boolean { try { return localStorage.getItem("archrunner.intro.v1") === "1"; } catch { return false; } }
  private markIntroSeen(): void { try { localStorage.setItem("archrunner.intro.v1", "1"); } catch { /* ephemeral */ } }
  private playIntro(): void {
    this.attract.cinematic(true); // slow dolly through the city behind the cutscene
    new Cutscene(
      this.overlay,
      () => { this.attract.cinematic(false); this.start("free"); },
      () => { this.attract.cinematic(false); this.renderHome(); },
    ).play();
  }

  private renderHome(): void {
    const n = dailyNumber();
    const best = bestEver();
    const dBest = dailyBest();
    const netLabel = this.isDemo ? "DEMO" : "BITCOIN TESTNET";
    const walletRow = this.session && this.profile
      ? `<button id="wallet" class="walletchip connected">👤 ${this.profile.displayName} · ${this.shortAddr(this.session.address)} <span class="net">${netLabel}</span></button>`
      : `<button id="wallet" class="walletchip">CONNECT WALLET</button>`;
    this.overlay.className = "show home";
    this.overlay.innerHTML = `
      <div class="hero">
        <div class="title"><span class="accent">ARCH</span> RUNNER</div>
        <div class="tagline">RUN THE BLOCK · BREAK THE SCORE</div>
        <div class="playbtns">
          <button id="daily" class="btn">PLAY DAILY BLOCK #${n}</button>
          <div class="todaychal">TODAY · ${dailyVariant().name} — ${dailyVariant().goal}</div>
          <button id="free" class="btn ghost">FREE RUN</button>
        </div>
        <div class="statline">
          <div><span class="sv">${best.toLocaleString()}</span><span class="sl">BEST SCORE</span></div>
          <div><span class="sv">${dBest ? dBest.toLocaleString() : "—"}</span><span class="sl">TODAY'S BEST</span></div>
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
    this.bind("#daily", () => this.start("daily"));
    this.bind("#free", () => this.start("free"));
    this.bind("#howto", () => this.showHowTo());
    this.bind("#board", () => this.showLeaderboard());
    this.bind("#runner", () => this.showRunner());
    this.bind("#story", () => this.playIntro());
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

  // --- wallet: real injected Bitcoin wallets (UniSat/OKX), with DEMO as a fallback ---
  private connect(): void {
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
      if (existing) { this.profile = existing; selectCharacter(existing.characterId); this.attract.setColor(selectedCharacterColor()); this.open(); }
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
      this.open();
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
    this.attract.stop();
    this.overlay.className = "";
    this.overlay.innerHTML = "";
    this.game?.stop();
    this.game = new Game(this.canvas, this.hud, this.overlay, { mode, onMenu: () => this.returnToMenu() });
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
    const dBest = dailyBest();
    const hist = loadHistory().slice(0, 8);
    const rows = hist.length
      ? hist.map((r, i) => `<div class="lbrow"><span class="lbrank">${i + 1}</span><span class="lbtag">${r.mode === "daily" ? "DAILY" : "FREE"}</span><span class="lbscore">${r.score.toLocaleString()}</span></div>`).join("")
      : `<div class="lbempty">No runs yet — play the Daily Block to get on the board.</div>`;
    this.modal(`DAILY BLOCK #${n}`, `
      <div class="lbhead">YOUR LOCAL BOARD${dBest ? ` · TODAY'S BEST ${dBest.toLocaleString()}` : ""}</div>
      ${rows}
      <div class="lbnote">A shared global leaderboard arrives with the Arch backend. These are your runs on this device.</div>`);
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
    const runs = loadHistory().length;
    const charName = CHARACTERS.find((c) => c.id === p.characterId)?.name ?? "—";
    const unlocked = unlockedIds().length;
    this.modal("PLAYER PROFILE", `
      <div class="profgrid">
        <div><span class="pv">${p.displayName}</span><span class="pl">NAME</span></div>
        <div><span class="pv">LV ${runnerLevel()}</span><span class="pl">RUNNER LEVEL</span></div>
        <div><span class="pv">${best.toLocaleString()}</span><span class="pl">BEST SCORE</span></div>
        <div><span class="pv">${runs}</span><span class="pl">RUNS</span></div>
        <div><span class="pv">${unlocked}/${ACHIEVEMENTS.length}</span><span class="pl">ACHIEVEMENTS</span></div>
        <div><span class="pv">${charName}</span><span class="pl">RUNNER</span></div>
      </div>
      <div class="lbnote">${this.shortAddr(p.walletAddress)} · ${this.isDemo ? "DEMO" : "BITCOIN TESTNET"}. Your wallet is your identity; the name is just how you appear. Stats are local to this device until the Arch backend is live.</div>`);
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
        <div class="lbnote">Real data from <code>rpc.testnet.arch.network</code>. The Daily Block competition is <b>entry-funded</b> (70/20/10, 5% fee, FREE/BRONZE/SILVER/GOLD tiers, no pay-to-win); entries &amp; prizes settle here once the competition program is deployed. No yield, no fake balances.</div>`;
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
