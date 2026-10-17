// Medicare hospital outpatient PTP edits. Modifiers route to review, never
// establish clinical validity or automatically clear an active code-pair edit.
const associated=new Set(['24','25','27','57','58','78','79','59','91','XE','XS','XP','XU']);
const anatomy=new Set(['E1','E2','E3','E4','FA','TA','LT','RT','LC','LD','RC','LM','RI',
  ...Array.from({length:9},(_,i)=>`F${i+1}`),...Array.from({length:9},(_,i)=>`T${i+1}`)]);
const mods=line=>line.modifiers.split(',').filter(Boolean);
function possibleException(first,second) {
  const a=mods(first),b=mods(second);
  if([...a,...b].some(m=>associated.has(m)))return true;
  const aa=a.filter(m=>anatomy.has(m)).sort(),bb=b.filter(m=>anatomy.has(m)).sort();
  return (aa.length||bb.length)&&aa.join(',')!==bb.join(',');
}
export const ptpActive=(rule,date)=>rule.modifier_indicator!==9&&rule.effective<=date&&(!rule.deletion||date<=rule.deletion);

export function assessPTP(bill,refs) {
  const findings=[],modifier_reviews=[],checks=[];
  const supported=new Set(refs.ptp?.codes??[]),complete=refs.ptp?.complete===true&&!!refs.sources.ptp;
  const eligible=line=>complete&&supported.has(line.code)&&refs.start<=line.date&&line.date<=refs.end&&!!line.provider;
  for(const line of bill.lines) {
    let detail='No active PTP pair found among the supplied, supported codes for this date/provider.',status='clear';
    if(!complete){status='unable';detail='Complete hospital PTP reference subset is unavailable.';}
    else if(line.date<refs.start||line.date>refs.end){status='unable';detail='Service date outside July–September 2026 PTP coverage.';}
    else if(!supported.has(line.code)){status='unable';detail='Missing code or code outside the PTP subset.';}
    else if(!line.provider){status='unable';detail='Confirm the billing provider before comparing code pairs.';}
    else if(bill.lines.some(other=>other.id!==line.id&&other.date===line.date&&(!other.provider||other.provider===line.provider)&&(!other.provider||!supported.has(other.code)))) {
      status='unable';detail='A same-date line has an unknown code or billing provider; complete pair review is unavailable.';
    }
    checks.push({line:line.id,check:'ptp',status,detail});
  }
  if(!complete)return {findings,modifier_reviews,checks};
  const priority={clear:0,unable:1,review:2,question:3};
  function mark(ids,status,detail) {
    for(const id of ids) {
      const check=checks.find(c=>c.line===id);
      if(priority[status]>=priority[check.status]) {
        check.detail=(check.status==='unable'?check.detail+' ':'')+detail;check.status=status;
      }
    }
  }
  for(const rule of refs.ptp.records) {
    const groups=new Map();
    for(const first of bill.lines.filter(l=>eligible(l)&&l.code===rule.column1&&ptpActive(rule,l.date))) {
      for(const second of bill.lines.filter(l=>eligible(l)&&l.code===rule.column2&&l.date===first.date&&l.provider===first.provider)) {
        const status=rule.modifier_indicator===1&&possibleException(first,second)?'review':'question';
        const key=JSON.stringify([first.date,first.provider,status]);
        if(!groups.has(key))groups.set(key,{date:first.date,status,first:[],second:[]});
        const group=groups.get(key);group.first.push(first.id);group.second.push(second.id);
      }
    }
    for(const group of groups.values()) {
      const first=[...new Set(group.first)].sort((a,b)=>a-b),second=[...new Set(group.second)].sort((a,b)=>a-b);
      const ids=[...new Set([...first,...second])].sort((a,b)=>a-b);
      const review=group.status==='review',pair=`${rule.column1} / ${rule.column2}`;
      const meaning=rule.modifier_indicator===0?'CMS modifier indicator 0: a PTP-associated modifier cannot bypass this edit.':
        review?'CMS modifier indicator 1: a possible exception modifier is present. Clinical documentation must establish whether separate billing is appropriate.':
        'CMS modifier indicator 1: a clinically appropriate PTP-associated modifier may permit separate billing; none establishing a possible exception was identified. Modifiers 76/77 alone do not bypass PTP edits.';
      const detail=`${rule.column2} (column 2, lines ${second.join(', ')}) is paired with ${rule.column1} (column 1, lines ${first.join(', ')}) on ${group.date} for the same billing provider. ${meaning}`;
      const item={id:`PTP-${rule.column1}-${rule.column2}-${ids.join('-')}`,kind:'bundling',status:group.status,lines:ids,
        title:review?`Confirm the modifier exception for ${pair}`:`Could ${pair} include a bundled charge?`,detail,
        question:review?`For ${group.date}, please confirm the documentation supporting the modifier exception and separate billing of ${rule.column1} (lines ${first.join(', ')}) and ${rule.column2} (lines ${second.join(', ')}). The Medicare hospital PTP reference allows exceptions only when clinically appropriate.`:
          `For ${group.date}, please explain why ${rule.column2} (column 2, lines ${second.join(', ')}) was billed separately with ${rule.column1} (column 1, lines ${first.join(', ')}), given the active Medicare hospital NCCI PTP edit with modifier indicator ${rule.modifier_indicator}, and provide any supporting documentation.`,
        evidence:[{id:`PTP-Q3-2026-${rule.column1}-${rule.column2}-${rule.row}`,label:`CMS hospital PTP · 2026 Q3 · ${pair}`,
          detail:`${rule.file}, source line ${rule.row}; column 1 ${rule.column1}, column 2 ${rule.column2}; effective ${rule.effective}; last active date ${rule.deletion??'none published'}; modifier indicator ${rule.modifier_indicator}; rationale: ${rule.rationale}. ${meaning} Medicare reference only; confirm payer and outpatient-setting applicability.`,url:refs.sources.ptp.url}]};
      (review?modifier_reviews:findings).push(item);mark(ids,group.status,detail);
    }
  }
  return {findings,modifier_reviews,checks};
}
