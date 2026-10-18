import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,packet,REFERENCES} from '../core/engine.js';
const line=(code,extra={})=>({code,date:'2026-09-14',description:'Synthetic service',units:1,amount:100,modifiers:'',provider:'FAC-A',...extra});
const bill=(a='80053',b='80048')=>({hospital:'Keck Hospital of USC',setting:'outpatient',payer:'Medicare',plan:'',lines:[line(a),line(b)]});
const ptp=r=>r.findings.filter(f=>f.kind==='bundling');

test('PTP subset comes from all four hospital parts and preserves source direction/row',()=>{
  assert.equal(REFERENCES.sources.ptp.files.length,4);assert.equal(REFERENCES.ptp.complete,true);
  assert.equal(REFERENCES.ptp.records.length,7);
  assert.deepEqual(REFERENCES.ptp.records.find(r=>r.column1==='80053'&&r.column2==='80048'),{
    column1:'80053',column2:'80048',effective:'2000-07-01',deletion:null,modifier_indicator:0,
    rationale:'CPT Manual or CMS manual coding instruction',file:'ccioph-v322r0-f4.txt',row:213077});
});
test('every published pair in the selected subset produces its own cited finding',()=>{
  for(const [first,second,indicator] of [['71275','96360',1],['71275','96374',1],['71275','96375',1],['74177','96360',1],['74177','96374',1],['80053','80048',0],['96360','96374',1]]) {
    const f=ptp(analyze(bill(first,second)));
    assert.equal(f.length,1);assert.match(f[0].evidence[0].id,new RegExp(`PTP-Q3-2026-${first}-${second}-`));
    assert.ok(f[0].detail.includes(`indicator ${indicator}`));
  }
});
test('indicator 0 raises bundling even when a modifier is present',()=>{
  for(const modifier of ['', '59','XE','91']){const b=bill();b.lines[1].modifiers=modifier;const r=analyze(b);assert.equal(ptp(r).length,1);assert.equal(r.modifier_reviews.length,0);}
});
test('indicator 1 with no exception modifier raises a question',()=>{
  const r=analyze(bill('96360','96374'));assert.equal(ptp(r).length,1);assert.match(ptp(r)[0].detail,/indicator 1/);
});
test('59 and X modifiers route to review, never automatic clearance, on either column',()=>{
  for(const modifier of ['59','XE','XP','XS','XU'])for(const index of [0,1]){
    const b=bill('96360','96374');b.lines[index].modifiers=modifier;const r=analyze(b);
    assert.equal(ptp(r).length,0);assert.equal(r.modifier_reviews.length,1);
    assert.ok(r.checks.filter(c=>c.check==='ptp').every(c=>c.status==='review'));
    assert.match(packet(r).letter,/documentation supporting the modifier exception/);
  }
});
test('repeat modifiers 76 and 77 do not bypass PTP',()=>{
  for(const modifier of ['76','77']){const b=bill('96360','96374');b.lines[1].modifiers=modifier;assert.equal(ptp(analyze(b)).length,1);}
});
test('same anatomical modifiers do not bypass; different sides require review',()=>{
  const b=bill('71275','96374');b.lines[0].modifiers='LT';b.lines[1].modifiers='LT';
  assert.equal(ptp(analyze(b)).length,1);
  b.lines[1].modifiers='RT';assert.equal(analyze(b).modifier_reviews.length,1);
  b.lines[1].modifiers='LT,59';assert.equal(analyze(b).modifier_reviews.length,1);
});
test('column direction is preserved when bill ordering is reversed',()=>{
  const b=bill('80048','80053');const f=ptp(analyze(b))[0];assert.match(f.detail,/80048 \(column 2, lines 1\)/);assert.match(f.detail,/80053 \(column 1, lines 2\)/);
});
test('different service dates and providers do not produce a pair flag',()=>{
  for(const fields of [{date:'2026-09-15'},{provider:'FAC-B'}]){const b=bill();Object.assign(b.lines[1],fields);assert.equal(ptp(analyze(b)).length,0);}
});
test('unknown provider, unsupported peer code and out-of-quarter dates abstain',()=>{
  for(const fields of [{provider:''},{code:''},{code:'99999'}]){const b=bill();Object.assign(b.lines[1],fields);assert.ok(analyze(b).checks.filter(c=>c.check==='ptp').every(c=>c.status==='unable'));}
  const b=bill();b.lines.forEach(l=>l.date='2026-10-01');assert.ok(analyze(b).checks.filter(c=>c.check==='ptp').every(c=>c.status==='unable'));
});
test('PTP does not depend on the amount or units being readable',()=>{
  const b=bill();b.lines[0].amount='';b.lines[1].units='';assert.equal(ptp(analyze(b)).length,1);
});
test('effective date and inclusive last-active deletion date are respected',()=>{
  const refs=structuredClone(REFERENCES);const rule=refs.ptp.records.find(r=>r.column1==='80053');rule.effective='2026-08-01';rule.deletion='2026-08-31';
  for(const [date,active] of [['2026-07-31',false],['2026-08-01',true],['2026-08-31',true],['2026-09-01',false]]){
    const b=bill();b.lines.forEach(l=>l.date=date);assert.equal(ptp(analyze(b,refs)).length,active?1:0);
  }
});
test('indicator 9 is inactive, including retroactive deletion',()=>{
  const refs=structuredClone(REFERENCES);const rule=refs.ptp.records.find(r=>r.column1==='80053');rule.modifier_indicator=9;rule.effective=rule.deletion='2026-09-14';assert.equal(ptp(analyze(bill(),refs)).length,0);
});
test('an incomplete source set cannot provide a false all-clear',()=>{
  const refs=structuredClone(REFERENCES);refs.ptp.complete=false;
  assert.ok(analyze(bill(),refs).checks.filter(c=>c.check==='ptp').every(c=>c.status==='unable'));
});
test('one modified occurrence does not hide an unmodified occurrence',()=>{
  const b=bill('96360','96374');b.lines.push(line('96374',{modifiers:'59',amount:125}));const r=analyze(b);
  assert.deepEqual(ptp(r)[0].lines,[1,2]);assert.deepEqual(r.modifier_reviews[0].lines,[1,3]);
});
test('all duplicate occurrences of a code pair are cited in one grouped question',()=>{
  const b=bill();b.lines.push(line('80053',{amount:125}));const f=ptp(analyze(b));assert.equal(f.length,1);assert.deepEqual(f[0].lines,[1,2,3]);
});
test('PTP source IDs survive the inquiry validator',()=>{
  const r=analyze(bill()),draft=packet(r);assert.match(draft.letter,/\[PTP-Q3-2026-80053-80048-213077\]/);
  assert.ok(draft.evidence.some(e=>e.detail.includes('source line 213077')));
});
