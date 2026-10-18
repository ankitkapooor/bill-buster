"""Five authored compound cases. This generator does not import the rule engine."""
import csv
import json
import shutil
import zipfile
from pathlib import Path
from create_bill_bank import draw_bill, line, DESCRIPTIONS

ROOT=Path(__file__).resolve().parents[1]
DESCRIPTIONS['71275']='Chest CT angiography'
cases=[]
def add(title,lines,expected,note,reviews=()):
 n=21+len(cases)
 cases.append(dict(id=f'BB-{n:02}',title=title,category='compound',patient=['Alex Morgan','Robin Chen','Sam Rivera','Jules Patel','Avery Brooks'][len(cases)],
  bill=dict(hospital='Keck Hospital of USC',setting='outpatient',payer='Medicare',plan='',lines=lines),
  expected_findings=[dict(kind=k,lines=ids) for k,ids in expected],
  expected_modifier_reviews=[dict(kind='bundling',lines=ids) for ids in reviews],note=note,pdf=f'bills/BB-{n:02}.pdf'))

add('Emergency visit with overlapping billing questions',[
 line('99284',amount=1850),line('85025',amount=212),line('85025',amount=212),line('80053',units=2,amount=480),
 line('80048',amount=125),line('96360',amount=640),line('96374',units=2,amount=1180),line('J2405',units=4,amount=76)],
 [('duplicate',[2,3]),('units',[4]),('units',[7]),('bundling',[4,5]),('bundling',[6,7])],
 'Default demo. Five questions: repeated blood count, two MUE questions and two PTP pairs. Drug price has unresolved CDM variants. These findings overlap and must not be added up as savings.')
add('Split panel units and repeated blood collection',[
 line('80053',amount=220),line('80048',amount=125),line('80053',amount=260),line('36415',amount=48),line('36415',amount=48),
 line('85025',units=5,amount=1060),line('J7030',amount=125),line('93005',amount=165)],
 [('duplicate',[4,5]),('units',[1,3]),('units',[6]),('bundling',[1,2,3])],
 'Different panel amounts prevent a duplicate-panel flag but not same-day MUE aggregation. The NCCI pair groups both panel occurrences. Two blood collections equal the MUE, so only their duplicate question applies.')
add('Modifier exception and non-bypassable panel edit',[
 line('80053',units=2,amount=480),line('80048',amount=125,modifiers='59'),line('85025',amount=212),line('85025',amount=212),
 line('96360',amount=640),line('96374',amount=590,modifiers='59'),line('J1885',units=9,amount=198),line('J7030',amount=125)],
 [('duplicate',[3,4]),('units',[1]),('units',[7]),('bundling',[1,2])],
 'Modifier 59 cannot bypass the indicator-0 80053/80048 edit. The separate indicator-1 96360/96374 pair requires modifier documentation review. J1885 has 9 units versus MUE 8.',reviews=([5,6],))
add('Imaging, administration and overlapping PTP pairs',[
 line('71275',units=2,amount=6400),line('96360',amount=640),line('96374',units=2,amount=1180),line('36415',amount=48),line('36415',amount=48),
 line('J2405',units=4,amount=76),line('85025',amount=212),line('93005',amount=165)],
 [('duplicate',[4,5]),('units',[1]),('units',[3]),('bundling',[1,2]),('bundling',[1,3]),('bundling',[2,3])],
 'CT angiography units exceed MUE 1; administration units exceed MUE 1. Three active PTP pairs overlap the same lines; each requires a distinct cited question, not additive savings.')
add('Compound findings with missing and unsupported data',[
 line('80053',units=2,amount=480),line('80048',amount=125),line('85025',amount=212),line('85025',amount=212),
 line('96374',units=2,amount=1180,modifiers='76'),line('99999',amount=55),line('J7030',amount=None),line('71046',amount=330,service_date='2026-10-01')],
 [('duplicate',[3,4]),('units',[1]),('units',[5]),('bundling',[1,2])],
 'Known issues remain visible despite an unsupported peer code. Unknown charge stays blank; October rules abstain; only a known-charge subtotal is available. Repeat modifier 76 does not remove a date-of-service unit edit.')

limits={'99284':2,'85025':4,'80053':1,'80048':2,'36415':2,'96360':2,'96374':1,'J2405':64,'J1885':8,'J7030':20,'93005':5,'71275':1,'71046':3}
for c in cases:
 rows=[]
 for i,l in enumerate(c['bill']['lines'],1):
  in_period='2026-07-01'<=l['date']<='2026-09-30'
  unknown_peer=any(o['date']==l['date'] and o['provider']==l['provider'] and o['code'] not in limits for o in c['bill']['lines'])
  status=lambda kind:'question' if any(f['kind']==kind and (i==f['lines'][-1] if kind=='duplicate' else i in f['lines']) for f in c['expected_findings']) else 'clear'
  rows.append(dict(line=i,duplicate='unable' if l['units'] is None or l['amount'] is None else status('duplicate'),
   units='unable' if not in_period or l['code'] not in limits or l['units'] is None else status('units'),
   ptp=status('bundling') if status('bundling')=='question' else 'review' if any(i in r['lines'] for r in c['expected_modifier_reviews']) else 'unable' if not in_period or unknown_peer or l['code'] not in limits else 'clear',
   price='unable' if not in_period or l['code'] in ['99284','99999','J1885','J2405'] or l['amount'] is None or l['units'] is None or l['modifiers'] else 'context'))
 c['expected_line_checks']=rows

public=ROOT/'public/test-bills';out=ROOT/'output/pdf/compound-bills';out.mkdir(parents=True,exist_ok=True)
fixtures=ROOT/'fixtures/compound-bills';fixtures.mkdir(parents=True,exist_ok=True)
for c in cases:
 draw_bill(c,out/f"{c['id']}.pdf");shutil.copyfile(out/f"{c['id']}.pdf",public/c['pdf'])
key=dict(version='1.0',date='2026-10-18',default='BB-21',limitations='Synthetic developer-authored fixtures; questions are not verified billing errors or savings.',cases=cases)
(fixtures/'cases.json').write_text(json.dumps(key,indent=2)+'\n')
(public/'compound-answer-key.json').write_text(json.dumps(key,indent=2)+'\n')
with (public/'compound-answer-key.csv').open('w',newline='') as f:
 w=csv.writer(f,lineterminator='\n');w.writerow(['bill','scenario','questions','modifier_reviews','expected_findings','note'])
 for c in cases:w.writerow([c['id'],c['title'],len(c['expected_findings']),len(c['expected_modifier_reviews']),'; '.join(f"{x['kind']} lines {','.join(map(str,x['lines']))}" for x in c['expected_findings']),c['note']])
(ROOT/'data/sample.json').write_text(json.dumps(cases[0]['bill'],indent=2)+'\n')
with zipfile.ZipFile(out/'five-compound-bills.zip','w',zipfile.ZIP_DEFLATED) as z:
 for c in cases:z.write(public/c['pdf'],f"compound-bills/{c['id']}.pdf")
 for name in ['compound-answer-key.json','compound-answer-key.csv']:z.write(public/name,f'compound-bills/{name}')
shutil.copyfile(out/'five-compound-bills.zip',public/'five-compound-bills.zip')
print('Created BB-21–BB-25; BB-21 is the default demo.')
