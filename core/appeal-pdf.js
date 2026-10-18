import {PDFDocument,StandardFonts,rgb,PDFName,PDFString} from 'pdf-lib';

// A patient billing-review letter with an evidence schedule and real PDF links.
export async function appealPDF(result,draft,options={}) {
  const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle('Request for review of outpatient charges');pdf.setAuthor('Bill Buster');pdf.setSubject('Billing review request with supporting evidence');
  const ink=rgb(.13,.22,.24),green=rgb(.12,.32,.27),muted=rgb(.36,.42,.43),pale=rgb(.95,.97,.95),line=rgb(.83,.88,.85);
  const safe=value=>[...String(value).replace(/[–—]/g,'-')].map(c=>{if(c==='\n')return c;try{regular.encodeText(c);return c;}catch{return '?';}}).join('');
  const evidence=draft.evidence??[],aliases=new Map(evidence.map((e,i)=>[e.id,`E${i+1}`])),targets=new Map(),pending=[];
  const letter=options.letter??draft.letter,edited=letter!==draft.letter||!!draft.edited;
  const dates=[...new Set(result.bill.lines.map(l=>l.date))].sort(),prepared=options.prepared??new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric'}).format(new Date());
  const dollars=n=>n==null?'Not supplied':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  let page,y;
  function addPage(label='BILLING REVIEW REQUEST') {
    page=pdf.addPage([612,792]);y=711;
    page.drawText('BILL BUSTER',{x:48,y:751,font:bold,size:9,color:green});
    const width=regular.widthOfTextAtSize(label,8);page.drawText(label,{x:564-width,y:751,font:regular,size:8,color:muted});
    page.drawLine({start:{x:48,y:736},end:{x:564,y:736},thickness:.7,color:line});
  }
  function wrap(raw,font,size,width=516) {
    const lines=[];
    for(const source of safe(raw).split('\n')) {
      let current='';
      for(const token of source.split(/(?<=\s)/)) {
        if(current&&font.widthOfTextAtSize(current+token,size)>width){lines.push(current.trimEnd());current='';}
        for(const char of token){if(font.widthOfTextAtSize(current+char,size)>width){lines.push(current);current='';}current+=char;}
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }
  function ensure(height,label) {if(y-height<62)addPage(label);}
  function annotation(rect,action) {
    const ref=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:rect,Border:[0,0,0],...action}));
    const annotations=page.node.Annots();if(annotations)annotations.push(ref);else page.node.set(PDFName.of('Annots'),pdf.context.obj([ref]));
  }
  function flow(text,{font=regular,size=10,leading=14.5,color=ink,gap=8,keep=true,x=48,width=516}={}) {
    const lines=wrap(text,font,size,width);
    if(keep&&lines.length*leading<590)ensure(lines.length*leading+gap);
    for(const rendered of lines) {
      ensure(leading);page.drawText(rendered,{x,y,font,size,color});
      for(const match of rendered.matchAll(/\bE\d+\b/g)) {
        const left=x+font.widthOfTextAtSize(rendered.slice(0,match.index),size),right=left+font.widthOfTextAtSize(match[0],size);
        pending.push({page,alias:match[0],rect:[left,y-2,right,y+size]});
      }
      y-=leading;
    }
    y-=gap;
  }
  function heading(text) {ensure(55);flow(text,{font:bold,size:11,color:green,leading:16,gap:10});}
  function externalLink(label,url) {
    ensure(18);const text=safe(label),width=regular.widthOfTextAtSize(text,9);
    page.drawText(text,{x:48,y,font:regular,size:9,color:green});page.drawLine({start:{x:48,y:y-2},end:{x:48+width,y:y-2},thickness:.4,color:green});
    annotation([48,y-3,48+width,y+10],{A:{S:'URI',URI:PDFString.of(url)}});y-=20;
  }
  addPage();flow('Request for review of\noutpatient facility charges',{font:bold,size:23,leading:28,gap:17});
  flow(`Prepared ${prepared}  |  ${result.bill.hospital}`,{size:9,color:muted,gap:6});
  flow(`Service dates: ${dates[0]}${dates.length>1?' to '+dates.at(-1):''}  |  ${result.bill.lines.length} itemized lines`,{size:9,color:muted,gap:14});
  page.drawRectangle({x:48,y:y-34,width:516,height:40,color:pale});
  page.drawText(`${result.findings.length} questions for review${result.modifier_reviews.length?'  |  '+result.modifier_reviews.length+' modifier documentation review':''}`,{x:60,y:y-10,font:bold,size:10,color:green});
  page.drawText('Evidence references link to the supporting schedule.',{x:60,y:y-24,font:regular,size:8,color:muted});y-=56;
  if(safe(letter)!==letter.replace(/[–—]/g,'-'))flow('Font note: unsupported characters appear as ?. The text download preserves the original characters.',{size:8.5,color:muted});
  if(edited)flow('USER-EDITED LETTER: changes to the generated draft have not been automatically verified.',{size:8.5,color:muted});
  else if(draft.mode==='ai')flow('AI-assisted wording. Figures and source references supplied by the rule-based assessment. Please review before sending.',{size:8.5,color:muted});
  for(let paragraph of letter.split('\n\n')) {
    for(const [id,alias] of aliases)paragraph=paragraph.replaceAll(id,alias);
    if(/^\d\. [A-Z ]+$/.test(paragraph.trim()))heading(paragraph);
    else if(/^\d+\. /.test(paragraph)) {
      const [title,...body]=paragraph.split('\n'),text=body.join('\n');
      const height=wrap(title,bold,10).length*13.5+4+wrap(text,regular,9.5).length*13.5+12;
      ensure(Math.min(height,590));flow(title,{font:bold,size:10,leading:13.5,gap:4});flow(text,{size:9.5,leading:13.5,gap:12});
    } else flow(paragraph,{size:9.5,leading:13.5});
  }
  addPage('APPENDIX A / EVIDENCE');heading('APPENDIX A. SUPPORTING EVIDENCE');
  flow('The references below explain the questions raised. Medicare coding edits are reference rules; confirm applicability with the hospital and insurer. Hospital prices do not establish patient responsibility.',{size:9.5,color:muted,gap:18});
  for(const [i,e] of evidence.entries()) {
    const title=`E${i+1}. ${e.label}`;const height=wrap(title,bold,10).length*14+wrap(e.detail,regular,9).length*12+52;ensure(Math.min(height,600),'APPENDIX A / EVIDENCE');
    targets.set(`E${i+1}`,{page:page.ref,y:y+10});
    flow(title,{font:bold,size:10,color:green,leading:14,gap:3});flow(e.id,{size:7.5,color:muted,leading:10,gap:5});flow(e.detail,{size:9,leading:12,gap:7});
    if(e.url&&/^https:\/\/(www\.)?(cms\.gov|keckmedicine\.org)\//.test(e.url))externalLink('View published source - '+new URL(e.url).hostname,e.url);
    else flow('Source: the confirmed itemized bill; see Appendix B.',{size:8.5,color:muted,leading:12,gap:8});
    page.drawLine({start:{x:48,y:y+4},end:{x:564,y:y+4},thickness:.4,color:line});y-=10;
  }
  addPage('APPENDIX B / CONFIRMED BILL');heading('APPENDIX B. CONFIRMED CHARGES');
  flow(`Bill amounts are ${result.amount_complete?'complete as entered':'incomplete; missing amounts remain unknown'}. ${result.amount_complete?'Confirmed bill total':'Known-charge subtotal'}: ${dollars(result.total)}.`,{size:9.5,color:muted,gap:18});
  function tableHeader() {
    ensure(60,'APPENDIX B / CONFIRMED BILL');page.drawRectangle({x:48,y:y-22,width:516,height:25,color:pale});
    for(const [x,label] of [[56,'LINE'],[90,'DATE'],[160,'CODE'],[225,'UNITS'],[278,'CHARGE'],[363,'MOD.'],[423,'PROVIDER']])page.drawText(label,{x,y:y-13,font:bold,size:7.5,color:green});y-=40;
  }
  tableHeader();
  for(const l of result.bill.lines) {
    const cells=[[56,l.id,28],[90,l.date,65],[160,l.code||'-',55],[225,l.units??'-',42],[278,dollars(l.amount),80],[363,l.modifiers||'-',55],[423,l.provider||'Unknown',137]]
      .map(([x,value,width])=>({x,lines:wrap(value,regular,8,width)}));
    const height=Math.max(...cells.map(c=>c.lines.length))*11+14;
    if(y-height<62){addPage('APPENDIX B / CONFIRMED BILL');tableHeader();}
    for(const cell of cells)cell.lines.forEach((text,i)=>page.drawText(text,{x:cell.x,y:y-i*11,font:regular,size:8,color:ink}));
    page.drawLine({start:{x:48,y:y-height+10},end:{x:564,y:y-height+10},thickness:.3,color:line});y-=height;
  }
  y-=15;heading('FOLLOW-UP CALL CHECKLIST');
  draft.checklist.forEach((item,i)=>flow(`${i+1}. ${item}`,{size:9,leading:13,gap:10}));
  for(const item of pending) {
    const target=targets.get(item.alias);if(!target)continue;
    const original=page;page=item.page;annotation(item.rect,{Dest:[target.page,PDFName.of('XYZ'),48,target.y,null]});page=original;
  }
  const pages=pdf.getPages();pages.forEach((p,i)=>{
    p.drawLine({start:{x:48,y:44},end:{x:564,y:44},thickness:.5,color:line});
    p.drawText('Synthetic prototype | Questions for billing review, not a payment determination.',{x:48,y:29,font:regular,size:7,color:muted});
    p.drawText(`${i+1} / ${pages.length}`,{x:538,y:29,font:regular,size:7,color:muted});
  });
  return pdf.save();
}

export function packetText(draft) {
  return draft.letter+'\n\nAPPENDIX A - SUPPORTING EVIDENCE\n\n'+draft.evidence.map(e=>`[${e.id}] ${e.label}\n${e.detail}${e.url?'\n'+e.url:''}`).join('\n\n')+'\n\nPHONE CHECKLIST\n'+draft.checklist.map((x,i)=>`${i+1}. ${x}`).join('\n');
}
