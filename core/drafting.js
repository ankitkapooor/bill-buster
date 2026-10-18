export function draftFacts(result) {
  return {scope:'Synthetic Medicare-reference outpatient billing inquiry. Questions, not proven errors.',
    findings:[...result.findings,...result.modifier_reviews].map(f=>({id:f.id,kind:f.kind,status:f.status??'question',
      detail:f.detail,question:f.question,evidence_ids:f.evidence.map(e=>e.id)}))};
}
export function draftSchema(result) {
  return {
    type:'object',additionalProperties:false,required:['opening','requests','closing'],
    properties:{
      opening:{type:'string'},closing:{type:'string'},
      requests:{type:'array',items:{
        type:'object',additionalProperties:false,required:['finding_id','explanation','request'],
        properties:{finding_id:{type:'string',enum:draftFacts(result).findings.map(f=>f.id)},explanation:{type:'string'},request:{type:'string'}}
      }}
    }
  };
}
export function validateNarrative(value,result) {
  const ids=new Set(draftFacts(result).findings.map(f=>f.id));
  if(!value||typeof value!=='object'||!Array.isArray(value.requests)||value.requests.length!==ids.size)throw new Error('Incomplete draft');
  function prose(text,max) {
    if(typeof text!=='string'||text.length<12||text.length>max||/[\d\[\]<>]|https?:|www\.|\$|%/i.test(text))throw new Error('Unsupported draft facts');
    if(/guarantee|definitely|certainly|illegal|fraud|must (?:remove|refund|pay)|confirmed (?:error|overcharge)|you owe|you are entitled|stop pay|withhold pay|you (?:underwent|received)|was (?:performed|administered|unnecessary)|insurance (?:covers|will pay)/i.test(text))throw new Error('Unsupported assertion');
    return text.trim();
  }
  const seen=new Set();
  const patientProse=(text,max,requireFirstPerson=false)=>{const clean=prose(text,max);if((requireFirstPerson&&!/\b(I|my|me)\b/i.test(clean))||/\b(?:the|a|your) patient\b|\byour (?:bill|charges|insurer|insurance|claim)\b|\byou (?:should|need to|may want to|(?:can|could|might) (?:ask|contact|request|send this|use this))\b|\bask (?:the )?(?:hospital|facility|billing)\b|\bthe (?:hospital|facility|billing office) should\b/i.test(clean))throw new Error('Draft must be written by the patient to the facility');return clean;};
  const requests=value.requests.map(r=>{
    if(!r||!ids.has(r.finding_id)||seen.has(r.finding_id))throw new Error('Unknown or duplicate finding');
    seen.add(r.finding_id);return {finding_id:r.finding_id,explanation:patientProse(r.explanation,420),request:patientProse(r.request,420)};
  });
  return {opening:patientProse(value.opening,500,true),closing:patientProse(value.closing,500,true),requests};
}
