import {analyze,packet} from '../core/engine.js';
import {draftFacts,draftSchema,validateNarrative} from '../core/drafting.js';

const instructions=`Write AS THE PATIENT, in the first person, directly TO THE OUTPATIENT FACILITY billing department. This is a professional letter I will send about my synthetic bill. Opening, closing and every request must use I, my or me. Explanations should refer to my bill or my charges. Never address me as the reader, advise me what to ask, refer to me as the patient, or narrate what the facility should do in the third person. Address the facility as you or your billing team when appropriate. Use ONLY the supplied findings. Do not decide that a charge is wrong. Explain the reason for each question in accessible everyday language, then request the specific clarification or documentation relevant to that finding. Treat modifier reviews as possible valid exceptions. Do not invent services, medical necessity, patient history, payer coverage, legal rights, refunds, savings or deadlines. Do not suggest withholding payment. Do not repeat ANY numerals, codes, dates, amounts, citations or URLs in prose; deterministic code will insert those facts and evidence separately. Return exactly one request for every supplied finding ID. Keep each explanation and request brief. Opening and closing should request a written billing review and explanation, without making allegations. Return the required JSON structure.`;
function json(value,status=200) {return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
async function limitedBody(request) {
  if(Number(request.headers.get('content-length')??0)>65536)throw new Error('oversize');
  const reader=request.body?.getReader();if(!reader)throw new Error('empty');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new Error('oversize');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
export async function generateDraft(result,env,fetcher=fetch) {
  const fallback=(reason,reason_code)=>({packet:packet(result),mode:'template',message:reason,...(reason_code?{reason_code}:{})});
  if(!env.OPENAI_API_KEY)return fallback('AI drafting is awaiting setup. Your verified template is ready.');
  const facts=draftFacts(result);if(!facts.findings.length||facts.findings.length>14)return fallback('The verified template is the best fit for this review.');
  try {
    const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:env.OPENAI_MODEL||'gpt-5.4-mini',store:false,instructions,input:JSON.stringify(facts),
        reasoning:{effort:'low'},max_output_tokens:3500,text:{format:{type:'json_schema',name:'billing_inquiry_draft',strict:true,schema:draftSchema(result)}}}),signal:AbortSignal.timeout(25000)});
    if(!response.ok)return fallback('AI drafting is unavailable. The verified template has been retained.');
    const data=await response.json();if(data.status!=='completed')throw new Error('Incomplete response');
    const text=(data.output??[]).flatMap(m=>m.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
    const narrative=validateNarrative(JSON.parse(text),result);
    return {packet:packet(result,narrative),mode:'ai',message:'AI wording added. Confirmed figures and evidence are inserted by code; review the wording before sending.'};
  } catch(error) {
    const codes={'Draft must be written by the patient to the facility':'perspective','Incomplete draft':'missing_findings','Unsupported draft facts':'unsupported_facts','Unsupported assertion':'unsupported_assertion','Unknown or duplicate finding':'finding_ids','Incomplete response':'incomplete_response'};
    return fallback('AI drafting could not be verified. The verified template has been retained.',codes[error.message]||'unverified_response');
  }
}
export default {async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==='/api/status'&&request.method==='GET')return json({ai_configured:!!env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-5.4-mini'});
  if(url.pathname!=='/api/draft')return env.ASSETS.fetch(request);
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  if(request.headers.get('Origin')!==url.origin)return json({error:'Open this request from Bill Buster.'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Use JSON bill data.'},415);
  try {
    const raw=await limitedBody(request),result=analyze(raw.bill);
    if(env.OPENAI_API_KEY) {
      if(!env.AI_RATE_LIMITER)return json({error:'AI drafting protection is unavailable. Use the verified template.'},503);
      const {success}=await env.AI_RATE_LIMITER.limit({key:`draft:${request.headers.get('CF-Connecting-IP')||'local'}`});
      const global=success?await env.AI_RATE_LIMITER.limit({key:'prototype-drafting'}):{success:false};
      if(!success||!global.success)return json({error:'AI drafting limit reached. Please wait a minute or use the verified template.'},429);
    }
    return json(await generateDraft(result,env));
  } catch {return json({error:'The draft request could not be processed. Check the confirmed bill fields.'},400);}
}};
