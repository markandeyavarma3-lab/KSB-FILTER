# KSB Agricultural Pump Selector — Version 1

Local-first, single-user app that selects agricultural pumps from the KSB
performance booklet by **water flow** and **motor depth**, and attaches exact
prices from the confidential price list. Domestic products are excluded from
Version 1 results but retained for audit.

## Pipeline

```
source_pdfs/*.pdf
   │  (Python, deterministic geometry extraction)
   ├─ extraction/scripts/import_technical_catalogue.py  → extraction/output/technical_catalogue.json
   └─ extraction/scripts/import_price_list.py           → extraction/output/price_list.json
        │  (TypeScript loader → SQLite via Drizzle)
        ├─ db/load.ts             → data/ksb.sqlite  (tables, variants, 8k operating points, price records)
        └─ db/generate_mappings.ts → technical↔price links (exact + suggested)
             │  (query engine)
             └─ db/engine.ts  ← app/api/search  ← app/page.tsx (browser)
```

## Confidential data is not in this repo

The confidential price list, the extracted prices, and the built database are
**git-ignored** and never pushed (`source_pdfs/`, `extraction/output/`, `data/`).
To run locally, place the two source PDFs in `source_pdfs/` and run the pipeline
below to regenerate the JSON and `data/ksb.sqlite`.

## First-time setup

```bash
# 1. Python extraction (venv already created)
. .venv/bin/activate
python extraction/scripts/import_technical_catalogue.py "source_pdfs/Selection Chart Agri.pdf"
python extraction/scripts/import_price_list.py "source_pdfs/Confidential Price 1-7-2026 Secunderabad Branch Final.pdf"

# 2. Node deps + DB
npm install
npx drizzle-kit generate      # once, to create db/migrations
npm run import:all            # db:load + db:mappings

# 3. Run
npm run dev                  # http://localhost:3000
npm run dev:lan              # http://0.0.0.0:3000 — exposes the confidential
                             # price list to the whole network; see below
```

**Restart the app after any re-import.** The server holds the SQLite file open,
so a running instance keeps serving the old database (and the old prices) until
it is restarted.

## Key business rules enforced

- **Search inputs are only** min/max flow (LPH) and min/max depth (ft), and optional
  min/max motor horsepower (HP). Everything else is shown, never asked.
- Depth is treated directly as required catalogue head (`ft × 0.3048`); no friction /
  loss corrections. Every result carries the site-duty warning.
- Only the **approved middle operating-point positions** (spec §9) are evaluated;
  tables with >15 points are flagged `UNSUPPORTED` and excluded.
- Ranking is **price-independent** (balanced / closest-flow / closest-head).
- **LP is never displayed** — only Landing / Single Pump / Above ₹50K. `#N/A` → `—`, never 0.
- Stage suffixes preserved (`4A` ≠ `4`); related series (`UQD`↔`UQDs`) are
  **suggested**, never auto-linked; manual review decisions persist across re-import.
- Multiple purchasable price options per technical combination are all shown.
- Monosub R is **model-coded**, not series+stage: its identity is HP + casing
  designation (`MR 3 C- 60-50-21`). The booklet writes one row for two builds
  (`MR 3 A / 3 C- …`), so the A/C letter is left out of the key and each build
  surfaces as its own price option. Phase stays in the key so a single-phase row
  can never take a three-phase price.

## Confidentiality of the running app

`npm run dev` and `npm start` bind **127.0.0.1 only** — the price booklet is
confidential, and binding all interfaces would publish it to every device on the
same Wi-Fi with no authentication. `/api/pdf/price` additionally refuses
non-loopback callers unless `KSB_ALLOW_LAN=1` is set. `npm run dev:lan` opts in
explicitly; do not use it on a shared network.

## Recent updates (v1.1)

### Feature: Motor HP filter
Users can now optionally filter results by motor horsepower (HP) range:
- **Min HP** and **Max HP** fields on the search form (leave blank for no filter)
- Validates inputs: rejects negative values, non-numeric input, and `max < min` conditions
- When both fields are blank, all HP ratings are included (original behavior)
- Filter is applied at the database query level for performance

Example: searching for 5000–8000 LPH / 300–1500 ft depth with HP 5–10 returns only pumps
in that horsepower range, reducing false positives for specific motor constraints.

### Critical bug fixes (v1.1)

#### Bug fix 1: Silent row disappearance (reconciliation invariant violation)

**Problem:** The matching engine had a gap in its row classification logic. Operating points
whose flow fell within the tolerance-widened database window but outside the exact requested
range, *combined* with head that missed by more than tolerance, matched none of the
`VALID`/`NEAR_MATCH`/`HEAD_*_RANGE` categories and silently vanished from results.

This violated a critical invariant:
```
approvedOperatingPointsScanned = validOperatingPoints + nearMatches + rejectedPoints + duplicatesMerged
```

**Impact:** Approximately 4% of scanned rows disappeared. In a 264-point search, 10 rows
vanished with no indication they existed. Users had no way to know the engine had excluded them.

**Fix:** Changed the final `else if (flowIn)` in the classification chain to an unconditional
`else` block, ensuring every scanned row lands in exactly one category. Updated rejection
reasons to clearly explain whether flow, head, or both were out of range, and by how much.

**Verification:** 25 randomized test cases cross-checked against an independent SQL reference
implementation. All cases now reconcile exactly; no more silent disappearances.

#### Bug fix 2: Duplicate technical rows inflating result counts

**Problem:** The KSB catalogue contains multiple motor_pump_variant rows for identical
hydraulic points that differ only in electrical attributes not captured as structured
columns (e.g., starting method: DOL vs S/D, cable size: 2.5 mm² vs 1.5 mm²). Without
deduplication, identical-looking result rows appeared multiple times, each independently
linked to the same price options—effectively doubling visible matches without adding
unique information.

**Example:** UQD 112 / stage 23 / 7.5HP / 5000 LPH appeared twice in results, both at
662.7 ft head, both linked to prices ₹37,350 (DOL) and ₹37,621 (S/D), confusing whether
these were two separate products or one product with two starting-method variants.

**Impact:** Approximately 4% of result rows were duplicates. In a 162-row valid set,
7 rows were redundant duplicates of earlier rows.

**Fix:** After classification, the engine now collapses rows by their technical/hydraulic
identity:
```
(pumpModel, stageIdentity, hp, phase, category, flowM3h, headM)
```

When merging, price options from all deduplicated variants are combined, sorted, and
deduplicated by IN-code to ensure one row shows all unique price options from all variants.

A new `duplicateTechnicalRowsMerged` statistic is shown in the UI to make the merge
count transparent (e.g., "Duplicates merged: 7").

**Verification:** 45+ test cases verified that:
- Duplicate row counts match the reference implementation exactly
- No duplicate keys remain in `validResults` or `nearMatches` arrays
- Price options are correctly combined and sorted when merging
- All deduped rows still reconcile: `scanned = valid + near + rejected + merged`

### Data insights from testing

- **Price coverage is sparse:** Only **132 of 907** technical variants (14.6%) have any
  linked price record. Most valid technical matches come back priced as `NO_EXACT_PRICE_MATCH`.
  This reflects the confidential price list's coverage, not a matching bug.

- **Shallow-depth searches are catalogue-sparse:** The KSB agricultural submersible
  catalogue skews heavily toward deep boreholes. Only 23 approved operating points
  exist anywhere in the 15–45 ft head range across all 2,231 points. Searches for
  shallow depths (e.g., 2000–8000 LPH / 15–45 ft) correctly return zero valid results
  because the catalogue doesn't cover that region.

- **SUGGESTED_RELATED_SERIES mappings are correctly flagged:** e.g., UQD vs UQDS
  auto-matches are tagged `SUGGESTED_RELATED_SERIES`, not `EXACT_AUTO_MATCH`. The UI
  shows these price options with a "suggested" badge rather than "exact," honoring
  manual review decisions per spec §27.

## Screens

- `/` — selector: search, live conversions, summary, tabs (valid / model / near /
  rejected / unpriced), expandable price options, source-PDF links. Every row
  carries a **Chart pg** and **Price pg** column: the printed page number in each
  booklet, each opening that exact page; **Both** opens them side by side.
- `/mapping` — price-mapping review (approve / reject related-series suggestions).
- `/quality` — extraction & mapping data-quality dashboard.
- `/api/pdf/{technical|price}#page=N` — opens the exact source page.

## Running on Windows (non-technical user)

`Start KSB Pump Selector.bat` is a double-click launcher. On first run it installs
dependencies, builds, drops a **KSB Pump Selector** shortcut on the Desktop, and
opens the browser — after that it is one click from the Desktop icon.
`WINDOWS_SETUP.txt` ships alongside it with plain-language instructions.

Python is **not** needed on that machine — only Node.js.

### Preparing the handoff — use `./prepare-for-windows.sh`

```bash
./prepare-for-windows.sh              # → ~/Desktop/KSB-for-dad
./prepare-for-windows.sh /some/path   # or an explicit destination
```

**Do not copy `node_modules/` or `.next/` to the Windows machine.**
`better-sqlite3` is a native module compiled for the machine that installed it
(here: Mach-O arm64). Copied to Windows it fails to load, and because the old
launcher only ran `npm install` when `node_modules` was *absent*, the install was
skipped and the app died on an error no end user could diagnose. The script
excludes both directories, which also drops the transfer from ~450 MB to ~14 MB.

The launcher additionally **self-heals** this case: it probes the native module by
opening an in-memory database, and if that fails it deletes `node_modules/` and
`.next/` and reinstalls. (Probing with a bare `require()` is not enough — the
module resolves fine and only throws when the binding is actually used.)

`data/ksb.sqlite` and `source_pdfs/` are git-ignored but **are required**; the
script copies them and warns if either is missing. That moves the confidential
price list onto that machine — transfer by USB, never a cloud link.

### Launcher behaviour

| Situation | What the user sees |
|---|---|
| Node.js not installed | Plain instructions, then opens nodejs.org |
| `data/ksb.sqlite` missing | "Ask Satya to send the complete folder again" |
| `node_modules` from another machine | Silently rebuilt for this machine |
| Already running (double-clicked twice) | Reopens the browser instead of an `EADDRINUSE` stack trace |
| Normal run | Browser opens **once the server is actually listening** |

That last row was a real defect in the previous launcher: it called
`start "" http://localhost:3000` *before* `npm start`, so the browser reliably
raced the server and showed "can't reach this site" on a cold start. A background
poller now waits for port 3000 to accept a connection before opening the browser.

`.bat` and `WINDOWS_SETUP.txt` are stored CRLF (enforced by `.gitattributes`) —
LF-only batch files can misbehave around `goto` labels, and Notepad renders
LF-only text as one unreadable line.

## Status

### Built & verified (v1.1)
- Extraction (both PDFs), SQLite schema + loader
- Matching engine with reconciliation invariant (`scanned = valid + near + rejected + merged`)
- Query engine with HP filter and three ranking modes
- Main selector UI with live unit conversions and near-match visibility
- Duplicate technical row deduplication (collapsing identical hydraulic points)
- Mapping review screen, data-quality screen, source viewer
- Manual-decision persistence across re-imports
- CSV/JSON/PDF exports
- Comprehensive test suite: 51 Vitest + 6 pytest + 45+ manual cross-check cases
  (covering edge cases, unit conversions, sort order, rank sequencing,
  price-mapping status, and key-set matching against reference implementations)

### Not yet built
- Import upload UI + price-change report
- Automated CI/CD test runner for the comprehensive cross-check suite

## Known limitation: three-phase Monosub R is priced but not selectable

The three-phase Monosub R tables carry 17–19 operating points. `ALLOWED_OPERATING_
POINT_POSITIONS` (spec §9, `extraction/scripts/common.py`) only defines approved
duty positions up to 15, so those tables are `position_supported = false` and the
engine excludes them. Their prices **are** now linked and visible on `/mapping`
and `/quality`, but the pumps cannot appear in search results until §9 defines
approved positions for 17/18/19-point tables. That is a duty-engineering decision,
not a parsing one — inventing positions would recommend pumps that cannot meet the
duty, so it is deliberately left open.
