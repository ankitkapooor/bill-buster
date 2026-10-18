import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';
import sample from '../data/sample.json' with {type:'json'};
import { BillError } from './engine.js';
export const SAMPLE=sample;
export {appealPDF,packetText} from './appeal-pdf.js';

export async function pdfDocument(title, paragraphs, options={}) {
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(title);pdf.setAuthor('Bill Buster');
  const safe=text=>[...String(text)].map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const replaced=paragraphs.some(p=>safe(p)!==String(p));
  const size=options.small?8:10,leading=options.small?16:15;
  let page,y;
  function addPage() {
    page=pdf.addPage([612,792]);y=740;
    page.drawText('BILL BUSTER  /  SYNTHETIC PROTOTYPE',{x:48,y:28,font,size:8,color:rgb(.36,.42,.39)});
    page.drawText(String(pdf.getPageCount()),{x:554,y:28,font,size:8,color:rgb(.36,.42,.39)});
  }
  addPage();page.drawText(safe(title),{x:48,y,font:bold,size:19,color:rgb(.1,.24,.21)});y-=36;
  const content=replaced?['PDF font note: unsupported characters appear as ?. Download text to preserve all characters.',...paragraphs]:paragraphs;
  for(const paragraph of content) {
    for(const raw of String(paragraph).split('\n')) {
      const text=safe(raw);let line='';
      // Character-level width measurement also safely wraps long URLs and citation IDs.
      const lines=[];
      for(const word of text.split(/(?<=\s)/)) {
        if(line&&font.widthOfTextAtSize(line+word,size)>516){lines.push(line.trimEnd());line='';}
        for(const char of word) {
          if(font.widthOfTextAtSize(line+char,size)>516){lines.push(line);line='';}
          line+=char;
        }
      }
      lines.push(line.trimEnd());
      for(const rendered of lines) {
        if(y<60)addPage();
        page.drawText(rendered,{x:48,y,font,size,color:rgb(.12,.19,.17)});y-=leading;
      }
    }
    y-=options.small?4:10;
  }
  return pdf.save();
}

export async function samplePDF() {
  const rows=['SYNTHETIC BILL - DEMO ONLY','Hospital: Keck Hospital of USC','Setting: outpatient','Payer: Medicare','Plan:',
    'No real patient information. Amounts below are invented for demonstration.','Date | Code | Description | Units | Amount | Modifiers | Provider'];
  rows.push(...SAMPLE.lines.map(x=>`${x.date} | ${x.code} | ${x.description} | ${x.units} | ${x.amount.toFixed(2)} | ${x.modifiers||'-'} | ${x.provider}`));
  return pdfDocument('Synthetic outpatient facility bill',rows,{small:true});
}

// Read explicit visible column headings and PDF text coordinates. This is a
// bounded statement-table reader, not OCR or a general hospital-bill parser.
function statementLines(items) {
  const rows=[];
  for(const item of items) {
    if(!item.str?.trim() || !item.transform)continue;
    const x=item.transform[4],y=item.transform[5];
    let row=rows.find(r=>Math.abs(r.y-y)<2);
    if(!row){row={y,items:[]};rows.push(row);}
    row.items.push({x,text:item.str.trim()});
  }
  const labels=['No.','Date of service','CPT / HCPCS','Description','Units','Charges','Mod.','Provider'];
  const header=rows.find(row=>labels.every(label=>row.items.some(i=>i.text===label)));
  if(!header)return [];
  const starts=labels.map(label=>header.items.find(i=>i.text===label).x);
  const lines=[];
  for(const row of rows.filter(r=>r.y<header.y).sort((a,b)=>b.y-a.y)) {
    const cells=labels.map(()=>[]);
    for(const item of row.items.sort((a,b)=>a.x-b.x)) {
      const column=starts.findLastIndex(x=>item.x>=x-2);
      if(column>=0)cells[column].push(item.text);
    }
    const [number,date,code,description,units,amount,modifiers,provider]=cells.map(c=>c.join(' '));
    if(!/^\d+$/.test(number)||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    lines.push({date,code:code==='-'?'':code,description,
      units:/^\d+$/.test(units)?units:'',
      amount:/^\$?[\d,]+(?:\.\d{1,2})?$/.test(amount)?amount.replace(/[$,]/g,''):'',
      modifiers:modifiers==='-'?'':modifiers,provider});
  }
  return lines;
}

export async function extractPDF(input) {
  const data=new Uint8Array(input);
  if(data.byteLength>2*1024*1024)throw new BillError('Choose a synthetic PDF smaller than 2 MB.');
  if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw new BillError('Choose a PDF file. Scans and real patient documents are outside this prototype.');
  let pdf,text='';const tableLines=[];
  try {
    pdf=await getDocumentProxy(data,{isEvalSupported:false,useSystemFonts:false});
    if(pdf.numPages<1||pdf.numPages>5)throw new BillError('Use an unencrypted synthetic PDF with no more than five pages.');
    for(let i=1;i<=pdf.numPages;i++) {
      const page=await pdf.getPage(i),content=await page.getTextContent();
      tableLines.push(...statementLines(content.items));
      let previousY=null;
      for(const item of content.items) {
        if(!('str' in item))continue;
        const y=item.transform?.[5];
        if(previousY!=null&&Math.abs(y-previousY)>2)text+='\n';
        text+=item.str+(item.hasEOL?'\n':' ');previousY=y;
      }
      text+='\n';
    }
  } catch(error) {
    if(error instanceof BillError)throw error;
    throw new BillError('This PDF could not be read. Try the downloadable synthetic sample.');
  } finally { await pdf?.destroy(); }
  if(!text.toUpperCase().includes('SYNTHETIC'))throw new BillError('Use a synthetic bill labeled SYNTHETIC. Real patient documents are not supported.');
  const field=name=>text.match(new RegExp(`^${name}:[ \\t]*([^\\n]*)`,'m'))?.[1].trim()??'';
  const lines=[];
  for(const row of text.split('\n')) {
    if(!/^\d{4}-\d{2}-\d{2}\s*\|/.test(row))continue;
    const parts=row.split('|').map(x=>x.trim());
    if(parts.length!==7)throw new BillError('A bill row could not be read completely. Use the sample layout or correct the bill lines manually.');
    const [date,code,description,units,amount,modifiers,provider]=parts;
    lines.push({date,code,description,units:/^\d+$/.test(units)?units:'',amount:/^\$?[\d,]+(?:\.\d{1,2})?$/.test(amount)?amount.replace(/[$,]/g,''):'',modifiers:modifiers==='-'?'':modifiers,provider});
  }
  if(!lines.length)lines.push(...tableLines);
  if(!lines.length)throw new BillError('No supported text rows found. Use the downloadable sample or statement test bank. OCR is not enabled.');
  if(lines.length>50)throw new BillError('The prototype supports up to 50 lines.');
  const hospital=field('Hospital')||(text.split('\n').some(row=>row.trim()==='Keck Hospital of USC')?'Keck Hospital of USC':'');
  return {bill:{hospital,setting:field('Setting'),payer:field('Payer'),plan:field('Plan'),lines},method:tableLines.length?'Read from the visible statement table in your browser, not AI. Review every field before running checks.':'Read from PDF text in your browser, not AI. Review every field before running checks.',text:text.slice(0,20000)};
}
