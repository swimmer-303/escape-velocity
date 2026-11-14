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
| api.nasa.gov | `https://api.nasa.gov/DONKI/{FLR,...}?startDate=...&endDate=...&api_key=KEY` | DEMO_KEY or your own | 200; returned the same JSON as CCMC (byte-for-byte for May 2024 GST) |

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
- `gsts[]`: `{id, startTime, maxKp (max of allKpIndex), link}`
- An empty `sourceLocation` ("") is turned into `null`.

### Event counts

| Window | Flares (X / M / C) | SEP entries | CMEs | Storms (GST) |
|---|---|---|---|---|
| Recent: 2026-10-15 to 2026-11-14 | 13 (**0 X / 10 M / 3 C**); biggest M3.5 on 2026-11-05 from AR 14566 | **0** | 86 (fastest 1048 km/s) | 1: 2026-10-31, max Kp 6 (G2), linked to a high-speed stream |
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

FACT_TABLE_PLACEHOLDER
