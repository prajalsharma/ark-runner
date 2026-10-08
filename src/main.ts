/** Bootstrap: live menu → Daily Block / Free Run. The game is fully playable with
 *  zero blockchain today; wallet + real competitions arrive in later phases. */
import { Menu } from "./menu/menu.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

new Menu(canvas, hud, overlay).open();
