# NCCI hospital PTP pipeline

The prototype now assesses **Medicare hospital-outpatient procedure-to-procedure (PTP) edits**, alongside MUE unit edits and duplicate/price checks. It does not implement all NCCI edit families or payer-specific adjudication.

## Reference preparation

`scripts/prepare_data.py` requires all four full Q3 2026 hospital PTP TXT parts (v322r0). It scans both columns for the selected 20 codes and retains all matching historical/current rows, preserving column 1/2, effective date, deletion date, modifier indicator, rationale, source filename and line number. Seven rows match. Full-file hashes and input record counts are in `data/references.json`. Change-only files and practitioner tables are not used.

This provides pair-table coverage only within the selected codes, hospital setting and July 1–September 30, 2026 service dates. It does not establish an all-clear for unsupported codes, incomplete bills, missing providers or other quarters.

## Runtime assessment

1. Validate the confirmed bill. The single uploaded bill is assumed to refer to one synthetic patient; patient/account identifiers are not imported.
2. Confirm that the reference subset is complete and the line's code/date/provider is in scope.
3. Match column 1 and column 2 services on the same service date and same billing-provider identifier, regardless of their order on the bill. Do not combine different providers or dates.
4. Apply the effective date and inclusive last-active deletion date. Ignore indicator 9 (retroactively deleted/non-applicable).
5. Apply the modifier indicator:
   - **0:** raise a potential bundling question; an associated modifier cannot bypass this edit.
   - **1 without a possible exception:** raise a potential bundling question.
   - **1 with a possible associated modifier:** return **modifier documentation review**, not a confirmed error or a clean result. The app cannot establish clinical appropriateness.
6. Group repeated occurrences into one question per source rule/date/provider/outcome; a modified occurrence never hides a separate unmodified occurrence.
7. Attach CMS quarter, column direction, row, rationale, date range and modifier indicator to each question/review. Carry these same facts and source IDs into the inquiry letter and PDF.

`core/ncci.js` returns per-line `clear`, `question`, `review` or `unable` statuses. Unknown peers can make a full pair review unassessable; known active pairs can still generate a cited question. Units and prices are not needed to identify a code-pair question.

## Modifier limitations

The CMS-associated modifier categories are drawn from the Medicare NCCI FAQ and 2026 policy manual, Chapter 1, Section E: global-surgery modifiers, 27/59/91/XE/XS/XP/XU, and anatomical modifiers. This is a **candidate-review rule**, not clinical modifier validation. A matching anatomical modifier on both services does not by itself route to an exception; different anatomical modifiers require review. Repeat modifiers **76 and 77 are not NCCI PTP-associated modifiers** and do not bypass an edit. All candidate exceptions remain visible in findings, coverage and the inquiry packet.

Sources: [CMS NCCI FAQ](https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-faq-library), [CMS hospital PTP tables](https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits), [CMS NCCI policy manuals](https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-policy-manual). The original downloaded manuals and license snapshot remain in the supplied source pack.

## Verification

Seventeen dedicated tests cover actual source records, indicators 0/1/9, bill-order reversal, dates, providers, unknowns, incomplete references, effectivity/deletion boundaries, anatomical modifiers, repeat modifiers, mixed modified/unmodified occurrences and letter citations. All 20 bank PDFs are re-extracted and compared with authored line-level keys; BB-09/15/20 test bundling and exception outcomes. The built-in sample includes a duplicate, an MUE and a PTP question in a complete PDF-to-packet workflow.

Source records for indicators 0/1 are real. Indicator 9 and date-boundary branches are exercised with injected unit-test reference records; the current seven-row production subset contains no indicator-9 rows. These are developer regression tests, not an independent clinical/coder validation.
