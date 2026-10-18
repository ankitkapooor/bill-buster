import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFArray} from 'pdf-lib';
import {analyze,validate,packet} from '../core/engine.js';
import {extractPDF,appealPDF,SAMPLE} from '../core/documents.js';
import {extractText} from 'unpdf';
const bank=JSON.parse(await readFile(new URL('../fixtures/compound-bills/cases.json',import.meta.url)));
const sorted=items=>items.map(f=>({kind:f.kind,lines:f.lines})).sort((a,b)=>a.kind.localeCompare(b.kind)||a.lines[0]-b.lines[0]);
for(const entry of bank.cases)test(`${entry.id}: compound statement, all checks, professional linked PDF`,async()=>{
  const extracted=await extractPDF(await readFile(new URL(`../public/test-bills/${entry.pdf}`,import.meta.url)));
  assert.deepEqual(validate(extracted.bill),validate(entry.bill));
  assert.match(extracted.method,/visible statement table/);
  const result=analyze(extracted.bill);
  assert.deepEqual(sorted(result.findings),sorted(entry.expected_findings));
  assert.deepEqual(sorted(result.modifier_reviews),sorted(entry.expected_modifier_reviews));
  for(const expected of entry.expected_line_checks)for(const check of ['duplicate','units','ptp','price'])assert.equal(result.checks.find(c=>c.line===expected.line&&c.check===check)?.status,expected[check],`Line ${expected.line}: ${check}`);
  assert.ok(['duplicate','units','bundling'].every(kind=>result.findings.some(f=>f.kind===kind)));
  if(entry.id==='BB-21'){assert.deepEqual(validate(SAMPLE),validate(entry.bill));assert.equal(result.total,4775);}
  if(entry.id==='BB-25'){assert.equal(result.amount_complete,false);assert.equal(result.total,2594);}
  const draft=packet(result),bytes=await appealPDF(result,draft,{prepared:'October 18, 2026'});
  const doc=await PDFDocument.load(bytes),text=(await extractText(bytes.slice(),{mergePages:true})).text;
  for(const phrase of ['PURPOSE OF THIS REQUEST','ITEMS REQUIRING CLARIFICATION','PUBLISHED PRICE CONTEXT','REQUESTED RESPONSE','SCOPE OF THIS REVIEW','APPENDIX A. SUPPORTING EVIDENCE','APPENDIX B. CONFIRMED CHARGES','FOLLOW-UP CALL CHECKLIST'])assert.ok(text.includes(phrase),phrase);
  const urls=[],destinations=[];
  for(const page of doc.getPages())for(const ref of page.node.Annots()?.asArray()??[]){
    const annotation=doc.context.lookup(ref),action=annotation.lookup(PDFName.of('A'));
    if(action)urls.push(action.lookup(PDFName.of('URI')).decodeText());
    const dest=annotation.lookup(PDFName.of('Dest'));if(dest)destinations.push(dest);
  }
  assert.deepEqual(new Set(urls),new Set(draft.evidence.filter(e=>e.url).map(e=>e.url)),'Each published source must be an actual hyperlink');
  assert.ok(destinations.length>=draft.evidence.length,'In-text references link to evidence entries');
  for(const dest of destinations){assert.ok(dest instanceof PDFArray);assert.ok(doc.getPages().some(p=>p.ref.toString()===dest.get(0).toString()));}
  for(const e of draft.evidence)assert.ok(text.includes(e.id),`Evidence ${e.id} preserved`);
  await mkdir('output/pdf/compound-bills',{recursive:true});await writeFile(`output/pdf/compound-bills/${entry.id}-inquiry.pdf`,bytes);
  if(entry.id==='BB-21')await writeFile('public/test-bills/BB-21-inquiry-example.pdf',bytes);
});
test('user edits and long provider values survive professional export',async()=>{
  const bill=structuredClone(SAMPLE);bill.lines[0].provider='A long facility provider reference that needs more than one line in the confirmed charge appendix';
  const result=analyze(bill),draft=packet(result);draft.edited=true;draft.letter+='\n\nPlease address my additional question about the statement.';
  const bytes=await appealPDF(result,draft),text=(await extractText(bytes.slice(),{mergePages:true})).text;
  assert.match(text,/USER-EDITED LETTER/);assert.match(text,/Please address my additional question/);
  assert.ok(text.replace(/\s+/g,' ').includes(bill.lines[0].provider));
});
