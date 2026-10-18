import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyze,packet,REFERENCES} from '../core/engine.js';
import {SAMPLE} from '../core/documents.js';
const sample=()=>structuredClone(SAMPLE);
const line=(code,extra={})=>({code,date:'2026-09-14',units:1,amount:100,modifiers:'',provider:'FAC-A',...extra});
const bill=lines=>({...sample(),lines});
test('price gaps distinguish missing records, ambiguous prices and missing plan details',()=>{
 const r=analyze(sample());
 assert.equal(r.prices[0].unavailable.gross.label,'No matching price');assert.match(r.prices[0].unavailable.cash.detail,/99284/);
 assert.equal(r.prices[7].unavailable.gross.label,'Multiple possible prices');assert.deepEqual(r.prices[7].unavailable.gross.values,[.62,20.04]);
 for(const p of r.prices){assert.equal(p.unavailable.negotiated.label,'No matching plan');assert.match(p.unavailable.negotiated.detail,/Medicare reimbursement rates/);}
 assert.equal(r.prices[1].gross.unit,84);assert.equal(r.findings.length,5);
});
test('each unsupported price input has its own explanation',()=>{
 for(const [patch,code] of [[{date:'2026-10-01'},'date'],[{code:''},'code'],[{units:''},'units'],[{amount:''},'amount'],[{modifiers:'59'},'modifier']]){
  const r=analyze(bill([line('85025',patch)]));for(const kind of ['gross','cash','negotiated'])assert.equal(r.prices[0].unavailable[kind].code,code);
 }
});
test('plan mismatch, absent dollars and formula-only rates remain separate',()=>{
 const b=bill([line('85025')]);b.payer='Unitedhealthcare';b.plan='Navigate/Select & Core Exchange';
 assert.equal(analyze(b).prices[0].negotiated.unit,12.83);
 b.plan='Unknown';assert.equal(analyze(b).prices[0].unavailable.negotiated.code,'plan');
 const refs=structuredClone(REFERENCES);refs.prices['85025']=[{...refs.prices['85025'][0],gross:null,cash:null,payer:'Unitedhealthcare',plan:'Unknown',negotiated:null,algorithm:'Contract formula'}];
 const p=analyze(b,refs).prices[0];assert.equal(p.unavailable.gross.code,'missing');assert.equal(p.unavailable.negotiated.code,'formula');
});
test('default scenario counts overlapping MUE and bundled charges only once',()=>{
 const r=analyze(sample()),s=r.reduction;assert.equal(s.starting,4775);assert.equal(s.reduced,3018);assert.equal(s.reduction,1757);
 assert.deepEqual(s.adjustments.map(a=>[a.line,a.reduction]),[[3,212],[4,240],[5,125],[7,1180]]);
 assert.match(s.assumptions,/hypothetical/);assert.match(s.assumptions,/Overlapping findings count once/);
});
test('duplicate removal is applied before recomputing day-unit excess',()=>{
 const s=analyze(bill([line('80053',{amount:200}),line('80053',{amount:200})])).reduction;
 assert.equal(s.starting,400);assert.equal(s.reduced,200);assert.equal(s.reduction,200);assert.equal(s.adjustments.length,1);
});
test('three repeats and two bundled column-one occurrences do not double count',()=>{
 const s=analyze(bill([line('80053',{amount:220}),line('80053',{amount:220}),line('80053',{amount:220}),line('80048',{amount:125})])).reduction;
 assert.equal(s.reduced,220);assert.equal(s.reduction,565);assert.equal(new Set(s.adjustments.map(a=>a.line)).size,s.adjustments.length);
});
test('day totals retain earlier charges and proportionally reduce only remaining excess units',()=>{
 const s=analyze(bill([line('80053',{amount:220}),line('80053',{amount:260})])).reduction;assert.equal(s.reduced,220);assert.equal(s.reduction,260);
 const b=bill([line('80053',{units:3,amount:100})]);assert.equal(analyze(b).reduction.reduced,33.33);
});
test('modifier reviews do not create a reduction and clean bills stay unchanged',()=>{
 const r=analyze(bill([line('96360'),line('96374',{modifiers:'59'})]));assert.equal(r.modifier_reviews.length,1);assert.equal(r.reduction.reduction,0);assert.equal(r.reduction.reduced,200);
 const s=analyze(bill([line('85025',{amount:212})])).reduction;assert.equal(s.reduced,212);assert.equal(s.reduction,0);
});
test('different providers and dates do not combine unit limits',()=>{
 for(const extra of [{provider:'FAC-B'},{date:'2026-09-15'}])assert.equal(analyze(bill([line('80053'),line('80053',extra)])).reduction.reduction,0);
});
test('unknown charges never become a complete starting or reduced total',()=>{
 const s=analyze(bill([line('80053',{units:2,amount:480}),line('J7030',{amount:''})])).reduction;
 assert.equal(s.known_subtotal,480);assert.equal(s.starting,null);assert.equal(s.reduced,null);assert.equal(s.reduction,null);assert.equal(s.status,'incomplete');
});
test('every bank bill has a bounded scenario and patient-to-facility letter',async()=>{
 for(const path of ['bill-bank','compound-bills']){
 const bank=JSON.parse(await readFile(new URL(`../fixtures/${path}/cases.json`,import.meta.url)));
 for(const entry of bank.cases){const r=analyze(entry.bill),s=r.reduction,draft=packet(r);
  if(r.amount_complete){assert.ok(s.reduced>=0&&s.reduced<=s.starting,entry.id);assert.equal(Math.round(s.starting*100),Math.round(s.reduced*100)+Math.round(s.reduction*100));}else assert.equal(s.reduced,null);
  assert.match(draft.letter,/review of my itemized outpatient facility bill/);assert.match(draft.letter,/Dear Billing Review Team/);assert.match(draft.letter,/Please send me a written response/);
  assert.ok(!/your plan|The limited prototype|Ask about the units|Questions to discuss with billing|I was billed for my bill/.test(draft.letter));
  for(const f of r.findings.filter(f=>f.kind==='units'))assert.ok(draft.letter.includes(f.question.replace('please explain the','please explain why my bill lists')));
 }
 }
});
test('scenario respects claim-line versus day-total MUE adjudication',()=>{
 const b=bill([line('80053',{units:2,amount:100}),line('80053',{units:2,amount:120})]);
 const refs=structuredClone(REFERENCES);refs.mue['80053'].indicator=1;
 assert.equal(analyze(b,refs).reduction.reduced,110);
 refs.mue['80053'].indicator=2;assert.equal(analyze(b,refs).reduction.reduced,50);
});
test('three overlapping NCCI pairs remove each column-two charge once',async()=>{
 const bank=JSON.parse(await readFile(new URL('../fixtures/compound-bills/cases.json',import.meta.url))),b=bank.cases.find(c=>c.id==='BB-24').bill;
 const s=analyze(b).reduction;assert.equal(s.starting,8769);assert.equal(s.reduced,3701);assert.equal(s.reduction,5068);assert.equal(s.adjustments.filter(a=>a.line===3).length,1);
});
