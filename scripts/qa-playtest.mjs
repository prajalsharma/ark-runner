import { chromium } from "playwright";
const OUT = "./qa-shots";
const URL = process.argv[2] || "http://localhost:5180";

const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const pg = await ctx.newPage();
const errors = [];
pg.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
pg.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await pg.addInitScript(() => { try { localStorage.setItem("archrunner.intro.v1", "1"); } catch {} });
await pg.goto(URL, { waitUntil: "networkidle" });
await pg.waitForTimeout(1500);
await pg.screenshot({ path: OUT + "/qa-menu.png" });

const freeBtn = await pg.$("#free");
if (freeBtn) await freeBtn.click(); else errors.push("NO #free BUTTON");
await pg.waitForTimeout(1200);
await pg.screenshot({ path: OUT + "/qa-gameplay-1.png" });

const keys = ["ArrowRight", "Space", "ArrowLeft", "ArrowDown", "ArrowRight", "Space"];
for (const k of keys) { await pg.keyboard.press(k); await pg.waitForTimeout(600); }
await pg.screenshot({ path: OUT + "/qa-gameplay-2.png" });
await pg.waitForTimeout(2500);
await pg.screenshot({ path: OUT + "/qa-gameplay-3.png" });
await pg.waitForTimeout(7000);
await pg.screenshot({ path: OUT + "/qa-death.png" });

console.log("ERRORS:\n" + (errors.length ? errors.join("\n") : "(none)"));
await b.close();
