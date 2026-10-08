/**
 * Menu / landing experience. A live 3D attract scene runs behind a hero; the player
 * reads PLAY first, then (optionally) How It Works, Leaderboard, Runner, and connect
 * a wallet. Blockchain supports the experience; it doesn't dominate the front page.
 * All copy is plain. The wallet here is a clearly-labelled DEMO provider — honest,
 * not a faked testnet connection (docs/arch-capabilities.md: real Arch wallet pending).
 */
import { Game } from "../game/game.ts";
import { Attract } from "./attract.ts";
import { dailyNumber, dailyBest, loadHistory } from "../game/daily.ts";
import { bestEver } from "../game/cosmetics.ts";
import { CHARACTERS, selectedCharacterId, selectCharacter, selectedCharacterColor, characterSwatch } from "../game/characters.ts";
import { MockWalletProvider } from "../wallet/mock.ts";
import { detectWallets, InjectedWalletProvider, WALLET_LABEL } from "../wallet/arch.ts";
import { getProfile, createProfile, saveProfile, type PlayerProfile } from "../game/profile.ts";
import type { WalletProvider, WalletSession } from "../wallet/provider.ts";
import type { Mode } from "../game/daily.ts";

export class Menu {
  private attract = new Attract();
  private game: Game | null = null;
  private activeProvider: WalletProvider | null = null;
  private session: WalletSession | null = null;
  private profile: PlayerProfile | null = null;
  private isDemo = false;

  constructor(private canvas: HTMLCanvasElement, private hud: HTMLElement, private overlay: HTMLElement) {}

  private shortAddr(a: string): string { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

  open(): void {
    this.attract.start();
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
    this.modal("PLAYER PROFILE", `
      <div class="profgrid">
        <div><span class="pv">${p.displayName}</span><span class="pl">NAME</span></div>
        <div><span class="pv">${best.toLocaleString()}</span><span class="pl">BEST SCORE</span></div>
        <div><span class="pv">${runs}</span><span class="pl">RUNS</span></div>
        <div><span class="pv">${charName}</span><span class="pl">RUNNER</span></div>
      </div>
      <div class="lbnote">${this.shortAddr(p.walletAddress)} · ${this.isDemo ? "DEMO" : "BITCOIN TESTNET"}. Your wallet is your identity; the name is just how you appear. Stats are local to this device until the Arch backend is live.</div>`);
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
