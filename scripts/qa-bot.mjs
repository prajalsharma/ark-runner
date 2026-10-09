// Smart automated playtest. The autopilot runs IN-PAGE (zero latency) reading the
// exposed sim (window.__ARCH_SIM) and dispatching key events, so the bot survives far
// enough to reach pits, Block Runs and flip gates. Playwright screenshots those moments.
import { chromium } from "playwright";
const OUT = "./qa-shots";
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const pg = await ctx.newPage();
const errors = [];
pg.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
await pg.addInitScript(() => { try { localStorage.setItem("archrunner.intro.v1", "1"); } catch {} });
await pg.goto("http://localhost:5180", { waitUntil: "networkidle" });
await pg.waitForTimeout(900);
const f = await pg.$("#free"); if (f) await f.click();
await pg.waitForTimeout(500);

await pg.evaluate(() => {
  const press = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  window.__snaps = { pit: false, block: false, flip: false, maxDist: 0 };
  window.__bot = setInterval(() => {
    const s = window.__ARCH_SIM; if (!s || !s.alive) return;
    window.__snaps.maxDist = Math.max(window.__snaps.maxDist, s.distance);
    if (s.blockRun) window.__snaps.block = true;
    if (s.flipActive || (s.flipGatesInView && s.flipGatesInView().length)) window.__snaps.flip = true;
    const d = s.distance, LOOK = 16, blocked = {}; let inLane = null;
    if (s.view().obstacles.some((o) => o.type === "PIT" && o.z - d > 0 && o.z - d < 28)) window.__snaps.pit = true; // any pit visible ahead
    for (const o of s.view().obstacles) {
      const rel = o.z - d; if (rel <= 1 || rel >= LOOK) continue;
      if ((o.type === "WALL" || o.type === "PIT") && rel < 10) blocked[o.lane] = true;
      if (o.lane === s.lane && (!inLane || rel < inLane.rel)) inLane = { type: o.type, rel };
    }
    if (inLane) {
      if (inLane.type === "LOW" && s.grounded) press("ArrowUp");
      else if (inLane.type === "PIT" && s.grounded && inLane.rel < 7) press("ArrowUp");
      else if (inLane.type === "HIGH" && s.grounded && !s.sliding) press("ArrowDown");
      else if (inLane.type === "WALL") { for (const L of [s.lane - 1, s.lane + 1]) if (L >= -1 && L <= 1 && !blocked[L]) { press(L < s.lane ? "ArrowLeft" : "ArrowRight"); break; } }
    }
  }, 16);
});

const got = {};
const t0 = Date.now();
let k = 0;
while (Date.now() - t0 < 45000) {
  const snaps = await pg.evaluate(() => window.__snaps);
  for (const m of ["pit", "block", "flip"]) {
    if (snaps[m] && !got[m]) { got[m] = true; await pg.screenshot({ path: `${OUT}/moment-${m}.png` }); }
  }
  if (k % 10 === 0) await pg.screenshot({ path: `${OUT}/bot-${(k / 10) % 5}.png` });
  if (got.pit && got.block && got.flip) break;
  k++; await pg.waitForTimeout(300);
}
const snaps = await pg.evaluate(() => window.__snaps);
console.log(JSON.stringify({ maxDist: Math.round(snaps.maxDist), got, errors }));
await b.close();
