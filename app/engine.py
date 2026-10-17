"""Deterministic bill checks. No model, network calls, or stored patient records."""
import json
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

REFERENCES = json.loads((Path(__file__).resolve().parents[1] / 'data/references.json').read_text())
REPEAT = {'76', '77', '91'}
DISCLAIMER = 'Questions to discuss with billing, not a determination of an error. Medicare coding references may not apply to your plan. Published prices do not establish patient responsibility or savings.'

class BillError(ValueError):
    pass

def validate(bill):
    if not isinstance(bill, dict) or not isinstance(bill.get('lines'), list) or not 1 <= len(bill['lines']) <= 50:
        raise BillError('Add between 1 and 50 bill lines.')
    if bill.get('hospital') != REFERENCES['hospital'] or bill.get('setting') != 'outpatient':
        raise BillError('This prototype supports Keck Hospital of USC outpatient facility bills only.')
    payer = bill.get('payer', '')
    plan = bill.get('plan', '')
    if not isinstance(payer, str) or not isinstance(plan, str) or len(payer) > 150 or len(plan) > 150:
        raise BillError('Payer and plan must be short text values.')
    result = dict(hospital=bill['hospital'], setting='outpatient', payer=payer.strip(), plan=plan.strip(), lines=[])
    for index, line in enumerate(bill['lines'], 1):
        if not isinstance(line, dict):
            raise BillError(f'Line {index}: invalid line.')
        code = str(line.get('code', '')).strip().upper()
        if code and not re.fullmatch(r'[A-Z0-9]{5}', code):
            raise BillError(f'Line {index}: use a five-character CPT/HCPCS code, or leave it empty if unknown.')
        try:
            service_date = date.fromisoformat(str(line.get('date', ''))).isoformat()
        except ValueError:
            raise BillError(f'Line {index}: confirm the service date.')
        units = line.get('units')
        amount = line.get('amount')
        try:
            units = None if units in ('', None) else Decimal(str(units))
            amount = None if amount in ('', None) else Decimal(str(amount))
            if units is not None and (not units.is_finite() or units <= 0 or units > 10000 or units != units.to_integral_value()):
                raise InvalidOperation
            if amount is not None and (not amount.is_finite() or amount < 0 or amount > 10000000 or amount.as_tuple().exponent < -2):
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            raise BillError(f'Line {index}: units must be positive whole numbers; amounts must be nonnegative dollars with at most two decimal places.')
        mods = line.get('modifiers', '')
        if not isinstance(mods, str) or (mods.strip() and not re.fullmatch(r'[A-Za-z0-9]{2}(?:[ ,]+[A-Za-z0-9]{2})*', mods.strip())):
            raise BillError(f'Line {index}: enter two-character modifiers separated by commas.')
        description = str(line.get('description', '')).strip()[:150]
        provider = str(line.get('provider', '')).strip()[:100]
        result['lines'].append(dict(id=index, code=code, date=service_date,
            units=int(units) if units is not None else None, amount=float(amount) if amount is not None else None,
            modifiers=','.join(sorted(set(re.split(r'[ ,]+', mods.strip().upper())) - {''})),
            description=description, provider=provider))
    return result

def money(value):
    return f'${value:,.2f}'

def analyze(raw):
    bill = validate(raw)
    findings, checks, prices = [], [], []
    groups = defaultdict(list)
    for line in bill['lines']:
        groups[(line['date'], line['code'], line['provider'])].append(line)
    for line in bill['lines']:
        lid, code = line['id'], line['code']
        complete = bool(code) and line['units'] is not None and line['amount'] is not None
        matches = [other for other in groups[(line['date'], code, line['provider'])]
                   if complete and other['id'] < lid and other['units'] == line['units'] and other['amount'] == line['amount']
                   and other['modifiers'] == line['modifiers'] and not (REPEAT & set((other['modifiers']+','+line['modifiers']).split(',')))]
        status = 'unable' if not complete else 'clear'
        detail = 'Missing code, units or amount.' if not complete else 'No matching earlier line without a repeat modifier.'
        if matches:
            other = matches[0]
            status, detail = 'question', f"Line {lid} matches line {other['id']} on code, date, provider, modifiers, units and amount."
            findings.append(dict(id=f'DUP-{lid}', kind='duplicate', title=f"Could line {lid} repeat line {other['id']}?",
                lines=[other['id'], lid], detail=detail,
                question=f"For {line['date']}, could you confirm whether line {lid} ({code}, {line['units']} units, {money(line['amount'])}) duplicates line {other['id']}, or explain the separate service?",
                evidence=[dict(id=f'BILL-{other["id"]}-{lid}', label=f"Confirmed bill, lines {other['id']} and {lid}",
                    detail='Same confirmed fields; no repeat-procedure modifier 76, 77 or 91. Repeated tests can be legitimate. Please review the clinical record.', url=None)]))
        checks.append(dict(line=lid, check='duplicate', status=status, detail=detail))
        in_period = REFERENCES['start'] <= line['date'] <= REFERENCES['end']
        rule = REFERENCES['mue'].get(code) if in_period else None
        group = groups[(line['date'], code, line['provider'])]
        if not rule or line['units'] is None or (rule['indicator'] != 1 and any(item['units'] is None for item in group)):
            detail = 'Service date outside July–September 2026.' if not in_period else 'Missing units or code outside the published prototype subset.'
            checks.append(dict(line=lid, check='units', status='unable', detail=detail))
        else:
            total = line['units'] if rule['indicator'] == 1 else sum(item['units'] for item in group)
            over = total > rule['limit']
            checks.append(dict(line=lid, check='units', status='question' if over else 'clear', detail=f"{total} units assessed; published limit {rule['limit']}; indicator {rule['indicator']}."))
            if over and (rule['indicator'] == 1 or line['id'] == group[0]['id']):
                ids = [lid] if rule['indicator'] == 1 else [item['id'] for item in group]
                evidence_id = f"MUE-Q3-2026-{code}"
                basis = 'per claim line' if rule['indicator'] == 1 else 'per date of service and provider'
                meaning = {1: 'A claim-line edit; appropriate modifiers can affect reporting.', 2: 'A date-of-service policy edit.', 3: 'A date-of-service clinical edit; documentation may support an exception on review.'}[rule['indicator']]
                findings.append(dict(id=f'MUE-{lid}', kind='units', title=f'Ask about the units for {code}', lines=ids,
                    detail=f"{total} units on {line['date']}; Medicare's published outpatient limit is {rule['limit']} {basis}.",
                    question=f"For code {code} on {line['date']} (lines {', '.join(map(str,ids))}), please explain the {total} units billed against the Medicare outpatient MUE reference of {rule['limit']}, including any supporting documentation or applicable exceptions.",
                    evidence=[dict(id=evidence_id, label=f"CMS outpatient MUE · 2026 Q3 · code {code}",
                        detail=f"Source CSV record {rule['row']}; limit {rule['limit']}; adjudication indicator {rule['indicator']}; rationale: {rule['rationale']}. {meaning} Medicare reference only; confirm applicability with your insurer.",
                        url=REFERENCES['sources']['mue']['url'])]))
        records = REFERENCES['prices'].get(code, [])
        price = dict(line=lid, code=code, billed=line['amount'], units=line['units'], status='unable', gross=None, cash=None, negotiated=None, evidence=[], note='')
        if not in_period or not code or line['units'] is None or line['amount'] is None or line['modifiers']:
            price['note'] = 'Unable to assess: date, code, units, amount or modifier is outside supported price matching.'
        else:
            def unique_price(field, candidates):
                available = [r for r in candidates if r[field] is not None]
                values = {r[field] for r in available}
                if len(values) != 1:
                    return None
                price['evidence'].extend([dict(id=f"KECK-{r['record']}", label=f"Keck MRF · CSV record {r['record']}",
                    detail=f"{code} ({r['code_type']}), facility/{r['setting']}, unmodified; {field} {money(r[field])} per published service unit. File dated {REFERENCES['price_date']}." + (f" {r['payer']} / {r['plan']}." if r['payer'] else ''),
                    url=REFERENCES['sources']['prices']['url']) for r in available])
                return dict(unit=next(iter(values)), total=round(next(iter(values))*line['units'], 2))
            price['gross'] = unique_price('gross', records)
            price['cash'] = unique_price('cash', records)
            matched = [r for r in records if bill['payer'] and bill['plan'] and r['payer'].casefold()==bill['payer'].casefold() and r['plan'].casefold()==bill['plan'].casefold()]
            price['negotiated'] = unique_price('negotiated', matched)
            price['status'] = 'context' if any(price[k] for k in ('gross','cash','negotiated')) else 'unable'
            price['note'] = 'Published service-unit prices scaled by confirmed bill units. Multiple CDM prices, missing amounts and algorithm-only rates are not resolved. Negotiated price requires an exact payer and plan match. File vintage does not prove the price applied on the service date.'
        # A record may supply more than one price category; cite it once.
        price['evidence'] = list({e['id']+e['detail']: e for e in price['evidence']}.values())
        prices.append(price)
        checks.append(dict(line=lid, check='price', status=price['status'], detail=price['note']))
    return dict(bill=bill, findings=findings, checks=checks, prices=prices, disclaimer=DISCLAIMER,
        quarter=REFERENCES['quarter'], price_date=REFERENCES['price_date'],
        total=round(sum(x['amount'] or 0 for x in bill['lines']),2), amount_complete=all(x['amount'] is not None for x in bill['lines']),
        unable_count=sum(x['status']=='unable' for x in checks), check_count=len(checks))

CHECKLIST = [
    'Have your itemized facility bill and insurer explanation of benefits ready. Do not share unnecessary personal information.',
    'Ask for the billing representative’s name and a call reference number.',
    'Read each question in the letter. Ask which services, units and modifiers support each charge.',
    'Ask which published price, payer contract or discount applies; confirm patient responsibility with your insurer.',
    'Ask whether a billing review or payment hold is available, and request any agreed correction in writing.',
    'Write down the next step, who owns it and when to follow up.'
]

def packet(result):
    # Construct only from the validated bill and deterministic findings. No generative claims.
    bill = result['bill']
    citations = {}
    paragraphs = ['To: Keck Hospital of USC billing office', 'Subject: Request for clarification of itemized outpatient charges',
        'Hello,', 'Please help me understand the following charges on my outpatient facility bill. These are questions for review, not a claim that a charge is incorrect.']
    for finding in result['findings']:
        for evidence in finding['evidence']:
            citations[evidence['id']] = evidence
        paragraphs.append(f"{finding['question']} [{'; '.join(e['id'] for e in finding['evidence'])}]")
    if not result['findings']:
        paragraphs.append('The limited prototype checks did not identify a coding question. Please explain any charges I ask about; this review does not establish that the entire bill is correct.')
    context = [p for p in result['prices'] if p['status']=='context']
    for p in context:
        values = ', '.join(f"{label} {money(p[key]['total'])} for {p['units']} units" for key,label in [('gross','published gross'),('cash','discounted cash'),('negotiated','matched negotiated')] if p[key])
        for evidence in p['evidence']:
            citations[evidence['id']] = evidence
        paragraphs.append(f"For line {p['line']} ({p['code']}), the bill shows {money(p['billed'])}. Keck's price file dated {result['price_date']} lists {values}. Please clarify the applicable rate, service-unit basis, discounts and final patient responsibility. [{'; '.join(dict.fromkeys(e['id'] for e in p['evidence']))}]")
    if result['unable_count']:
        paragraphs.append(f"This limited review could not assess {result['unable_count']} of {result['check_count']} line checks. Missing information and unsupported services have not been cleared.")
    paragraphs += ['Please provide an itemized explanation and any corrections in writing. I will confirm any insurer adjustments against my explanation of benefits.', 'Thank you,', '[Your name and account reference — add privately before sending]', '\nEvidence']
    paragraphs += [f"[{key}] {e['label']}. {e['detail']}" + (f" {e['url']}" if e['url'] else '') for key,e in citations.items()]
    paragraphs += [result['disclaimer']]
    letter = '\n\n'.join(paragraphs)
    # The source IDs in the generated text must be exactly those collected from findings/prices.
    referenced = set(re.findall(r'\[((?:BILL|MUE|KECK)-[^\]]+)\]', letter))
    assert {part.strip() for group in referenced for part in group.split(';')} == set(citations)
    return dict(letter=letter, checklist=CHECKLIST, validation='Verified template: all generated figures and citations come from confirmed lines and local references.')
