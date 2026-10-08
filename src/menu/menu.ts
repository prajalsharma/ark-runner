/**
 * Menu / landing experience. A live 3D attract scene runs behind a hero; the player
 * reads PLAY first, then (optionally) How It Works, Leaderboard, Runner. Blockchain
 * supports the experience, it doesn't dominate the front page. All copy is plain —
 * a non-crypto player should understand it in under a minute.
 */
import { Game } from "../game/game.ts";
import { Attract } from "./attract.ts";
import { dailyNumber, dailyBest, loadHistory } from "../game/daily.ts";
import { SKINS, selectedSkin, selectSkin, isUnlocked } from "../game/cosmetics.ts";
import { bestEver } from "../game/cosmetics.ts";
import type { Mode } from "../game/daily.ts";

export class Menu {
  private attract = new Attract();
  private game: Game | null = null;

  constructor(private canvas: HTMLCanvasElement, private hud: HTMLElement, private overlay: HTMLElement) {}

  open(): void {
    this.attract.start();
    const n = dailyNumber();
    const best = bestEver();
    const dBest = dailyBest();
    this.overlay.className = "show home";
    this.overlay.innerHTML = `
      <div class="hero">
        <div class="title"><span class="accent">ARCH</span> RUNNER</div>
        <div class="tagline">RUN THE BLOCK · MASTER THE FLOW</div>
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
        </div>
        <div class="footnote">Skill-based. Free to play. Competitions settle on <b>Arch</b> (Bitcoin-native).</div>
      </div>`;
    this.bind("#daily", () => this.start("daily"));
    this.bind("#free", () => this.start("free"));
    this.bind("#howto", () => this.showHowTo());
    this.bind("#board", () => this.showLeaderboard());
    this.bind("#runner", () => this.showRunner());
  }

  private bind(sel: string, fn: () => void): void {
    const el = this.overlay.querySelector(sel) as HTMLButtonElement | null;
    if (el) el.onclick = fn;
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
    const body = `<div class="skins big">${SKINS.map((s) => {
      const unlocked = isUnlocked(s), active = selectedSkin().id === s.id;
      const sw = `#${s.color.toString(16).padStart(6, "0")}`;
      return `<button class="skin${active ? " active" : ""}${unlocked ? "" : " locked"}" data-skin="${s.id}" ${unlocked ? "" : "disabled"}>
        <span class="dot" style="background:${sw}"></span>
        <span class="sn">${unlocked ? s.name : `🔒 ${s.unlockScore.toLocaleString()}`}</span></button>`;
    }).join("")}</div><div class="lbnote">Runners are cosmetic only — they never change your score.</div>`;
    this.modal("CHOOSE YOUR RUNNER", body);
    this.overlay.querySelectorAll<HTMLButtonElement>(".skin").forEach((b) => {
      b.onclick = () => { selectSkin(b.dataset.skin!); this.showRunner(); };
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
