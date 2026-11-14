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
