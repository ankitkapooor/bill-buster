"""Create authored synthetic test cases and visibly realistic statement PDFs.

No production analysis code is imported. Expected findings are authored below;
CMS limits are cross-checked against the original source CSV when supplied.
"""
import csv
import hashlib
import json
import shutil
import sys
import zipfile
from datetime import date
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/bill-bank'
PUBLIC = ROOT / 'public/test-bills'
FIXTURES = ROOT / 'fixtures/bill-bank'
DESCRIPTIONS = {
 '99284':'Emergency department visit', '85025':'Blood count with differential', '36415':'Routine blood collection',
 'J7030':'IV saline supply, 1,000 mL', '80053':'Comprehensive metabolic panel', '93005':'ECG tracing',
 '71046':'Chest X-ray, two views', '96360':'IV hydration, initial service', '96361':'IV hydration, additional hour',
 '96374':'IV medication administration', 'J2405':'Antiemetic supply, per unit', 'J1885':'Pain-relief supply, per unit',
 '80048':'Basic metabolic panel', '84484':'Cardiac laboratory test', '70450':'Head CT without contrast',
 '99999':'Unmapped test service', '':'Unspecified laboratory service'
}
NAMES = ['Morgan Ellis','Avery Chen','Jordan Patel','Casey Brooks','Taylor Rivera','Riley Adams','Cameron Lee',
 'Quinn Parker','Alex Bennett','Jamie Nguyen','Drew Sullivan','Reese Carter','Skyler Ross','Emerson Bell',
 'Finley Davis','Rowan Kim','Peyton Shah','Sage Wilson','Hayden Lewis','Blair Cooper']

def line(code, units=1, amount=100, service_date='2026-09-14', modifiers='', provider='FAC-A'):
 return dict(code=code,description=DESCRIPTIONS[code],units=units,amount=amount,date=service_date,modifiers=modifiers,provider=provider)

def make_cases():
 cases=[]
 def add(title,kind,lines,expected=(),note='',payer='Medicare',plan='',ptp=None):
  n=len(cases)+1
  cases.append(dict(id=f'BB-{n:02}',title=title,category=kind,patient=NAMES[n-1],
   bill=dict(hospital='Keck Hospital of USC',setting='outpatient',payer=payer,plan=plan,lines=lines),
   expected_findings=[dict(kind=k,lines=ids) for k,ids in expected],note=note,ptp=ptp))
 add('Routine emergency evaluation','clean',[
  line('99284',amount=1850),line('85025',amount=212),line('80053',amount=240),line('36415',amount=48),line('93005',amount=165)])
 add('Imaging and blood collection','clean',[
  line('70450',amount=1640,service_date='2026-07-08'),line('71046',amount=330,service_date='2026-07-08'),line('36415',amount=52,service_date='2026-07-08')])
 add('Hydration visit','clean',[
  line('96360',amount=640,service_date='2026-08-12'),line('96361',amount=160,service_date='2026-08-12'),line('J7030',amount=125,service_date='2026-08-12')])
 add('Serial cardiac testing','clean',[
  line('84484',units=2,amount=310),line('93005',amount=180),line('80048',amount=125),line('85025',amount=210)],note='Two units on one cardiac-test line remain below the published four-unit limit.')
 add('Repeat laboratory test with modifier 91','clean',[
  line('85025',amount=212,service_date='2026-08-03'),line('85025',amount=212,service_date='2026-08-03',modifiers='91'),line('80048',amount=125,service_date='2026-08-03')],note='Do not flag a duplicate; the repeat-test modifier is present. Modified price matching is outside the prototype.')
 add('Commercial plan price matching','clean',[
  line('85025',amount=212),line('84484',amount=155),line('36415',amount=48)],payer='Unitedhealthcare',plan='Navigate/Select & Core Exchange',note='Coding findings are Medicare-reference questions only. Expect the exact-plan negotiated CBC rate of $12.83; do not call the billed-price difference an overcharge.')
 add('Repeated blood-count charge','planted',[
  line('85025',amount=212),line('80048',amount=125),line('85025',amount=212)], [('duplicate',[1,3])], 'Only the repeated blood-count line should raise a duplicate question; day units are 2, below the MUE of 4.')
 add('Repeated blood-collection charge','planted',[
  line('36415',amount=48),line('36415',amount=48),line('85025',amount=212)], [('duplicate',[1,2])], 'Two blood-collection units equal the published limit of 2; this is a duplicate question only.')
 add('Potential bundling without an exception modifier','planted',[
  line('96360',amount=640),line('96374',amount=590),line('J7030',amount=125)], [('bundling',[1,2])], 'Active hospital PTP pair 96360/96374, modifier indicator 1. No associated exception modifier is present; ask why the services were billed separately.',
  ptp=dict(column1='96360',column2='96374',modifier_indicator=1,effective='2009-01-01',deletion=None,expected='bundling question',source='ccioph-v322r0-f4.txt',source_line=355092))
 add('Metabolic-panel units above the limit','planted',[
  line('80053',units=2,amount=480),line('85025',amount=212),line('36415',amount=48)], [('units',[1])], '80053: 2 units versus MUE 1, MAI 3. Ask about documentation or exceptions; do not determine that the charge is wrong.')
 add('Medication-administration units above the limit','planted',[
  line('96374',units=2,amount=1180),line('J2405',units=4,amount=76),line('J1885',units=2,amount=44)], [('units',[1])], '96374: 2 units versus MUE 1, MAI 3. Drug supply units are separate code-specific billing units, not a dose comparison.')
 add('Units split over two differently priced lines','planted',[
  line('80053',amount=120),line('85025',amount=212),line('80053',amount=135)], [('units',[1,3])], 'Aggregate same-provider, same-date 80053 units to 2. Different amounts mean no duplicate flag.')
 add('Blood-count units above the limit','planted',[
  line('85025',units=5,amount=1060),line('36415',amount=48)], [('units',[1])], '85025: 5 units versus MUE 4, MAI 3.')
 add('Duplicate and day-unit questions together','planted',[
  line('80053',amount=240),line('80053',amount=240),line('99284',amount=1850)], [('duplicate',[1,2]),('units',[1,2])], 'Show two separate questions. Do not add the flagged amounts together or call the result savings.')
 add('Possible PTP exception with modifier 59','edge',[
  line('96360',amount=640),line('96374',amount=590,modifiers='59'),line('J7030',amount=125)],note='Same active 96360/96374 pair as BB-09. Modifier 59 routes to documentation review, not a bundling finding or automatic clearance. Modified price matching stays unable to assess.',
  ptp=dict(column1='96360',column2='96374',modifier_indicator=1,effective='2009-01-01',deletion=None,expected='modifier documentation review',source='ccioph-v322r0-f4.txt',source_line=355092))
 cases[-1]['expected_modifier_reviews']=[dict(kind='bundling',lines=[1,2])]
 add('PTP pair on different dates','edge',[
  line('96360',amount=640,service_date='2026-09-29'),line('96374',amount=590,service_date='2026-09-30')],note='The 96360/96374 pair is not a bundling question across different dates. Each MUE is within its same-date limit.')
 add('Quarter boundary','edge',[
  line('80053',amount=240,service_date='2026-09-30'),line('80053',amount=240,service_date='2026-10-01'),line('80048',amount=125,service_date='2026-10-01')],note='The October 80053/80048 pair needs Q4 references. October unit, PTP and price checks must be unable to assess; Q3 must not be carried forward.')
 add('PTP pair from separate billing providers','edge',[
  line('96360',amount=640,provider='FAC-A'),line('96374',amount=590,provider='FAC-B')],note='Do not raise a 96360/96374 PTP question across distinct billing providers. Each MUE is within its same-provider limit.')
 add('Missing and unsupported fields','edge',[
  line('',amount=90),line('85025',units=None,amount=212),line('J7030',amount=None),line('99999',amount=55)],note='Preserve the missing code, missing units and missing charge. Unknown code 99999 is outside the subset. Do not convert blanks to zero or present a complete statement total.')
 add('Bundled metabolic panels','planted',[
  line('80053',amount=240),line('80048',amount=125)], [('bundling',[1,2])],note='Each MUE is within its limit, but active hospital NCCI PTP pair 80053/80048 raises a separate-billing question. Modifier indicator 0 does not permit a modifier bypass.',
  ptp=dict(column1='80053',column2='80048',modifier_indicator=0,effective='2000-07-01',deletion=None,expected='bundling question',source='ccioph-v322r0-f4.txt',source_line=213077))
 return cases

def draw_bill(case,path):
 c=canvas.Canvas(str(path),pagesize=(612,792),pageCompression=1)
 c.setTitle(f"Synthetic itemized statement {case['id']}");c.setAuthor('Bill Buster synthetic test bank')
 ink=HexColor('#243d51');muted=HexColor('#586975');rule=HexColor('#d7dfe4');pale=HexColor('#f1f5f7')
 def text(x,y,value,size=9,bold=False,color=ink):
  c.setFillColor(color);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,y,str(value))
 def right(x,y,value,size=9,bold=False,color=ink):
  c.setFillColor(color);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawRightString(x,y,str(value))
 def hline(y):c.setStrokeColor(rule);c.setLineWidth(.5);c.line(36,y,576,y)
 c.setFillColor(ink);c.rect(0,753,612,39,fill=1,stroke=0)
 text(36,768,'SYNTHETIC TRAINING DOCUMENT - NOT ISSUED BY THE HOSPITAL',9,True,HexColor('#ffffff'))
 text(36,718,'Keck Hospital of USC',21,True)
 text(36,700,'Outpatient facility services',10,color=muted)
 right(576,720,'ITEMIZED HOSPITAL STATEMENT',10,True)
 right(576,703,f"Statement: {case['id']}",10)
 right(576,686,'Statement date: 2026-10-15',9,color=muted)
 text(36,681,'1500 San Pablo Street',9,color=muted)
 text(36,667,'Los Angeles, CA 90033',9,color=muted)
 hline(651)
 # Text is visibly printed; no hidden fixture data or machine-readable answer hints.
 text(36,627,'PATIENT / ACCOUNT',8,True,color=muted)
 text(320,627,'VISIT / COVERAGE',8,True,color=muted)
 text(36,607,f"Patient: {case['patient']} (synthetic)",10,True)
 text(36,589,f"Account: DEMO-26-{case['id'][-2:]}",9)
 text(36,572,f"Medical record: DEMO-11{int(case['id'][-2:]):04d}",9)
 text(36,555,'Statement type: Itemized charges',9)
 text(320,607,'Setting: outpatient',10,True)
 text(320,589,f"Payer: {case['bill']['payer']}",9)
 text(320,572,f"Plan: {case['bill']['plan']}",8)
 dates=sorted({l['date'] for l in case['bill']['lines']})
 text(320,555,f"Visit dates: {dates[0]}"+(f" to {dates[-1]}" if len(dates)>1 else ''),9)
 hline(537)
 text(36,515,f"ITEMIZED CHARGES ({len(case['bill']['lines'])} lines)",10,True)
 c.setFillColor(ink);c.roundRect(36,478,540,25,3,fill=1,stroke=0)
 for x,label in [(42,'No.'),(62,'Date of service'),(126,'CPT / HCPCS'),(184,'Description'),(341,'Units'),(376,'Charges'),(447,'Mod.'),(492,'Provider')]:
  text(x,487,label,7,True,HexColor('#ffffff'))
 y=457
 for index,l in enumerate(case['bill']['lines'],1):
  if index%2==0:c.setFillColor(pale);c.rect(36,y-11,540,29,fill=1,stroke=0)
  text(42,y,f'{index:02}',8)
  text(62,y,l['date'],8)
  text(126,y,l['code'] or '-',8,True)
  text(184,y,l['description'],7.4)
  right(362,y,'-' if l['units'] is None else str(l['units']),8)
  right(433,y,'-' if l['amount'] is None else f"${l['amount']:,.2f}",8)
  text(447,y,l['modifiers'] or '-',8)
  text(492,y,l['provider'],8)
  y-=29
 hline(y+13)
 total=sum(round((l['amount'] or 0)*100) for l in case['bill']['lines'])/100
 complete=all(l['amount'] is not None for l in case['bill']['lines'])
 y-=18
 text(36,y,'FAC-A: facility billing provider A; FAC-B: separate billing provider B.',7.2,color=muted)
 text(36,y-14,'A dash means missing / not supplied. Modifiers may explain repeated services.',7.2,color=muted)
 # Fixed lower section leaves a consistent statement-summary and tear-off area.
 c.setFillColor(pale);c.roundRect(330,177,246,89,5,fill=1,stroke=0)
 text(344,245,'Total billed charges' if complete else 'Known-charge subtotal',9,True)
 right(562,245,f'${total:,.2f}',11,True)
 text(344,224,'Insurance adjustments',8,color=muted);right(562,224,'Pending / not provided',8)
 text(344,202,'Patient responsibility',8,True);right(562,202,'Not determined',8,True)
 text(36,245,'ABOUT THIS STATEMENT',8,True)
 for offset,s in enumerate(['All patient details, accounts and charges are invented.',
  'Reference prices in Bill Buster are separate public data.',
  'No EOB or final insurer determination is included.',
  'This document is not a payment request.']):text(36,228-offset*13,s,7.7,color=muted)
 c.setDash(3,3);hline(149);c.setDash()
 text(36,130,'TRAINING COPY - DO NOT PAY',11,True)
 text(36,113,f"Reference: {case['id']} / DEMO-26-{case['id'][-2:]}",8,color=muted)
 right(576,130,'NO REMITTANCE REQUIRED',9,True)
 right(576,113,'No payment address or online payment link',8,color=muted)
 hline(86)
 text(36,67,'Bill Buster test bank v2 | Synthetic document | For prototype testing only',7,color=muted)
 right(576,67,'Page 1 of 1',7,color=muted)
 c.save()

def create(source=None):
 for folder in [OUT,PUBLIC/'bills',FIXTURES]:folder.mkdir(parents=True,exist_ok=True)
 cases=make_cases()
 # Freeze source values independently of the application's prepared reference subset.
 limits={'36415':2,'70450':3,'71046':3,'80048':2,'80053':1,'84484':4,'85025':4,'93005':5,'96360':2,'96361':24,'96374':1,'99284':2,'J1885':8,'J2405':64,'J7030':20}
 provenance={}
 if source:
  root=Path(source);p=next((root/'cms/mue/2026-q3').rglob('*Hospital*.csv'))
  rows={row[0]:(n,row) for n,row in enumerate(csv.reader(p.open(encoding='cp1252')),1) if row and row[0] in limits}
  for code,value in limits.items():
   assert int(rows[code][1][1])==value and rows[code][1][2].startswith('3 '),(code,rows[code])
  provenance=dict(mue=dict(file=str(p.relative_to(root)),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),records={k:v[0] for k,v in rows.items()}))
  ptp=next((root/'cms/ptp/2026-q3/hospital_outpatient').rglob('ccioph-v322r0-f4.txt'))
  pair=ptp.read_text().splitlines()[213076].split('\t')
  assert pair[:2]==['80053','80048'] and pair[3:6]==['20000701','*','0']
  ptp_rows=ptp.read_text().splitlines()
  hydration=ptp_rows[355091].split('\t')
  assert hydration[:2]==['96360','96374'] and hydration[3:6]==['20090101','*','1']
  provenance['ptp']=dict(file=str(ptp.relative_to(root)),sha256=hashlib.sha256(ptp.read_bytes()).hexdigest(),records=[dict(source_line=213077,values=pair),dict(source_line=355092,values=hydration)])
 for case in cases:
  case['pdf']=f"bills/{case['id']}.pdf"
  draw_bill(case,OUT/f"{case['id']}.pdf")
  shutil.copyfile(OUT/f"{case['id']}.pdf",PUBLIC/case['pdf'])
 # Author per-line expectations separately; derive only from frozen source limits and
 # explicit planted finding groups. Price expectations are not used as an accuracy claim.
 for case in cases:
  rows=[]
  for i,l in enumerate(case['bill']['lines'],1):
   duplicate='question' if any(f['kind']=='duplicate' and f['lines'][-1]==i for f in case['expected_findings']) else ('unable' if l['code']=='' or l['units'] is None or l['amount'] is None else 'clear')
   units='question' if any(f['kind']=='units' and i in f['lines'] for f in case['expected_findings']) else ('unable' if l['code'] not in limits or l['units'] is None or not '2026-07-01'<=l['date']<='2026-09-30' else 'clear')
   rows.append(dict(line=i,duplicate=duplicate,units=units,mue_limit=limits.get(l['code']),mue_indicator=3 if l['code'] in limits else None,
    # Source gross/cash rows for J1885 have both 34.59 and 43.17;
    # J2405 has both 0.62 and 20.04. The unresolved CDM variants must abstain.
    price='unable' if l['modifiers'] or l['code'] in ('','99999','99284','J1885','J2405') or l['units'] is None or l['amount'] is None or not '2026-07-01'<=l['date']<='2026-09-30' else 'context'))
   row=rows[-1]
   row['ptp']='question' if any(f['kind']=='bundling' and i in f['lines'] for f in case['expected_findings']) else ('review' if any(i in f['lines'] for f in case.get('expected_modifier_reviews',[])) else ('unable' if l['code'] not in limits or not l['provider'] or not '2026-07-01'<=l['date']<='2026-09-30' or any(o['date']==l['date'] and (not o['provider'] or o['provider']==l['provider']) and (not o['provider'] or o['code'] not in limits) for o in case['bill']['lines']) else 'clear'))
  case.setdefault('expected_modifier_reviews',[])
  case['expected_line_checks']=rows
 key=dict(version='2.0',created='2026-10-17',scope='Keck outpatient, Q3 2026, synthetic bills',
  limitations='Developer-authored regression bank, not held-out or coder-validated. PTP cases test bundling and documentation review within the 20-code Q3 hospital subset; no clinical correctness or real-world accuracy claim.',
  original_source_provenance=provenance,cases=cases)
 (FIXTURES/'cases.json').write_text(json.dumps(key,indent=2)+'\n')
 (PUBLIC/'answer-key.json').write_text(json.dumps(key,indent=2)+'\n')
 with (PUBLIC/'answer-key.csv').open('w',newline='') as f:
  w=csv.writer(f);w.writerow(['bill_id','scenario','category','expected_coding_questions','expected_findings','ptp_coverage','review_note'])
  for case in cases:w.writerow([case['id'],case['title'],case['category'],len(case['expected_findings']),'; '.join(f"{x['kind']} lines {','.join(map(str,x['lines']))}" for x in case['expected_findings']),case['ptp']['expected'] if case['ptp'] else 'No PTP question within supported scope',case['note']])
 guide='''BILL BUSTER - 20 SYNTHETIC STATEMENTS (V2 - NCCI PTP ENABLED)\n\nAll names, accounts, charges and clinical combinations are invented. These are not hospital-issued documents, clinical records or payment requests. The hospital name identifies the prototype reference scope. No hospital logo or patient data is used.\n\nHOW TO TEST\n1. Open https://billbuster.ankitkapoor.me and choose Upload synthetic PDF.\n2. Choose one BB-xx.pdf, inspect the extracted lines, and confirm them.\n3. Review the questions and evidence, then download an inquiry packet.\n4. Compare with answer-key.csv (overview) or answer-key.json (line-level details).\n\nThe PDFs contain ordinary visible statement tables. They do not embed an invisible JSON payload, answers, or a hidden pipe-separated extraction appendix. Patient/account fields are not imported into the prototype.\n\nCASES\nBB-01 through BB-06: no planted coding questions.\nBB-07 through BB-14: planted duplicate, MUE, PTP or combined questions. BB-09 tests indicator-1 bundling without a modifier.\nBB-15: indicator-1 PTP modifier 59 documentation review, not an automatic clearance. BB-16: same code pair on different dates. BB-17: an October pair outside Q3 coverage. BB-18: different billing providers. BB-19: missing data. BB-20: indicator-0 PTP bundling question for 80053/80048.\n\nIMPORTANT LIMITS\nMUE is part of NCCI. The app checks published Q3 2026 hospital-outpatient MUEs for its selected codes and asks questions; it does not decide liability. All selected source MUE records in this bank have adjudication indicator 3. This bank therefore does not establish indicator-1/2 source coverage.\n\nBB-20 includes an active hospital PTP pair: column 1 80053, column 2 80048, modifier indicator 0, effective 2000-07-01, no deletion in the supplied Q3 table. The app now raises a bundling question for this case, carries the source row into the findings and letter, and does not treat a modifier as a bypass for indicator 0.\n\nPublished prices are context, not patient responsibility or savings. Unknown/missing fields and dates outside Q3 must not be cleared. Missing charges make only a known-charge subtotal possible.\n\nExpected findings were authored from the synthetic specifications and checked against the supplied source CSV/TXT. This is a developer-authored regression bank, not an independent held-out accuracy study or a billing-specialist evaluation.\n\nSOURCE NOTICES\nCPT codes and other data only are copyright 2025 American Medical Association. All rights reserved. CPT is a registered trademark of the AMA. Applicable FARS/DFARS Restrictions Apply to Government Use. No endorsement by AMA, CMS or Keck Hospital of USC is implied. The original source pack retains source terms.\n'''
 (PUBLIC/'README.txt').write_text(guide)
 (PUBLIC/'catalog.json').write_text(json.dumps([dict(id=c['id'],pdf=c['pdf'],lines=len(c['bill']['lines']),date=min(l['date'] for l in c['bill']['lines'])) for c in cases],indent=2)+'\n')
 archive=OUT/'bill-buster-20-bills.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for path in sorted((PUBLIC/'bills').glob('BB-*.pdf')):z.write(path,f'bill-buster-20-bills/bills/{path.name}')
  for name in ['answer-key.json','answer-key.csv','README.txt']:z.write(PUBLIC/name,f'bill-buster-20-bills/{name}')
 shutil.copyfile(archive,PUBLIC/'bill-buster-20-bills.zip')
 print(f'Created {len(cases)} one-page bills; archive: {archive}')

if __name__=='__main__':create(sys.argv[1] if len(sys.argv)>1 else None)
