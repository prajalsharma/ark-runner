/**
 * Opening cinematic — "The Block Bandit". A short, skippable sequence of caption
 * shots over the live 3D city (the attract scene behind the overlay), introducing the
 * world, the graffiti, and THE AUDITOR before gameplay. Lightweight: timed DOM frames
 * with fades, not a film engine. Plays once on first visit; replayable from the menu.
 */
const AUDITOR = `<div class="auditor"><div class="iris"></div></div>`;

type Shot = { html: string; ms: number };

export class Cutscene {
  private i = 0;
  private timer = 0;

  constructor(private overlay: HTMLElement, private onPlay: () => void, private onSkip: () => void) {}

  private shots(): Shot[] {
    return [
      { ms: 2800, html: `<div class="cs-cap big-cap">THE ARCH CITY</div><div class="cs-sub">3 AM · you are broke · you want exactly one thing</div>` },
      { ms: 3000, html: `<div class="cs-donut">🍩</div><div class="cs-cap">THE LEGENDARY ORANGE SATOSHI DONUT</div><div class="cs-sub">0.0001 ₿ · worth every single sat</div>` },
      { ms: 3000, html: `<div class="cs-cap alert">PAYMENT: PENDING…</div><div class="cs-pending"><span></span></div><div class="cs-sub">the bakery terminal is… thinking about it</div>` },
      { ms: 2600, html: `<div class="cs-donut">🍩</div><div class="cs-line you"><b>YOU:</b> …it's basically confirmed.</div><div class="cs-cap" style="margin-top:8px">*CRUNCH*</div>` },
      { ms: 2600, html: `<div class="cs-siren"></div>${AUDITOR}<div class="cs-cap alert">“UNSETTLED PASTRY DETECTED.”</div>` },
      { ms: 3600, html: `${AUDITOR}<div class="cs-line"><b>AUDITOR:</b> That pastry has not reached finality.</div><div class="cs-line you"><b>YOU:</b> It reached my mouth. That's finality.</div>` },
      { ms: 3800, html: `${AUDITOR}<div class="cs-line"><b>AUDITOR:</b> Return the asset in its original, un-bitten state.</div><div class="cs-line you"><b>YOU:</b> Define "original." Philosophically.</div>` },
      { ms: 3400, html: `${AUDITOR}<div class="cs-line"><b>AUDITOR:</b> Fleeing incurs a gas fee, a late fee, and a disappointment fee.</div><div class="cs-line you"><b>YOU:</b> Worth it.</div>` },
      { ms: 0, html: `<div class="title cs-title"><span class="accent">ARCH</span> RUNNER</div><div class="cs-sub">RUN THE BLOCK · BREAK THE SCORE</div><button id="cs-run" class="btn" style="max-width:320px;margin-top:20px">RUN</button>` },
    ];
  }

  play(): void { this.i = 0; this.render(); }

  private render(): void {
    const shots = this.shots();
    const shot = shots[this.i]!;
    const last = this.i === shots.length - 1;
    this.overlay.className = "show cutscene";
    this.overlay.innerHTML = `
      <div class="cs-frame">${shot.html}</div>
      ${last ? "" : `<button id="cs-skip" class="cs-skip">SKIP ›</button><div id="cs-advance" class="cs-advance"></div>`}`;
    if (last) {
      const run = this.overlay.querySelector("#cs-run") as HTMLButtonElement;
      run.onclick = () => this.finish(this.onPlay);
      return;
    }
    (this.overlay.querySelector("#cs-skip") as HTMLButtonElement).onclick = () => this.finish(this.onSkip);
    (this.overlay.querySelector("#cs-advance") as HTMLElement).onclick = () => this.next();
    this.timer = window.setTimeout(() => this.next(), shot.ms);
  }

  private next(): void {
    window.clearTimeout(this.timer);
    this.i++;
    if (this.i >= this.shots().length) { this.finish(this.onSkip); return; }
    this.render();
  }

  private finish(cb: () => void): void {
    window.clearTimeout(this.timer);
    this.overlay.className = "";
    this.overlay.innerHTML = "";
    cb();
  }
}
