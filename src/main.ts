/** Bootstrap: live menu → Daily Block / Free Run. The game is fully playable with
 *  zero blockchain today; wallet + real competitions arrive in later phases. */
import { Menu } from "./menu/menu.ts";
import { heroModel } from "./game/settings.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

// Warm the ARCH PEPE GLB parse cache at boot (code-split) so it's ready before the cutscene
// renders — no first-frame "procedural then swap" flash, no mid-cutscene parse hitch.
if (heroModel() === "pepe") void import("./game/hero-pepe.ts").then((m) => m.preloadPepe()).catch(() => { /* fallback stays */ });

new Menu(canvas, hud, overlay).open();
