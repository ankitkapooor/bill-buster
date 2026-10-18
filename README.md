# Bill Buster

Live: https://billbuster.ankitkapoor.me

A focused prototype: a synthetic Keck outpatient bill becomes an evidence-backed inquiry letter and phone checklist. PDF reading, deterministic checks and PDF generation run **in the browser**. Optional AI drafting uses an OpenAI Responses API call through a Cloudflare Worker, after the user adds a server secret. The template workflow needs no key. PDFs remain on the device; pressing **Refine with AI** sends confirmed bill fields to the Worker, which sends only generated findings to OpenAI. Reviews are not saved by the app; refreshing clears the review.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:8001. Requires Node.js 22 or later. `npm run build` produces the deployable `dist/` directory.

## Try the entire journey

1. Click **Try the sample bill**, or download the sample PDF and select it using **Upload synthetic PDF**. The file stays on the device.
2. Confirm the eight bill lines of **BB-21**, the default compound statement and tick the confirmation box.
3. Click **Review this bill**. Expected five questions: line 3 may duplicate line 2; lines 4 and 7 each exceed their Q3 outpatient MUE reference of 1; lines 4/5 form the active 80053/80048 NCCI edit and lines 6/7 the 96360/96374 edit. The confirmed bill total is $4,775. Overlapping findings are not additive savings.
4. Expand the evidence, price context and coverage table.
5. Click **Prepare my inquiry**, edit the letter, and download PDF or text. The professional PDF includes numbered sections, internal links from citations to evidence, external source hyperlinks, a confirmed-charge appendix and phone checklist. If configured, **Refine with AI** adds clearer explanations and requests before export.

The sample charges are invented. References are real, extracted from the supplied source pack. Checks run deterministically each time; no cached analysis is presented. PDF extraction supports the sample’s pipe-separated text layout and the visible headed statement tables in the 25-bill bank; scans and arbitrary bill layouts are unsupported. Selecting the built-in sample is visibly labeled as a fixture, not a PDF-extraction claim.

## Scope and behavior

- Keck Hospital of USC, outpatient facility, July 1–September 30, 2026; 20 selected codes.
- Possible duplicates require matching date, code, provider, modifiers, units and amount. Repeat modifiers 76/77/91 prevent duplicate flags. Separate providers are not combined.
- MUE indicator 1 uses claim-line units; indicators 2/3 aggregate code, date and provider. Missing units make the aggregate unassessable. Findings preserve indicator, rationale, quarter and source CSV record.
- NCCI hospital PTP pairs are checked against seven records filtered from all four full Q3 table parts. Same provider/date and CMS column direction are preserved. Effective and deletion dates apply (deletion is the last active day); indicator 9 is inactive. Indicator 0 cannot be bypassed by a modifier; indicator 1 with a possible associated modifier routes to documentation review, never automatic clearance. Repeat modifiers 76/77 alone do not bypass PTP. See `docs/NCCI.md`.
- Prices match facility, outpatient/both, unmodified CPT/HCPCS codes across all code columns. Distinct gross/cash prices remain unresolved; negotiated amounts require exact payer and plan. Formula-only rates stay unknown. Confirm the service-unit basis with billing. Data vintage is not proof of the applicable service-date rate.
- Unknown code/date/units/amount does not receive a false all-clear. Dates outside the quarter do not use Q3 references. Unsupported hospitals and settings are rejected.
- Template letters use only confirmed lines and cited findings. A source-ID invariant verifies generated citations. User edits are labeled unvalidated and preserved on export. PDF uses a standard Western font; an explanatory note appears if unsupported characters must be replaced. Text export preserves all characters.
- Synthetic documents only: no scans, EOB processing, automatic sending, stored reviews or savings calculations. Optional LLM wording remains subject to user review; its figures and citations are inserted by code.

## API setup

There was no LLM in the original implementation. Optional server-side drafting is now implemented using **gpt-5.4-mini**. The API key is deliberately empty.

**Cloudflare Dashboard → Workers & Pages → bill-buster → Settings → Variables and Secrets → Add → Type: Secret → Variable name: OPENAI_API_KEY → paste key in Value → Deploy.** Refresh the website to enable **Refine with AI** on the packet screen. Full details and local setup: [docs/API-SETUP.md](docs/API-SETUP.md). `.env.example` points to this setup; Wrangler local development reads the ignored `.dev.vars` file.

The LLM helps explain each finding and formulate a documentation request. Coding checks and price comparisons remain deterministic. An unavailable or rejected AI response preserves the template. Tests use mocked API responses; a real model call has not been made because the user will supply the key manually.

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

The 64 tests include 20 original statement-bank tests, 6 compound-statement/PDF tests, 6 AI drafting/Worker tests, 17 dedicated NCCI tests, and 15 workflow tests: ten PDF-to-packet runs, clean bills, repeats, provider separation, MUE indicator logic, quarter boundaries, exact plan matching, ambiguous prices, missing fields, input rejection and output citations. They do not establish the PRD’s independent 30-bill/coder evaluation or real-world accuracy.

## Deployment

```sh
npm run deploy
```

`wrangler.jsonc` binds the static assets to `billbuster.ankitkapoor.me` on the user’s Cloudflare account. Wrangler manages the custom domain and HTTPS. The Worker serves assets and the optional drafting route. OpenAI API use requires the user’s funded API project. No Railway service is needed. The Railway project-creation attempt was rejected because the account’s trial expired; no Railway project was created.

Bundled browser libraries are Mozilla PDF.js via unpdf and pdf-lib. Cloudflare serves the assets and makes optional OpenAI requests. No external fonts, analytics or persistent browser storage are used. Content security headers are in `scripts/build.mjs`; Worker API responses are not cached. API request bodies and keys are not logged by the application.

## 25-bill bank

Browse https://billbuster.ankitkapoor.me/test-bills/ or open `public/test-bills/` locally. The original ZIP contains 20 realistic-looking synthetic statements; a separate **five-compound-bills.zip** adds BB-21–BB-25, with its own CSV/JSON answer keys. All statements are clearly marked synthetic. PDFs contain visible statement tables, not hidden extraction data. Patient identity/account fields are not imported into the tool.

Bank v2 contains 6 controls, 9 bills with planted questions and 5 edge cases. BB-09 raises a modifier-indicator-1 bundling question for 96360/96374. BB-15 uses modifier 59 on the same pair and must request documentation review. BB-20 raises the modifier-indicator-0 80053/80048 bundling question. BB-16/18 separate dates/providers; BB-17 is outside Q3 for its October pair. No result implies comprehensive coding clearance.

`fixtures/bill-bank/cases.json` holds authored expectations, cross-checked against original source CSV/TXT records. `tests/bill-bank.test.mjs` compares every extracted field, all four per-line checks (duplicate, MUE, PTP and price), modifier reviews and packet generation against that key. `public/test-bills/verification.json` records the contract checks; it is not an accuracy study. The bank uses actual indicator-3 source records; indicator-1/2 logic is covered only by the separate unit tests.

To recreate the PDFs, install ReportLab in a Python environment and run:

```sh
python3 scripts/create_bill_bank.py /absolute/path/to/bill-buster-public-sources
npm test
npm run build
```

The standalone archive is also written to `output/pdf/bill-bank/bill-buster-20-bills.zip`. No Python dependencies are needed to run the website, build existing assets, or execute its JavaScript tests.

### Five compound cases and the default

BB-21 combines a repeated CBC, excess panel/administration units and two NCCI pairs. BB-22 adds split same-day unit aggregation. BB-23 tests a possible modifier exception alongside a non-bypassable edit. BB-24 has three overlapping PTP pairs. BB-25 retains known questions while leaving unknown charges, unsupported codes and October rules unassessed. All five contain duplicate, MUE and NCCI questions.

`fixtures/compound-bills/cases.json` is the authored answer key; tests compare all visible fields and all four line-check statuses after PDF extraction. `scripts/create_compound_bills.py` regenerates the five statements and sets `data/sample.json` to BB-21. Build copies the actual BB-21 statement to `/sample-bill.pdf`. The landing illustration, built-in demo and downloadable sample therefore use the same bill. `/test-bills/BB-21-inquiry-example.pdf` is a verified-template example of the professional export; no AI response is simulated as a live result.
