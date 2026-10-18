import references from '../data/references.json' with { type: 'json' };
import { assessPTP } from './ncci.js';
import { assessPrice } from './pricing.js';
import { reductionScenario } from './reduction.js';
export const REFERENCES = references;
export class BillError extends Error {}
export const DISCLAIMER = 'Questions to discuss with billing, not a determination of an error. Medicare coding references may not apply to your plan. Published prices do not establish patient responsibility or savings.';
const REPEAT = new Set(['76','77','91']);
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const empty = x => x === '' || x == null;
const cents = n => Math.round(n * 100);

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
          unit_limit:rule.limit,unit_indicator:rule.indicator,detail:`${total} units on ${line.date}; Medicare's published outpatient limit is ${rule.limit} ${basis}.`,
          question:`For code ${code} on ${line.date} (lines ${ids.join(', ')}), please explain the ${total} units billed against the Medicare outpatient MUE reference of ${rule.limit}, including any supporting documentation or applicable exceptions.`,
          evidence:[{id:`MUE-Q3-2026-${code}`,label:`CMS outpatient MUE · 2026 Q3 · code ${code}`,detail:`Source CSV record ${rule.row}; limit ${rule.limit}; adjudication indicator ${rule.indicator}; rationale: ${rule.rationale}. ${meaning} Medicare reference only; confirm applicability with your insurer.`,url:refs.sources.mue.url}]});
      }
    }
    const price=assessPrice(line,bill,refs);prices.push(price);
    checks.push({line:lid,check:'price',status:price.status,detail:price.note});
  }
  const ptp=assessPTP(bill,refs);findings.push(...ptp.findings);checks.push(...ptp.checks);
  return {bill,findings,modifier_reviews:ptp.modifier_reviews,checks,prices,reduction:reductionScenario(bill,findings),disclaimer:DISCLAIMER,quarter:refs.quarter,price_date:refs.price_date,total:bill.lines.reduce((sum,x)=>sum+cents(x.amount??0),0)/100,amount_complete:bill.lines.every(x=>x.amount!=null),unable_count:checks.filter(x=>x.status==='unable').length,check_count:checks.length};
}

export const CHECKLIST=[
  'Have your itemized facility bill and insurer explanation of benefits ready. Do not share unnecessary personal information.',
  'Ask for the billing representative’s name and a call reference number.',
  'Read each question in the letter. Ask which services, units and modifiers support each charge.',
  'Ask which published price, payer contract or discount applies; confirm patient responsibility with your insurer.',
  'Ask whether a billing review or payment hold is available, and request any agreed correction in writing.',
  'Write down the next step, who owns it and when to follow up.'
];

export function packet(result,narrative=null) {
  const citations=new Map(),paragraphs=['To: Billing Review Department, Keck Hospital of USC','Re: Request for review of itemized outpatient facility charges','Dear Billing Review Team,',
    '1. PURPOSE OF THIS REQUEST',narrative?.opening??'I am writing to request a review of my itemized outpatient facility bill. I have identified the questions below and would appreciate your explanation and supporting documentation. If your review identifies an incorrect charge, please correct my bill and send me an updated statement.',
    '2. ITEMS REQUIRING CLARIFICATION'];
  function cite(e) {
    const previous=citations.get(e.id);
    citations.set(e.id,previous?!previous.detail.includes(e.detail)?{...previous,detail:previous.detail+' '+e.detail}:previous:e);
  }
  let index=0;
  for(const finding of [...result.findings,...(result.modifier_reviews??[])]) {
    finding.evidence.forEach(cite);index++;
    const ai=narrative?.requests.find(r=>r.finding_id===finding.id);
    const title=finding.kind==='duplicate'?'Repeated charges on my bill':finding.kind==='units'?`My billed units for ${result.bill.lines.find(l=>l.id===finding.lines[0]).code}`:`${finding.status==='review'?'Modifier documentation for my bill':'My separately billed services'}: ${finding.column1} / ${finding.column2}`;
    const patientQuestion=finding.kind==='duplicate'?finding.question.replace('could you confirm whether','could you confirm whether my charge on'):
      finding.kind==='units'?finding.question.replace('please explain the','please explain why my bill lists'):
      finding.status==='review'?finding.question.replace('please confirm the documentation','please provide me with the documentation'):
      finding.question.replace('please explain why','please explain why I was billed for').replace('was billed separately with','separately from');
    paragraphs.push(`${index}. ${title}\n${ai?`${finding.detail}\n${ai.explanation}\nRequested clarification: ${ai.request}`:patientQuestion} [${finding.evidence.map(e=>e.id).join('; ')}]`);
  }
  if(!result.findings.length&&!result.modifier_reviews?.length)paragraphs.push('My limited review did not identify a specific coding question. I would still appreciate an explanation of the itemized charges, and I understand that this does not establish that every charge is correct.');
  paragraphs.push('3. PUBLISHED PRICE CONTEXT');
  for(const p of result.prices.filter(p=>p.status==='context')) {
    const values=[['gross','published gross'],['cash','discounted cash'],['negotiated','matched negotiated']].filter(([key])=>p[key]).map(([key,label])=>`${label} ${money(p[key].total)} for ${p.units} units`).join(', ');
    p.evidence.forEach(cite);
    paragraphs.push(`For line ${p.line} (${p.code}), my bill lists ${money(p.billed)}. Your facility's published price file dated ${result.price_date} lists ${values}. Please explain which rate, service-unit basis and discounts apply to my charge, and how you calculated my patient responsibility. [${[...new Set(p.evidence.map(e=>e.id))].join('; ')}]`);
  }
  paragraphs.push('4. REQUESTED RESPONSE',narrative?.closing??'Please send me a written response addressing each question, the documentation supporting the charges, and an updated itemized statement if you make any corrections. Please let me know if you need further information from me and how I can follow up on this review. I will compare any insurer adjustments with my explanation of benefits.',
    '5. SCOPE OF THIS REVIEW');
  if(result.unable_count)paragraphs.push(`I could not fully assess ${result.unable_count} of ${result.check_count} checks on my bill because information or applicable reference coverage was unavailable. Please help me clarify these remaining items.`);
  paragraphs.push('I am raising these items as questions for your review, rather than asserting that a charge is incorrect. I understand that Medicare references may not apply to my claim and published hospital prices do not establish what I owe. Please confirm the rules and rates applicable to my services.');
  paragraphs.push('Yours sincerely,\n[Your name and account reference - add privately before sending]');
  const letter=paragraphs.join('\n\n');
  const actual=new Set([...letter.matchAll(/\[((?:BILL|MUE|PTP|KECK)-[^\]]+)\]/g)].flatMap(m=>m[1].split(';').map(s=>s.trim())));
  if(actual.size!==citations.size||[...actual].some(id=>!citations.has(id)))throw new Error('The letter failed citation verification.');
  return {letter,evidence:[...citations.values()],checklist:CHECKLIST,mode:narrative?'ai':'template',
    validation:narrative?'AI-assisted wording; figures and citations inserted by code. Review the wording before sending.':'Verified template: figures and citations come from confirmed lines and local references.'};
}
