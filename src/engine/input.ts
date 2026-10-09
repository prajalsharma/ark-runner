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
  // Swipes fire the INSTANT the threshold is crossed during the move (touchmove), not on
  // finger-lift (touchend) — waiting for release was the perceived input lag. `fired` makes
  // it one action per gesture; touchend is only a fallback for a swipe that never moved.
  const THRESH = 20;
  let sx = 0, sy = 0, st = 0, fired = false;
  const resolve = (cx: number, cy: number): void => {
    const dx = cx - sx, dy = cy - sy, ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < THRESH) return;
    fired = true;
    if (ax > ay) onAction(dx > 0 ? "right" : "left");
    else onAction(dy > 0 ? "slide" : "jump");
  };
  const ts = (e: TouchEvent) => { const t = e.changedTouches[0]!; sx = t.clientX; sy = t.clientY; st = Date.now(); fired = false; };
  const tm = (e: TouchEvent) => { if (fired) return; const t = e.touches[0] ?? e.changedTouches[0]!; resolve(t.clientX, t.clientY); };
  const te = (e: TouchEvent) => { if (fired || Date.now() - st > 500) return; const t = e.changedTouches[0]!; resolve(t.clientX, t.clientY); };
  window.addEventListener("keydown", key);
  window.addEventListener("touchstart", ts, { passive: true });
  window.addEventListener("touchmove", tm, { passive: true });
  window.addEventListener("touchend", te, { passive: true });
  return () => {
    window.removeEventListener("keydown", key);
    window.removeEventListener("touchstart", ts);
    window.removeEventListener("touchmove", tm);
    window.removeEventListener("touchend", te);
  };
}
