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
npm run dev:lan              # http://0.0.0.0:3000 (phone/tablet on same Wi-Fi)
```

## Key business rules enforced

- **Search inputs are only** min/max flow (LPH) and min/max depth (ft). Everything
  else is shown, never asked.
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

## Screens

- `/` — selector: search, live conversions, summary, tabs (valid / model / near /
  rejected / unpriced), expandable price options, source-PDF links. Every row
  carries a **Chart pg** and **Price pg** column: the printed page number in each
  booklet, each opening that exact page; **Both** opens them side by side.
- `/mapping` — price-mapping review (approve / reject related-series suggestions).
- `/quality` — extraction & mapping data-quality dashboard.
- `/api/pdf/{technical|price}#page=N` — opens the exact source page.

## Running on Windows (non-technical user)

`Start KSB Pump Selector.bat` is a double-click launcher for handing the app to an
end user. It installs deps and builds on first run, then opens
`http://localhost:3000` in the default browser. See `WINDOWS_SETUP.txt` for the
plain-language instructions that ship alongside it.

Python is **not** needed on that machine — only Node.js. Copy the built
`data/ksb.sqlite` and `source_pdfs/` across with the folder and the extraction step
can be skipped entirely. Note that doing so moves the confidential price list onto
that machine; transfer by USB rather than a cloud link.

## Status

Built & verified: extraction (both PDFs), SQLite schema + loader, matching engine,
query engine, main selector UI, mapping review, data-quality screen, source viewer,
manual-decision persistence, CSV/JSON/PDF exports, and the automated test suite
(51 Vitest + 6 pytest).

Not yet built: the import upload UI + price-change report.

## Known limitation: three-phase Monosub R is priced but not selectable

The three-phase Monosub R tables carry 17–19 operating points. `ALLOWED_OPERATING_
POINT_POSITIONS` (spec §9, `extraction/scripts/common.py`) only defines approved
duty positions up to 15, so those tables are `position_supported = false` and the
engine excludes them. Their prices **are** now linked and visible on `/mapping`
and `/quality`, but the pumps cannot appear in search results until §9 defines
approved positions for 17/18/19-point tables. That is a duty-engineering decision,
not a parsing one — inventing positions would recommend pumps that cannot meet the
duty, so it is deliberately left open.
