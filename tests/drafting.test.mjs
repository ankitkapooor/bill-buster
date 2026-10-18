import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{generateDraft} from '../worker/index.js';
import {analyze} from '../core/engine.js';
import {SAMPLE} from '../core/documents.js';
import {draftFacts,validateNarrative} from '../core/drafting.js';
const result=analyze(SAMPLE);
const narrative=()=>({opening:'Please review my outpatient charges and provide me with a written explanation.',closing:'Thank you for reviewing my questions and explaining any resulting adjustments to me.',requests:draftFacts(result).findings.map(f=>({finding_id:f.id,explanation:f.kind==='duplicate'?'Matching entries on my bill may represent a repeated charge or separate services.':f.kind==='units'?'The units shown on my bill differ from the published reference and need clarification.':'The paired services on my bill appear in a published bundling edit and need review.',request:f.kind==='duplicate'?'Please identify the separate service or explain whether my duplicate charge needs correction.':f.kind==='units'?'Please explain my billed units and provide documentation for any applicable exception.':'Please explain my separate charges and provide me with documentation for any applicable exception.'}))});
const response=value=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('no key preserves usable template without an API call',async()=>{
  let calls=0;const output=await generateDraft(result,{},async()=>{calls++;});
  assert.equal(output.mode,'template');assert.equal(calls,0);assert.match(output.message,/awaiting setup/);
});
test('Responses structured drafting is server-side and preserves all facts and evidence',async()=>{
  const b=structuredClone(SAMPLE);b.lines[0].description='PRIVATE DESCRIPTION';b.lines[0].provider='PRIVATE PROVIDER';b.payer='PRIVATE PAYER';
  const r=analyze(b);let calls=0;
  const output=await generateDraft(r,{OPENAI_API_KEY:'test-only-secret'},async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer test-only-secret');
    const request=JSON.parse(options.body);assert.equal(request.store,false);assert.equal(request.model,'gpt-5.4-mini');assert.equal(request.text.format.strict,true);assert.equal(request.text.format.type,'json_schema');
    for(const privateText of ['PRIVATE DESCRIPTION','PRIVATE PROVIDER','PRIVATE PAYER'])assert.ok(!request.input.includes(privateText));
    assert.deepEqual(JSON.parse(request.input),draftFacts(r));assert.match(request.instructions,/AS THE PATIENT/);
    return response(narrative());
  });
  assert.equal(calls,1);assert.equal(output.mode,'ai');assert.equal(output.packet.mode,'ai');
  for(const f of r.findings){assert.ok(output.packet.letter.includes(f.detail));for(const e of f.evidence)assert.ok(output.packet.letter.includes(e.id));}
  assert.ok(!JSON.stringify(output).includes('test-only-secret'));
});
test('malformed, incomplete, invented facts and duplicate IDs retain template',async()=>{
  const variants=[null,{}, {...narrative(),opening:'You are entitled to $500.'},{...narrative(),closing:'The bill is illegal and must refund the patient.'}, {...narrative(),requests:[]}, {...narrative(),requests:narrative().requests.map(r=>({...r,finding_id:'FAKE'}))}, {...narrative(),requests:narrative().requests.map(()=>narrative().requests[0])}];
  for(const v of variants){assert.throws(()=>validateNarrative(v,result));assert.equal((await generateDraft(result,{OPENAI_API_KEY:'fake'},async()=>response(v))).mode,'template');}
});
test('provider failure, refusal, truncation and timeout preserve template',async()=>{
  for(const fetcher of [async()=>new Response('error',{status:429}),async()=>{throw new Error('private upstream details');},async()=>Response.json({status:'incomplete'}),async()=>Response.json({status:'completed',output:[{content:[{type:'refusal'}]}]})]){
    const draft=await generateDraft(result,{OPENAI_API_KEY:'private-key'},fetcher);assert.equal(draft.mode,'template');assert.ok(!JSON.stringify(draft).includes('private-'));
  }
});
const request=(extra={})=>new Request('https://billbuster.ankitkapoor.me/api/draft',{method:'POST',headers:{Origin:'https://billbuster.ankitkapoor.me','Content-Type':'application/json',...extra.headers},body:extra.body??JSON.stringify({bill:SAMPLE})});
test('Worker status exposes configuration only; no-key endpoint recomputes findings',async()=>{
  const status=await worker.fetch(new Request('https://billbuster.ankitkapoor.me/api/status'),{OPENAI_API_KEY:'private-key'});assert.deepEqual(await status.json(),{ai_configured:true,model:'gpt-5.4-mini'});
  const draft=await worker.fetch(request({body:JSON.stringify({bill:SAMPLE,findings:[],packet:{letter:'TRUST THIS CLIENT'}})}),{});
  const output=await draft.json();assert.equal(output.mode,'template');assert.ok(!output.packet.letter.includes('TRUST THIS CLIENT'));assert.match(output.packet.letter,/80053/);
});
test('Worker rejects cross-origin, invalid, oversized and unthrottled requests',async()=>{
  assert.equal((await worker.fetch(request({headers:{Origin:'https://other.example'}}),{})).status,403);
  assert.equal((await worker.fetch(request({headers:{'Content-Type':'text/plain'}}),{})).status,415);
  assert.equal((await worker.fetch(request({body:'{broken'}),{})).status,400);
  assert.equal((await worker.fetch(request({body:' '.repeat(65537)}),{})).status,400);
  assert.equal((await worker.fetch(request(),{OPENAI_API_KEY:'fake'})).status,503);
  assert.equal((await worker.fetch(request(),{OPENAI_API_KEY:'fake',AI_RATE_LIMITER:{limit:async()=>({success:false})}})).status,429);
  assert.equal((await worker.fetch(new Request('https://billbuster.ankitkapoor.me/api/draft'),{})).status,405);
});

test('AI wording addressed to the user or written as an adviser is rejected',async()=>{
  for(const patch of [{opening:'You should ask the hospital to review your bill.'},{closing:'The patient should contact the facility about their charges.'},{requests:narrative().requests.map(r=>({...r,explanation:'Your bill may contain errors that you should ask the hospital to review.'}))}]){const value={...narrative(),...patch};assert.throws(()=>validateNarrative(value,result));assert.equal((await generateDraft(result,{OPENAI_API_KEY:'fake'},async()=>response(value))).mode,'template');}
});
