/** Bootstrap: title → free run. Wallet / competition arrive in later phases;
 *  the game is fully playable with zero blockchain today (by design). */
import { Game } from "./game/game.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

let game: Game | null = null;

function showTitle(): void {
  overlay.innerHTML = `
    <div class="card">
      <div class="title"><span class="accent">ARCH</span> RUNNER</div>
      <div class="sub" style="margin-top:10px">RUN THE ARCH · BANK THE SATS · CHAIN YOUR FLOW</div>
      <button id="run" class="btn">RUN THE ARCH</button>
      <div class="hint">← → MOVE · ↑ / SPACE JUMP · ↓ SLIDE · SWIPE ON MOBILE · ESC PAUSE · M MUTE</div>
    </div>`;
  overlay.classList.add("show");
  (overlay.querySelector("#run") as HTMLButtonElement).onclick = () => {
    overlay.classList.remove("show");
    overlay.innerHTML = "";
    if (!game) game = new Game(canvas, hud, overlay);
    else game.restart();
  };
}

showTitle();
