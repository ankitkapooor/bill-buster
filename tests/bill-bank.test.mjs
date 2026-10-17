import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {analyze,validate,packet} from '../core/engine.js';
import {extractPDF,pdfDocument} from '../core/documents.js';

const bank=JSON.parse(await readFile(new URL('../fixtures/bill-bank/cases.json',import.meta.url)));
const results=[];
for(const entry of bank.cases) {
  test(`${entry.id}: visible statement extraction and authored answer key`,async()=>{
    const input=await readFile(new URL(`../public/test-bills/${entry.pdf}`,import.meta.url));
    const extracted=await extractPDF(input);
    assert.deepEqual(validate(extracted.bill),validate(entry.bill),'Every visible date/code/unit/amount/modifier/provider must match, including blanks');
    assert.match(extracted.method,/visible statement table/);
    const result=analyze(extracted.bill);
    const sorted=items=>items.map(f=>({kind:f.kind,lines:f.lines})).sort((a,b)=>a.kind.localeCompare(b.kind));
    assert.deepEqual(sorted(result.findings),sorted(entry.expected_findings));
    for(const expected of entry.expected_line_checks)for(const check of ['duplicate','units','ptp','price']) {
      assert.equal(result.checks.find(c=>c.line===expected.line&&c.check===check)?.status,expected[check],`Line ${expected.line}, ${check}`);
    }
    if(entry.id==='BB-06')assert.equal(result.prices[0].negotiated.unit,12.83);
    if(entry.id==='BB-19'){assert.equal(result.amount_complete,false);assert.equal(result.total,357);}
    assert.deepEqual(sorted(result.modifier_reviews),sorted(entry.expected_modifier_reviews));
    if(entry.ptp)assert.ok([...result.findings,...result.modifier_reviews].some(f=>f.evidence.some(e=>e.id.startsWith('PTP-'))),'PTP outcome must carry a source citation');
    const draft=packet(result),pdf=await pdfDocument('Bank validation inquiry',[draft.validation,...draft.letter.split('\n\n'),'Phone checklist',...draft.checklist]);
    assert.ok(pdf.byteLength>1000);
    results.push({id:entry.id,extraction:'matches authored fixture',duplicate_mue_ptp_findings:'matches authored key',line_checks:result.check_count,packet:'generated',ptp:entry.ptp?.expected??'matches authored per-line PTP key'});
  });
}
test.after(async()=>{
  // A contract/regression report, deliberately not a clinical accuracy score.
  results.sort((a,b)=>a.id.localeCompare(b.id));
  await writeFile(new URL('../public/test-bills/verification.json',import.meta.url),JSON.stringify({
    date:'2026-10-17',bills_verified:results.length,bills_expected:20,
    statement:'Visible extraction, duplicate/MUE/PTP checks and modifier reviews match developer-authored fixtures. Not independent/coder validation; scoped to 20 codes and Q3 hospital outpatient references.',results
  },null,2)+'\n');
});
