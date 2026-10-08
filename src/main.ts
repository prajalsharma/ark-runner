/** Bootstrap: title → Daily Block or Free Run. Wallet / real competition arrive
 *  in later phases; the game is fully playable with zero blockchain today. */
import { Game } from "./game/game.ts";
import { dailyNumber, dailyBest, loadHistory } from "./game/daily.ts";
import { SKINS, selectedSkin, selectSkin, isUnlocked } from "./game/cosmetics.ts";
import type { Mode } from "./game/daily.ts";
import { MockWalletProvider } from "./wallet/mock.ts";
import type { WalletSession } from "./wallet/provider.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

let game: Game | null = null;
const wallet = new MockWalletProvider();
let session: WalletSession | null = null;
const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

function startGame(mode: Mode): void {
  overlay.classList.remove("show");
  overlay.innerHTML = "";
  game?.stop();
  game = new Game(canvas, hud, overlay, { mode, onMenu: showTitle });
}

function skinRow(): string {
  return `<div class="skins">` + SKINS.map((s) => {
    const unlocked = isUnlocked(s);
    const active = selectedSkin().id === s.id;
    const sw = `#${s.color.toString(16).padStart(6, "0")}`;
    return `<button class="skin${active ? " active" : ""}${unlocked ? "" : " locked"}" data-skin="${s.id}" ${unlocked ? "" : "disabled"}>
      <span class="dot" style="background:${sw}"></span>
      <span class="sn">${unlocked ? s.name : `🔒 ${(s.unlockScore).toLocaleString()}`}</span>
    </button>`;
  }).join("") + `</div>`;
}

function recentRuns(): string {
  const hist = loadHistory().slice(0, 3);
  if (!hist.length) return "";
  return `<div class="recent">` + hist.map((r) => {
    const tag = r.mode === "daily" ? "DAILY" : "FREE";
    return `<div class="run"><span>${tag}</span><span>${r.score.toLocaleString()}</span></div>`;
  }).join("") + `</div>`;
}

function showTitle(): void {
  const n = dailyNumber();
  const best = dailyBest();
  overlay.innerHTML = `
    <div class="card">
      <div class="title"><span class="accent">ARCH</span> RUNNER</div>
      <div class="sub" style="margin-top:8px">DAILY BLOCK #${n}${best ? ` · TODAY'S BEST ${best.toLocaleString()}` : ""}</div>
      <button id="daily" class="btn">RUN THE DAILY BLOCK</button>
      <button id="free" class="btn ghost">FREE RUN</button>
      ${skinRow()}
      ${recentRuns()}
      <button id="wallet" class="btn ghost small">${session ? `CONNECTED ${shortAddr(session.address)}` : "CONNECT WALLET (DEMO)"}</button>
      <div class="hint">← → MOVE · ↑/SPACE JUMP · ↓ SLIDE · SWIPE ON MOBILE · ESC PAUSE · M MUTE</div>
    </div>`;
  overlay.classList.add("show");
  (overlay.querySelector("#daily") as HTMLButtonElement).onclick = () => startGame("daily");
  (overlay.querySelector("#free") as HTMLButtonElement).onclick = () => startGame("free");
  overlay.querySelectorAll<HTMLButtonElement>(".skin").forEach((b) => {
    b.onclick = () => { selectSkin(b.dataset.skin!); showTitle(); };
  });
  (overlay.querySelector("#wallet") as HTMLButtonElement).onclick = async () => {
    if (session) { await wallet.disconnect(); session = null; } else { session = await wallet.connect(); }
    showTitle();
  };
}

showTitle();
