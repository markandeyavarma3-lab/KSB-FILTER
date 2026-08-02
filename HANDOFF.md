# Handoff brief

Context for anyone (human or AI) picking this repo up on a different machine.
`README.md` explains *what* the app does. This file explains *what not to break*,
and why some code looks the way it does.

---

## 1. The invariant that must always hold

Every operating point pulled from the database must land in exactly one bucket:

```
approvedOperatingPointsScanned
    = validOperatingPoints
    + nearMatches
    + rejectedPoints
    + duplicateTechnicalRowsMerged
```

This is not decorative. It was violated by a real bug (see §2) that silently
deleted ~4% of rows from results with no user-visible trace. **If you change the
classification logic in `db/engine.ts`, re-verify this invariant before
committing.** §5 explains how.

---

## 2. Bug already fixed — do not reintroduce

### 2a. The `else if` that swallowed rows

`db/engine.ts:155` is an unconditional `else`. It used to be `else if (flowIn)`.

The SQL query widens the flow window by the tolerance percentage so near-matches
can be found. That means rows arrive whose flow is inside the *widened* band but
outside the *exact* requested range. If such a row also missed on head by more
than tolerance, it matched none of the branches and vanished — counted in
`approvedOperatingPointsScanned` but present in no result array.

Symptom if reintroduced: stats stop adding up; a search reports scanning N points
but displays fewer than N across all tabs.

### 2b. Duplicate technical rows

`db/engine.ts:182` (`dedupeTechnical`) collapses rows sharing this key
(`db/engine.ts:189`):

```
pumpModel | stageIdentity | hp | phase | category | flowM3h | headM
```

The catalogue contains pairs of `motor_pump_variants` rows for the same hydraulic
point that differ only in electrical attributes extraction did not capture as
structured columns (starting method DOL vs S/D, cable size). Without collapsing,
the UI showed two identical-looking rows, both linked to the same price options.

When merging, price options from all merged variants are combined and
**deduplicated by `inCode`** — each row carries `variantIds: number[]`, not a
single `variantId`. Anything downstream that assumes one variant per row is wrong.

Do not "fix" this by adding starting method to the key unless extraction starts
populating `motor_pump_variants.starting_method`; it is currently null on the
rows in question, so it would not separate them anyway.

---

## 3. Non-obvious things that are correct as-is

**Native-module probe must open a database.** In `Start KSB Pump Selector.bat`:

```
node -e "const D=require('better-sqlite3'); new D(':memory:').close()"
```

A bare `require('better-sqlite3')` is **not sufficient** — verified: it exits 0
even when the `.node` binary is corrupt or built for the wrong platform. The
module resolves fine and only throws when the binding is actually used. This probe
is what lets the launcher self-heal a `node_modules/` copied between machines.

**`npm start` binds `127.0.0.1` deliberately.** Verified that the LAN IP is
refused. The app serves a confidential price list; do not change this to `0.0.0.0`
or add a host flag for convenience.

**`MANUALLY_REJECTED` price mappings are skipped** (`db/engine.ts:301`). This
honours decisions made on `/mapping` and must survive re-import.

**LP price is never displayed.** Only Landing / Single Pump / Above ₹50K.

---

## 4. Findings that are data limitations, NOT bugs

Do not "fix" these — they were investigated and confirmed against the source data:

| Observation | Reality |
|---|---|
| Most results show "no price" | Only **161 of 919** variants (17.5%) have any linked price record. Price-list coverage, not a matching failure. Measure this against a **freshly rebuilt** database — a stale one understates it (see §8). |
| Shallow-depth searches return nothing | Only **23** approved operating points exist in the entire catalogue between 15–45 ft head. The catalogue skews to deep boreholes. |
| `UQD` matched to a `UQDs` price record | Correctly tagged `SUGGESTED_RELATED_SERIES` (confidence 0.6), not `EXACT_AUTO_MATCH`. UI shows a "suggested" badge. Per spec, related series are suggested and never auto-linked. |

---

## 5. How to verify a change to the engine

The committed suite is `npm test` (Vitest, `tests/*.test.ts`) plus
`tests/test_common.py` (pytest — **Python is not installed on the Windows
laptop**, so `npm run test:all` will fail there; use `npm test`).

For engine changes, that suite is not sufficient on its own. The method used to
validate the fixes above was:

1. Reimplement the classification independently in Python straight from SQL
   against `data/ksb.sqlite` — do not import the TypeScript.
2. Generate 20–25 randomised searches across wide flow/depth/tolerance/HP/ranking
   combinations.
3. For each, compare against the live API and assert:
   - the invariant in §1 holds
   - counts match the reference
   - **the actual set** of `(model, stage, hp, phase, category, flow, head)` keys
     matches — counts alone hide compensating errors
   - no duplicate keys remain in `validResults` / `nearMatches`
   - results are sorted by the requested ranking key and ranks are sequential

That method caught both bugs in §2. Count-only checks would have missed 2b.

---

## 6. Known Windows-specific issues (unfixed)

- `npm run dev:lan` fails — `KSB_ALLOW_LAN=1 next dev` uses Unix env-var syntax.
  Needs `cross-env` or a Windows equivalent. `npm run dev` is unaffected.
- `npm run test:all` / `npm run test:py` fail — Python is intentionally absent on
  the end-user laptop.

---

## 7. Two-machine git discipline

`git pull --rebase origin main` **before** starting work. This repo has already
diverged once and needed a manual rebase with a README conflict.

`data/`, `source_pdfs/`, and `extraction/output/` are gitignored and contain the
confidential price list. They **never sync via git** — if you regenerate the
database on one machine, copy it by USB. Never commit them, and never move them
over email or a cloud drive.

Use `./prepare-for-windows.sh` to build a transfer folder; it excludes
`node_modules/` and `.next/` (platform-specific) and warns if the database or
PDFs are missing.

---

## 8. The database is NOT rebuilt automatically — this has already bitten once

`data/ksb.sqlite` is a build artifact of the extraction scripts, but nothing
rebuilds it when you pull. Changes to `extraction/` or `db/load.ts` leave every
existing database stale until someone re-runs the pipeline by hand:

```bash
. .venv/bin/activate
python extraction/scripts/import_technical_catalogue.py "source_pdfs/Selection Chart Agri.pdf"
python extraction/scripts/import_price_list.py "source_pdfs/Confidential Price 1-7-2026 Secunderabad Branch Final.pdf"
npm run import:all      # db:load + db:mappings
npm test                # 66/66 must pass
```

**How this already went wrong:** extraction fixes landed 1–2 Aug; a database built
21 Jul was still in place. `npm test` failed 3 of 66 — and those failures were the
correct signal, not broken tests. On one sample search the stale database returned
59 valid / 20 priced where the rebuilt one returns 62 valid / 23 priced, and it had
48 fewer price mappings overall.

**`tests/data.test.ts` is the canary.** If it fails, suspect a stale
`data/ksb.sqlite` before suspecting the test. Rebuild, then re-run.

Because the database is gitignored, a `git pull` that brings in extraction changes
gives you *new code over an old database* with no warning. Rebuild after any pull
that touches `extraction/` or `db/load.ts`, and re-cut any Windows transfer zip
afterwards.
