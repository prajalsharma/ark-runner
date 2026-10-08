/** Maps keyboard + touch-swipe to the four run actions. One hand on mobile. */
import type { Action } from "../game/sim.ts";

export function attachInput(onAction: (a: Action) => void): () => void {
  const key = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowLeft": case "a": case "A": onAction("left"); break;
      case "ArrowRight": case "d": case "D": onAction("right"); break;
      case "ArrowUp": case "w": case "W": case " ": onAction("jump"); e.preventDefault(); break;
      case "ArrowDown": case "s": case "S": onAction("slide"); break;
    }
  };
  let sx = 0, sy = 0, st = 0;
  const ts = (e: TouchEvent) => { const t = e.changedTouches[0]!; sx = t.clientX; sy = t.clientY; st = Date.now(); };
  const te = (e: TouchEvent) => {
    const t = e.changedTouches[0]!;
    if (Date.now() - st > 600) return;
    const dx = t.clientX - sx, dy = t.clientY - sy, ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 24) return; // a tap, not a swipe
    if (ax > ay) onAction(dx > 0 ? "right" : "left");
    else onAction(dy > 0 ? "slide" : "jump");
  };
  window.addEventListener("keydown", key);
  window.addEventListener("touchstart", ts, { passive: true });
  window.addEventListener("touchend", te, { passive: true });
  return () => {
    window.removeEventListener("keydown", key);
    window.removeEventListener("touchstart", ts);
    window.removeEventListener("touchend", te);
  };
}
