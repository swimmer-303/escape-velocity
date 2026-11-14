// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Mini-game B: fly the full rocket to escape velocity (Mars 5.03 km/s, Moon 2.38 km/s). Hold for full power, tip the
// rocket to follow the gravity-turn arc, and ease off before the engine overheats. The launch always succeeds (the
// mission is already won): skill only changes the medal.

import { h } from '../../ui/dom';
import { ESCAPE, LAUNCH_WARP, MIN_THROTTLE, ORBIT, PATH_OK, RADIUS, createLaunch, idealPitch, launchSpeed, stepLaunch, type LaunchScore, type LaunchState } from './physics';
import { Particles, type FlightShell } from './engine';
import { drawBase, drawFlame, drawGround, drawPad, drawPlanet, drawRocket, launchSky, launchSkyline, ROCKET_SIZE, type Scenery, type View } from './scenery';
import type { FlightSetup } from './session';

export interface LaunchRun {
  state: LaunchState;
  /** Real seconds the computer flew. */
  helped: number;
}

const kbd = (t: string) => h('kbd', { class: 'ev-key' }, t);
const kms = (ms: number) => (ms / 1000).toFixed(2);
const world = (site: 'mars' | 'moon') => (site === 'mars' ? 'Mars' : 'the Moon');

export function launchHint(setup: FlightSetup): HTMLElement {
  const w = world(setup.site);
  return h(
    'div',
    null,
    h('div', { class: 'kicker' }, setup.site === 'mars' ? 'Mars launch' : 'Moon launch', setup.practice ? ' · Flight school' : ''),
    h('h2', null, 'Fly to escape velocity'),
    !setup.practice ? h('p', null, `The tank is full. Fly ${setup.crew} astronauts home!`) : null,
    h('p', { class: 'ev-flight-goal' }, `Reach ${kms(ESCAPE[setup.site])} km/s: fast enough to leave ${w} for good.`),
    h(
      'ul',
      { class: 'ev-flight-howto' },
      h('li', null, h('span', { class: 'keys' }, kbd('Space'), kbd('Up')), h('span', null, `Hold for full power (or hold THRUST). Let go and the engine drops to ${MIN_THROTTLE * 100}%.`)),
      h('li', null, h('span', { class: 'keys' }, kbd('Left'), kbd('Right')), h('span', null, 'Tip the rocket. Keep its nose on the dotted arc as it leans over.')),
      h('li', null, h('span', { class: 'keys' }, h('span', { class: 'ev-key wide' }, 'Heat')), h('span', null, 'Full power heats the engine. Let go now and then, before it overheats.')),
    ),
    h(
      'p',
      { class: 'ev-flight-fact' },
      `Rockets lean over as they climb (a "gravity turn"), so their speed carries them around the planet instead of only fighting gravity straight up. At ${kms(ORBIT[setup.site])} km/s you could circle ${w} in orbit; at ${kms(ESCAPE[setup.site])} km/s you escape it.`,
    ),
    h('p', { class: 'ev-flight-note' }, `Medals for staying on the arc, never overheating, and a quick climb. Real gravity and escape speed; the clock runs ${LAUNCH_WARP} times faster than real life, and engine heat is a game rule.`),
  );
}

function launchHud(site: 'mars' | 'moon') {
  const esc = ESCAPE[site];
  const speedVal = h('b', null, '0.00');
  const speedFill = h('div', { class: 'fill' });
  const speedBox = h(
    'div',
    { class: 'ev-gauge speed wide' },
    h('div', { class: 'lbl' }, 'Speed'),
    h('div', { class: 'bar' }, speedFill, h('div', { class: 'tick', style: `left:${(ORBIT[site] / esc) * 100}%` }, h('span', null, 'orbit'))),
    h('div', { class: 'val' }, speedVal, ` of ${kms(esc)} km/s`),
  );
  const heatFill = h('div', { class: 'fill' });
  const heatState = h('span', { class: 'state' }, 'OK');
  const heatBox = h('div', { class: 'ev-gauge heat' }, h('div', { class: 'lbl' }, 'Engine heat'), h('div', { class: 'bar' }, heatFill), h('div', { class: 'val' }, heatState));
  const pathVal = h('b', null, '');
  const pathBox = h('div', { class: 'ev-gauge small path' }, h('div', { class: 'lbl' }, 'Path'), h('div', { class: 'val' }, pathVal));
  const altVal = h('b', null, '0');
  const clockVal = h('b', null, '0:00');
  const el = h(
    'div',
    { class: 'ev-fhud' },
    speedBox,
    heatBox,
    pathBox,
    h('div', { class: 'ev-gauge small' }, h('div', { class: 'lbl' }, 'Height'), h('div', { class: 'val' }, altVal, ' km')),
    h('div', { class: 'ev-gauge small' }, h('div', { class: 'lbl' }, `Clock x${LAUNCH_WARP}`), h('div', { class: 'val' }, clockVal)),
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
    update(s: LaunchState) {
      const v = launchSpeed(s);
      set('v', kms(v), (t) => (speedVal.textContent = t));
      set('vw', Math.min(100, (v / esc) * 100).toFixed(1), (t) => (speedFill.style.width = `${t}%`));
      set('heat', (s.heat * 100).toFixed(0), (t) => (heatFill.style.width = `${t}%`));
      const hs = s.cooling ? 'cooling' : s.heat > 0.75 ? 'hot' : 'ok';
      set('hs', hs, (t) => {
        heatBox.dataset.state = t === 'ok' ? 'ok' : t === 'hot' ? 'warn' : 'danger';
        heatState.textContent = t === 'cooling' ? 'COOLING' : t === 'hot' ? 'HOT! Let go' : 'OK';
      });
      const err = s.pitch - idealPitch(s);
      const ps = s.phase === 'pad' ? 'pad' : s.assisted ? 'auto' : Math.abs(err) <= PATH_OK ? 'on' : err < 0 ? 'right' : 'left';
      set('path', ps, (t) => {
        pathBox.dataset.state = t === 'on' || t === 'pad' || t === 'auto' ? 'ok' : 'warn';
        pathVal.textContent = t === 'pad' ? 'Ready' : t === 'auto' ? 'Computer' : t === 'on' ? 'On path' : t === 'right' ? 'Tip right >' : '< Tip left';
      });
      set('alt', (s.h / 1000).toFixed(s.h < 10_000 ? 1 : 0), (t) => (altVal.textContent = t));
      const c = Math.floor(s.clock);
      set('clock', `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`, (t) => (clockVal.textContent = t));
    },
  };
}

/** Fly one launch. Resolves after the "ESCAPE VELOCITY!" moment. */
export function runLaunch(shell: FlightShell, setup: FlightSetup): Promise<LaunchRun> {
  return new Promise((resolve) => {
    const sc: Scenery = setup.scenery;
    const site = setup.site;
    const R = RADIUS[site];
    let s = createLaunch(site);
    let helped = 0;
    const parts = new Particles(shell.reduced ? 80 : 220);
    const streaks = new Particles(shell.reduced ? 10 : 40);
    const hud = launchHud(site);
    shell.setHud(hud.el);
    shell.showControls({ left: 'Tip left', right: 'Tip right', thrust: 'Thrust' });
    shell.say('Hold THRUST to lift off!', { ms: 0, tone: 'big', speak: 'Ready on the pad. Hold thrust to lift off!' });

    const zoom = shell.H >= 330 ? 2 : 1;
    const half = (ROCKET_SIZE.h * zoom) / 2;
    const skyLevels = 6;
    let skies: Array<HTMLCanvasElement | null> = [];
    let skyline: HTMLCanvasElement | null = null;
    const layout = () => {
      skies = shell.g ? Array.from({ length: skyLevels }, (_, i) => launchSky(shell.W, shell.H, sc, i / (skyLevels - 1))) : [];
      skyline = shell.g ? launchSkyline(shell.W, shell.H, sc) : null;
    };
    layout();
    shell.onResize = layout;

    let ended = 0;
    let done = false;
    let emit = 0;
    let away = 0;
    const fire = ['#fff3d1', '#ffb627', '#ff8a3a', '#ff5a4f'];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const rocketPos = () => {
      const sp = Math.sin(Math.max(0, s.pitch));
      return { x: shell.W * (0.5 - 0.14 * sp) + away * 0.6, y: shell.H * (0.6 - 0.06 * sp) - away };
    };

    shell.start({
      update(dt) {
        const before = s;
        s = stepLaunch(s, shell.input, dt);
        if (s.assisted && s.phase === 'flying') helped += dt;

        if (before.phase === 'pad' && s.phase === 'flying') {
          shell.sfx('run');
          shell.shake(4);
          shell.say(s.autoLiftoff ? 'Lift-off! The computer started the engine.' : 'Lift-off!', { ms: 2200, tone: 'big' });
        }
        if (!before.orbit && s.orbit && s.phase !== 'escaped') {
          shell.sfx('good');
          shell.say('Orbit speed! Keep going!', { ms: 2600, tone: 'good', speak: `Orbit speed: ${kms(ORBIT[site])} kilometers per second. You could circle ${world(site)} now. Keep going to escape!` });
        }
        if (!before.cooling && s.cooling) {
          shell.sfx('alarm');
          shell.shake(3);
          shell.say('Engine too hot! Cooling...', { ms: 2400, tone: 'bad' });
        }
        if (before.phase === 'flying' && before.assisted !== s.assisted && s.phase === 'flying') {
          if (s.assisted) shell.say('The computer is flying. Press a control to take over.', { ms: 3000, tone: 'warn' });
          else shell.say('You have control!', { ms: 1400 });
        }
        if (before.phase !== 'escaped' && s.phase === 'escaped') {
          shell.sfx(setup.practice ? 'win' : 'good');
          shell.shake(5);
          shell.el.classList.add('flash');
          shell.say('ESCAPE VELOCITY!', { ms: 0, tone: 'big', speak: `Escape velocity! ${kms(launchSpeed(s))} kilometers per second. You are on your way home!` });
          const p = rocketPos();
          for (let i = 0; i < (shell.reduced ? 14 : 60); i++) {
            const a = rand(0, Math.PI * 2);
            const v = rand(20, 90);
            streaks.add({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.6, 1.4), color: i % 3 ? '#ffd34d' : '#5ef2e6', size: 2, fall: 0 });
          }
        }

        // Exhaust (screen space) and speed streaks.
        const p = rocketPos();
        const dir = { x: Math.sin(s.pitch), y: -Math.cos(s.pitch) };
        if (s.phase !== 'pad') {
          emit += dt * (shell.reduced ? 20 : 60) * (s.throttle > MIN_THROTTLE ? 1 : 0.5);
          while (emit >= 1) {
            emit -= 1;
            parts.add({
              x: p.x - dir.x * half + rand(-1, 1),
              y: p.y - dir.y * half + rand(-1, 1),
              vx: -dir.x * rand(30, 60) + rand(-6, 6),
              vy: -dir.y * rand(30, 60) + 18,
              life: rand(0.3, 0.7),
              color: fire[Math.floor(rand(0, 4))],
              size: rand(1, 2.5) * zoom,
              fall: 0,
            });
          }
          const v = launchSpeed(s);
          if (v > 250 && Math.random() < dt * (shell.reduced ? 3 : 14)) {
            const vd = { x: s.vx / v, y: -s.vy / v };
            const speedPx = 120 + 260 * Math.min(1, v / ESCAPE[site]);
            streaks.add({ x: rand(0, shell.W) + vd.x * shell.W * 0.5, y: rand(0, shell.H) + vd.y * shell.H * 0.5, vx: -vd.x * speedPx, vy: -vd.y * speedPx, life: 0.8, color: 'rgba(244,234,216,0.5)', size: 1, fall: 0 });
          }
        }
        parts.update(dt);
        streaks.update(dt);
        if (s.phase === 'flying' && s.throttle === 1) shell.shake(0.8);
        shell.engine(s.phase === 'pad' ? 0 : s.phase === 'escaped' ? Math.max(0, 1 - ended) : s.throttle);

        if (s.phase === 'escaped') {
          ended += dt;
          away += dt * 50;
          if (ended >= 0.4) shell.el.classList.remove('flash');
          if (ended >= 2.6 && !done) {
            done = true;
            shell.stop();
            shell.onResize = undefined;
            resolve({ state: s, helped });
          }
        }
      },
      draw() {
        hud.update(s);
        const g = shell.g;
        if (!g) return;
        const W = shell.W;
        const H = shell.H;
        g.save();
        g.translate(shell.shakeX, shell.shakeY);
        // Sky: blend between cached skies by height (Mars air thins out fast: mostly gone by about 50 km).
        const k = sc === 'moon' ? 0 : Math.min(1, s.h / 50_000);
        const fi = k * (skyLevels - 1);
        const i0 = Math.floor(fi);
        const a = skies[i0];
        if (a) g.drawImage(a, 0, 0);
        else {
          g.fillStyle = '#000';
          g.fillRect(0, 0, W, H);
        }
        const b = skies[Math.min(skyLevels - 1, i0 + 1)];
        if (b && fi > i0) {
          g.globalAlpha = fi - i0;
          g.drawImage(b, 0, 0);
          g.globalAlpha = 1;
        }
        // The planet below: flat at first, then a curved limb that shrinks as we climb.
        const rp = rocketPos();
        const ppm = (H * 0.3) / (s.h + 80);
        const groundY = rp.y + half + s.h * ppm;
        if (s.h < 2000) {
          // Near the ground: the same skyline, rocks and base as the landing, sliding away below.
          const view: View = { W, H, groundY: Math.round(groundY), ppm, camX: s.x - (rp.x - W / 2) / ppm };
          if (skyline) g.drawImage(skyline, 0, view.groundY - H);
          if (view.groundY < H) drawGround(g, view, sc);
          drawBase(g, view, sc, { blink: shell.reduced || Math.floor(shell.time * 2) % 2 === 0 });
          drawPad(g, view, 9, true);
        } else if (groundY < H + 2) drawPlanet(g, W, H, rp.x, groundY + R * ppm, R * ppm, sc);
        streaks.draw(g, (x, y) => [x, y]);
        // The gravity-turn arc to follow: dotted, bending over toward level flight.
        if (s.phase === 'flying') {
          const on = Math.abs(s.pitch - idealPitch(s)) <= PATH_OK;
          let x = rp.x;
          let y = rp.y;
          let ang = idealPitch(s);
          g.fillStyle = on ? '#7ddc5a' : '#ffb627';
          for (let i = 0; i < 14; i++) {
            const step = i === 0 ? half + 4 : 5;
            x += Math.sin(ang) * step;
            y -= Math.cos(ang) * step;
            ang = Math.min(Math.PI / 2 + 0.1, ang + 0.05);
            const d = on ? 2 : 1;
            if (i % 2 === 0) g.fillRect(Math.round(x), Math.round(y), d * zoom, d * zoom);
          }
        }
        parts.draw(g, (x, y) => [x, y]);
        const dir = { x: Math.sin(s.pitch), y: -Math.cos(s.pitch) };
        if (s.phase !== 'pad') {
          const flick = shell.reduced ? 0 : Math.random() * 3;
          drawFlame(g, rp.x - dir.x * (half - 1), rp.y - dir.y * (half - 1), s.pitch, (s.throttle === 1 ? 9 : 4) * zoom, 3 * zoom, flick);
        }
        drawRocket(g, rp.x, rp.y, s.pitch, zoom);
        g.restore();
      },
    });
  });
}

/** One thing to try next time (nothing for gold). */
export function launchTip(score: LaunchScore): string | null {
  if (score.medal === 'gold') return null;
  if (score.path < 0.7) return 'Next time: tap Right again and again as the dotted arc leans over, and keep the nose on it.';
  if (score.overheats > 0) return 'Next time: let go of THRUST when the heat bar says HOT, before it overheats.';
  return 'Next time: keep the engine at full power as much as the heat allows, to climb faster.';
}

export function launchStats(score: LaunchScore, helped: number): string[] {
  const out = [
    `On the path: ${Math.round(score.path * 100)}% of the flight`,
    score.overheats === 0 ? 'The engine never overheated' : `Engine overheated ${score.overheats} time${score.overheats === 1 ? '' : 's'}`,
    `Flight time: about ${Math.max(1, Math.round(score.clockMinutes))} minutes (${Math.round(score.seconds)} seconds on the x${LAUNCH_WARP} clock)`,
  ];
  if (helped > 1) out.push(`The computer flew for ${Math.round(helped)} seconds`);
  return out;
}
