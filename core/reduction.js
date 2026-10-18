const cents=n=>Math.round(n*100);
// A conditional bill-charge scenario, never an adjudicated balance or patient liability.
// Remove flagged later duplicates and column-two charges, then cap only the remaining
// flagged unit groups. Recompute from retained units so overlapping findings count once.
export function reductionScenario(bill,findings) {
  const rows=bill.lines.map(l=>({...l,remaining_units:l.units,reasons:[]}));
  function remove(id,finding) {
    const row=rows.find(r=>r.id===id);if(!row)return;
    row.remaining_units=0;row.reasons.push(finding.id);
  }
  for(const f of findings.filter(f=>f.kind==='duplicate'))remove(f.lines.at(-1),f);
  for(const f of findings.filter(f=>f.kind==='bundling'&&f.status!=='review'))
    for(const id of f.lines.filter(id=>rows.find(r=>r.id===id)?.code===f.column2))remove(id,f);
  for(const f of findings.filter(f=>f.kind==='units')) {
    const group=rows.filter(r=>f.lines.includes(r.id));
    let excess=Math.max(0,group.reduce((sum,r)=>sum+(r.remaining_units??0),0)-f.unit_limit);
    for(const row of [...group].reverse()) {
      const removed=Math.min(excess,row.remaining_units??0);if(!removed)continue;
      row.remaining_units-=removed;row.reasons.push(f.id);excess-=removed;
    }
  }
  const adjustments=rows.filter(r=>r.reasons.length).map(r=>{
    const after=r.amount==null?null:r.remaining_units===0?0:r.units==null?cents(r.amount):Math.round(cents(r.amount)*r.remaining_units/r.units);
    return {line:r.id,code:r.code,original:r.amount,remaining_units:r.remaining_units,reduced:after==null?null:after/100,reduction:after==null?null:(cents(r.amount)-after)/100,finding_ids:[...new Set(r.reasons)],reasons:[...new Set(r.reasons.map(id=>({duplicate:'Possible duplicate',bundling:'NCCI column-two charge',units:'Excess units at billed unit price'})[findings.find(f=>f.id===id).kind]))]};
  });
  const complete=bill.lines.every(l=>l.amount!=null),known_total=rows.reduce((sum,r)=>sum+cents(r.amount??0),0),deduction=adjustments.reduce((sum,r)=>sum+cents(r.reduction??0),0);
  return {status:complete?'scenario':'incomplete',starting:complete?known_total/100:null,known_subtotal:known_total/100,
    reduced:complete?(known_total-deduction)/100:null,reduction:complete?deduction/100:null,adjustments,
    assumptions:'Assumes the facility agrees to remove flagged duplicate occurrences and column-two bundled charges, and reduces remaining flagged units to the published MUE limits. Unit adjustments use the billed average price per unit. Overlapping findings count once. Modifier-documentation reviews and published price differences are excluded. This is a hypothetical bill-charge scenario, not an approved adjustment, insurer allowance or amount you owe.',
    note:complete?(adjustments.length?'Subject to facility review and applicable exceptions.':'No reduction identified by the supported coding checks; this does not establish that the bill is correct.'):'A complete starting or reduced bill amount cannot be calculated because one or more charges are missing.'};
}
