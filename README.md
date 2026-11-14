# Escape Velocity

**A retro 3D Mars outpost game for kids aged 7 to 12, powered by real NASA data.**
NASA Space Apps Challenge 2026, Charlotte, NC · Team Sendy1 (Spencer Hedges and Sandeep Talari)

> Command a tiny outpost in Gale Crater on Mars. Keep your 4-person crew breathing, fed and safe from solar storms, while making enough oxygen to fill the rocket that flies them home. Fill the tank and you hit **escape velocity**.

**Play it:** https://escape-velocity-seven.vercel.app · no download, no account, works on Chromebooks, desktops and tablets.

## The challenge

> Space-themed STEM content often oversimplifies the engineering trade-offs that define a real mission or presents them at a level too complex to hold a young learner's attention. Few tools make those trade-offs both tangible and fun. Your challenge is to design and build an interactive game or app that lets students run a lunar or Martian outpost, balancing competing demands like life support, radiation shielding, power, and food production, so they experience firsthand the decisions that determine whether a mission fails or succeeds.

Challenge page: https://www.spaceappschallenge.org/2026/challenges/junior-astronaut-mission-trainer/

## The core trade-off (it's real)

The same machine makes the **air your crew breathes** and the **oxygen your rocket burns**. NASA's MOXIE experiment on the Perseverance rover proved you can pull oxygen out of Mars' carbon-dioxide air, and the main reason NASA wants that technology is rocket propellant. So every power cell you spend on heat, food or a radiation shelter is a cell that is not filling the fuel tank. **No choice is free**, and our tests prove it (see below).

## How to play

One turn is one **sol** (a Mars day, 24 h 39 min).

1. **Morning briefing.** Weather, how many power cells your solar panels make today, and space weather from Earth. Earth's messages arrive late: today the one-way delay is about 11 minutes.
2. **Budget your power.** Drag power cells onto modules (or tap a slot, or use the keyboard). Every cell must go somewhere.
   - **O2 Plant**: AIR for the crew, or FUEL for the rocket. Same machine, two jobs.
   - **Greenhouse**: food, plus a little air. Grow lights are power-hungry.
   - **Heaters**: skip them and the batteries freeze: fewer cells tomorrow, and repeated cold nights damage batteries for good.
   - **Storm Shelter**: blocks most of a solar storm's radiation, but only when it's powered.
   - **Radiation Monitor**: costs a cell, and warns you about tomorrow's storm, even the fast ones that beat Earth's warning to Mars.
3. **Run the sol.** Watch the day play out.
4. **Debrief.** One plain sentence of cause and effect, plus an optional Real Science card.

**HUD:** POWER, LIFE SUPPORT (days of air and food), RADIATION (dose against the mission budget), and the goal: **FUEL TANK**.
**Win:** fill the tank before the launch window closes. **Mission over** (never "death"): if air or food runs out or the dose budget is spent, the flight surgeon sends the crew home early, and the game shows what happened and one thing to try next time.

**Modes:** Cadet (forgiving), Commander (less power, more storms, a solar-conjunction blackout), and **Replay History: May 2024**, where the real storms of May 2024 hit your outpost on their real dates, ending with the far-side eruption of May 20, 2024 that Curiosity measured at Gale Crater.

## NASA data (and how each piece is used)

| Data | Used for | Live or archive |
|---|---|---|
| **NASA DONKI** solar flares (FLR) and particle storms (SEP) | Every radiation storm in a mission is a real event. Flare class sets storm size (C small, M medium, X big). Event cards show the real class, date, sunspot region and a link to the DONKI record. | **LIVE** (last 30 days, through our cached Vercel proxy or directly from NASA), with a stored snapshot as **ARCHIVE** fallback. The badge always says which. |
| **NASA DONKI** May 2024 (FLR, SEP, CME, GST) | Replay History mode: AR 13664's X-class flares, the Kp 9 storm at Earth on May 10, and the 2,678 km/s far-side CME of May 20. | ARCHIVE |
| **JPL Solar System Dynamics** orbital elements | Earth to Mars light time for the comm-delay mechanic, calculated live in the browser. Checked against JPL Horizons: 11.01 min on Nov 14, 2026 (exact to 2 decimals). | Calculated now |
| **Curiosity RAD** (Hassler et al. 2014; NASA/JPL 2024) | The steady background dose on every sol (0.67 mSv/sol, the real Gale Crater average) and the model for a "big" storm (8,100 µGy on May 20, 2024). | Published figures |
| **NASA OSDR RadLab** (ISS DOSTEL dosimetry) | "Mars vs. ISS" radiation comparison. | ARCHIVE (RadLab's ISS series ends in late 2024) |
| **NASA OSDR** study search | 10 Real Science cards with real study IDs (OSD-###), tied to the greenhouse, shelter and crew. | ARCHIVE (curated at build time) |
| **NASA/JPL MOXIE**, **NASA BVAD Rev 2** (0.895 kg O2 per person per day), **Opportunity** power history | O2 plant concept, crew oxygen needs, dust-storm power loss. | Published figures |
| **Canadian Space Agency**: food production on the Moon and in remote areas | Greenhouse Real Science card (partner agency resource). | Reference |

Full details, raw field names, CORS findings and the source URL for every number are in [`docs/data-notes.md`](docs/data-notes.md). The in-game **Science Log** shows all of this to players.

### Honesty and scaling

The game time-compresses and scales real numbers so a mission fits in about 10 minutes, and it says so in-game:

- 1 sol plays in about 30 seconds.
- Fuel: each cell fills a few percent of the tank. A real crewed ascent needs about 25 to 31 tonnes of oxygen from a 25 to 30 kW plant (MOXIE scaled up about 200 times) running for about 16 months.
- Radiation: the mission dose budget (about 27 mSv) is much stricter than NASA's real 600 mSv career limit, so radiation choices matter in a short game. The background dose per sol is the real measured value.
- Dust storms take 2 or 3 of 7 cells: gentler than Opportunity's real storms.
- We never invent space-weather events, values or study IDs, and we never label stored data as live.

## Architecture

```
src/sim/      Pure, deterministic, seeded simulation. No rendering imports. The heart of the game.
  sim.ts        briefing, previews, running a sol, win/lose
  plan.ts       turns a seed + real DONKI events into the day-by-day mission plan
  explain.ts    plain-language debriefs, endings, badges
  strategies.ts scripted players used by the balance tests
src/data/     DONKI loader (proxy -> direct -> snapshot), light-time calculator, OSDR + RadLab snapshots, Real Science facts
src/render/   Stage interface (3D diorama plugs in here)
src/ui/       HUD, power-budget dock (drag and drop, tap, keyboard), briefing, debrief, Science Log, credits, audio
api/          spaceweather.ts: Vercel Function that proxies DONKI and lets the CDN cache it for an hour
scripts/      fetch-data.mjs (build-time data snapshots), process-art.py (retro art processing + watermark)
```

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # simulation, balance and headless UI tests
npm run fetch-data   # refresh NASA data snapshots in src/data/snapshots/
npm run build        # typecheck + production build into dist/
```

Deployment: Vercel (Vite preset). Optional environment variable `NASA_API_KEY` lets the proxy fall back to api.nasa.gov; the default CCMC DONKI host needs no key.

### Tests

- **No free choices:** for thousands of game states, moving any useful power cell from one module to another always makes at least one thing worse (air, food, fuel, dose, tomorrow's power, equipment wear, or early warning).
- **Balance:** a balanced strategy wins on Cadet (100%) and usually on Commander; pure greed (all power to fuel) always loses.
- **Headless UI test:** boots the real interface and clicks through whole missions, including the May 2024 scenario, offline.

## Use of AI tools

We used AI tools, and here is exactly where and how:

- **Code:** written with AI assistance (Claude Code by Anthropic), directed and reviewed by our team. Every source file has a header comment saying so.
- **Images:** every illustration (title art, event cards, Real Science art) was generated with **Higgsfield** (GPT Image 2.6), then downscaled and palette-reduced for the retro look. **Every image carries a visible "AI-generated" watermark**, baked into the image file.
- **Music:** generated with **Higgsfield** (ElevenLabs Music v2.5); credited here, in the in-game Credits screen, and in each MP3's metadata. Sound effects are synthesized in code.
- **Data:** all data comes from NASA sources. AI-assisted scripts fetch and reformat it, but never invent or change values.
- **Disclosure in the product:** an `ai-assistance` meta tag in `index.html`, an "AI tools" section in the in-game Credits, watermarks on all images, and [`ASSETS.md`](ASSETS.md), which lists every generated asset with its tool, model and full prompt.
- No NASA logos, flags, mission patches or insignia appear in any prompt or asset.

## Credits

**Team Sendy1:** Spencer Hedges and Sandeep Talari.
Fonts: Silkscreen (Jason Kottke) and Atkinson Hyperlegible (Braille Institute), both SIL Open Font License 1.1. Libraries: Three.js, Vite, Vitest (MIT).
Data: NASA DONKI (CCMC), JPL Solar System Dynamics, NASA OSDR and RadLab, NASA/JPL mission results, Canadian Space Agency.
This is a hackathon project and is not endorsed by NASA or any space agency.
