import references from '../data/references.json' with { type: 'json' };
import { assessPTP } from './ncci.js';
export const REFERENCES = references;
export class BillError extends Error {}
export const DISCLAIMER = 'Questions to discuss with billing, not a determination of an error. Medicare coding references may not apply to your plan. Published prices do not establish patient responsibility or savings.';
const REPEAT = new Set(['76','77','91']);
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const empty = x => x === '' || x == null;
const cents = n => Math.round(n * 100);
const same = (a,b) => a.localeCompare(b, 'en', {sensitivity:'accent'}) === 0;

export function validate(raw) {
  if (!raw || !Array.isArray(raw.lines) || raw.lines.length<1 || raw.lines.length>50) throw new BillError('Add between 1 and 50 bill lines.');
  if (raw.hospital!==REFERENCES.hospital || raw.setting!=='outpatient') throw new BillError('This prototype supports Keck Hospital of USC outpatient facility bills only.');
  if (['payer','plan'].some(k=>typeof(raw[k]??'')!=='string'||(raw[k]??'').length>150)) throw new BillError('Payer and plan must be short text values.');
  const bill={hospital:raw.hospital,setting:'outpatient',payer:(raw.payer??'').trim(),plan:(raw.plan??'').trim(),lines:[]};
  raw.lines.forEach((line,i)=>{
    if (!line || typeof line!=='object') throw new BillError(`Line ${i+1}: invalid line.`);
    const code=String(line.code??'').trim().toUpperCase();
    if(code&&!/^[A-Z0-9]{5}$/.test(code))throw new BillError(`Line ${i+1}: use a five-character CPT/HCPCS code, or leave it empty if unknown.`);
    const date=String(line.date??'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new BillError(`Line ${i+1}: confirm the service date.`);
    function number(value,units) {
      if(empty(value))return null;
      if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw new BillError(`Line ${i+1}: enter a numeric ${units?'unit count':'amount'}.`);
      const n=Number(value);
      if(!Number.isFinite(n)||n<(units?1:0)||n>(units?10000:10000000)||(units?!Number.isInteger(n):Math.abs(n*100-Math.round(n*100))>0.000001))throw new BillError(`Line ${i+1}: units must be positive whole numbers; amounts must be nonnegative dollars with at most two decimal places.`);
      return units?n:cents(n)/100;
    }
    const mods=line.modifiers??'';
    if(typeof mods!=='string'||(mods.trim()&&!/^[A-Za-z0-9]{2}(?:[ ,]+[A-Za-z0-9]{2})*$/.test(mods.trim())))throw new BillError(`Line ${i+1}: enter two-character modifiers separated by commas.`);
    bill.lines.push({id:i+1,code,date,units:number(line.units,true),amount:number(line.amount,false),modifiers:[...new Set(mods.trim().toUpperCase().split(/[ ,]+/).filter(Boolean))].sort().join(','),description:String(line.description??'').trim().slice(0,150),provider:String(line.provider??'').trim().slice(0,100)});
  });
  return bill;
}

export function analyze(raw, refs=REFERENCES) {
  const bill=validate(raw),findings=[],checks=[],prices=[];
  const groupFor=line=>bill.lines.filter(x=>x.date===line.date&&x.code===line.code&&x.provider===line.provider);
  for(const line of bill.lines) {
    const {id:lid,code}=line, group=groupFor(line);
    const complete=!!code&&line.units!=null&&line.amount!=null;
    const match=group.find(x=>complete&&x.id<lid&&x.units===line.units&&x.amount===line.amount&&x.modifiers===line.modifiers&&![...x.modifiers.split(','),...line.modifiers.split(',')].some(m=>REPEAT.has(m)));
    let status=complete?'clear':'unable',detail=complete?'No matching earlier line without a repeat modifier.':'Missing code, units or amount.';
    if(match) {
      status='question';detail=`Line ${lid} matches line ${match.id} on code, date, provider, modifiers, units and amount.`;
      findings.push({id:`DUP-${lid}`,kind:'duplicate',title:`Could line ${lid} repeat line ${match.id}?`,lines:[match.id,lid],detail,
        question:`For ${line.date}, could you confirm whether line ${lid} (${code}, ${line.units} units, ${money(line.amount)}) duplicates line ${match.id}, or explain the separate service?`,
        evidence:[{id:`BILL-${match.id}-${lid}`,label:`Confirmed bill, lines ${match.id} and ${lid}`,detail:'Same confirmed fields; no repeat-procedure modifier 76, 77 or 91. Repeated tests can be legitimate. Please review the clinical record.',url:null}]});
    }
    checks.push({line:lid,check:'duplicate',status,detail});
    const inPeriod=refs.start<=line.date&&line.date<=refs.end, rule=inPeriod?refs.mue[code]:null;
    if(!rule||line.units==null||(rule.indicator!==1&&group.some(x=>x.units==null)))checks.push({line:lid,check:'units',status:'unable',detail:!inPeriod?'Service date outside July–September 2026.':'Missing units or code outside the published prototype subset.'});
    else {
      const total=rule.indicator===1?line.units:group.reduce((sum,x)=>sum+x.units,0),over=total>rule.limit;
      checks.push({line:lid,check:'units',status:over?'question':'clear',detail:`${total} units assessed; published limit ${rule.limit}; indicator ${rule.indicator}.`});
      if(over&&(rule.indicator===1||lid===group[0].id)) {
        const ids=rule.indicator===1?[lid]:group.map(x=>x.id),basis=rule.indicator===1?'per claim line':'per date of service and provider';
        const meaning={1:'A claim-line edit; appropriate modifiers can affect reporting.',2:'A date-of-service policy edit.',3:'A date-of-service clinical edit; documentation may support an exception on review.'}[rule.indicator];
        findings.push({id:`MUE-${lid}`,kind:'units',title:`Ask about the units for ${code}`,lines:ids,
          detail:`${total} units on ${line.date}; Medicare's published outpatient limit is ${rule.limit} ${basis}.`,
          question:`For code ${code} on ${line.date} (lines ${ids.join(', ')}), please explain the ${total} units billed against the Medicare outpatient MUE reference of ${rule.limit}, including any supporting documentation or applicable exceptions.`,
          evidence:[{id:`MUE-Q3-2026-${code}`,label:`CMS outpatient MUE · 2026 Q3 · code ${code}`,detail:`Source CSV record ${rule.row}; limit ${rule.limit}; adjudication indicator ${rule.indicator}; rationale: ${rule.rationale}. ${meaning} Medicare reference only; confirm applicability with your insurer.`,url:refs.sources.mue.url}]});
      }
    }
    const records=refs.prices[code]??[];
    const price={line:lid,code,billed:line.amount,units:line.units,status:'unable',gross:null,cash:null,negotiated:null,evidence:[],note:''};
    if(!inPeriod||!code||line.units==null||line.amount==null||line.modifiers)price.note='Unable to assess: date, code, units, amount or modifier is outside supported price matching.';
    else {
      const uniquePrice=(field,candidates)=>{
        const available=candidates.filter(r=>r[field]!=null),values=new Set(available.map(r=>r[field]));
        if(values.size!==1)return null;
        for(const r of available)price.evidence.push({id:`KECK-${r.record}`,label:`Keck MRF · CSV record ${r.record}`,
          detail:`${code} (${r.code_type}), facility/${r.setting}, unmodified; ${field} ${money(r[field])} per published service unit. File dated ${refs.price_date}.`+(r.payer?` ${r.payer} / ${r.plan}.`:''),url:refs.sources.prices.url});
        const unit=[...values][0];return {unit,total:cents(unit*line.units)/100};
      };
      price.gross=uniquePrice('gross',records);price.cash=uniquePrice('cash',records);
      price.negotiated=uniquePrice('negotiated',records.filter(r=>bill.payer&&bill.plan&&same(r.payer,bill.payer)&&same(r.plan,bill.plan)));
      price.status=price.gross||price.cash||price.negotiated?'context':'unable';
      price.note='Published service-unit prices scaled by confirmed bill units. Multiple CDM prices, missing amounts and algorithm-only rates are not resolved. Negotiated price requires an exact payer and plan match. File vintage does not prove the price applied on the service date.';
    }
    price.evidence=[...new Map(price.evidence.map(e=>[e.id+e.detail,e])).values()];prices.push(price);
    checks.push({line:lid,check:'price',status:price.status,detail:price.note});
  }
  const ptp=assessPTP(bill,refs);findings.push(...ptp.findings);checks.push(...ptp.checks);
  return {bill,findings,modifier_reviews:ptp.modifier_reviews,checks,prices,disclaimer:DISCLAIMER,quarter:refs.quarter,price_date:refs.price_date,total:bill.lines.reduce((sum,x)=>sum+cents(x.amount??0),0)/100,amount_complete:bill.lines.every(x=>x.amount!=null),unable_count:checks.filter(x=>x.status==='unable').length,check_count:checks.length};
}

export const CHECKLIST=[
  'Have your itemized facility bill and insurer explanation of benefits ready. Do not share unnecessary personal information.',
  'Ask for the billing representative’s name and a call reference number.',
  'Read each question in the letter. Ask which services, units and modifiers support each charge.',
  'Ask which published price, payer contract or discount applies; confirm patient responsibility with your insurer.',
  'Ask whether a billing review or payment hold is available, and request any agreed correction in writing.',
  'Write down the next step, who owns it and when to follow up.'
];

export function packet(result) {
  const citations=new Map(),paragraphs=['To: Keck Hospital of USC billing office','Subject: Request for clarification of itemized outpatient charges','Hello,','Please help me understand the following charges on my outpatient facility bill. These are questions for review, not a claim that a charge is incorrect.'];
  for(const finding of [...result.findings,...(result.modifier_reviews??[])]) {
    finding.evidence.forEach(e=>citations.set(e.id,e));
    paragraphs.push(`${finding.question} [${finding.evidence.map(e=>e.id).join('; ')}]`);
  }
  if(!result.findings.length&&!result.modifier_reviews?.length)paragraphs.push('The limited prototype checks did not identify a coding question. Please explain any charges I ask about; this review does not establish that the entire bill is correct.');
  for(const p of result.prices.filter(p=>p.status==='context')) {
    const values=[['gross','published gross'],['cash','discounted cash'],['negotiated','matched negotiated']].filter(([key])=>p[key]).map(([key,label])=>`${label} ${money(p[key].total)} for ${p.units} units`).join(', ');
    p.evidence.forEach(e=>citations.set(e.id,e));
    paragraphs.push(`For line ${p.line} (${p.code}), the bill shows ${money(p.billed)}. Keck's price file dated ${result.price_date} lists ${values}. Please clarify the applicable rate, service-unit basis, discounts and final patient responsibility. [${[...new Set(p.evidence.map(e=>e.id))].join('; ')}]`);
  }
  if(result.unable_count)paragraphs.push(`This limited review could not assess ${result.unable_count} of ${result.check_count} line checks. Missing information and unsupported services have not been cleared.`);
  paragraphs.push('Please provide an itemized explanation and any corrections in writing. I will confirm any insurer adjustments against my explanation of benefits.','Thank you,','[Your name and account reference — add privately before sending]','Evidence');
  for(const [id,e] of citations)paragraphs.push(`[${id}] ${e.label}. ${e.detail}${e.url?' '+e.url:''}`);
  paragraphs.push(result.disclaimer);
  const letter=paragraphs.join('\n\n');
  const actual=new Set([...letter.matchAll(/\[((?:BILL|MUE|PTP|KECK)-[^\]]+)\]/g)].flatMap(m=>m[1].split(';').map(s=>s.trim())));
  if(actual.size!==citations.size||[...actual].some(id=>!citations.has(id)))throw new Error('The letter failed citation verification.');
  return {letter,checklist:CHECKLIST,validation:'Verified template: all generated figures and citations come from confirmed lines and local references.'};
}
