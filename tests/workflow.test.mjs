import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {analyze,validate,packet,REFERENCES,BillError} from '../core/engine.js';
import {SAMPLE,samplePDF,extractPDF,pdfDocument,appealPDF} from '../core/documents.js';
import {getDocumentProxy,extractText} from 'unpdf';
const baseline=JSON.parse(await readFile(new URL('../fixtures/workflow-baseline.json',import.meta.url)));
const sample=()=>structuredClone(baseline);
const questions=(bill,kind,refs)=>analyze(bill,refs).findings.filter(f=>f.kind===kind);

test('ten complete synthetic PDF-to-packet runs',async()=>{
  const source=await samplePDF();
  for(let i=0;i<10;i++) {
    const extracted=await extractPDF(source.slice());
    assert.deepEqual(validate(extracted.bill),validate(SAMPLE));
    const result=analyze(extracted.bill),draft=packet(result);
    assert.deepEqual(result.findings.map(f=>[f.kind,f.lines]),[['duplicate',[2,3]],['units',[4]],['units',[7]],['bundling',[4,5]],['bundling',[6,7]]]);
    assert.equal(result.total,4775);
    assert.match(draft.letter,/\[BILL-2-3\]/);assert.match(draft.letter,/\[MUE-Q3-2026-80053\]/);
    const pdf=await appealPDF(result,draft);
    const content=await extractText(pdf.slice(),{mergePages:true});
    assert.match(content.text,/MUE-Q3-2026-80053/);assert.match(content.text,/FOLLOW-UP CALL CHECKLIST/);
    assert.match(content.text,/PTP-Q3-2026-80053-80048/);
    if(i===0){await mkdir('output',{recursive:true});await writeFile('output/synthetic-bill.pdf',source);await writeFile('output/inquiry-packet.pdf',pdf);}
  }
});
test('independently recorded CMS and Keck source values',()=>{
  assert.equal(REFERENCES.mue['80053'].limit,1);
  assert.equal(REFERENCES.mue['85025'].limit,4);assert.equal(REFERENCES.mue['85025'].indicator,3);
  const row=REFERENCES.prices['85025'].find(r=>r.record===94732);assert.equal(row.gross,84);assert.equal(row.cash,84);
});
test('clean bill produces no coding questions',()=>{
  const b=sample();b.lines=b.lines.filter((l,i)=>i!==3&&l.code!=='80048');b.lines.find(l=>l.code==='80053').units=1;assert.deepEqual(analyze(b).findings,[]);
});
test('repeat modifiers prevent duplicate questions',()=>{
  for(const m of ['76','77','91']){const b=sample();b.lines[3].modifiers=m;assert.equal(questions(b,'duplicate').length,0);}
});
test('different providers and dates do not create duplicate flags',()=>{
  for(const edit of [{provider:'Other provider'},{date:'2026-09-15'}]){const b=sample();Object.assign(b.lines[3],edit);assert.equal(questions(b,'duplicate').length,0);}
});
test('date-of-service units aggregate across same-provider lines',()=>{
  const b=sample();b.lines=[{...b.lines[4],units:1},{...b.lines[4],units:1}];
  assert.deepEqual(questions(b,'units').map(f=>f.lines),[[1,2]]);
  b.lines[1].date='2026-09-15';assert.equal(questions(b,'units').length,0);
});
test('indicator one uses claim line; indicator two retains policy explanation',()=>{
  const refs=structuredClone(REFERENCES),b=sample();b.lines=[{...b.lines[4],units:1},{...b.lines[4],units:1}];
  refs.mue['80053'].indicator=1;assert.equal(questions(b,'units',refs).length,0);
  b.lines[0].units=2;assert.deepEqual(questions(b,'units',refs).map(f=>f.lines),[[1]]);
  refs.mue['80053'].indicator=2;assert.match(questions(b,'units',refs)[0].evidence[0].detail,/policy edit/);
});
test('quarter boundaries abstain rather than using the wrong source',()=>{
  for(const [date,supported] of [['2026-06-30',false],['2026-07-01',true],['2026-09-30',true],['2026-10-01',false]]) {
    const b=sample();b.lines.forEach(l=>l.date=date);const r=analyze(b);
    assert.equal(r.findings.some(f=>f.kind==='units'),supported);
    if(!supported)assert.ok(r.checks.filter(c=>['units','price'].includes(c.check)).every(c=>c.status==='unable'));
  }
});
test('missing fields and unsupported codes are unable to assess',()=>{
  const b=sample();b.lines=[{...b.lines[0],code:'',units:'',amount:''}];assert.ok(analyze(b).checks.every(c=>c.status==='unable'));
  Object.assign(b.lines[0],{code:'99999',units:1,amount:100});assert.equal(analyze(b).checks.find(c=>c.check==='units').status,'unable');
});
test('missing units prevent a false clear on day totals',()=>{
  const b=sample();b.lines=[{...b.lines[4],units:1},{...b.lines[4],units:''}];assert.ok(analyze(b).checks.filter(c=>c.check==='units').every(c=>c.status==='unable'));
});
test('negotiated rates require exact payer and plan',()=>{
  const b=sample();Object.assign(b,{payer:'Unitedhealthcare',plan:'Navigate/Select & Core Exchange'});
  assert.equal(analyze(b).prices[1].negotiated.unit,12.83);b.plan='Unknown';assert.equal(analyze(b).prices[1].negotiated,null);
});
test('price scaling, unknown modifiers and conflicting CDM prices',()=>{
  const b=sample();b.lines=[{...b.lines[1],units:2}];assert.equal(analyze(b).prices[0].gross.total,168);
  b.lines[0].modifiers='91';assert.equal(analyze(b).prices[0].status,'unable');b.lines[0].modifiers='';
  const refs=structuredClone(REFERENCES);refs.prices['85025'].push({...refs.prices['85025'][0],gross:999,record:999999});
  assert.equal(analyze(b,refs).prices[0].gross,null);
});
test('invalid inputs, wrong scope and impossible dates are rejected',()=>{
  for(const [key,value] of [['units',-1],['units',1.5],['units','NaN'],['units',false],['amount','Infinity'],['amount',-.1],['amount',.001],['date','2026-02-30'],['code','<svg>'],['modifiers','123']]) {
    const b=sample();b.lines[0][key]=value;assert.throws(()=>validate(b),BillError);
  }
  const b=sample();b.hospital='Other';assert.throws(()=>validate(b),BillError);
});
test('PDF rejection, empty plan and accurate text extraction',async()=>{
  await assert.rejects(extractPDF(new TextEncoder().encode('not a PDF')),BillError);
  await assert.rejects(extractPDF(await pdfDocument('Synthetic',['SYNTHETIC','No coded lines'])),BillError);
  const b=(await extractPDF(await samplePDF())).bill;assert.equal(b.plan,'');assert.equal(b.lines[0].amount,'1850.00');
});
test('template references all evidence, edits can be exported and text is escaped in PDF',async()=>{
  const r=analyze(sample()),draft=packet(r);
  for(const f of r.findings)for(const e of f.evidence)assert.ok(draft.letter.includes(`[${e.id}]`));
  const pdf=await pdfDocument('Edited packet',['User-edited, not automatically validated.','<script>Literal user text</script>']);
  assert.ok(pdf.length>500);
});
