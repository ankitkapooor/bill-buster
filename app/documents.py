import io
import re
from html import escape
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from app.engine import BillError, REFERENCES

SAMPLE = dict(hospital='Keck Hospital of USC', setting='outpatient', payer='Medicare', plan='', lines=[
    dict(code='99284', description='Emergency visit', units=1, amount=1850, date='2026-09-14', modifiers='', provider='Keck facility'),
    dict(code='85025', description='Blood count', units=1, amount=212, date='2026-09-14', modifiers='', provider='Keck facility'),
    dict(code='36415', description='Blood draw', units=1, amount=48, date='2026-09-14', modifiers='', provider='Keck facility'),
    dict(code='85025', description='Blood count', units=1, amount=212, date='2026-09-14', modifiers='', provider='Keck facility'),
    dict(code='80053', description='Metabolic panel', units=2, amount=240, date='2026-09-14', modifiers='', provider='Keck facility')])

def pdf_document(title, paragraphs):
    output = io.BytesIO()
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='BillBody', parent=styles['BodyText'], fontSize=10, leading=15, spaceAfter=12))
    doc = SimpleDocTemplate(output, pagesize=(612,792), rightMargin=48, leftMargin=48, topMargin=48, bottomMargin=48,
        title=title, author='Bill Buster')
    story = [Paragraph(escape(title), styles['Title']), Spacer(1,18)]
    story += [Paragraph(escape(p).replace('\n','<br/>'),styles['BillBody']) for p in paragraphs]
    def footer(canvas, document):
        canvas.setFont('Helvetica',8)
        canvas.setFillColor(colors.HexColor('#596569'))
        canvas.drawString(48,28,'BILL BUSTER · SYNTHETIC PROTOTYPE · NOT BILLING ADVICE')
        canvas.drawRightString(564,28,str(document.page))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()

def sample_pdf():
    # One row per text line; deliberately transparent, testable extraction format.
    rows = ['SYNTHETIC BILL - DEMO ONLY', 'Hospital: Keck Hospital of USC', 'Setting: outpatient', 'Payer: Medicare',
        'Plan: ', 'No real patient information. Amounts below are invented for demonstration.',
        'Date | Code | Description | Units | Amount | Modifiers | Provider']
    rows += [f"{x['date']} | {x['code']} | {x['description']} | {x['units']} | {x['amount']:.2f} | {x['modifiers'] or '-'} | {x['provider']}" for x in SAMPLE['lines']]
    return pdf_document('Synthetic outpatient facility bill', rows)

def extract_pdf(data):
    if not data.startswith(b'%PDF-'):
        raise BillError('Choose a PDF file. Scans and real patient documents are outside this prototype.')
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 5:
            raise BillError('Use an unencrypted synthetic PDF with no more than five pages.')
        text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    except BillError:
        raise
    except Exception:
        raise BillError('This PDF could not be read. Try the downloadable synthetic sample.')
    if 'SYNTHETIC' not in text.upper():
        raise BillError('Use a synthetic bill labeled SYNTHETIC. Real patient documents are not supported.')
    def field(name):
        match = re.search(rf'^{name}:[ \t]*([^\n]*)',text,re.M)
        return match.group(1).strip() if match else ''
    lines = []
    for row in text.splitlines():
        if not re.match(r'^\d{4}-\d{2}-\d{2}\s*\|',row):
            continue
        parts = [x.strip() for x in row.split('|')]
        if len(parts) != 7:
            raise BillError('A bill row could not be read completely. Use the sample layout or enter the lines manually.')
        service_date,code,description,units,amount,modifiers,provider = parts
        lines.append(dict(date=service_date,code=code,description=description,units=units if re.fullmatch(r'\d+',units) else '',
            amount=amount.replace('$','').replace(',','') if re.fullmatch(r'\$?[\d,]+(?:\.\d{1,2})?',amount) else '',
            modifiers='' if modifiers=='-' else modifiers,provider=provider))
    if not lines:
        raise BillError('No supported text rows found. Use the synthetic sample layout or enter the bill lines manually. OCR is not enabled.')
    if len(lines)>50:
        raise BillError('The prototype supports up to 50 lines.')
    return dict(bill=dict(hospital=field('Hospital'),setting=field('Setting'),payer=field('Payer'),plan=field('Plan'),lines=lines),
        method='Read from PDF text, not AI. Review every extracted field before running checks.', text=text[:20000])
