# Escape Velocity

**A retro 3D Mars outpost game for kids aged 7 to 12, powered by real NASA data.**
NASA Space Apps Challenge 2026, Charlotte, NC · Team Escape Velocity (Spencer Hedges, Sandeep Talari, Jerod Wallace, Meg Patel, Al Patel)

> Build a base in Gale Crater on Mars, crew after crew. Keep each crew breathing, fed and safe from solar storms, make enough oxygen to fill the rocket that flies them home, and leave the base better for the next crew. Fill the tank and you hit **escape velocity**.

**Play it:** https://playescapevelocity.com · no download, no account, works on Chromebooks, desktops and tablets.

## The challenge

> Space-themed STEM content often oversimplifies the engineering trade-offs that define a real mission or presents them at a level too complex to hold a young learner's attention. Few tools make those trade-offs both tangible and fun. Your challenge is to design and build an interactive game or app that lets students run a lunar or Martian outpost, balancing competing demands like life support, radiation shielding, power, and food production, so they experience firsthand the decisions that determine whether a mission fails or succeeds.

Challenge page: https://www.spaceappschallenge.org/2026/challenges/junior-astronaut-mission-trainer/

## The core trade-off (it's real)

The same machine makes the **air your crew breathes** and the **oxygen your rocket burns**. NASA's MOXIE experiment on the Perseverance rover proved you can pull oxygen out of Mars' carbon-dioxide air, and the main reason NASA wants that technology is rocket propellant. So every power cell you spend on heat, food or a radiation shelter is a cell that is not filling the fuel tank. **No choice is free**, and our tests prove it (see below).

## A game a teacher can build a lesson on

A **campaign** follows three crews (4, then 5, then 6 astronauts) and takes about 35 minutes, with built-in "Talk about it" breaks between crews. Each crew must fill its rocket and launch before the window closes. Then the base sits empty for **26 months** (the real gap between Earth-Mars launch windows) while the robot O2 plant pre-fills the next crew's rocket, just like real Mars propellant plans. Everything a crew builds stays with the base, so every crew builds for the next one. The game saves after every sol, so a class can stop and continue later. A printable **Teacher Guide** (`/teacher/`) has a 45 to 55 minute lesson plan, NGSS connections, vocabulary, discussion questions and a student worksheet.

## Built to keep kids playing

A lesson is one session; curiosity is many. Everything below rewards *playing well* (sheltering a crew, building for the next one, launching on time), so the more a kid plays, the more they practice the real trade-offs. Nothing is bought; there are no ads and no accounts.

- **Astronaut rank:** XP for every sol, storm survived, upgrade built and rocket launched; 50 levels and 11 ranks (Cadet to Legend), with a level-up celebration and something new unlocked at almost every level (`src/meta/rank`).
- **Daily missions:** three small goals a day, the same for everyone on a given date (for example "Shelter your crew from a big storm"), plus a gentle streak (`src/meta/rank/daily.ts`).
- **Storm Cards:** every real NASA solar storm a crew faces becomes a collectible card, with rarity from the real flare class (C common, M rare, X epic, X5+ legendary) and a link to its NASA DONKI record. The live feed means new real storms appear as the real Sun erupts (`src/meta/cards`).
- **The Hangar:** suit colors, rocket paint jobs, base lights and a rover pet, all shown in the 3D outpost and unlocked by rank (`src/meta/hangar`).
- **Flight mini-games:** land the crew with real Mars or Moon gravity, and fly the rocket to escape velocity; medals and bonus XP for skill, never a penalty for the mission (`src/meta/flight`).
- **Rival Race:** race three AI rival commanders (fictional, with pixel portraits) on the *same* base with the *same* real storms, so it is fair. Live standings in the HUD, an OVERTAKE! moment when you pass someone, friendly banter, and a podium. First to launch with the crew safe wins (ties: fewer sols, then less radiation, then more air and food). Rivals are the game's own scripted players (the "Suggest a plan" advisor, the balanced player, the builder, and racers and daredevils who skip the shelter or the heaters and can be sent home early). Five leagues, Bronze to Legend, with smarter rivals in each; top-2 finishes move you up, and nobody is ever moved down (`src/meta/race`).
- **Friend challenges, no server and no names:** after a race or a quick mission, "Challenge a friend" makes a link that carries the mission's seed and the player's run (rocket fuel after every sol). The friend races that run as a ghost on the same base with the same storms. Links show a callsign made from fixed word lists ("Brave Comet 42"), never typed text.

The features plug into the game through one small module (`src/meta/hooks.ts`): the game announces what happened, and each feature listens. Progress is stored only in the browser.

## From Mars to Earth

Running a Mars base means living within limits: a tiny power budget, no water to waste, food grown under lights. At the end of every mission the game links what the crew did to NASA technology that already improves lives and protects the environment on Earth (space-station water recycling, NASA's first vertical farm and today's indoor farming, NASA-invented flow batteries storing solar power for communities), each with its NASA Spinoff source (`src/data/earth.ts`).

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

**Landing site (Mars):** build at **Gale Crater** (Curiosity's crater, the default) or on the icy plains of **Arcadia Planitia** (47°N), where NASA's Subsurface Water Ice Mapping (SWIM) maps show likely ice in the top meter. Ice means water, so the greenhouse grows twice the food and air; but farther north there is less sunshine (1 fewer power cell) and more cold nights. The sizes of those effects are game values; the ice map is real.

**Modes:** a 3-crew **campaign** (Cadet or Commander), a **Quick mission** (one crew, about 10 minutes), and **Replay History: May 2024**, where the real storms of May 2024 hit your outpost on their real dates, ending with the far-side eruption of May 20, 2024 that Curiosity measured at Gale Crater.

**For presenters:** [playescapevelocity.com/demo](https://playescapevelocity.com/demo) opens a 3-sol version of the May 2024 replay you can play live in about two minutes: the rocket starts 78% full, sols 1 and 2 are calm, and sol 3 brings the real X-class flare of May 8, 2024 with a warning from Earth. It plays the same way every time (tested for every Earth-Mars light time). **Watch a demo** on the title screen (or `?demo`) plays a mission by itself with the planning advisor, for screen recordings and event tables; any tap stops it.

**Daily challenge:** one mission a day for everyone (the day changes at midnight in Charlotte, NC). Everyone gets the same crew, the same weather and the same real NASA DONKI storms, frozen at the day's first request and labeled LIVE or ARCHIVE like the rest of the game. Mars on most days, the Moon on Sundays. Finish the mission and put your crew on today's board with a nickname (or as "Anonymous astronaut"): launched crews rank first, then the fewest sols, then the lowest radiation dose, then the most stars. **Today's best** on the title screen shows the board. Without our server, the challenge still plays from the stored NASA snapshot, and the game says scores can't be sent right now.

**Class mission: Mission Control** (team play): the whole class runs one base together. The teacher opens a room on the projector and students join from their own devices with a room code and a first name. The modules are split between 4 stations (O2 Plant; Greenhouse and Heat; Radiation; Workshop and Battery), several students can share a station, and everyone sees the whole plan, but each student can only move cells in their own station. The power cells are one shared pool, so stations have to agree who gets them. No chat: only preset "pings" like "I need more cells!" or "Storm warning: shelter!". The teacher runs each sol; the server holds the real mission, using the same simulation and the same real DONKI storms.

**Reading help and display options** (for slow readers, English learners, dyslexia and low vision): every dialog and tutorial tip has a **Read to me** button that reads it in order with the browser's own on-device voices (no network, no AI), highlighting each sentence and saying numbers naturally ("2.5 d" is "2.5 days"). **Auto read-aloud** reads each new briefing and debrief, **My status** reads the HUD meters, and a voice picker prefers an English voice. Read-aloud is separate from the sound switch, and the music gets quieter while it reads. The menu (or **Text and voice** on the title screen) also has **Larger text**, **High contrast** (checked against WCAG AA) and **Dyslexia-friendly spacing** (British Dyslexia Association style guide; the font stays Atkinson Hyperlegible). Without a speech engine, the read-aloud controls are hidden.

**Junior Astronaut certificate:** after any win and at the campaign finale, type a name (it is never saved), and print the certificate or save it as a picture. It shows the stars, crews launched, the base built and the date, drawn in the browser.

## NASA data (and how each piece is used)

| Data | Used for | Live or archive |
|---|---|---|
| **NASA DONKI** solar flares (FLR) and particle storms (SEP) | Every radiation storm in a mission is a real event. Flare class sets storm size (C small, M medium, X big). Event cards show the real class, date, sunspot region and a link to the DONKI record. | **LIVE** (last 30 days, through our cached server or directly from NASA), with a stored snapshot as **ARCHIVE** fallback. The badge always says which. |
| **NASA DONKI** CME analyses + **WSA-ENLIL** model runs | The **Space weather radar** (title screen, menu, and "See it on the radar" in each briefing): every real CME of the last 30 days flies out from the Sun past Earth and Mars at its real speed, direction and cone width (DONKI's most accurate analysis). Our simple constant-speed model estimates whether and when each one reached Earth's and Mars' distance; NASA's own WSA-ENLIL predictions from DONKI are shown next to it. Calm month? It says so and offers the May 2024 replay. | **LIVE** (CMEs are part of `/api/spaceweather`; the radar can also ask DONKI directly), else the stored snapshot as **ARCHIVE**; May 2024 is ARCHIVE |
| **NASA DONKI** May 2024 (FLR, SEP, CME, GST) | Replay History mode: AR 13664's X-class flares, the Kp 9 storm at Earth on May 10, and the 2,678 km/s far-side CME of May 20. | ARCHIVE |
| **NASA SDO** (Solar Dynamics Observatory) AIA 171 picture | "The Sun right now" on the title screen and in each briefing, next to the latest real DONKI flare. Real NASA imagery (Image: NASA/SDO), not AI. | **LIVE** (through our server, cached 10 minutes, or directly from NASA); shows when it was taken only when that time is known |
| **JPL Solar System Dynamics** orbital elements | Earth to Mars light time for the comm-delay mechanic, and Earth's and Mars' positions on the Space weather radar, calculated live in the browser. Checked against JPL Horizons: 11.01 min on Nov 14, 2026 (exact to 2 decimals). | Calculated now |
| **JPL orbital elements** (all six, in 3D) + **Lambert's problem** (Izzo 2015) | The **Trip planner**: a porkchop plot of about 38,000 real trips from Mars to Earth, showing why launch windows come about every 26 months. Checked against NASA mission design handbooks (NASA/TM-2010-216764, NASA/TM-1998-208533): Earth-to-Mars C3 within 0.1%, Mars-to-Earth v-infinity within 2%; planet positions against JPL Horizons. | Calculated now |
| **Curiosity RAD** (Hassler et al. 2014; NASA/JPL 2024) | The steady background dose on every sol (0.67 mSv/sol, the real Gale Crater average) and the model for a "big" storm (8,100 µGy on May 20, 2024). | Published figures |
| **NASA OSDR RadLab** (ISS DOSTEL dosimetry) | "Mars vs. ISS" radiation comparison. | ARCHIVE (RadLab's ISS series ends in late 2024) |
| **NASA OSDR** study search | 10 Real Science cards with real study IDs (OSD-###), tied to the greenhouse, shelter and crew. | ARCHIVE (curated at build time) |
| **NASA/JPL MOXIE**, **NASA BVAD Rev 2** (0.895 kg O2 per person per day), **Opportunity** power history | O2 plant concept, crew oxygen needs, dust-storm power loss. | Published figures |
| **Canadian Space Agency**: food production on the Moon and in remote areas | Greenhouse Real Science card (partner agency resource). | Reference |
| **NASA SWIM** (Subsurface Water Ice Mapping, PSI for NASA's Mars Exploration Program) ice-consistency maps | The Arcadia Planitia landing site: its real map values (top meter +0.55 at Arcadia, about 0 at Gale), 3 Real Science cards, the Science Log. | ARCHIVE (values read from the SWIM 2.0 GeoTIFFs) |
| **NASA Mars Trek** elevations (MOLA + HRSC DEM) | The 3D ground: Gale Crater with Mount Sharp, or the flat plains of Arcadia Planitia. | ARCHIVE |

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
src/data/     DONKI loader (proxy -> direct -> snapshot), light-time and planet-position calculator, OSDR + RadLab snapshots, Real Science facts
src/radar/    Space weather radar math (pure, tested): DONKI Stonyhurst directions -> solar-system directions, constant-speed CME model, plain-language text
src/orbits/   Trip planner math: 3D planet states from JPL elements, Izzo's Lambert solver, universal-variable propagation, porkchop grids
src/render/   Stage interface (3D diorama plugs in here)
src/ui/       HUD, power-budget dock (drag and drop, tap, keyboard), briefing, debrief, Science Log, credits, audio
src/room/     Mission Control: shared protocol, pure room rules (stations, legal moves, running a sol), the in-memory room store and its HTTP + SSE API
src/ui/room/  Mission Control screens: join/create, the teacher's projector view and the student's station view
src/class/    Teacher dashboard: shared protocol, result checks, class summary, and the class-board store (saved to STATE_DIR) and HTTP API
src/ui/dashboard/  the teacher dashboard page (/?dashboard=CODE&key=KEY); src/ui/classboard.ts sends results from the game
src/daily/    Daily challenge: shared protocol and dates, the frozen pool, the replay check, the board store and its HTTP API
src/ui/daily/ Daily challenge screens: intro card, end-screen board (nickname and rank), Today's best
src/ui/radar/ Space weather radar screen (SVG radar, timeline, list), loaded on demand
src/ui/planner/ Trip planner screen (loaded only when opened): porkchop plot, animated orbit view, end-screen line
api/          spaceweather.ts: the DONKI proxy handler (run by the droplet's server)
deploy/       droplet server (server.ts), Caddyfile, systemd service, one-time setup script
scripts/      fetch-data.mjs (build-time data snapshots), process-art.py (retro art processing), process-portraits.py (crew portrait sheets); both take --watermark to bake a label in
```

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # simulation, balance and headless UI tests
npm run fetch-data   # refresh NASA data snapshots in src/data/snapshots/
npm run fetch-terrain                              # Gale Crater elevations (NASA Mars Trek)
node scripts/fetch-terrain.mjs --site=arcadia      # Arcadia Planitia elevations
node scripts/fetch-swim.mjs                        # SWIM ice-map values at both landing sites
npm run build        # typecheck + production build into dist/
```

### Deployment

Every push to `main` runs the tests, builds the game, and deploys it to our DigitalOcean droplet through GitHub Actions (`.github/workflows/deploy.yml`), so any teammate with push access can ship. On the droplet, **Caddy** serves the static game with automatic HTTPS and forwards `/api/*` to a tiny Node service (`deploy/server.ts`) that fetches NASA DONKI flares, particle storms and CMEs (`/api/spaceweather`, cached for an hour; CMEs are trimmed to the radar's fields, about 30 KB) and NASA SDO's newest picture of the Sun (`/api/sun`, cached for 10 minutes). One-time server setup lives in `deploy/setup.sh`; the GitHub secrets it needs are `DEPLOY_HOST`, `DEPLOY_URL`, `DEPLOY_SSH_KEY` (a deploy-only key) and `DEPLOY_KNOWN_HOSTS`. The site is served at **playescapevelocity.com** (DNS on Cloudflare, DNS-only, pointing straight at the droplet); `www` redirects there. Caddy's config is `deploy/Caddyfile`: copy it to `/etc/caddy/Caddyfile` and `systemctl reload caddy` after changing it.

**Mission Control rooms** (`/api/rooms`, `src/room/http.ts`) live only in the Node process's memory: nothing is written to disk, and a restart (every deploy) closes open rooms. Routes: `POST /api/rooms` (teacher: returns the code and a secret teacher token), `GET /api/rooms/:code` (no names), `POST /api/rooms/:code/join` (`{name}` or `{token}` to rejoin), `POST /api/rooms/:code/action` (place, remove, move, project, crate, ready, ping, leave), `POST /api/rooms/:code/teacher` (start, plan, run, next, restart, assign, autoAssign, autoRun, kick, end) and `GET /api/rooms/:code/events?token=` (or `?teacher=`): Server-Sent Events with the full public room state on every change and a heartbeat every 20 s. Limits: 200 rooms, 40 players per room, names of up to 12 letters and numbers through a small blocklist, rooms expire after 3 h idle, per-address rate limits on making and joining rooms, 2 KB request bodies. Caddy passes the event stream straight through (`flush_interval -1`, and the stream is `no-transform`).

**Teacher dashboard** (`/api/class`, `src/class/http.ts`): when a teacher makes a class code, the game registers it and gets a secret dashboard key. Games played with that code send one small result per crew (a random player id, an optional nickname and game numbers; no addresses or anything else). Routes: `POST /api/class` (`{code}` -> `{code, key}`), `POST /api/class/:code/report`, `GET /api/class/:code?key=&since=` (the dashboard) and `POST /api/class/:code/teacher` (`remove` a student, `clear` every result). Class boards are saved as `classes.json` in `STATE_DIR` (systemd's `StateDirectory=escape-velocity`, so `/var/lib/escape-velocity`; written atomically a couple of seconds after a change and on shutdown), and deleted 7 days after their last result. Limits: 500 classes, 60 students per class, the latest result for each of the 3 crews per student (plus running totals, at most 100 results), 2 KB bodies, per-address rate limits, nicknames of up to 12 letters and numbers through the same blocklist. The key is stored only as a hash.
**Daily challenge** (`/api/daily`, `src/daily/http.ts`): `GET /api/daily` returns today's challenge `{date, seed, site, difficulty, lightTimeMin, eventPool, poolSource, poolFetchedAt, poolStart, poolEnd}`; the first request of the day (US Eastern) freezes the pool of real DONKI events (our cached proxy, else the bundled snapshot). `POST /api/daily/:date/submit` takes `{playerId, nickname, moves}`, where `moves` is one entry per sol (allocation, cargo crate, Workshop project). The server never trusts a score from the browser: it **replays** the moves on a fresh mission built from the frozen pool with the same simulation, rejects any move the real game could not make (too many or too few cells, a module over its cap, a crate with no lander, a project that can't be built, moves after the end, an unfinished mission), and scores the result itself. `GET /api/daily/:date/top?limit=20&player=` returns the board (nickname, sols, dose, stars, launched) and the asking player's rank. What is stored: per player per day, only a nickname (up to 12 letters, numbers and spaces, through the Mission Control blocklist; or none) and their best score, under a hash of a random id the browser keeps in localStorage. No names, addresses or times. Limits: one best entry per player per day, 500 entries a day (a better score pushes the last one off), 60 scores per address per 10 minutes, 4 KB request bodies, 14 days kept (a game started before midnight can be sent the next day). Boards and frozen pools are saved to `daily.json` in `STATE_DIR` (default `/var/lib/escape-velocity`), written atomically (temp file + rename) about a second after each change, right away when a day's pool is frozen, and when the service stops.

Optional: put `NASA_API_KEY=...` in `/etc/escape-velocity.env` on the droplet to let the proxy fall back to api.nasa.gov; the default CCMC DONKI host needs no key.

### Tests

- **No free choices:** for thousands of game states, moving any useful power cell from one module to another always makes at least one thing worse (air, food, fuel, dose, tomorrow's power, equipment wear, or early warning).
- **Balance:** a player who builds up the base wins every Cadet expedition; never building makes the last crew's mission much harder (the generational lesson); pure greed (all power to fuel) always loses. Run `npm run balance` for the full report.
- **Campaign:** the base and Workshop progress pass to the next crew, even after an early return; saves round-trip.
- **Headless UI test:** boots the real interface and clicks through a whole 3-crew campaign, a save-and-resume, and the May 2024 scenario, offline.
- **Teacher dashboard:** the class-board store (registering, result checks, nickname blocklist, limits, expiry, saving and loading `classes.json` in a temp folder), the real server over HTTP (including a restart), the dashboard page from a fixture, and a student's quick mission sending its result and naming itself on the end screen.
- **Reading and display:** read-aloud order and number wording with a fake speech engine, auto read-aloud, the voice picker's fallbacks, display settings saved and restored, high-contrast colors checked against WCAG AA, every read-aloud control hidden without a speech engine, and the certificate drawn on a fake canvas (name, stars, art credit, print and save).
- **Trip planner:** the Lambert solver against Curtis Example 5.2 and Vallado Example 7-5 (plus energy and angular momentum checks on 60 random cases); planet positions against JPL Horizons; Earth-to-Mars C3 at the NASA handbook minima for 2005, 2026, 2028 and 2031; Mars-to-Earth returns from NASA/TM-1998-208533; launch windows 2018-2048 averaging the 779.94-day synodic period.
- **Mission Control:** the room rules (joining, names, stations, illegal moves, running a sol only when every cell is placed, reconnecting, expiry, limits), an integration test that starts the real server on a random port, joins 4 students, places cells over HTTP and reads the live event stream, and headless teacher and student screens.
- **Daily challenge:** dates and the site rule, pool freezing (one pool per date, kept across a restart), replay verification (a real game scores exactly as played; tampered moves and illegal allocations are rejected), board order, one best entry per player, the 500-entry, rate and 14-day limits, the nickname blocklist, an HTTP test of the real server on a random port, and headless screens that play today's mission and send the score.

## Use of AI tools

We used AI tools, and here is exactly where and how:

- **Code:** written with AI assistance (Claude Code by Anthropic), directed and reviewed by our team. Every source file has a header comment saying so.
- **Images:** every illustration (title art, event cards, Real Science art, crew portraits) was generated with **Higgsfield** (GPT Image 2.6), then downscaled and palette-reduced for the retro look. The Space Apps organizer confirmed that a clear disclosure (at the start of our slides and at the bottom of the website) is enough, so images carry no per-image watermark; the title screen's footer and the Credits say which art is AI-generated. The one exception is the live picture of the Sun, which is real NASA/SDO imagery loaded from NASA and credited as such.
- **Music:** generated with **Higgsfield** (ElevenLabs Music v2.5); credited here, in the in-game Credits screen, and in each MP3's metadata. Sound effects are synthesized in code.
- **Data:** all data comes from NASA sources. AI-assisted scripts fetch and reformat it, but never invent or change values.
- **Disclosure in the product:** an `ai-assistance` meta tag in `index.html`, an "AI tools" section in the in-game Credits, a disclosure line at the bottom of the title screen, the disclosure on the pitch deck's first slide, and [`ASSETS.md`](ASSETS.md), which lists every generated asset with its tool, model and full prompt.
- No NASA logos, flags, mission patches or insignia appear in any prompt or asset.

## Credits

**Team Escape Velocity:** Spencer Hedges and Sandeep Talari.
Fonts: Silkscreen (Jason Kottke) and Atkinson Hyperlegible (Braille Institute), both SIL Open Font License 1.1. Libraries: Three.js, Vite, Vitest (MIT).
Data: NASA DONKI (CCMC), JPL Solar System Dynamics, NASA OSDR and RadLab, NASA/JPL mission results, Canadian Space Agency.
This is a hackathon project and is not endorsed by NASA or any space agency.
