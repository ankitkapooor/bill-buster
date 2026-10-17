# Bill Buster

A focused prototype: a synthetic Keck outpatient bill becomes an evidence-backed inquiry letter and phone checklist. No account, database, model or API key is required. No bill documents or results are stored.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.server
```

Open http://localhost:8000. `PORT` defaults to 8000. The app does not automatically load `.env`; export a setting in your shell or configure it in your host.

## Try the entire journey

1. Click **Try the sample bill**, or download the sample PDF and upload it.
2. Confirm the five extracted lines and tick the confirmation box.
3. Click **Review this bill**. Expected questions: line 4 may duplicate line 2; line 5 has 2 units of 80053 against the published Q3 outpatient MUE of 1, indicator 3.
4. Expand each evidence section and inspect the price context and coverage table.
5. Click **Prepare my inquiry**, edit the letter, and download PDF or text. The phone checklist is included.

The sample charges are invented. References are real, extracted from the supplied source pack. Results run deterministically each time; no cached analysis is presented. PDF extraction reads the sample's pipe-separated text layout; scans and arbitrary bill layouts are unsupported. The sample route is a fixture, not an extraction claim.

## Scope and behavior

- Keck Hospital of USC, outpatient facility, July 1–September 30, 2026; 20 selected codes.
- Possible duplicates require matching date, code, provider, modifiers, units and amount. Repeat modifiers 76/77/91 prevent duplicate flags. Separate providers are not combined.
- MUE indicator 1 uses claim-line units; indicators 2/3 aggregate code, date and provider. Missing units make the aggregate unassessable. Findings preserve indicator, rationale, quarter and source CSV record.
- Price context matches facility, outpatient/both, unmodified CPT/HCPCS codes across all code columns. Distinct gross/cash prices remain unresolved; negotiated amounts require exact payer and plan. No formula-only prices are treated as numbers. Confirm the service-unit basis with billing. Data vintage is not proof of the service-date price.
- Unknown code/date/units/amount does not receive a false all-clear. Dates outside the reference quarter do not use Q3 MUE or prices. Unknown hospitals and settings are rejected.
- Template letters are built only from confirmed lines and cited findings. A source-ID invariant verifies generated citations. User edits are explicitly labeled unvalidated and preserved on export.
- No PTP code-pair review, AI calls, real patient documents, scans, EOBs, automatic sending, saved records or savings calculations.

## API keys

[.env.example](.env.example) provides empty placeholders. **No API keys are needed for any implemented feature.** `OPENAI_API_KEY` and `OPENAI_MODEL` are reserved for future integration and are intentionally not read. Adding them alone does not activate AI. Deployment tooling placeholders are separate from application behavior. Keep secrets out of `static/` and Git.

## Data provenance

`data/references.json` contains the 20-code subset, exact source record numbers, original source URLs and SHA-256 hashes. Keck's file is dated April 1, 2026. CMS uses 2026 Q3 outpatient hospital MUEs. See `data/NOTICES.md` for retained data notices. This is a limited synthetic prototype, not a CPT dictionary or a validated clinical/billing product.

Rebuild from the original source pack:

```sh
python scripts/prepare_data.py /absolute/path/to/bill-buster-public-sources
```

## Verification

```sh
python -m unittest discover -s tests -v
node --check static/app.js
```

Tests cover the full PDF→confirmable schema→analysis→letter/PDF journey for ten consecutive runs; clean bills; repeats; provider separation; all three MUE indicators; date boundaries; exact plan matching; ambiguous prices; unknowns; and invalid inputs. They are engineering checks, not the PRD's independent 30-bill/coder evaluation or a real-world accuracy claim.

## Hosting

The Dockerfile runs the stateless Python service. Railway uses `railway.toml` and `/api/health`; no volume is needed. Deploy this repository on Railway, generate a Railway domain, and add `billbuster.ankitkapoor.me` as a custom domain. Copy the **exact CNAME and verification records returned by Railway** into Cloudflare DNS. Keep the port set to Railway's `PORT` variable. Do not copy app API keys into DNS or frontend code.

Security scope: same-origin requests, body/page/line limits, escaped rendered text, strict content security policy, no document logging or persistence. The public endpoint accepts synthetic samples and is not a production medical-document upload service. Rate limiting, broader PDF isolation and a privacy review are prerequisites for real-document support.
