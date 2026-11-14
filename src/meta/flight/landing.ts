// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mini-game A: land the new crew's lander on the pad beside the base. Real gravity (Mars 3.71 m/s², Moon 1.62 m/s²);
// on Mars the parachute is already out over the thin air and the rockets take over. A crash never hurts the mission:
// the player can rewind and try again, or let the autopilot land, as real landers do.

import { h } from '../../ui/dom';
import { EARTH_GRAVITY, GRAVITY, PAD_HALF, SAFE_SPEED, createLanding, descentSpeed, landingAutopilot, landingSpeed, speedLimit, stepLanding, type FlightSite, type LandingScore, type LandingState } from './physics';
import { Particles, type FlightShell } from './engine';
import { drawBase, drawChute, drawFlame, drawGround, drawLander, drawPad, landingBackdrop, LANDER_SIZE, sx, sy, type Scenery, type View } from './scenery';
import type { FlightSetup } from './session';
import { REAL } from '../../sim/constants';

export type LandingRun = { kind: 'landed'; state: LandingState; autopilot: boolean } | { kind: 'crashed'; state: LandingState };

const kbd = (t: string) => h('kbd', { class: 'ev-key' }, t);

/** The one-screen "how to fly" card. */
export function landingHint(setup: FlightSetup): HTMLElement {
  const mars = setup.site === 'mars';
  const g = GRAVITY[setup.site];
  const lt = setup.lightTimeMin;
  const radio =
    lt === undefined
      ? `radio signals take ${REAL.marsLightMinMin} to ${REAL.marsLightMaxMin} minutes to reach Earth (it depends on where the two planets are)`
      : `radio signals take about ${Math.max(1, Math.round(lt))} minutes to reach Earth today`;
  return h(
    'div',
    null,
    h('div', { class: 'kicker' }, mars ? 'Mars landing' : 'Moon landing', setup.practice ? ' · Flight school' : ''),
    h('h2', null, setup.practice ? 'Practice landing' : `Land the crew`),
    !setup.practice ? h('p', null, `${setup.crew} astronauts are riding down to the base. You fly the last part.`) : null,
    h('p', { class: 'ev-flight-goal' }, `Touch down on the pad slower than ${SAFE_SPEED} m/s.`),
    h(
      'ul',
      { class: 'ev-flight-howto' },
      h('li', null, h('span', { class: 'keys' }, kbd('Space'), kbd('Up')), h('span', null, 'Hold to fire the engine. On a touch screen, hold the THRUST button or anywhere on the picture.')),
      h('li', null, h('span', { class: 'keys' }, kbd('Left'), kbd('Right')), h('span', null, 'Side thrusters: slide over the pad.')),
      h('li', null, h('span', { class: 'keys' }, h('span', { class: 'ev-key wide' }, 'Tip')), h('span', null, 'Watch the SPEED gauge. SLOW DOWN: hold the engine. OK: let go. Touch down when it says SAFE. Fuel runs out!')),
    ),
    h(
      'p',
      { class: 'ev-flight-fact' },
      mars
        ? `Mars gravity is ${g} m/s², about 3/8 of Earth's ${EARTH_GRAVITY}. The parachute slows you down, but Mars air is too thin to land on a parachute alone, so rockets do the last part. Engineers call a Mars landing the "seven minutes of terror": ${radio}, so real Mars landers fly themselves.`
        : `Moon gravity is ${g} m/s², about 1/6 of Earth's ${EARTH_GRAVITY}, so you fall slowly. There is no air, so no parachute: the rocket does all the work. Radio reaches Earth in about ${REAL.moonLightSec} seconds, and Apollo astronauts steered the last part of every Moon landing by hand.`,
    ),
    h('p', { class: 'ev-flight-note' }, 'Medals for a soft touchdown, landing right on the pad, and fuel left. Real gravity; heights and speeds are shortened so a landing takes about half a minute.'),
  );
}

interface HudParts {
  el: HTMLElement;
  update(s: LandingState): void;
}

/** Speed gauge position, %: a square-root scale, so slow speeds (where landing happens) get most of the bar. */
const gaugePct = (v: number) => Math.min(100, Math.sqrt(Math.max(0, v) / 40) * 100);

function landingHud(site: FlightSite): HudParts {
  const speedVal = h('b', null, '0.0');
  const speedState = h('span', { class: 'state' }, '');
  const speedFill = h('div', { class: 'fill' });
  // The white line: the fastest wise speed at this height (see speedLimit).
  const limitTick = h('div', { class: 'limit', title: 'Fastest safe speed for this height' });
  const speedBox = h(
    'div',
    { class: 'ev-gauge speed' },
    h('div', { class: 'lbl' }, 'Speed'),
    h('div', { class: 'bar' }, h('div', { class: 'zone', style: `width:${gaugePct(SAFE_SPEED)}%` }, 'safe'), speedFill, limitTick),
    h('div', { class: 'val' }, speedVal, ' m/s ', speedState),
  );
  const altVal = h('b', null, '0');
  const fuelVal = h('b', null, '100');
  const fuelFill = h('div', { class: 'fill' });
  const fuelBox = h('div', { class: 'ev-gauge fuel' }, h('div', { class: 'lbl' }, 'Fuel'), h('div', { class: 'bar' }, fuelFill), h('div', { class: 'val' }, fuelVal, '%'));
  const padVal = h('b', null, '');
  const el = h(
    'div',
    { class: 'ev-fhud' },
    speedBox,
    h('div', { class: 'ev-gauge small' }, h('div', { class: 'lbl' }, 'Height'), h('div', { class: 'val' }, altVal, ' m')),
    fuelBox,
    h('div', { class: 'ev-gauge small pad' }, h('div', { class: 'lbl' }, 'Pad'), h('div', { class: 'val' }, padVal)),
  );
  const last: Record<string, string> = {};
  const set = (k: string, v: string, fn: (v: string) => void) => {
    if (last[k] !== v) {
      last[k] = v;
      fn(v);
    }
  };
  return {
    el,
    update(s) {
      const v = s.touchdown ?? landingSpeed(s);
      const down = s.touchdown ?? descentSpeed(s);
      const limit = s.touchdown !== undefined ? SAFE_SPEED : speedLimit(site, s.y);
      set('speed', v.toFixed(1), (t) => (speedVal.textContent = t));
      // SLOW DOWN: hold the engine. OK / SAFE / GOING UP: let go.
      const state =
        s.touchdown !== undefined
          ? s.touchdown <= SAFE_SPEED
            ? 'safe'
            : 'danger'
          : down > limit
            ? s.y < 40
              ? 'danger'
              : 'warn'
            : s.vy > 0.3
              ? 'up'
              : down <= SAFE_SPEED
                ? 'safe'
                : 'ok';
      set('state', state, (t) => {
        speedBox.dataset.state = t === 'up' ? 'ok' : t;
        speedState.textContent =
          t === 'safe' ? 'SAFE' : t === 'ok' ? 'OK' : t === 'up' ? 'GOING UP' : s.touchdown !== undefined ? 'TOO FAST' : 'SLOW DOWN';
      });
      set('speedW', gaugePct(v).toFixed(1), (t) => (speedFill.style.width = `${t}%`));
      set('limit', gaugePct(limit).toFixed(1), (t) => (limitTick.style.left = `calc(${t}% - 1px)`));
      set('alt', Math.max(0, s.y).toFixed(0), (t) => (altVal.textContent = t));
      const f = Math.round(s.fuel * 100);
      set('fuel', String(f), (t) => {
        fuelVal.textContent = t;
        fuelFill.style.width = `${t}%`;
        fuelBox.dataset.state = f <= 0 ? 'danger' : f < 20 ? 'warn' : 'ok';
      });
      const d = Math.abs(s.x);
      set('pad', d <= PAD_HALF ? 'below' : `${Math.round(d)}${s.x < 0 ? 'r' : 'l'}`, () => {
        padVal.textContent = d <= PAD_HALF ? 'Below you' : `${Math.round(d)} m ${s.x < 0 ? 'right' : 'left'}`;
      });
    },
  };
}

/** Fly one landing. Resolves when the lander is down (safely or not) and the moment has played out. */
export function runLanding(shell: FlightShell, setup: FlightSetup, autopilot: boolean): Promise<LandingRun> {
  return new Promise((resolve) => {
    const sc: Scenery = setup.scenery;
    let s = createLanding(setup.site);
    const parts = new Particles(shell.reduced ? 90 : 240);
    const hud = landingHud(setup.site);
    shell.setHud(hud.el);
    if (autopilot) {
      shell.hideControls();
      shell.say('Autopilot landing...', { ms: 2500, tone: 'big' });
    } else shell.showControls({ left: 'Left', right: 'Right', thrust: 'Thrust' });

    // Camera: the ground stays at the bottom; zoom in as the lander gets low.
    let backdrop: HTMLCanvasElement | null = null;
    const view: View = { W: shell.W, H: shell.H, groundY: 0, ppm: 0.3, camX: 0 };
    const targetPpm = () => (view.groundY - 14) / Math.max(70, Math.min(650, s.y * 1.3 + 40));
    const layout = () => {
      view.W = shell.W;
      view.H = shell.H;
      view.groundY = shell.H - Math.max(18, Math.round(shell.H * 0.15));
      backdrop = shell.g ? landingBackdrop(shell.W, shell.H, view.groundY, sc) : null;
    };
    layout();
    view.ppm = targetPpm();
    view.camX = s.x * 0.5;
    shell.onResize = layout;

    let ended = 0;
    let tilt = 0;
    let chuteGone = -1;
    let lowFuel = false;
    let empty = false;
    let emit = 0;
    let done = false;
    let usedEngine = false;
    let nudged = false;
    const zoom = shell.H >= 330 ? 2 : 1;
    const dustColor = sc === 'moon' ? ['#b4b4bc', '#8c8c94', '#6a6a72'] : ['#e3a06a', '#c2562a', '#d98a52'];
    const fire = ['#fff3d1', '#ffb627', '#ff8a3a', '#ff5a4f'];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    if (s.phase === 'chute' && !autopilot) shell.say('Parachute out!', { ms: 2000, tone: 'big', speak: 'Parachute out. The rockets take over in a moment.' });

    shell.start({
      update(dt) {
        const before = s;
        const input = autopilot ? landingAutopilot(s) : shell.input;
        s = stepLanding(s, input, dt);

        // Moments.
        if (before.phase === 'chute' && s.phase === 'flying') {
          chuteGone = 0;
          shell.sfx('run');
          if (!autopilot) shell.say('Rockets on: your turn!', { ms: 2200, tone: 'big', speak: 'Parachute away. Rockets on. Your turn to fly!' });
        }
        if (chuteGone >= 0) chuteGone += dt;
        if (s.firing) usedEngine = true;
        // A first-time pilot who hasn't touched the engine yet gets one reminder before it's too late.
        if (!autopilot && !usedEngine && !nudged && s.phase === 'flying' && s.y < 230 && landingSpeed(s) > 12) {
          nudged = true;
          shell.say('Hold THRUST to slow down!', { ms: 2600, tone: 'warn' });
        }
        if (!lowFuel && s.fuel < 0.2 && s.phase === 'flying') {
          lowFuel = true;
          shell.sfx('alarm');
          shell.say('Low fuel!', { ms: 1800, tone: 'warn' });
        }
        if (!empty && s.fuel <= 0 && s.phase === 'flying') {
          empty = true;
          shell.say('Out of fuel!', { ms: 2500, tone: 'bad' });
        }
        if (before.phase === 'flying' && s.phase === 'landed') {
          shell.sfx('good');
          shell.shake(2);
          shell.say('Touchdown!', { ms: 0, tone: 'good', speak: `Touchdown at ${(s.touchdown ?? 0).toFixed(1)} meters per second.` });
          for (let i = 0; i < (shell.reduced ? 8 : 24); i++) parts.add({ x: s.x + rand(-2, 2), y: 0.3, vx: rand(-9, 9), vy: rand(1, 5), life: rand(0.5, 1.1), color: dustColor[i % 3], size: 2, fall: -0.5 });
        }
        if (before.phase === 'flying' && s.phase === 'crashed') {
          shell.sfx('bad');
          shell.shake(9);
          shell.say('Too fast!', { ms: 0, tone: 'bad', speak: `Too fast! The lander bumped down at ${(s.touchdown ?? 0).toFixed(1)} meters per second.` });
          for (let i = 0; i < (shell.reduced ? 20 : 70); i++) parts.add({ x: s.x + rand(-3, 3), y: 0.5, vx: rand(-22, 22), vy: rand(4, 26), life: rand(0.7, 1.6), color: dustColor[i % 3], size: rand(1, 3), fall: -14 });
        }

        // Exhaust and dust.
        emit += dt * (shell.reduced ? 25 : 70);
        while (emit >= 1) {
          emit -= 1;
          if (s.firing) {
            parts.add({ x: s.x + rand(-0.6, 0.6), y: s.y - 0.5, vx: rand(-3, 3) + s.vx, vy: s.vy - rand(22, 34), life: rand(0.25, 0.6), color: fire[Math.floor(rand(0, 4))], size: rand(1, 2.5), fall: 0 });
            if (s.y < 30) parts.add({ x: s.x + rand(-1, 1), y: 0.2, vx: (Math.random() < 0.5 ? -1 : 1) * rand(8, 20) * (1 - s.y / 34), vy: rand(0.5, 3), life: rand(0.4, 0.9), color: dustColor[Math.floor(rand(0, 3))], size: rand(1, 2), fall: -2 });
          }
          if (s.side && Math.random() < 0.6) parts.add({ x: s.x - s.side * 2.4, y: s.y + 3, vx: -s.side * rand(8, 14) + s.vx, vy: rand(-1, 1) + s.vy, life: rand(0.15, 0.3), color: '#f4ead8', size: 1, fall: 0 });
        }
        parts.update(dt);
        for (const p of parts.list) {
          if (p.y < 0) {
            // Exhaust hitting the ground turns into blowing dust.
            p.y = 0;
            p.vy = Math.abs(p.vy) * 0.1;
            p.vx = (p.vx >= 0 ? 1 : -1) * rand(6, 16);
            p.color = dustColor[0];
          }
        }

        // Camera and lander tilt.
        const k = 1 - Math.exp(-dt * 2.5);
        view.ppm += (targetPpm() - view.ppm) * k;
        view.camX += (s.x * 0.5 - view.camX) * k;
        const wantTilt = s.phase === 'crashed' ? 0.7 : s.phase === 'chute' && !shell.reduced ? 0.06 * Math.sin(s.t * 2.2) : s.side * 0.18;
        tilt += (wantTilt - tilt) * (s.phase === 'crashed' ? 0.25 : 0.15);
        shell.engine(s.firing ? 1 : s.side ? 0.25 : 0);

        // Let the moment play, then hand back.
        if (s.phase === 'landed' || s.phase === 'crashed') {
          ended += dt;
          if (ended >= 1.5 && !done) {
            done = true;
            shell.stop();
            shell.onResize = undefined;
            resolve(s.phase === 'landed' ? { kind: 'landed', state: s, autopilot } : { kind: 'crashed', state: s });
          }
        }
      },
      draw() {
        hud.update(s);
        const g = shell.g;
        if (!g) return;
        g.save();
        g.translate(shell.shakeX, shell.shakeY);
        if (backdrop) g.drawImage(backdrop, 0, 0);
        else {
          g.fillStyle = '#000';
          g.fillRect(0, 0, view.W, view.H);
        }
        drawGround(g, view, sc);
        const blink = shell.reduced || Math.floor(shell.time * 2) % 2 === 0;
        drawBase(g, view, sc, { rocket: true, blink });
        drawPad(g, view, PAD_HALF, blink);
        const flyingNow = s.phase === 'chute' || s.phase === 'flying';
        // A marker over the pad while it's small and far away.
        if (flyingNow && view.ppm < 1.3) {
          const px = sx(view, 0);
          const py = view.groundY - 12 - (blink ? 0 : 1);
          g.fillStyle = '#5ef2e6';
          g.fillRect(px - 3, py, 7, 1);
          g.fillRect(px - 2, py + 1, 5, 1);
          g.fillRect(px - 1, py + 2, 3, 1);
          g.fillRect(px, py + 3, 1, 1);
        }
        parts.draw(g, (x, y) => [sx(view, x), sy(view, y)]);
        const lx = sx(view, s.x);
        const ly = sy(view, s.y);
        // The lander's shadow on the ground helps judge the height.
        if (flyingNow && s.y < 150) {
          const w = Math.max(2, Math.round(LANDER_SIZE.w * zoom * (1 - s.y / 190)));
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(Math.round(lx - w / 2), view.groundY, w, 1);
        }
        if (s.firing) drawFlame(g, lx, ly - 1, tilt, (shell.reduced ? 6 : 5 + Math.random() * 3) * zoom, 3 * zoom, 0);
        if (s.side) drawFlame(g, lx - s.side * 7 * zoom, ly - 8 * zoom, (s.side * Math.PI) / 2, 3 * zoom, 1 * zoom, 0);
        drawLander(g, lx, ly, tilt, zoom);
        if (s.phase === 'chute' || (chuteGone >= 0 && chuteGone < 1.6)) {
          const away = chuteGone < 0 ? 0 : chuteGone;
          const flutter = shell.reduced ? 0 : Math.round(Math.sin(shell.time * 9));
          drawChute(g, lx + away * 30, ly - LANDER_SIZE.h * zoom - away * 60, zoom, flutter);
        }
        g.restore();
      },
    });
  });
}

/** One thing to try next time (nothing for gold). */
export function landingTip(score: LandingScore): string | null {
  if (score.medal === 'gold') return null;
  if (!score.onPad) return 'Next time: slide over the pad with Left and Right while you are still high up.';
  if (score.soft < 0.6) return 'Next time: slow right down just before the ground. Short bursts of the engine near the bottom.';
  if (score.fuelLeft < 0.3) return 'Next time: let it fall for a while before you brake. Hovering burns lots of fuel.';
  return 'So close! A little softer and closer to the middle of the pad wins gold.';
}

export function landingStats(score: LandingScore): string[] {
  return [
    `Touchdown speed: ${score.speed.toFixed(1)} m/s (safe is under ${SAFE_SPEED})`,
    score.onPad ? (score.distance < 2 ? 'Right in the middle of the pad!' : `On the pad (${score.distance.toFixed(0)} m from the middle)`) : `${score.distance.toFixed(0)} m from the pad: a long walk to the base`,
    `Fuel left: ${Math.round(score.fuelLeft * 100)}%`,
  ];
}
