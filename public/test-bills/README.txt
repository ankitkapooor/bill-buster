BILL BUSTER - 20 SYNTHETIC STATEMENTS

All names, accounts, charges and clinical combinations are invented. These are not hospital-issued documents, clinical records or payment requests. The hospital name identifies the prototype reference scope. No hospital logo or patient data is used.

HOW TO TEST
1. Open https://billbuster.ankitkapoor.me and choose Upload synthetic PDF.
2. Choose one BB-xx.pdf, inspect the extracted lines, and confirm them.
3. Review the questions and evidence, then download an inquiry packet.
4. Compare with answer-key.csv (overview) or answer-key.json (line-level details).

The PDFs contain ordinary visible statement tables. They do not embed an invisible JSON payload, answers, or a hidden pipe-separated extraction appendix. Patient/account fields are not imported into the prototype.

CASES
BB-01 through BB-06: no planted duplicate/MUE questions.
BB-07 through BB-14: planted duplicate, MUE or combined questions.
BB-15 through BB-20: repeat modifiers, date/provider separation, quarter boundary, missing data and a PTP coverage gap.

IMPORTANT LIMITS
MUE is part of NCCI. The app checks published Q3 2026 hospital-outpatient MUEs for its selected codes and asks questions; it does not decide liability. All selected source MUE records in this bank have adjudication indicator 3. This bank therefore does not establish indicator-1/2 source coverage.

BB-20 includes an active hospital PTP pair: column 1 80053, column 2 80048, modifier indicator 0, effective 2000-07-01, no deletion in the supplied Q3 table. The app does not yet implement PTP review. It produces no duplicate/MUE question for this case; that is a known coverage gap, not evidence that the bill is clean.

Published prices are context, not patient responsibility or savings. Unknown/missing fields and dates outside Q3 must not be cleared. Missing charges make only a known-charge subtotal possible.

Expected findings were authored from the synthetic specifications and checked against the supplied source CSV/TXT. This is a developer-authored regression bank, not an independent held-out accuracy study or a billing-specialist evaluation.

SOURCE NOTICES
CPT codes and other data only are copyright 2025 American Medical Association. All rights reserved. CPT is a registered trademark of the AMA. Applicable FARS/DFARS Restrictions Apply to Government Use. No endorsement by AMA, CMS or Keck Hospital of USC is implied. The original source pack retains source terms.
