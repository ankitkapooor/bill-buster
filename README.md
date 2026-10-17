# Bill Buster

Live: https://billbuster.ankitkapoor.me

A focused prototype: a synthetic Keck outpatient bill becomes an evidence-backed inquiry letter and phone checklist. All PDF reading, deterministic checks and PDF generation run **in the browser**. No account, backend, database, model or API key is required. Bills are never uploaded or saved; refreshing clears the review.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:8001. Requires Node.js 22 or later. `npm run build` produces the deployable `dist/` directory.

## Try the entire journey

1. Click **Try the sample bill**, or download the sample PDF and select it using **Upload synthetic PDF**. The file stays on the device.
2. Confirm the five bill lines and tick the confirmation box.
3. Click **Review this bill**. Expected questions: line 4 may duplicate line 2; line 5 has 2 units of 80053 against the published Q3 outpatient MUE of 1, indicator 3.
4. Expand the evidence, price context and coverage table.
5. Click **Prepare my inquiry**, edit the letter, and download PDF or text. The phone checklist is included.

The sample charges are invented. References are real, extracted from the supplied source pack. Checks run deterministically each time; no cached analysis is presented. PDF extraction supports the sample’s pipe-separated text layout; scans and arbitrary bill layouts are unsupported. Selecting the built-in sample is visibly labeled as a fixture, not a PDF-extraction claim.

## Scope and behavior

- Keck Hospital of USC, outpatient facility, July 1–September 30, 2026; 20 selected codes.
- Possible duplicates require matching date, code, provider, modifiers, units and amount. Repeat modifiers 76/77/91 prevent duplicate flags. Separate providers are not combined.
- MUE indicator 1 uses claim-line units; indicators 2/3 aggregate code, date and provider. Missing units make the aggregate unassessable. Findings preserve indicator, rationale, quarter and source CSV record.
- Prices match facility, outpatient/both, unmodified CPT/HCPCS codes across all code columns. Distinct gross/cash prices remain unresolved; negotiated amounts require exact payer and plan. Formula-only rates stay unknown. Confirm the service-unit basis with billing. Data vintage is not proof of the applicable service-date rate.
- Unknown code/date/units/amount does not receive a false all-clear. Dates outside the quarter do not use Q3 references. Unsupported hospitals and settings are rejected.
- Template letters use only confirmed lines and cited findings. A source-ID invariant verifies generated citations. User edits are labeled unvalidated and preserved on export. PDF uses a standard Western font; an explanatory note appears if unsupported characters must be replaced. Text export preserves all characters.
- No PTP code-pair review, AI calls, real patient documents, scans, EOBs, automatic sending, stored records or savings calculations.

## API key placeholders

`.env.example` provides empty placeholders for later manual setup. **No API keys are needed by this prototype.** `OPENAI_API_KEY` and `OPENAI_MODEL` are reserved for a future server-side integration and are intentionally not read. Adding them alone does not enable AI. Never put secrets in browser code, build-time frontend variables or Git. Deployment credentials belong in local tooling or CI secrets, not the app.

## Sources

`data/references.json` contains the 20-code subset, source record numbers, original URLs and SHA-256 hashes. Keck’s file is dated April 1, 2026. CMS uses the 2026 Q3 outpatient hospital MUE table. Notices are in `data/NOTICES.md`. This is a limited synthetic prototype, not a CPT dictionary or a clinically validated product.

Rebuild the subset with Python’s standard library:

```sh
python3 scripts/prepare_data.py /absolute/path/to/bill-buster-public-sources
```

## Verification

```sh
npm test
npm run check
npm run build
```

The 15 tests cover ten PDF-to-packet runs, clean bills, repeats, provider separation, all MUE indicators, quarter boundaries, exact plan matching, ambiguous prices, missing fields, input rejection and output citations. They do not establish the PRD’s independent 30-bill/coder evaluation or real-world accuracy.

## Deployment

```sh
npm run deploy
```

`wrangler.jsonc` binds the static assets to `billbuster.ankitkapoor.me` on the user’s Cloudflare account. Wrangler manages the custom domain and HTTPS. No Railway service or paid compute plan is needed for the browser-only application. The Railway project-creation attempt was rejected because the account’s trial expired; no Railway project was created.

The only dependencies at runtime are bundled browser libraries: Mozilla PDF.js via unpdf and pdf-lib. Cloudflare serves the assets. No external fonts, analytics, API calls or persistent browser storage are used. Content security headers are in `scripts/build.mjs`.
