const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const same=(a,b)=>a.localeCompare(b,'en',{sensitivity:'accent'})===0;
const reason=(code,label,detail)=>({code,label,detail});

export function assessPrice(line,bill,refs) {
  const {id,code,units,amount,modifiers,date}=line,records=refs.prices[code]??[];
  const price={line:id,code,billed:amount,units,status:'unable',gross:null,cash:null,negotiated:null,evidence:[],unavailable:{},note:''};
  const blocked=date<refs.start||date>refs.end?reason('date','Outside reference dates',`Price matching is limited to ${refs.start} through ${refs.end}.`):
    !code?reason('code','Missing code','Confirm the CPT or HCPCS code to look up a published price.'):
    units==null?reason('units','Missing units','Confirm billed service units before scaling a published price.'):
    amount==null?reason('amount','Missing billed amount','Enter the charge from the bill before comparing prices.'):
    modifiers?reason('modifier','Modifier not matched',`The loaded price rows are unmodified; this line has modifier ${modifiers}.`):null;
  function match(field,candidates) {
    if(blocked){price.unavailable[field]=blocked;return null;}
    if(!candidates.length){price.unavailable[field]=reason(field==='negotiated'?'plan':'record',field==='negotiated'?'No matching plan':'No matching price',field==='negotiated'?'No loaded price record matches both the payer and exact plan name.':`No eligible hospital outpatient price record was loaded for ${code}.`);return null;}
    const available=candidates.filter(r=>r[field]!=null),values=[...new Set(available.map(r=>r[field]))].sort((a,b)=>a-b);
    if(!values.length){
      const formula=field==='negotiated'&&candidates.some(r=>r.algorithm);
      price.unavailable[field]=reason(formula?'formula':'missing',formula?'Formula-only rate':'Price not published',formula?'The matched plan publishes an algorithm rather than a dollar rate; the prototype cannot calculate it.':'Matching records contain no dollar value for this price type.');return null;
    }
    if(values.length>1){price.unavailable[field]={...reason('ambiguous','Multiple possible prices',`${values.map(money).join(' or ')} per published unit across different hospital charge records. The bill needs an internal charge identifier and service-unit detail to select the applicable record.`),values};return null;}
    for(const row of available)price.evidence.push({id:`KECK-${row.record}`,label:`Keck MRF · CSV record ${row.record}`,
      detail:`${code} (${row.code_type}), facility/${row.setting}, unmodified; ${field} ${money(row[field])} per published service unit. File dated ${refs.price_date}.`+(row.payer?` ${row.payer} / ${row.plan}.`:''),url:refs.sources.prices.url});
    return {unit:values[0],total:Math.round(values[0]*units*100)/100};
  }
  price.gross=match('gross',records);price.cash=match('cash',records);
  if(blocked)price.unavailable.negotiated=blocked;
  else if(!bill.payer||!bill.plan)price.unavailable.negotiated=reason('plan_details','No matching plan',`${!bill.payer?'The payer is missing':'The exact plan name is missing'}. ${/^medicare$/i.test(bill.payer)?'This prototype does not calculate Medicare reimbursement rates.':'The prototype cannot infer a negotiated rate from the payer alone.'}`);
  else price.negotiated=match('negotiated',records.filter(r=>same(r.payer,bill.payer)&&same(r.plan,bill.plan)));
  price.status=price.gross||price.cash||price.negotiated?'context':'unable';
  price.evidence=[...new Map(price.evidence.map(e=>[e.id+e.detail,e])).values()];
  price.note=[...new Set(Object.entries(price.unavailable).map(([field,r])=>`${{gross:'Gross',cash:'Cash',negotiated:'Plan rate'}[field]}: ${r.label}. ${r.detail}`))].join(' ');
  if(price.status==='context')price.note+=' Published unit prices are scaled to billed units; confirm the applicable rate and unit basis with the facility.';
  return price;
}
