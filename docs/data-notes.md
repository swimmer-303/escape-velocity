# Data notes

Written with AI assistance (Claude Code). See README "Use of AI tools".

What this covers: where Escape Velocity's real NASA data comes from, what the raw fields are called, what the browser is allowed to fetch directly (CORS), and which game claims the data does or does not support. Everything below was checked on **2026-11-14** with `curl` and `scripts/fetch-data.mjs`.

Refresh all snapshots with `npm run fetch-data` (or `node scripts/fetch-data.mjs --only=donki,radlab,osdr`). A snapshot is replaced only when every request behind it succeeded. If anything fails, the old file stays and the script exits with code 1. This failure path was tested with a simulated outage.

## Snapshot files (`src/data/snapshots/`)

| File | What it is | Window |
|---|---|---|
| `donki-recent.json` | DONKI flares, SEPs, CMEs and storms | last 30 days, UTC (2026-10-15 to 2026-11-14 at time of writing) |
| `donki-may2024.json` | same | 2024-05-01 to 2024-05-31 |
| `radlab-iss.json` | ISS absorbed dose, daily | 2024-09-29 to 2024-10-28 (newest 30 full days RadLab has) |
| `radlab-iss-may2024.json` | same detector during the May 2024 storms | 2024-05-01 to 2024-05-31 |
| `osdr-cards.json` | 10 "Real Science" cards | n/a |

All of these are **archived snapshots**. Only call something "live" when it was fetched in the current session; `fetchedAt` records when each file was made.

---

## 1. DONKI (space weather)

### Endpoints

| Host | URL pattern | Key | Status on 2026-11-14 |
|---|---|---|---|
| **ccmc.gsfc.nasa.gov** (use this) | `https://ccmc.gsfc.nasa.gov/DONKI/WS/get/{FLR,SEP,CME,GST,notifications}?startDate=yyyy-MM-dd&endDate=yyyy-MM-dd` | none | 200, ~0.5-1.5 s |
| kauai.ccmc.gsfc.nasa.gov (old) | `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/...` | none | **down**: TCP connect timed out from our network and returned "connection refused" from a second network. Every `link` field in DONKI now points at `ccmc.gsfc.nasa.gov/DONKI/view/...`. |
| api.nasa.gov | `https://api.nasa.gov/DONKI/{FLR,...}?startDate=...&endDate=...&api_key=KEY` | DEMO_KEY or your own | 200; returned the same JSON content as CCMC (checked for May 2024 GST) |

`scripts/fetch-data.mjs` tries ccmc, then kauai, then api.nasa.gov (with `NASA_API_KEY` if set, otherwise `DEMO_KEY`).

> **Heads-up for `src/data/donki.ts`:** its `DIRECT_BASE` is still the kauai host, which is not responding. Change it to `https://ccmc.gsfc.nasa.gov/DONKI/WS/get`.

### CORS

Browsers always send an `Origin` header on cross-origin requests, so the header test below sent one too.

- **ccmc.gsfc.nasa.gov: yes.** Returns `Access-Control-Allow-Origin: *` when the request has an `Origin` header, plus `Vary: Origin,...`. Without `Origin` (plain curl) the header is absent, which is normal.
- **api.nasa.gov: yes.** Returns `access-control-allow-origin: *`.
- kauai: could not be tested because it is down.

### Rate limits

- CCMC returned `X-Rate-Limit-Remaining: 119` on every call; the limit itself is not published.
- api.nasa.gov with DEMO_KEY returned `x-ratelimit-limit: 10` and `x-ratelimit-remaining: 9`. That is lower than the commonly quoted 30/hour, so don't let the game poll it with DEMO_KEY. A full refresh is 8 requests (4 types x 2 windows).

### Field names (raw JSON, as returned)

- **FLR**: `flrID`, `catalog`, `instruments[].displayName` (e.g. "GOES-P: EXIS 1.0-8.0"), `beginTime`, `peakTime`, `endTime`, `classType` (e.g. "X8.7"), `sourceLocation` (e.g. "S19W90"), `activeRegionNum` (e.g. 13664), `note`, `link`, `linkedEvents[].activityID` or `null`, `sentNotifications`, `submissionTime`, `versionId`.
- **SEP**: `sepID`, `eventTime`, `instruments[].displayName` (e.g. "GOES-P: SEISS >10 MeV", "STEREO A: IMPACT 13-100 MeV", "MODEL: REleASE:ACE/EPAM 15.8-39.8 MeV"), `link`, `linkedEvents[].activityID`, `sentNotifications[]` (`messageID`, `messageIssueTime`, `messageURL`), `submissionTime`, `versionId`.
- **CME**: `activityID`, `catalog`, `startTime`, `instruments[].displayName`, `sourceLocation` (often ""), `activeRegionNum`, `note`, `cmeAnalyses[]`, `linkedEvents`, `sentNotifications`, `link`, `submissionTime`, `versionId`.
  - `cmeAnalyses[]` contains `isMostAccurate`, `levelOfData`, `time21_5`, `latitude`, `longitude`, `halfAngle`, `speed` (km/s), `type`, `featureCode`, `imageType`, `measurementTechnique`, `note`, `minorHalfWidth`, `speedMeasuredAtHeight`, `tilt`, `submissionTime`, `link`, and `enlilList[]`.
  - `enlilList[]` contains `modelCompletionTime`, `au`, `estimatedShockArrivalTime`, `isEarthGB`, `isEarthMinorImpact`, `kp_18/90/135/180`, `link`, `cmeIDs`, and `impactList[]` (`location`, `arrivalTime`, `isGlancingBlow`, `isMinorImpact`). **`location` can be "Mars"**, so this is where DONKI's model predictions for Mars live.
- **GST**: `gstID`, `startTime`, `allKpIndex[]` (`kpIndex`, `observedTime`, `source`), `link`, `linkedEvents`, `sentNotifications`, `submissionTime`, `versionId`.
- **notifications**: `messageType`, `messageID`, `messageURL`, `messageIssueTime`, `messageBody` (free text, Markdown-ish).

How the snapshots are normalized:

- `flares[]`: `{id (=flrID), classType, beginTime, peakTime, sourceLocation, activeRegionNum, link}`
- `seps[]`: `{id, eventTime, instruments[], linkedEvents[], link}`
- `cmes[]`: `{id (=activityID), startTime, speed, sourceLocation, link}`. `speed` comes from the first `cmeAnalyses` entry with `isMostAccurate: true`, or `null` if there isn't one.
  - Optional radar fields (added 2026-11-14; older snapshots and stored pools may lack them), from the same first most-accurate analysis: `time21_5` (front at 21.5 solar radii), `longitude` and `latitude` (Stonyhurst degrees: 0 = toward Earth, + = west), `halfAngle` (degrees), and `enlil`: `{runs, completedAt, link, earth, mars}` summarizing the **newest** WSA-ENLIL run (by `modelCompletionTime`) under any most-accurate analysis. `earth` = `estimatedShockArrivalTime` + `isEarthGB` / `isEarthMinorImpact`; `mars` = the `impactList` entry with `location: "Mars"`; each is `{time, glancing, minor}` or `null` (no arrival predicted). `enlil` is `null` when DONKI lists no run.
  - An ENLIL arrival dated before the CME started is dropped: it is a typo in DONKI (the 2026-10-25T03:12 CME's run lists Parker Solar Probe on **2016**-10-28).
  - Plane-of-sky analyses (`measurementTechnique: "Plane-of-sky"`) have `longitude: null`: DONKI has a speed but no direction for them, so the radar lists them but cannot draw them.
- Every snapshot also has `included: ["FLR","SEP","CME","GST"]`: the record types actually fetched. An empty `cmes` list means "no CMEs" only when `included` has `"CME"` (the proxy leaves it out if the CME request failed; the browser's direct fallback fetches only FLR and SEP).
- `gsts[]`: `{id, startTime, maxKp (max of allKpIndex), link}`
- An empty `sourceLocation` ("") is turned into `null`.

### Event counts

| Window | Flares (X / M / C) | SEP entries | CMEs | Storms (GST) |
|---|---|---|---|---|
| Recent: 2026-10-15 to 2026-11-14 | 13 (**0 X / 10 M / 3 C**); biggest M3.5 on 2026-11-05 from AR 14566 | **0** | 89 at 18:11 UTC (fastest 1048 km/s) | 1: 2026-10-31, max Kp 6 (G2), linked to a high-speed stream |
| May 2024 | 181 (**21 X / 155 M / 5 C**); biggest X8.7 on 2024-05-14 from AR 13664 | 14 | 144 (fastest 2678 km/s) | 5, max Kp 9.0 on 2024-05-10 (G5) |

Things to know about these counts:

- **DONKI's flare list is not a complete C-class catalog.** The 3-5 C flares are the few the catalog happened to record, not every C flare that occurred. In the game, treat FLR as "notable flares (mostly M and X)".
- **SEP entries are one per instrument or energy channel, not one per storm.** The 14 May 2024 entries describe three clusters of particle events near Earth and STEREO-A (May 9-10, May 11, May 13), each seen by several instruments or models. Don't tell players "14 radiation storms".
- In the recent window, the only flare-like value DONKI gives is `classType`; there were no SEPs at all.

### May 2024 findings

- **G5 storm at Earth:** GST `2024-05-10T15:00:00-GST-001`, max Kp 9.0, is in DONKI as expected.
- **The May 20 "X12" flare is NOT in DONKI.** There is no FLR entry on 2024-05-20, and the largest FLR entries late in the month are X2.8 (May 27) and X1.4 (May 29) from AR 13697. The May 20 eruption came from the Sun's far side as seen from Earth, so GOES (which DONKI's flare list relies on) could not measure its X-ray class. The ~X12 estimate came from other sources (see the fact table).
  - DONKI has no `sourceLocation` or `activeRegionNum` for it.
  - DONKI does have the eruption as **CME `2024-05-20T05:36:00-CME-001`**: "Fast halo CME ... The source is believed to be backsided". It has two analyses flagged most-accurate, a shock fit at 2678 km/s and a bulk fit at 1927 km/s. Link: https://ccmc.gsfc.nasa.gov/DONKI/view/CME/31034/-1
- **No DONKI SEP is linked to May 20.** May's SEP list stops at 2024-05-13. DONKI's SEP instruments are near Earth or on STEREO-A, so the Mars particle event measured by Curiosity RAD is not a DONKI SEP record.
- **Mars in DONKI:** 30 May 2024 CMEs have WSA-ENLIL `impactList` entries with `location: "Mars"`, for example 2024-05-11T01:36 CME, predicted Mars arrival 2024-05-13T17:42Z. The 2024-05-22 weekly report (`20240522-7D-001`) lists predicted Mars arrivals for the May 15-17 CMEs, and notification `20240523-AL-002` names Mars (glancing blow).
  - **But the ENLIL runs for the May 20 CME predicted impacts only at Solar Orbiter, OSIRIS-APEX (glancing) and Juno, not Mars** (notification `20240520-AL-001`).
  - So the game must not say "DONKI predicted the May 20 storm would hit Mars". The particles that reached Mars are documented by NASA/JPL (see fact table), not in DONKI's SEP or ENLIL records.

---

### Space weather radar: CMEs, coordinates and NASA's ENLIL model

- **Proxy:** `/api/spaceweather` now fetches `CME` for the same 30-day window, in parallel with FLR and SEP (CCMC answered a month of CMEs in about 1 s, 162 KB raw; the normalized response is about 32 KB). If the CME request fails, the answer still has flares and SEPs, without `"CME"` in `included`. The radar then tries `ccmc.gsfc.nasa.gov/DONKI/WS/get/CME` directly from the browser (CORS allowed), and otherwise falls back to the stored snapshot, labeled ARCHIVE.
- **Coordinates:** DONKI gives CME directions in **Stonyhurst heliographic** coordinates: longitude 0 is the solar meridian facing Earth, positive is **west** (the Sun's right-hand limb as seen from Earth), which faces the way Earth moves around the Sun. So W90 points 90° *ahead* of Earth and W180 is the far side. `src/radar/geometry.ts` rebuilds the Stonyhurst axes in heliocentric ecliptic space at the CME's `time21_5` (Earth's position from the JPL elements; solar equator tilted 7.25° with ascending node from Meeus ch. 29) and converts the analysis direction. The tilt shifts longitudes by at most ~0.5° but also tells us how far above or below the planets' plane a CME is aimed.
- **Checks** (`src/radar/geometry.test.ts`): Earth and Mars positions match JPL Horizons (heliocentric ecliptic J2000 vectors for 2026-11-14 and 2024-05-20) within 0.5° and 0.01 AU; Stonyhurst 0/W90/E90/180 land at Earth's longitude, +90°, -90° and the far side; and in both snapshots at least 80% of the CMEs that NASA's ENLIL runs predicted at Mars point within (half-angle + 30°) of Mars, against under 20% with west and east swapped.
- **Simple model (labeled "estimate" everywhere):** each CME is a cone along that direction with DONKI's half-angle; its front is at 21.5 solar radii at `time21_5` and keeps DONKI's speed. It "reached" a planet if the planet is inside the cone when the front reaches the planet's distance from the Sun. Real CMEs speed up or slow down in the solar wind: slow CMEs in our model arrive later than ENLIL predicts (e.g. 2026-10-25T19:24, 275 km/s: model Nov 4, ENLIL Nov 1), while mid-speed ones match well (2026-11-09T18:15, 726 km/s: model Nov 13 11:57 UTC, ENLIL Nov 13 12:00 UTC).
- **Counts (2026-10-15 to 2026-11-14):** 89 CMEs, 58 with a direction. Our model: **7 reached Mars' distance with Mars inside the cone**, 1 reached Earth's. ENLIL: 10 predicted at Mars, 3 at Earth. All 7 of our Mars hits are also ENLIL Mars predictions. **May 2024:** 144 CMEs, 120 with a direction; our model 15 at Mars (all 15 also ENLIL Mars predictions), ENLIL 28 at Mars.
- **May 20, 2024** (W172, half-angle 45°, 2,678 km/s): both our model and DONKI's ENLIL runs say the cloud passed beside Mars (Mars was about 104° west of Earth, 67° from the cone's center). The particles Curiosity measured are not in DONKI's SEP or ENLIL records (see above); the radar says so instead of claiming a CME hit.

## 2. RadLab (OSDR radiation dosimetry)

- **Docs:** https://visualization.osdr.nasa.gov/radlab/gui/data-api/
  - On 2026-11-14 the RadLab web GUI (overview, docs and knowledgebase pages) returned **HTTP 500**, but the **API worked**.
  - The docs were read from the Wayback Machine copy: http://web.archive.org/web/20240522074550/https://visualization.osdr.nasa.gov/radlab/gui/data-api/
- **API base:** `https://visualization.osdr.nasa.gov/radlab/api/`. It uses GET with key-value filters, or a boolean `query=`. `format=csv|tsv|json|html`.
  - JSON comes back as `{columns:[...], index:[...], data:[[...]]}`.
- **Fields:** `celestial_body`, `trajectory`, `spacecraft`, `module`, `instrument_family`, `instrument`, `instrument_id` (case-sensitive), `timestamp` (ISO, no zone given; we treat it as UTC), `absorbed_dose_rate` (**µGy/hour**), `dose_equivalent_rate` (µSv/hour), `flux` (cm^-2 sr^-1 s^-1), `latitude`, `longitude`, `altitude` (km), `B` (nT), `L`.
- **Query used:**
  ```
  https://visualization.osdr.nasa.gov/radlab/api/?instrument_id=DosTel1&timestamp%3E=2024-09-29T00%3A00&timestamp%3C2024-10-29T00%3A00&absorbed_dose_rate&module&format=json
  ```
- **Coverage:** ISS data in RadLab currently **ends in late 2024**. DosTel1's last full day is 2024-10-28 and DosTel2 runs to 2024-11-04; there is nothing for 2025 or 2026. Earlier probes found REM-Lid and Lidal (Columbus) in 2023. Response size is ~1.5 MB per detector-month and takes ~12 s.
- **CORS: no.** The response has no `Access-Control-Allow-Origin` header even with `Origin` sent. The browser cannot call RadLab directly; use the snapshot.
- **Result:** DOSTEL1 in Columbus averaged **194.4 µGy/day** over 2024-09-29 to 2024-10-28, with daily values from 151.6 to 233.9 µGy/day.
  - During May 2024 it averaged **202.0 µGy/day**. The May 10-11 G5 storm barely shows: 186 µGy on May 10 and 207 µGy on May 11. Earth's magnetic field and the ISS's low orbit shield it, and that contrast with Mars (no global magnetic field) is a fair teaching point.
- **Units and conversion:**
  - RadLab gives µGy/**hour**. Readings are unevenly spaced: about every 20 s in the South Atlantic Anomaly (SAA) and about every 100 s elsewhere. We measured this: readings with a ≤30 s gap had a median of 40 µGy/h, and readings with a ≥80 s gap had a median of 3.7 µGy/h.
  - A plain average of the readings therefore over-counts the SAA and gives ~530 µGy/day, which is wrong.
  - The script **time-weights** instead. Each reading counts for the time until the next one, gaps over 10 min are skipped, and days with under 20 h of coverage are dropped. The resulting daily mean µGy/h is multiplied by 24 to get µGy/day.
- **Gy vs Sv:** DOSTEL is a silicon detector telescope (DLR, DOSIS-3D), and DLR publishes its doses as absorbed dose in silicon (Berger et al. 2017, https://www.swsc-journal.org/articles/swsc/full_html/2017/01/swsc160046/swsc160046.html). That paper reports up to 286 µGy/day in Si and 647 µSv/day dose equivalent in May 2016, so our ~200 µGy/day is in the expected range.
  - **Do not compare µGy with the mSv/day figures below without saying they are different quantities.** The "ISS ~731 µSv/day" number is a dose *equivalent* (Sv) from a different instrument and period.

---

## 3. OSDR search API ("Real Science" cards)

- **Search:** `https://osdr.nasa.gov/osdr/data/search?term=KEYWORD&type=cgene&from=0&size=N`. This is Elasticsearch-style, with `hits.hits[]._source`.
  - Useful `_source` fields: `Accession` (e.g. "OSD-772"), `Study Title`, `Study Description`, `organism`, `Flight Program`, `Mission.Name`, `Project Title`.
  - Without `type=cgene`, results are mixed with other repositories (e.g. MG-RAST "mgp..." records), so always filter.
- **Study metadata:** `https://osdr.nasa.gov/osdr/data/osd/meta/{number}` returns `study["OSD-n"].studies[0].title`.
  - For a study that doesn't exist it still returns HTTP 200, with `{"hits":0,"study":{}}`.
- **Study page** (`https://osdr.nasa.gov/bio/repo/data/studies/OSD-n`) returned 200 for all 10 cards, **but it also returns 200 for a non-existent OSD-99999** because it is a single-page app. The script therefore confirms existence and the exact title through the metadata API.
- **CORS: no** for third-party sites. The search API returns `access-control-allow-origin: osdr.nasa.gov`, so only OSDR's own site may read it. Use the snapshot.
- **Search totals** (`type=cgene`): bone 67, muscle 96, plant growth 76, radiation 232, sleep 3, microgravity 271, arabidopsis 65, lettuce 13, veggie 23, space radiation 188, cosmic radiation 83, partial gravity 10, circadian 9.
  - The 3 "sleep" hits are not about sleep (e.g. kidney and skin studies), so there is **no sleep card**.
  - No study fit an honest "o2" tie-in, so there is **no o2 card**.

Cards (titles copied from the API; takeaways hand-written to stay inside each study's own description):

| OSD | Tie-in | Search term | Title |
|---|---|---|---|
| OSD-772 | greenhouse | plant growth | PH-04 Chile Peppers in Space |
| OSD-267 | greenhouse | lettuce | Microbiological and nutritional analysis of lettuce crops grown on the International Space Station-VEG01A |
| OSD-314 | greenhouse | partial gravity | Adaptive response of Arabidopsis seedlings in microgravity and Mars reduced gravity environment is enhanced by red light photostimulation |
| OSD-581 | greenhouse | oxygen | A molecular study of Italian ryegrass grown on Martian regolith simulant *(ground study)* |
| OSD-210 | shelter | cosmic radiation | Approaches for Surveying Cosmic Radiation Damage in Large Populations of Arabidopsis thaliana Seeds- an Antarctic Example *(balloon flight, not orbit)* |
| OSD-431 | shelter | space radiation | Microgravity and space radiation exert either opposite or synergic effects on single molecular pathways |
| OSD-479 | shelter | cosmic radiation | The impact of deep space radiation on cognitive performance: ... *(ground study, simulated GCR)* |
| OSD-714 | crew | muscle | Lunar gravity prevents skeletal muscle atrophy but not myofiber type shift in mice |
| OSD-342 | crew | bone | Targeting myostatin/activin A protects against skeletal muscle and bone loss during spaceflight [plasma proteomics] |
| OSD-324 | crew | bone | Osteocytes transcriptome is altered during spaceflight |

Cautions for the UI:

- OSD-714 is about **Moon** gravity (1/6 g), not Mars gravity. Don't say it shows Mars gravity protects muscle.
- OSD-581 and OSD-479 were done on the ground.
- OSD-210 flew on a stratospheric balloon over Antarctica.

---

## 4. Verified facts

Checked 2026-11-14 against the sources listed. In the **Status** column:

- "OK" means the claim matches the source.
- "FIX" means the claim needed correcting; use the value in the table.
- "Partial" means part of the claim is confirmed and part is not.

| # | Claim we planned to use | What the source actually says | Status | Source |
|---|---|---|---|---|
| 1 | O2 per crew member ~0.82-0.84 kg/day | BVAD Rev 2 (2022) Table 3-31 gives a nominal "Oxygen Consumed 0.895 kg/CM-d". Table 4-1 gives low / nominal / high values of 0.61 / 0.90 / 1.08. BVAD Rev 1 (2018) had 0.816. | **FIX**: use **~0.9 kg/day** (0.895) | https://ntrs.nasa.gov/api/citations/20210024855/downloads/BVAD_2.15.22-final.pdf |
| 2 | MOXIE: 122 g total over 16 runs; peak 12 g/h at >=98% purity | "generated a total of 122 grams of oxygen ... about what a small dog breathes in 10 hours"; "12 grams of oxygen an hour ... at 98% purity or better"; 16th run on Aug 7, 2023 | OK | https://www.nasa.gov/missions/mars-2020-perseverance/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/ |
| 3a | Scaled-up MOXIE: ~2-3 kg O2/hour | Hoffman et al. 2022 (Science Advances): "2 to 3 kg/hour of oxygen production ... for a crew arriving one 26-month cycle later" | OK | https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/ |
| 3b | ~25 kW, how long the plant runs | NASA PDS MOXIE page: scale up "about 200 times to ... produce at least 24 metric tons ... of liquid oxygen ... in the 16 months preceding the launch of a human crew ... powered by the same 25-30 kW plant" | OK: say **25-30 kW**, **about 16 months** | https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/moxie.html |
| 3c | O2 needed for a crewed ascent ~25-30 t | NASA (Apr 2021, 4 astronauts): "7 metric tons of rocket fuel and 25 metric tons of oxygen". Hoffman 2022 (6-person ascent vehicle): "~31 tons will be oxygen and ~9 tons will be methane". The PDS page says at least 24 t. | OK as a range (**~25-31 t**); name the crew size | https://www.nasa.gov/news-release/nasas-perseverance-mars-rover-extracts-first-oxygen-from-red-planet/ |
| 4a | Mars surface ~0.67 mSv/day (Hassler et al. Science **2013**) | "0.67 millisieverts per day" (SwRI release for the paper). The paper was published online in Dec 2013 and in print in Science 343, **Jan 24, 2014**. | **FIX**: cite it as Hassler et al., *Science* **2014** | https://swri.org/node/9079 |
| 4b | Deep-space cruise ~1.8 mSv/day | Zeitlin et al., *Science* 340:1080 (2013): "1.8 milliSieverts per day in cruise". Round trip about 0.66 Sv. | OK | https://www.swri.org/newsroom/press-releases/swri-led-team-calculates-the-radiation-exposure-associated-trip-mars |
| 5 | Moon 1,369 µSv/day is ~2.6x the ISS (~731 µSv/day) | Zhang et al. 2020 (Science Advances): "1369 μSv/day ... ISS ... 731 μSv/day with contributions only from GCR of 523 μSv/day ... the daily GCR dose equivalent on the surface of the Moon is around a factor of 2.6 higher than the dose inside the ISS". The ISS number came from DOSIS 3D DOSTEL, the same detector family as our RadLab snapshot. | **FIX**: 2.6x is against the ISS **cosmic-ray part (523)**. Against the full 731 it is **~1.9x**. | https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7518862/fullTextXML |
| 6 | May 20, 2024: RAD ~8,100 µGy, "30 chest X-rays", typical day ~700 µGy | JPL, June 10, 2024: "8,100 micrograys", equivalent to 30 chest X-rays; the flare was "later estimated to be an X12 ... based on data from the Solar Orbiter spacecraft"; particles reached Mars "in just tens of minutes". **The release gives no typical-day dose; ~700 µGy appears only in news coverage.** | 8,100 and 30 X-rays OK; **drop "typical day ~700 µGy"** or source it elsewhere | https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm |
| 7a | Opportunity 2007: ~700 Wh/day down to 128 Wh; ~99% of sunlight blocked | JPL 2007: about 700 watt-hours before the storm, 148 Wh on July 17, then 128 Wh the next day; dust "blocked 99 percent of direct sunlight" | OK (128 Wh was the low point) | https://www.jpl.nasa.gov/news/nasa-mars-rovers-braving-severe-dust-storms |
| 7b | Opportunity 2018: ~22 Wh | JPL gives tau 10.8 on June 10, 2018. **22 Wh comes only from the Planetary Society** (down from about 645 Wh on June 1); no NASA page states it. | **Partial**: credit the Planetary Society, or use "tau 10.8" | https://www.jpl.nasa.gov/news/six-things-about-opportunitys-recovery-efforts/ and https://www.planetary.org/articles/06-mer-update-opportunity-dust-storm-sleep |
| 8 | Mars sunlight ~43% of Earth's (586-590 vs 1361 W/m²) | NASA Mars Fact Sheet: "Solar irradiance (W/m2) 586.2 / 1361.0 / ratio 0.431" | OK: use **586.2 W/m²** | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html |
| 9a | Mars escape velocity 5.03 km/s; Moon 2.38 km/s | Mars fact sheet: 5.03. Moon fact sheet: 2.38. | OK | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html and https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html |
| 9b | Sol = 24 h 39 m 35 s | Fact sheet: length of day 24.6597 h, which is 24 h 39 m 34.9 s | OK | same Mars fact sheet |
| 10 | Time for first SEPs to reach Mars; can Mars rely on Earth forecasts? | JPL (May 2024 event): particles reached Mars "in just tens of minutes". Löwe et al. 2025 (arXiv 2502.02469, with Hassler, Zeitlin and others): "all currently available tools are primarily designed for the Earth or Earth-Moon system"; their Mars nowcasting system gives "at least 30 minutes" of warning. NASA notes that Perseverance can see the Sun's far side "where Earth has no view". | OK: say **"tens of minutes"**; Earth forecasts can miss far-side events (May 20, 2024 was one) | https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm ; https://arxiv.org/abs/2502.02469 ; https://science.nasa.gov/missions/artemis/artemis-2/to-protect-artemis-ii-astronauts-nasa-experts-keep-eyes-on-sun/ |
| 11 | Career limit 600 mSv (NASA-STD-3001) | Vol 1 Rev B (2022) [V1 4030]: "shall be less than 600 mSv. This limit is universal for all ages and sexes." **Rev C (2023-09-15)** is current and keeps 600 mSv. | OK: cite **Rev C** | https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf |
| 12 | ISS water recovery ~98% (2023) | NASA, June 20, 2023: "total water recovery of 98%, thanks to the brine processor" (up from 93-94%) | OK | https://www.nasa.gov/missions/station/iss-research/nasa-achieves-water-recovery-milestone-on-international-space-station/ |
| 13a | Mars solar conjunction 2025-26 | JPL Horizons: smallest Sun-Mars angle about 0.94°, around **2026-01-09 ~10 UT**. NASA's Curiosity blog: conjunction "will last from Dec. 27 to Jan. 20". | OK: **blackout ~Dec 27, 2025 to Jan 20, 2026** | https://science.nasa.gov/blog/curiosity-blog-sols-4750-4762-see-you-on-the-other-side-of-the-sun/ ; https://ssd.jpl.nasa.gov/api/horizons.api |
| 13b | Mars opposition early 2027 | JPL Horizons: opposition **2027-02-19 (~16 UT)**; closest approach ~Feb 20, about 0.678 AU. No NASA web page stating the date was found. | OK (ephemeris-derived) | https://ssd.jpl.nasa.gov/api/horizons.api |

Not verified:

- **Hecht et al. 2021** (*Space Science Reviews*, the MOXIE instrument paper) could not be loaded, so nothing above relies on it.
- **"Plant runs ~14 months before crew arrive"** was found only in a secondary quote. Use the PDS page's **16 months**, or Hoffman's "one 26-month cycle".

---

## 5. Claims the data does not support (or only partly supports)

1. **"DONKI recorded the X12 flare that hit Mars."**
   - False: DONKI has no FLR entry for May 20, 2024, and none of its SEP entries are linked to it.
   - DONKI records the eruption only as a fast "backsided" halo CME (`2024-05-20T05:36:00-CME-001`).
   - Its model runs for that CME predicted no Mars impact.
   - The X12 estimate comes from Solar Orbiter, via JPL's release.
2. **"The recent window had radiation storms."**
   - 2026-10-15 to 2026-11-14 had **0 SEPs**, no X flares and one G2 storm.
   - If the "live" mode needs a big event to be fun, say plainly that it's a replay of May 2024. Don't present the replay as live.
3. **SEP entry count ≠ storm count** (see section 1).
4. **ISS numbers are µGy (absorbed, silicon); Mars and Moon numbers are mSv or µSv (dose equivalent).**
   - Don't put them on the same bar chart without labels.
   - Fair comparisons: ISS ~200 µGy/day (DOSTEL) next to Curiosity's 8,100 µGy in one event, both in Gy units. Or ISS 731 µSv/day next to Moon 1,369 µSv/day next to Mars 670 µSv/day, all dose equivalent.
5. **The ISS barely noticed the May 2024 G5 storm** (DOSTEL1: 186 µGy on May 10, 207 µGy on May 11, against a ~202 µGy/day monthly mean). The magnetosphere protects the ISS; Mars has no global magnetic field. This is a true and useful contrast.
6. **RadLab ISS data stops in late 2024**, so don't label it "today's ISS radiation".
7. **The kauai DONKI host is down**, and `src/data/donki.ts` should use `https://ccmc.gsfc.nasa.gov/DONKI/WS/get`.
8. **OSD-714 is Moon gravity, not Mars gravity.** OSD-581 and OSD-479 are ground studies.
9. **O2 per person is ~0.9 kg/day in current NASA BVAD**, not 0.82-0.84.
10. **"Moon 2.6x ISS"** is true only against the ISS cosmic-ray component. Against the ISS total it is ~1.9x.

## 6. SDO: "The Sun right now" picture

The title screen and the morning briefing show NASA Solar Dynamics Observatory's newest picture of the Sun (real NASA imagery, credited "Image: NASA/SDO", no AI watermark).

- **Camera:** AIA 171 Å (extreme ultraviolet, Fe IX, about 600,000 K). It shows the quiet corona and coronal loops; the bright, loopy spots sit over active (sunspot) regions, where flares come from. Source: https://svs.gsfc.nasa.gov/3980 and the channel table at https://sdo.gsfc.nasa.gov/data/channels.php. The gold color is NASA's false color: our eyes can't see this light.
- **Latest file:** `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg` (512x512 JPEG, ~58 KB). Headers seen on 2026-11-14 at 15:55 UTC: `Content-Type: image/jpeg`, `Last-Modified: Sat, 14 Nov 2026 15:52:07 GMT`, `Cache-Control: no-cache, no-store, must-revalidate`, `Expires: 0`, an `ETag`, and **no CORS headers** (so the browser can show it in an `<img>` but can't read its headers or time). Sizes 256, 512 and 1024 exist, and 0193, 0304, 0131, HMIIC, HMIIF and 211193171 at 512 also answered 200.
- **Observation time:** `Last-Modified` is when NASA posted the file, a few minutes after the picture was taken (15:52:07 vs. 15:47:46 for that file). The real time is burned into the picture and is in the file name in SDO's browse archive: `https://sdo.gsfc.nasa.gov/assets/img/browse/YYYY/MM/DD/YYYYMMDD_HHMMSS_512_0171.jpg` (UTC). The newest browse file was byte-identical to the latest file both times we checked.
- **Listing size:** the full browse folder listing is about 1 MB; Apache's pattern filter `?C=M;O=D;P=*_512_0171.jpg` cuts it to about 14 KB.
- **Cadence:** on 2026-11-14 (00:06 to 15:47 UTC) there were 94 AIA 171 pictures in the browse folder, a median of 10 minutes apart (8.4 to 19 minutes). The game says "about every 10 minutes".
- **How the game loads it:** `/api/sun` on our server (`api/sun.ts`, cached 10 minutes in `deploy/server.ts`) serves the newest browse picture with `x-sun-taken-at` (from the file name), `last-modified` (NASA's), `x-sun-fetched-at` and `x-sun-source`, falling back to the latest file with no taken time. The browser tries `/api/sun` first, then NASA's latest file directly (also what the Vite dev server uses), and hides the picture if both fail. "Taken about N minutes ago" is shown only when the time came from the file name and the device clock agrees with the server's `Date`; otherwise the panel says NASA adds a new picture about every 10 minutes.

---

## 7. Terrain: NASA Mars Trek elevation (added 2026-11-14)

- **Product:** MGS MOLA and Mars Express HRSC blended DEM, 200 m/pixel (`Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw`). USGS product page: https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m
- **Access:** Mars Trek's WMTS map tiles are 8-bit shaded/stretched images (no usable heights). The Trek ArcGIS *ImageServer* for the same layer returns real elevations (signed 16-bit meters): `https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage?...&format=tiff&pixelType=F32`.
- **Snapshot:** `npm run fetch-terrain` (scripts/fetch-terrain.mjs) writes `src/data/snapshots/gale-terrain.json`: an 81 x 81 grid, about 3 km spacing, about 240 km across, centered on Bradbury Landing (Curiosity's landing site, 4.5895°S 137.4417°E). Heights range from -4,557 m (crater floor) to +954 m (Mount Sharp's upper slopes); the landing site reads -4,501 m.
- **In the game:** 1 scene unit = 1 km for the landscape (the outpost's buildings are not to scale), heights exaggerated x1.5, and the real terrain fades in beyond the flat base pad. Stated in the Science Log.
- **Caveat:** the landing-site coordinates come from Wikipedia's Bradbury Landing article; we did not find a NASA page listing them.

---

## 8. The ice landing site: Arcadia Planitia and NASA SWIM (added 2026-11-14)

On Mars the player can land at **Gale Crater** (default, unchanged) or **Arcadia Planitia**. Code: `landing?: 'gale' | 'arcadia'` on `MissionConfig` and `Campaign` (missing = Gale, so old saves load as before); `ARCADIA` and `ARCADIA_TUNING` in `src/sim/constants.ts`.

### Why Arcadia (sources)

| Claim | What the source says | Source |
|---|---|---|
| Where | Arcadia Planitia: center latitude **46.66°**, center longitude **192.00°** (planetocentric, +East, 0-360); extent 34.68-54.68°N, 165-217°E | IAU/USGS Gazetteer of Planetary Nomenclature, feature 348: https://planetarynames.wr.usgs.gov/Feature/348 |
| SWIM picks it out | "our composite ice-consistency maps indicate that the broad plains of Arcadia and the extensive glacial networks across Deuteronilus Mensae match the greatest number of remote-sensing criteria for accessible ice-rich, subsurface material situated equatorwards of the contemporary ice-stability zone" | Morgan et al. 2021, *Nature Astronomy* 5, 230-236, abstract on USGS: https://pubs.usgs.gov/publication/70226786 (DOI 10.1038/s41550-020-01290-z) |
| SWIM's purpose | "The SWIM project's products support Mars Human Landing Sites Studies"; "The goal of SWIM is to provide maps of potential buried ice deposits to support the selection of human landing sites." The pilot study "focused on a mid-latitude swath in the Arcadia Planitia region". | https://swim.psi.edu/ ; PSI, Feb 8 2021: https://www.psi.edu/blog/water-ice-resources-identified-in-martian-northern-hemisphere/ |
| What ice is for | "water for human consumption, growing plants for food, and for the generation of methane fuel and breathable air. But the most important is to provide fuel for the return trip home to Earth." | PSI, Feb 8 2021 (same URL) |
| The trade-off | "ice buried within 3 meters of the surface should be stable in the current climate at latitudes above 50 degrees ... but these regions are colder and subject to long seasons of extended night. Lower latitudes are warmer, have a manageable length of night and plenty of solar radiation for power generation." NASA/JPL: the northern mid-latitudes are "a literal middle ground between where to find the most water ice (the poles) and where to find the most sunlight and warmth (the equator)". | PSI, Feb 8 2021; NASA/JPL, Feb 8 2021: https://www.jpl.nasa.gov/news/where-should-future-astronauts-land-on-mars-follow-the-water |
| SWIM does not pick sites | "the paper does not select specific sites best suited for future human exploration" (N. Putzig) | PSI, Feb 8 2021 |
| Oxygen from water | The ISS Oxygen Generation System's cell stack "electrolyzes, or breaks apart, water" | NASA ECLSS: https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/ |
| Frost on the northern plains | Viking 2 imaged "a thin layer of water ice frost on the martian surface at Utopia Planitia" on 18 May 1979, "only a couple thousandths of a centimeter thick" | NASA NSSDC: https://nssdc.gsfc.nasa.gov/imgcat/html/object_page/vl2_p21873.html |

Not found: a citable figure for how much less energy per kg of O2 water electrolysis needs than MOXIE-style CO2 splitting (once mining and melting ice are counted). So the game does **not** make the O2 plant better at Arcadia; the ice helps the greenhouse instead.

### SWIM map snapshot (`node scripts/fetch-swim.mjs` -> `src/data/snapshots/swim-ice.json`)

- **Data:** SWIM 2.0 global products, https://swim.psi.edu/SWIM2Products.php. "Combined Ice Consistency" GeoTIFFs for three depth zones: `SWIM2_c0_1.tif` (0-1 m), `SWIM2_c1_5.tif` (1-5 m), `SWIM2_c_5.tif` (>5 m), under `https://swim.psi.edu/output/SWIM2/Global/Composite/`. Each is 7200 x 2400 float32, uncompressed, 128 x 128 tiles, Mars 2000 sphere (R = 3,396,190 m), equirectangular, 0.05°/pixel, 60°S to 60°N, no-data = -100. About 71 MB each; the script reads only the header and ~12 tiles per file with HTTP range requests (checked: a range read is byte-identical to the same bytes of a full download).
- **Scale:** "ice consistency" from -1 to +1: "-1 indicates that a given measurement is inconsistent with the presence of ice ... +1 ... consistent with the presence of ice. A value of 0 means these data are inconclusive or are absent altogether." (https://swim.psi.edu/about.php?section=overview). The 0-1 m map is `(C_N + C_T + 0.2 C_GS + 0.2 C_RS) / 2.4` (neutron, thermal, shallow landforms, SHARAD surface power). It is agreement between datasets, not a probability or an amount.
- **Values (fetched 2026-11-14), pixel at the site / mean over ±0.5°:**

| | 0-1 m | 1-5 m | >5 m |
|---|---|---|---|
| Arcadia Planitia (46.66°N, 192.00°E) | **+0.547** / +0.540 | +0.250 / +0.455 | +0.887 / +0.850 |
| Gale Crater (4.5895°S, 137.4417°E) | -0.011 / +0.072 | -0.500 / -0.058 | 0.000 / 0.000 |

- **Profile** along 192°E (0-1 m, ±0.5° box means): -0.11 at 36°N, +0.20 at 40°N, +0.31 at 44°N, +0.64 at 48°N, +0.68 at 52°N, +0.72 at 56°N. More likely ice farther north: the same trade-off the sources describe.
- The game shows the 0-1 m pixel value (rounded to 2 decimals) in the expedition intro and all three in the Science Log.

### Arcadia terrain (`node scripts/fetch-terrain.mjs --site=arcadia` -> `src/data/snapshots/arcadia-terrain.json`)

- Same Mars Trek product and method as Gale (section 7), centered on 46.66°N 192.00°E (asked for as -168.00, since the image server uses -180..180). The server only returns square pixels in degrees, so at 46.66°N a pixel is 3 km north-south but 2.06 km east-west; the grid is **119 x 81** so it reaches about ±120 km both ways. (The script's default run still writes Gale's 81 x 81 grid: re-running it reproduced `gale-terrain.json` exactly except `fetchedAt`.)
- Heights -4,079 to -3,653 m (426 m of relief in 240 km; Gale: 5,511 m); the base site reads -4,008 m (full-resolution check: -4,008 m). Shown at Gale's scale (1 unit = 1 km, x1.5 heights). The frost patches are made up for the look.

### Game values at Arcadia (labeled in the Science Log)

- **Sunshine:** 6 starting solar cells instead of 7. Sanity check (our own estimate, not a NASA figure): yearly-mean sunlight at the top of the atmosphere from the standard daily-insolation formula, with Mars' obliquity 25.19° (NASA Mars Fact Sheet), is about 0.73 of Gale's at 46.66°N (the latitude ratio of yearly means does not depend on orbital eccentricity). So the game's 1-in-7 cut is gentler than real.
- **Cold:** 2 more cold snaps per mission (Cadet 4, Commander 5).
- **Water:** each greenhouse cell grows 3x the food and gives 3x the plant air (2x until 2026-11-15; raised because Commander was close to unwinnable, see Balance).
- Everything else (crews, fuel, windows, storms, background radiation) is the Gale value. Radiation: the game keeps Curiosity's Gale measurement; Arcadia's base site is about as low (-4,008 m vs -4,501 m).
- **Balance** (`npm run balance`, 100 campaigns each, after the 2026-11-15 retune): Cadet builder wins 100 / 100 / 100% of crews 1-3 and a careful non-builder 100 / 100 / 100%; greed always loses. Commander is harder at Arcadia than at Gale: following "Suggest a plan" wins 72 / 61 / 45% (Gale 86 / 96 / 96%), the scripted builder 55 / 49 / 68% (Gale 43 / 98 / 97%), a balanced non-builder 26 / 99 / 0%, and ignoring radiation 0 / 55 / 0%. Before the retune (2x greenhouse, and an advisor that never sheltered "just in case" at Arcadia because its 6-cell array never had 3 cells to spare) the advisor won 1% of Commander first crews and the builder 19%.

## 9. Trip planner: Mars-to-Earth trajectories (added 2026-11-14)

- **Planet positions and velocities:** JPL SSD "Approximate Positions of the Planets", Table 1 (1800-2050), all six elements and rates for the Earth-Moon barycenter and Mars, so the orbits are tilted correctly in 3D (`src/orbits/ephemeris.ts`). Velocity is the time derivative of the same model. https://ssd.jpl.nasa.gov/planets/approx_pos.html
- **Paths:** Lambert's problem, zero revolutions, prograde, solved with D. Izzo, "Revisiting Lambert's problem", Celest. Mech. Dyn. Astr. 121 (2015), https://doi.org/10.1007/s10569-014-9587-y (`src/orbits/lambert.ts`). Checked by flying each answer forward with a universal-variable (Stumpff function) propagator (`src/orbits/kepler.ts`).
- **Constants:** Mars GM 42,828 km³/s², mean radius 3,389.5 km (escape 5.03 km/s) and synodic period 779.94 days from the NASA Mars Fact Sheet; Earth GM 398,600.4 km³/s² and radius 6,378.137 km from the Earth Fact Sheet; Sun GM 1.32712440018e11 km³/s². Model choices (not data): parking orbits 300 km above Mars and 400 km above Earth; Earth entry interface 121.92 km (400,000 ft).
- **What "speed change" means:** one impulsive burn from the Mars parking orbit plus one into the Earth parking orbit (patched conics). "From the ground" = sqrt(v_esc² + v∞²), ideal (no drag, gravity losses or planet spin). "Hits Earth's air" = sqrt(v∞² + 2μ/r_entry).

### Validation (all in `src/orbits/*.test.ts`)

| Check | Published | Ours | Source |
|---|---|---|---|
| Lambert, Curtis Example 5.2 | v1 = (-5.9925, 1.9254, 3.2456), v2 = (-3.3125, -4.1966, -0.38529) km/s | (-5.99249, 1.92536, 3.24564), (-3.31246, -4.19662, -0.385288) | Curtis, *Orbital Mechanics for Engineering Students* |
| Lambert, Vallado Example 7-5 | v1 = (2.058925, 2.915956), v2 = (-3.451569, 0.910301) km/s | (2.058913, 2.915965), (-3.451567, 0.910314) | Vallado, as reproduced in the poliastro docs |
| Mars position, 2026-2033 (4 dates) | JPL Horizons DE441 | within 57,000 km (0.02% of its distance from the Sun) and 3.8 m/s | https://ssd.jpl.nasa.gov/api/horizons.api |
| Earth-Moon barycenter, 2026-2033 | JPL Horizons DE441 | within 7,000 km and 1.7 m/s | same |
| Earth-to-Mars C3 at the handbook's minimum dates | 2026: 11.11 (I), 9.144 (II); 2028: 9.048, 8.928; 2031: 9.00, 8.237; 2005: 15.883, 15.445 km²/s² | 11.116, 9.145; 9.049, 8.930; 9.001, 8.239; 15.893, 15.450 (all within 0.07%) | NASA/TM-2010-216764 Tables 2-4 and 13 |
| Mars-to-Earth returns, v∞ at Mars / at Earth / entry speed | 2016-01-07 to 2016-07-05: 2.989 / 7.342 / 13.285 km/s (and 3 more) | 2.990 / 7.466 / 13.356 (all v∞ within 1.7%, entry within 0.6%) | NASA/TM-1998-208533 Tables 9 and 11 |
| Entry speed formula | Table 4: v∞ 3.50 -> 11.61, 9.35 -> 14.49 km/s | 11.61, 14.49 | NASA/TM-1998-208533 Table 4 |
| Return windows 2018-2048 | synodic period 779.94 days | 15 windows, 735 to 898 days apart, mean 778 days | NASA Mars Fact Sheet |

- **One mismatch, left visible:** for the 2026 Earth-to-Mars Type I opportunity our search finds a lower C3 (10.48 on Nov 12, 2026, right beside the 180° ridge) than the handbook's 11.11; at the handbook's own dates we agree (11.116). That test checks the published dates only.
- **Fast returns are date-sensitive:** the 1998 handbook gives dates to the day only; for 154-180 day trips half a day moves v∞ by about 1%, which is why those tolerances are 2%.

## 10. Sound on Mars (the Settings dialog's science line, added 2026-11-15)

The Sound section of Settings (`src/ui/settings.ts`) says: "NASA's Perseverance rover has recorded real sounds on Mars with its microphones. Mars's air is thin, cold and mostly carbon dioxide, so sound travels slower there: about 240 meters per second, compared with about 340 on Earth." Checked on **2026-11-15**:

| Claim | What the source says | Status | Source |
|---|---|---|---|
| Perseverance recorded real sounds on Mars with microphones | "The Perseverance rover carries two microphones, letting us directly record the sounds of Mars for the very first time." (One is on the mast, part of SuperCam; the other is on the rover's side.) | OK | https://science.nasa.gov/mission/mars-2020-perseverance/sounds-of-mars/ |
| Speed of sound: about 240 m/s on Mars, about 340 m/s on Earth | NASA Science: "around 540 mph (~240 meters per second), compared to about 760 mph (~340 meters per second) on Earth." JPL: on Earth "767 mph (343 meters per second)"; on Mars "low-pitched sounds travel at about 537 mph (240 meters per second)" and "higher-pitched sounds move at 559 mph (250 meters per second)". | OK: say **about** 240, since high pitches go about 250 | same NASA page, and https://www.jpl.nasa.gov/news/what-sounds-captured-by-nasas-perseverance-rover-reveal-about-mars/ |
| Thin, cold, mostly carbon dioxide air is why | JPL: "The variable sound speeds on the Red Planet are an effect of the thin, cold, carbon dioxide atmosphere." NASA Science: the atmosphere is "about 100 times less dense than on Earth" and "96 percent carbon dioxide". | OK | both pages above |

The line links to the NASA Science page ("Hear them at NASA"), where the recordings can be played.
