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
      { ms: 3000, html: `<div class="cs-cap big-cap">THE ARCH CITY</div><div class="cs-sub">3 AM · you are broke · you want one thing</div>` },
      { ms: 2800, html: `<div class="cs-graffiti" style="font-size:72px">🍩</div><div class="cs-cap">THE LEGENDARY ORANGE SATOSHI DONUT</div>` },
      { ms: 2800, html: `<div class="cs-cap alert">PAYMENT: PENDING…</div><div class="cs-sub">the bakery terminal is thinking about it</div>` },
      { ms: 3000, html: `<div class="cs-cap">You look at the donut. You look at the terminal.</div><div class="cs-line you"><b>YOU:</b> …I'll take the risk.</div><div class="cs-sub">*bite*</div>` },
      { ms: 2800, html: `${AUDITOR}<div class="cs-cap alert">“UNSETTLED PASTRY DETECTED.”</div>` },
      { ms: 3600, html: `${AUDITOR}<div class="cs-line"><b>AUDITOR:</b> Citizen. Your pastry transaction has not reached finality.</div><div class="cs-line you"><b>YOU:</b> It's a donut. How much finality does it need?</div>` },
      { ms: 3800, html: `${AUDITOR}<div class="cs-line"><b>AUDITOR:</b> Please return the asset in its original condition.</div><div class="cs-line you"><b>YOU:</b> You want the bitten half or the emotionally significant half?</div>` },
      { ms: 2600, html: `${AUDITOR}<div class="cs-line"><b>AUDITOR:</b> Running will add a procedural fee.</div>` },
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
