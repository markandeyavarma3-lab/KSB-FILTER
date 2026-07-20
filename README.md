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

## Screens

- `/` — selector: search, live conversions, summary, tabs (valid / model / near /
  rejected / unpriced), expandable price options, source-PDF links.
- `/mapping` — price-mapping review (approve / reject related-series suggestions).
- `/quality` — extraction & mapping data-quality dashboard.
- `/api/pdf/{technical|price}#page=N` — opens the exact source page.

## Status

Built & verified: extraction (both PDFs), SQLite schema + loader, matching engine,
query engine, main selector UI, mapping review, data-quality screen, source viewer,
manual-decision persistence.

Not yet built: CSV/Excel/PDF exports (JSON is the search API response), the import
upload UI + price-change report, and the automated test suite.
