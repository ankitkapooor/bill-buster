import copy
import io
import unittest
from unittest.mock import patch
from pypdf import PdfReader
from app.engine import analyze, packet, validate, REFERENCES, BillError
from app.documents import SAMPLE, sample_pdf, extract_pdf, pdf_document

class WorkflowTests(unittest.TestCase):
    def sample(self):
        return copy.deepcopy(SAMPLE)

    def test_pdf_to_packet_ten_consecutive_runs(self):
        source=sample_pdf()
        for _ in range(10):
            extracted=extract_pdf(source)['bill']
            self.assertEqual(validate(extracted),validate(SAMPLE))
            review=analyze(extracted)
            self.assertEqual([(f['kind'],f['lines']) for f in review['findings']],[('duplicate',[2,4]),('units',[5])])
            letter=packet(review)
            self.assertIn('[BILL-2-4]',letter['letter'])
            self.assertIn('[MUE-Q3-2026-80053]',letter['letter'])
            self.assertEqual(review['total'],2562)
            data=pdf_document('Inquiry',letter['letter'].split('\n\n')+letter['checklist'])
            text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)
            self.assertIn('MUE-Q3-2026-80053',text)
            self.assertIn('Phone', 'Phone checklist')

    def test_published_source_values(self):
        # Independently read from supplied source CSV: 80053 = 1/MAI3, 85025 = 4/MAI3.
        self.assertEqual(REFERENCES['mue']['80053']['limit'],1)
        self.assertEqual(REFERENCES['mue']['85025']['limit'],4)
        self.assertEqual(REFERENCES['mue']['85025']['indicator'],3)
        # Keck CSV record 94732: unmodified facility/both, HCPCS 85025, gross/cash 84.
        r=next(r for r in REFERENCES['prices']['85025'] if r['record']==94732)
        self.assertEqual((r['gross'],r['cash']),(84,84))

    def test_clean_bill_has_no_questions(self):
        b=self.sample(); b['lines'].pop(3);b['lines'][-1]['units']=1
        self.assertEqual(analyze(b)['findings'],[])

    def test_repeat_modifiers_suppress_duplicate(self):
        for modifier in ('76','77','91'):
            b=self.sample();b['lines'][3]['modifiers']=modifier
            self.assertFalse(any(f['kind']=='duplicate' for f in analyze(b)['findings']))

    def test_different_providers_are_separate(self):
        b=self.sample();b['lines'][3]['provider']='Other facility provider'
        self.assertFalse(any(f['kind']=='duplicate' for f in analyze(b)['findings']))

    def test_date_of_service_aggregation(self):
        b=self.sample();b['lines']=[copy.deepcopy(b['lines'][4]) for _ in range(2)]
        for line in b['lines']:line['units']=1
        r=analyze(b);mue=[f for f in r['findings'] if f['kind']=='units']
        self.assertEqual(len(mue),1);self.assertEqual(mue[0]['lines'],[1,2])
        b['lines'][1]['date']='2026-09-15'
        self.assertFalse(any(f['kind']=='units' for f in analyze(b)['findings']))

    def test_indicator_one_is_per_line(self):
        refs=copy.deepcopy(REFERENCES);refs['mue']['80053']['indicator']=1
        b=self.sample();b['lines']=[copy.deepcopy(b['lines'][4]) for _ in range(2)]
        for line in b['lines']:line['units']=1
        with patch('app.engine.REFERENCES',refs):
            self.assertFalse(any(f['kind']=='units' for f in analyze(b)['findings']))
            b['lines'][0]['units']=2
            self.assertEqual([f['lines'] for f in analyze(b)['findings'] if f['kind']=='units'],[[1]])

    def test_indicator_two_retains_policy_evidence(self):
        refs=copy.deepcopy(REFERENCES);refs['mue']['80053']['indicator']=2
        with patch('app.engine.REFERENCES',refs):
            finding=next(f for f in analyze(self.sample())['findings'] if f['kind']=='units')
            self.assertIn('policy edit',finding['evidence'][0]['detail'])

    def test_quarter_boundaries_never_clear_unsupported_dates(self):
        for date,supported in [('2026-06-30',False),('2026-07-01',True),('2026-09-30',True),('2026-10-01',False)]:
            b=self.sample()
            for line in b['lines']:line['date']=date
            r=analyze(b)
            self.assertEqual(any(f['kind']=='units' for f in r['findings']),supported)
            if not supported:
                self.assertTrue(all(c['status']=='unable' for c in r['checks'] if c['check'] in ('units','price')))

    def test_unknowns_abstain(self):
        b=self.sample();b['lines']=[dict(b['lines'][0],code='',units='',amount='')]
        self.assertTrue(all(c['status']=='unable' for c in analyze(b)['checks']))
        b['lines'][0].update(code='99999',units=1,amount=100)
        self.assertEqual(next(c for c in analyze(b)['checks'] if c['check']=='units')['status'],'unable')

    def test_unknown_units_do_not_clear_day_sum(self):
        b=self.sample();b['lines']=[dict(b['lines'][4],units=1),dict(b['lines'][4],units='')]
        self.assertTrue(all(c['status']=='unable' for c in analyze(b)['checks'] if c['check']=='units'))

    def test_negotiated_price_requires_exact_plan(self):
        b=self.sample();b.update(payer='Unitedhealthcare',plan='Navigate/Select & Core Exchange')
        r=analyze(b);p=r['prices'][1]
        self.assertEqual(p['negotiated']['unit'],12.83)
        b['plan']='Unknown'
        self.assertIsNone(analyze(b)['prices'][1]['negotiated'])

    def test_prices_scale_by_units_and_reject_ambiguity(self):
        b=self.sample();b['lines']=[dict(b['lines'][1],units=2)]
        self.assertEqual(analyze(b)['prices'][0]['gross']['total'],168)
        b['lines'][0]['modifiers']='91'
        self.assertEqual(analyze(b)['prices'][0]['status'],'unable')
        refs=copy.deepcopy(REFERENCES);refs['prices']['85025'].append(dict(refs['prices']['85025'][0],gross=999,record=999999))
        b['lines'][0]['modifiers']=''
        with patch('app.engine.REFERENCES',refs):
            self.assertIsNone(analyze(b)['prices'][0]['gross'])

    def test_reject_invalid_and_wrong_scope(self):
        for field,value in [('units',-1),('units',1.5),('units','NaN'),('amount','Infinity'),('amount','-2'),('amount','0.001'),('date','oops'),('code','<svg>'),('modifiers','123')]:
            b=self.sample();b['lines'][0][field]=value
            with self.assertRaises(BillError):validate(b)
        b=self.sample();b['hospital']='Another hospital'
        with self.assertRaises(BillError):validate(b)

    def test_pdf_rejection_and_missing_values(self):
        with self.assertRaises(BillError):extract_pdf(b'not a pdf')
        data=pdf_document('Unsupported',['SYNTHETIC','No coded rows here'])
        with self.assertRaises(BillError):extract_pdf(data)
        extracted=extract_pdf(sample_pdf())['bill']
        self.assertEqual(extracted['plan'],'')
        self.assertEqual(extracted['lines'][0]['amount'],'1850.00')

if __name__=='__main__':
    unittest.main()
