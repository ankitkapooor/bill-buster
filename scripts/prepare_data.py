"""Build a small, traceable subset from the user-supplied source pack."""
import csv
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODES = '99284 85025 36415 J7030 80053 93005 71046 96360 96361 96374 96375 J2405 81001 80048 83690 84484 70450 74177 71275 J1885'.split()

def prepare(source):
    source = Path(source)
    mue_path = next((source / 'cms/mue/2026-q3').rglob('*Hospital*.csv'))
    price_path = source / 'hospitals/keck/standardcharges.csv'
    mue = {}
    with mue_path.open(encoding='cp1252', newline='') as stream:
        for row_number, row in enumerate(csv.reader(stream), 1):
            if row[0] in CODES:
                mue[row[0]] = dict(limit=int(row[1]), indicator=int(row[2][0]), rationale=row[3], row=row_number)
    prices = {code: [] for code in CODES}
    with price_path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.reader(stream)
        next(reader)
        metadata = next(reader)
        headers = next(reader)
        for record, values in enumerate(reader, 4):
            row = dict(zip(headers, values))
            if row['billing_class'] != 'facility' or row['setting'] not in ('outpatient', 'both') or row['modifiers']:
                continue
            for i in range(1, 5):
                code = row[f'code|{i}']
                if code not in prices or row[f'code|{i}|type'] not in ('HCPCS', 'CPT'):
                    continue
                def number(key):
                    value = row.get(key, '')
                    return float(value) if value else None
                prices[code].append(dict(record=record, code_type=row[f'code|{i}|type'], setting=row['setting'],
                    description=row['description'], cdm=row['code|1'] if row['code|1|type'] == 'CDM' else None,
                    gross=number('standard_charge|gross'), cash=number('standard_charge|discounted_cash'),
                    payer=row['payer_name'], plan=row['plan_name'], negotiated=number('standard_charge|negotiated_dollar'),
                    algorithm=row['standard_charge|negotiated_algorithm'], methodology=row['standard_charge|methodology']))
    data = dict(hospital=metadata[0], price_date=metadata[1], quarter='2026 Q3', start='2026-07-01', end='2026-09-30',
        codes=CODES, mue=mue, prices=prices, sources={
            'mue': dict(file=str(mue_path.relative_to(source)), sha256=hashlib.sha256(mue_path.read_bytes()).hexdigest(),
                url='https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits-mues'),
            'prices': dict(file=str(price_path.relative_to(source)), sha256=hashlib.sha256(price_path.read_bytes()).hexdigest(),
                url='https://www.keckmedicine.org/hospital-pricing-information/'),
            'guidance': dict(url='https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-faq-library')})
    (ROOT / 'data/references.json').write_text(json.dumps(data, indent=2) + '\n')
    print(f'Prepared {len(mue)} MUE records and {sum(map(len, prices.values()))} hospital price records.')

if __name__ == '__main__':
    prepare(sys.argv[1])
