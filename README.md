# Escape Velocity

**A retro 3D Mars outpost game for kids aged 7 to 12, powered by real NASA data.**
NASA Space Apps Challenge 2026, Charlotte, NC · Team Sendy1 (Spencer Hedges and Sandeep Talari)

> Build a base in Gale Crater on Mars, crew after crew. Keep each crew breathing, fed and safe from solar storms, make enough oxygen to fill the rocket that flies them home, and leave the base better for the next crew. Fill the tank and you hit **escape velocity**.

**Play it:** https://playescapevelocity.com · no download, no account, works on Chromebooks, desktops and tablets.

## The challenge

> Space-themed STEM content often oversimplifies the engineering trade-offs that define a real mission or presents them at a level too complex to hold a young learner's attention. Few tools make those trade-offs both tangible and fun. Your challenge is to design and build an interactive game or app that lets students run a lunar or Martian outpost, balancing competing demands like life support, radiation shielding, power, and food production, so they experience firsthand the decisions that determine whether a mission fails or succeeds.

Challenge page: https://www.spaceappschallenge.org/2026/challenges/junior-astronaut-mission-trainer/

## The core trade-off (it's real)

The same machine makes the **air your crew breathes** and the **oxygen your rocket burns**. NASA's MOXIE experiment on the Perseverance rover proved you can pull oxygen out of Mars' carbon-dioxide air, and the main reason NASA wants that technology is rocket propellant. So every power cell you spend on heat, food or a radiation shelter is a cell that is not filling the fuel tank. **No choice is free**, and our tests prove it (see below).

## A game a teacher can build a lesson on

A **campaign** follows three crews (4, then 5, then 6 astronauts) and takes about 35 minutes, with built-in "Talk about it" breaks between crews. Each crew must fill its rocket and launch before the window closes. Then the base sits empty for **26 months** (the real gap between Earth-Mars launch windows) while the robot O2 plant pre-fills the next crew's rocket, just like real Mars propellant plans. Everything a crew builds stays with the base, so every crew builds for the next one. The game saves after every sol, so a class can stop and continue later. A printable **Teacher Guide** (`/teacher/`) has a 45 to 55 minute lesson plan, NGSS connections, vocabulary, discussion questions and a student worksheet.

## How to play

One turn is one **sol** (a Mars day, 24 h 39 min).

1. **Morning briefing.** Weather, how many power cells your solar panels make today, and space weather from Earth. Earth's messages arrive late: today the one-way delay is about 11 minutes.
2. **Budget your power.** Drag power cells onto modules (or tap a slot, or use the keyboard). Every cell must go somewhere.
   - **O2 Plant**: AIR for the crew, or FUEL for the rocket. Same machine, two jobs.
   - **Greenhouse**: food, plus a little air. Grow lights are power-hungry.
   - **Heaters**: skip them and the batteries freeze: fewer cells tomorrow, and repeated cold nights damage batteries for good.
   - **Storm Shelter**: blocks most of a solar storm's radiation, but only when it's powered.
   - **Workshop**: cells here build upgrades that last for every later crew: solar panels, a radiation monitor, a battery bank, a regolith berm, a second greenhouse dome, a bigger O2 plant, and a fission reactor. Each costs power today, and some have a catch (more panels lose more power in dust; a second dome needs more heat).
   - **Radiation Monitor** (once built): costs a cell, and warns you about tomorrow's storm, even the fast ones that beat Earth's warning to Mars.
   - **Battery** (once built): store cells today, get them back tomorrow. Handy before a forecast dust storm.
3. **Run the sol.** Watch the day play out.
4. **Debrief.** One plain sentence of cause and effect, plus an optional Real Science card.

**HUD:** POWER, LIFE SUPPORT (days of air and food), RADIATION (dose against the mission budget), and the goal: **FUEL TANK**.
**Win:** fill the tank before the launch window closes. **Mission over** (never "death"): if air or food runs out or the dose budget is spent, the flight surgeon sends the crew home early, and the game shows what happened and one thing to try next time.

**Stars:** up to 3 per crew: Launch, Safe crew (dose under 60% of budget), and Builder (finish an upgrade for the next crew).

**Modes:** a 3-crew **campaign** (Cadet or Commander), a **Quick mission** (one crew, about 10 minutes), and **Replay History: May 2024**, where the real storms of May 2024 hit your outpost on their real dates, ending with the far-side eruption of May 20, 2024 that Curiosity measured at Gale Crater.

**Class mission: Mission Control** (team play): the whole class runs one base together. The teacher opens a room on the projector and students join from their own devices with a room code and a first name. The modules are split between 4 stations (O2 Plant; Greenhouse and Heat; Radiation; Workshop and Battery), several students can share a station, and everyone sees the whole plan, but each student can only move cells in their own station. The power cells are one shared pool, so stations have to agree who gets them. No chat: only preset "pings" like "I need more cells!" or "Storm warning: shelter!". The teacher runs each sol; the server holds the real mission, using the same simulation and the same real DONKI storms.

## NASA data (and how each piece is used)

| Data | Used for | Live or archive |
|---|---|---|
| **NASA DONKI** solar flares (FLR) and particle storms (SEP) | Every radiation storm in a mission is a real event. Flare class sets storm size (C small, M medium, X big). Event cards show the real class, date, sunspot region and a link to the DONKI record. | **LIVE** (last 30 days, through our cached server or directly from NASA), with a stored snapshot as **ARCHIVE** fallback. The badge always says which. |
| **NASA DONKI** May 2024 (FLR, SEP, CME, GST) | Replay History mode: AR 13664's X-class flares, the Kp 9 storm at Earth on May 10, and the 2,678 km/s far-side CME of May 20. | ARCHIVE |
| **NASA SDO** (Solar Dynamics Observatory) AIA 171 picture | "The Sun right now" on the title screen and in each briefing, next to the latest real DONKI flare. Real NASA imagery (Image: NASA/SDO), not AI. | **LIVE** (through our server, cached 10 minutes, or directly from NASA); shows when it was taken only when that time is known |
| **JPL Solar System Dynamics** orbital elements | Earth to Mars light time for the comm-delay mechanic, calculated live in the browser. Checked against JPL Horizons: 11.01 min on Nov 14, 2026 (exact to 2 decimals). | Calculated now |
| **JPL orbital elements** (all six, in 3D) + **Lambert's problem** (Izzo 2015) | The **Trip planner**: a porkchop plot of about 38,000 real trips from Mars to Earth, showing why launch windows come about every 26 months. Checked against NASA mission design handbooks (NASA/TM-2010-216764, NASA/TM-1998-208533): Earth-to-Mars C3 within 0.1%, Mars-to-Earth v-infinity within 2%; planet positions against JPL Horizons. | Calculated now |
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
  campaign.ts   three crews, the inherited base, the 26-month gap and pre-filled tank, stars, saves
  upgrades.ts   the Workshop's upgrades (costs, effects, catches, real science)
  plan.ts       turns a seed + real DONKI events into the day-by-day mission plan
  explain.ts    plain-language debriefs, endings, badges
  strategies.ts scripted players used by the balance tests
src/data/     DONKI loader (proxy -> direct -> snapshot), light-time calculator, OSDR + RadLab snapshots, Real Science facts
src/orbits/   Trip planner math: 3D planet states from JPL elements, Izzo's Lambert solver, universal-variable propagation, porkchop grids
src/render/   Stage interface (3D diorama plugs in here)
src/ui/       HUD, power-budget dock (drag and drop, tap, keyboard), briefing, debrief, Science Log, credits, audio
src/room/     Mission Control: shared protocol, pure room rules (stations, legal moves, running a sol), the in-memory room store and its HTTP + SSE API
src/ui/room/  Mission Control screens: join/create, the teacher's projector view and the student's station view
src/ui/planner/ Trip planner screen (loaded only when opened): porkchop plot, animated orbit view, end-screen line
api/          spaceweather.ts: the DONKI proxy handler (run by the droplet's server)
deploy/       droplet server (server.ts), Caddyfile, systemd service, one-time setup script
scripts/      fetch-data.mjs (build-time data snapshots), process-art.py (retro art processing + watermark), process-portraits.py (crew portrait sheets + watermark)
```

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # simulation, balance and headless UI tests
npm run fetch-data   # refresh NASA data snapshots in src/data/snapshots/
npm run build        # typecheck + production build into dist/
```

### Deployment

Every push to `main` runs the tests, builds the game, and deploys it to our DigitalOcean droplet through GitHub Actions (`.github/workflows/deploy.yml`), so any teammate with push access can ship. On the droplet, **Caddy** serves the static game with automatic HTTPS and forwards `/api/*` to a tiny Node service (`deploy/server.ts`) that fetches NASA DONKI (`/api/spaceweather`, cached for an hour) and NASA SDO's newest picture of the Sun (`/api/sun`, cached for 10 minutes). One-time server setup lives in `deploy/setup.sh`; the GitHub secrets it needs are `DEPLOY_HOST`, `DEPLOY_URL`, `DEPLOY_SSH_KEY` (a deploy-only key) and `DEPLOY_KNOWN_HOSTS`. The site is served at **playescapevelocity.com** (DNS on Cloudflare, DNS-only, pointing straight at the droplet); `www` redirects there. Caddy's config is `deploy/Caddyfile`: copy it to `/etc/caddy/Caddyfile` and `systemctl reload caddy` after changing it.

**Mission Control rooms** (`/api/rooms`, `src/room/http.ts`) live only in the Node process's memory: nothing is written to disk, and a restart (every deploy) closes open rooms. Routes: `POST /api/rooms` (teacher: returns the code and a secret teacher token), `GET /api/rooms/:code` (no names), `POST /api/rooms/:code/join` (`{name}` or `{token}` to rejoin), `POST /api/rooms/:code/action` (place, remove, move, project, crate, ready, ping, leave), `POST /api/rooms/:code/teacher` (start, plan, run, next, restart, assign, autoAssign, autoRun, kick, end) and `GET /api/rooms/:code/events?token=` (or `?teacher=`): Server-Sent Events with the full public room state on every change and a heartbeat every 20 s. Limits: 200 rooms, 40 players per room, names of up to 12 letters and numbers through a small blocklist, rooms expire after 3 h idle, per-address rate limits on making and joining rooms, 2 KB request bodies. Caddy passes the event stream straight through (`flush_interval -1`, and the stream is `no-transform`).

Optional: put `NASA_API_KEY=...` in `/etc/escape-velocity.env` on the droplet to let the proxy fall back to api.nasa.gov; the default CCMC DONKI host needs no key.

### Tests

- **No free choices:** for thousands of game states, moving any useful power cell from one module to another always makes at least one thing worse (air, food, fuel, dose, tomorrow's power, equipment wear, or early warning).
- **Balance:** a player who builds up the base wins every Cadet expedition; never building makes the last crew's mission much harder (the generational lesson); pure greed (all power to fuel) always loses. Run `npm run balance` for the full report.
- **Campaign:** the base and Workshop progress pass to the next crew, even after an early return; saves round-trip.
- **Headless UI test:** boots the real interface and clicks through a whole 3-crew campaign, a save-and-resume, and the May 2024 scenario, offline.
- **Trip planner:** the Lambert solver against Curtis Example 5.2 and Vallado Example 7-5 (plus energy and angular momentum checks on 60 random cases); planet positions against JPL Horizons; Earth-to-Mars C3 at the NASA handbook minima for 2005, 2026, 2028 and 2031; Mars-to-Earth returns from NASA/TM-1998-208533; launch windows 2018-2048 averaging the 779.94-day synodic period.
- **Mission Control:** the room rules (joining, names, stations, illegal moves, running a sol only when every cell is placed, reconnecting, expiry, limits), an integration test that starts the real server on a random port, joins 4 students, places cells over HTTP and reads the live event stream, and headless teacher and student screens.

## Use of AI tools

We used AI tools, and here is exactly where and how:

- **Code:** written with AI assistance (Claude Code by Anthropic), directed and reviewed by our team. Every source file has a header comment saying so.
- **Images:** every illustration (title art, event cards, Real Science art, crew portraits) was generated with **Higgsfield** (GPT Image 2.6), then downscaled and palette-reduced for the retro look. **Every image carries a visible "AI-generated" watermark**, baked into the image file. Crew portraits come in one sprite sheet per crew: each face has a baked-in "AI" tag and each sheet a full "AI-generated" label. The crew members are fictional. The one exception is the live picture of the Sun, which is real NASA/SDO imagery loaded from NASA and credited as such.
- **Music:** generated with **Higgsfield** (ElevenLabs Music v2.5); credited here, in the in-game Credits screen, and in each MP3's metadata. Sound effects are synthesized in code.
- **Data:** all data comes from NASA sources. AI-assisted scripts fetch and reformat it, but never invent or change values.
- **Disclosure in the product:** an `ai-assistance` meta tag in `index.html`, an "AI tools" section in the in-game Credits, watermarks on all images, and [`ASSETS.md`](ASSETS.md), which lists every generated asset with its tool, model and full prompt.
- No NASA logos, flags, mission patches or insignia appear in any prompt or asset.

## Credits

**Team Sendy1:** Spencer Hedges and Sandeep Talari.
Fonts: Silkscreen (Jason Kottke) and Atkinson Hyperlegible (Braille Institute), both SIL Open Font License 1.1. Libraries: Three.js, Vite, Vitest (MIT).
Data: NASA DONKI (CCMC), JPL Solar System Dynamics, NASA OSDR and RadLab, NASA/JPL mission results, Canadian Space Agency.
This is a hackathon project and is not endorsed by NASA or any space agency.
