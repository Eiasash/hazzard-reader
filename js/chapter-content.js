/* The reader and search builder render the same canonical chapter files. */
window.HazzardChapterContent=(()=>{
function renderMarkdown(mdText,chapter,imageSizes={}){
  // marked v12 mis-pairs some **bold** runs (e.g. "cm²**, … **>"), leaving literal ** on screen. Pre-convert simple one-line bold.
  mdText=mdText.replace(/(?<![\\*])\*\*(?![\s*])([^*\n]*?\S)(?<![\\*])\*\*(?!\*)/g,(m,t)=>'<strong>'+t.replace(/~/g,'&#126;')+'</strong>');
  mdText=mdText.split('\n').map(line=>line.includes('<')&&line.includes('>')?line.replace(/(?<![\\*\w])\*(?![\s*])([^*\n]*?\S)(?<![\\*])\*(?!\*)/g,'<em>$1</em>'):line).join('\n');
  let html=marked.parse(mdText);
  html=html.replace(/<table>/g,'<div class="table-wrap" tabindex="0" role="region" aria-label="Table" data-md="1"><table>');
  html=html.replace(/<\/table>/g,'</table></div>');
  html=html.replace(/<blockquote>\s*/g,'<div class="note">').replace(/\s*<\/blockquote>/g,'</div>');
  html=html.replace(/<p><img src="([^"\/]+\.(?:png|jpg|jpeg|gif|svg|webp))" alt="([^"]*)"><\/p>/g,(m,file,alt)=>`<figure><img src="chapters/${file}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`);
  html=html.replace(/<img src="([^"\/]+\.(?:png|jpg|jpeg|gif|svg|webp))" alt="([^"]*)">/g,(m,file,alt)=>`<img src="chapters/${file}" alt="${alt}">`);
  const usedIds=new Set();
  html=html.replace(/<h([123])>([\s\S]*?)<\/h\1>/g,(m,level,inner)=>{
    const text=inner.replace(/<[^>]+>/g,'');
    let slug=text.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'section';
    let unique=slug,i=2;while(usedIds.has(unique))unique=slug+'-'+(i++);usedIds.add(unique);
    return '<h'+level+' id="'+unique+'">'+inner+'</h'+level+'>';
  });
  html=html.replace(/<img\b[^>]*>/g,tag=>{
    const source=tag.match(/src="([^"]+)"/),dimensions=source&&imageSizes[source[1].split('/').pop()];
    return tag.slice(0,-1)+' loading="lazy" decoding="async"'+(dimensions?' width="'+dimensions[0]+'" height="'+dimensions[1]+'"':'')+'>';
  });
  return html;
}
function smoothPageMarkers(copy){
  for(const a of [...copy.querySelectorAll('a[id]')]){
    if(!/^p\d+$/.test(a.id))continue;
    let s=a.nextSibling;while(s&&s.nodeType===3&&!s.data.trim())s=s.nextSibling;
    const m=s&&s.nodeType===1&&s.tagName==='STRONG'&&s.textContent.trim().match(/^\[p\.\s*(\d+)\]$/);
    if(!m)continue;
    const flagNode=s.nextSibling,flag=flagNode?.textContent.match(/^\s*⟨2026[^⟩]*⟩/);
    if(flag){
      a.dataset.exam='2026';
      a.dataset.examAnnotation=flag[0].trim();
      if(flagNode.nodeType===3){const badge=document.createElement('span');badge.className='exam-page-badge';badge.textContent=flag[0].trim();flagNode.before(document.createTextNode(flag[0].match(/^\s*/)[0]),badge);flagNode.data=flagNode.data.slice(flag[0].length)}
    }
    s.remove();a.className='pg';a.dataset.page=m[1];a.dataset.readerMetadata='page';a.setAttribute('role','note');a.setAttribute('aria-label','Page '+m[1]);
  }
  const sentenceEnd=/[.!?]["”’)\]]*$/;
  for(const a of [...copy.querySelectorAll('a.pg')]){
    const p=a.parentElement;if(!p||p.tagName!=='P')continue;
    const pre=document.createRange();pre.setStart(p,0);pre.setEndBefore(a);if(pre.toString().trim())continue;
    const prev=p.previousElementSibling;
    if(!prev||prev.tagName!=='P'||prev.querySelector('img')||!prev.textContent.trim()||sentenceEnd.test(prev.textContent.trim()))continue;
    const post=document.createRange();post.setStartAfter(a);post.setEnd(p,p.childNodes.length);
    if(p.querySelector('img'))continue;
    const rest=post.toString().replace(/⟨[^⟩]*⟩/g,'').trim();
    if(rest){prev.append(' ',...p.childNodes);p.remove();continue}
    const next=p.nextElementSibling;
    if(!next||next.tagName!=='P'||next.querySelector('img'))continue;
    prev.append(' ',...p.childNodes,' ',...next.childNodes);p.remove();next.remove();
  }
}

const searchText=node=>node.textContent.replace(/\s+/g,' ').trim();
function searchBlocks(root){return [...root.querySelectorAll('h1,h2,h3,h4,p,li,td,th,caption,figcaption,.book-caption,summary')].filter(n=>!n.closest('[data-reader-metadata]')&&!n.querySelector('p,li,td,th,details,h1,h2,h3,h4')&&searchText(n))}
// Only build-listed nodes are visited. Personal markup and user gestures never trigger a bidi scan.
function textKey(value){
  let hash=2166136261;
  for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);
  return (hash>>>0).toString(36);
}
function applyLayout(article,layout){
  if(!layout)return;
  const at=path=>path.reduce((node,index)=>node?.childNodes[index],article);
  const runs=layout.runs.map(([path,key,markup])=>[at(path),key,markup]);
  for(const [path,tag] of layout.dir){const el=at(path);if(el?.tagName===tag){el.dir='rtl';el.lang='he';}}
  const fragment=document.createElement('template');
  for(const [node,key,markup] of runs){
    if(node?.nodeType!==Node.TEXT_NODE||textKey(node.data)!==key)continue;
    fragment.innerHTML=markup;node.replaceWith(fragment.content);
  }
}
function placeExamQuestions(copy,exam){
  if(!exam)return;
  const introduction=[],questions=[];
  for(let el=exam.nextElementSibling;el&&!el.matches('h1,h2,h3,h4,.chapter-nav,.point-rail,.read-references');el=el.nextElementSibling){
    const number=el.matches('p')&&/^Q(\d+)\b/.exec(el.textContent.trim());
    if(number){
      const page=el.querySelector('a[href^="#p"]')?.getAttribute('href');
      const marker=page&&/^#p\d+$/.test(page)&&copy.querySelector(page);
      if(!marker)return;
      let anchor=marker;
      while(anchor.parentNode!==copy)anchor=anchor.parentNode;
      if(!anchor.textContent.replace(/\[p\.\s*\d+\]/g,'').trim()&&anchor.nextElementSibling?.matches('p'))anchor=anchor.nextElementSibling;
      questions.push({number:number[1],page:page.slice(2),anchor,nodes:[]});
    }
    (questions.length?questions[questions.length-1].nodes:introduction).push(el);
  }
  if(!questions.length)return;
  const lastAtPage=new Map();
  const source=document.createElement('details'),caption=document.createElement('summary');
  caption.append(exam);source.className='read-exam-source';source.append(caption,...introduction);
  for(const [i,{number,page,anchor,nodes}] of questions.entries()){
    const question=document.createElement('details'),summary=document.createElement('summary');
    question.className='read-inline-question';question.dataset.examNumber=number;question.dataset.printedPage=page;summary.dataset.readerMetadata='exam-heading';
    summary.textContent='2026 exam · Q'+number;
    question.append(summary,...nodes);
    if(i===0)question.append(source);
    (lastAtPage.get(anchor)||anchor).after(question);
    lastAtPage.set(anchor,question);
  }
}

// Keep the printed heading and its individual reference nodes. Moving these
// nodes after mark registration preserves their stable IDs and note anchors.
function formatReadEndMatter(copy,chapter){
  if(!/^\d+$/.test(String(chapter))||copy.querySelector(':scope > .read-references'))return;
  const headings=[...copy.querySelectorAll(':scope > :is(h1,h2,h3,h4)')];
  const references=headings.find(h=>/^further reading$/i.test(h.textContent.trim()));
  const exam=headings.find(h=>/^2026 exam\b/i.test(h.textContent.trim()));
  if(exam){
    for(let node=exam.nextElementSibling;node&&!/^H[1-4]$/.test(node.tagName);node=node.nextElementSibling){
      if(!node.matches('ul,ol'))continue;
      const options=[...node.children].filter(li=>li.tagName==='LI');
      if(!options.length||!options.every(li=>/^\s*[א-דA-D][.)]\s/.test(li.textContent)))continue;
      let stem=node.previousElementSibling;
      while(stem&&stem!==exam&&!/^(?:Q\d+|שאלה\s+\d+)/u.test(stem.textContent.trim()))stem=stem.previousElementSibling;
      if(stem===exam)stem=null;
      const substantive=(stem?.textContent.replace(/^Q\d+\s*.*?p\.\s*\d+(?:[–-]\d+)?\.\s*/iu,'')||'')+' '+options.map(li=>li.textContent.replace(/^\s*[א-דA-D][.)]\s*/u,'')).join(' ');
      const hebrew=(substantive.match(/[א-ת]/gu)||[]).length,latin=(substantive.match(/[a-z]/giu)||[]).length;
      const lang=hebrew>0&&hebrew>=latin/3?'he':'en',dir=lang==='he'?'rtl':'ltr',alphabet=lang==='he'?'אבגד':'ABCD';
      node.lang=lang;node.dir=dir;node.classList.add('read-exam-options');
      if(stem?.matches('p')){stem.lang=lang;stem.dir=dir;}
      const displayKeys=[];
      for(const li of options){
        li.lang=lang;li.dir=dir;
        const walker=document.createTreeWalker(li,NodeFilter.SHOW_TEXT);
        const texts=[];while(walker.nextNode())texts.push(walker.currentNode);
        const prefix=texts.find(t=>/^\s*[א-דA-D][.)]/u.test(t.data));
        if(!prefix)continue;
        const original=prefix.data.trimStart()[0],index='אבגד'.includes(original)?'אבגד'.indexOf(original):'ABCD'.indexOf(original);
        prefix.data=prefix.data.replace(/^(\s*)[א-דA-D]([.)])/u,'$1'+alphabet[index]+'$2');
        const labelNode=[...li.querySelectorAll('strong,b')].find(n=>/^key$/iu.test(n.textContent.trim()));
        if(labelNode&&/←\s*key\s*$/iu.test(li.textContent)){
          displayKeys.push(alphabet[index]);labelNode.remove();
          for(const t of texts)if(t.isConnected||li.contains(t))t.data=t.data.replace(/\s*←\s*$/u,'');
        }
      }
      if(displayKeys.length){
        const key=document.createElement('p');key.className='read-exam-key';key.lang=lang;key.dir=dir;
        key.dataset.readerMetadata='exam-key';key.textContent=(lang==='he'?'תשובה: ':'Key: ')+displayKeys.join(', ');
        node.after(key);
      }
    }
  }
  if(!references){placeExamQuestions(copy,exam);return;}
  const level=Number(references.tagName[1]),nodes=[];
  for(let next=references.nextSibling;next;next=next.nextSibling){
    if(next.nodeType===1){
      if(next.matches('.chapter-nav,.point-rail'))break;
      if(/^H[1-4]$/.test(next.tagName)&&Number(next.tagName[1])<=level){
        const title=next.textContent.trim();
        const referenceCategory=chapter==='36'&&/^(General|Breast|Pain|Vulva|Vagina|Cervix)$/i.test(title);
        if(!referenceCategory&&!/^selected websites$/i.test(title))break;
      }
    }
    nodes.push(next);
  }
  const disclosure=document.createElement('details'),label=document.createElement('summary');
  disclosure.className='read-references';label.append(references);disclosure.append(label,...nodes);
  const footer=copy.querySelector(':scope > .chapter-nav');if(footer)footer.before(disclosure);else copy.append(disclosure);
  placeExamQuestions(copy,exam);
}
function placeOpeningPage(copy,chapter){
  if(!/^\d+$/.test(chapter))return;
  const marker=copy.querySelector('a.pg[data-page]'),line=marker?.parentElement;
  if(!line?.matches('p')||line.parentElement!==copy||line.querySelectorAll('a.pg').length!==1)return;
  const contents=line.cloneNode(true);
  contents.querySelectorAll('[data-reader-metadata],.exam-page-badge,.exam-missed').forEach(el=>el.remove());
  if(contents.textContent.trim()||line.querySelector('img,table'))return;
  const cases=[];let paragraph=line.nextElementSibling;
  while(paragraph?.matches('h2,h3,h4,h5,h6,.read-inline-question')){
    if(paragraph.matches('.read-inline-question'))cases.push(paragraph);
    paragraph=paragraph.nextElementSibling;
  }
  if(!paragraph?.matches('p')||!paragraph.textContent.trim()||paragraph.querySelector('img,table,a.pg'))return;
  const evidence=line.querySelector(':scope > .exam-count');
  // The printed-page ID and existing quote offsets stay at the beginning of the page.
  // Only the visible marker follows the book's opening prose.
  line.classList.add('read-opening-page-source');
  if(!evidence?.dataset.caseLabel){
    const label=document.createElement('span');label.className='read-opening-page-label';label.dataset.readerMetadata='page';
    if(evidence)label.classList.add('has-exam-control');
    label.textContent='p'+marker.dataset.page;paragraph.append(label);
  }
  if(evidence)paragraph.append(evidence);
  paragraph.after(...cases);
}

// Run after mark registration. Source words keep their original order and unit IDs.
// The marked book prints major headings in capitals. For the reader's
// mixed-case presentation, retain medical names and use short internal words
// in lowercase. These exceptions follow the actual printed word forms.
const printedHeadingCase=new Map([
  ['55|Exercise/physical Activity','Exercise/physical activity'],
  ['81|Physiologic Impairments Resulting From Structural Changes In COPD','Physiologic Impairments Resulting from Structural Changes in COPD'],
  ['81|Covid-19 (SARS-Cov-2) And COPD','COVID-19 (SARS-CoV-2) and COPD'],
  ['83|Withdrawal From Dialysis','Withdrawal from Dialysis'],
  ['97|Hyponatremia And Syndrome Of Inappropriate Adh','Hyponatremia and Syndrome of Inappropriate ADH'],
  ['98|Physiologic Changes With Age','Physiologic Changes with Age'],
  ['101|Musculoskeletal Symptoms Associated With Cancer','Musculoskeletal Symptoms Associated with Cancer'],
  ['101|Risk Of Cancer With Immunosuppression','Risk of Cancer with Immunosuppression'],
  ['101|Covid-19 And Rheumatic Diseases','COVID-19 and Rheumatic Diseases'],
  ['105|Treatment Of Latent Tb','Treatment of Latent TB']
]);
function headingLabel(text,chapter){
  if(!/^\d+$/.test(chapter)||!/[a-z]/.test(text))return text;
  const printed=printedHeadingCase.get(chapter+'|'+text.trim().replace(/\s+/g,' '));
  if(printed){const words=printed.match(/[A-Za-z]+/g);let i=0;return text.replace(/[A-Za-z]+/g,()=>words[i++]);}
  return text.replace(/\b(?:A|An|And|As|At|By|For|In|Of|On|Or|The|To)\b/g,(word,i)=>{
    const before=text.slice(0,i);
    if(!before.trim()||/:\s*$/.test(before)||(text[i+word.length]==='-'&&text[i-1]!=='-'))return word;
    if(word==='A'&&!/\b(?:as|formulating)\s+$/i.test(before))return word;
    return word.toLowerCase();
  });
}
// Display book table headings in sentence case while retaining the printed
// source text for existing word ranges, abbreviations and proper names.
const tableHeadingLabels=new Map([
  'Screening activity','Attribute addressed','Functional implication','Factor of interest',
  'Reason for possible delay in rehabilitation','Factor','Effect','Score','Medication',
  'Mechanism/benefits','Side effects/adverse events/considerations','Clinical context/presentation',
  'Recommendations','≥ 1:80 titer on HEp-2 cells or an equivalent positive test',
  'Immunomodulatory therapy','Timing considerations for vaccination','Level of consensus',
  'Characteristics of frailty','Cardiovascular Health Study measure','Test','Description',
  'Class','Generic','Brand','Dose','Sedating','Alerting','Preserved cognition functions',
  'Cognitive functions showing decline','Type of dementia','Alzheimer disease','Vascular dementia',
  'Dementia with Lewy bodies','Frontotemporal dementia','AD pathology-related mechanism',
  'CSF measure','Mild','Moderate','Severe','Complication','Procedural risk (%)','Antibiotic','Dosage'
].map(label=>[label.toUpperCase(),label]));
function presentHeadingCase(copy,chapter){
  if(!/^\d+$/.test(chapter))return;
  for(const heading of copy.querySelectorAll('h2,h3,h4,h5,h6,th')){
    if(heading.closest('[data-reader-metadata]'))continue;
    const walker=document.createTreeWalker(heading,NodeFilter.SHOW_TEXT);
    const nodes=[];while(walker.nextNode()){const n=walker.currentNode;if(!n.parentElement.closest('[data-reader-metadata]'))nodes.push(n);}
    const original=nodes.map(n=>n.data).join(''),shown=heading.tagName==='TH'?(tableHeadingLabels.get(original)||original):headingLabel(original,chapter);
    if(shown===original)continue;
    // Paint only case differences. Unit text, quote offsets, and heading IDs
    // stay intact for highlights created before this presentation change.
    let offset=0;
    for(const node of nodes){
      const text=node.data,target=shown.slice(offset,offset+text.length);offset+=text.length;
      if(text===target)continue;
      const parts=document.createDocumentFragment();let begin=0;
      for(let i=0;i<text.length;i++){
        if(text[i]===target[i])continue;
        if(i>begin)parts.append(text.slice(begin,i));
        const transform=target[i]===text[i].toLowerCase()?'lowercase':'uppercase';
        const span=document.createElement('span');span.style.textTransform=transform;
        span.textContent=text[i];parts.append(span);begin=i+1;
      }
      if(begin<text.length)parts.append(text.slice(begin));node.replaceWith(parts);
    }
  }
}
function presentChapter(copy,chapter,title){
  if(copy.dataset.chapterPresentation||!title)return;
  const h1=copy.querySelector('h1');if(!h1)return;
  copy.dataset.chapterPresentation='true';copy.dataset.canonicalTitle=title;presentHeadingCase(copy,chapter);
  const base=chapter.replace(/s$/,''),nativeLaw=base==='law';
  const label=document.createElement('p');label.className='chapter-context';label.dataset.readerMetadata='chapter-context';
  label.textContent=(nativeLaw?title:'Chapter '+base)+' · '+(chapter.endsWith('s')?'Study':'Read');label.dir='ltr';
  h1.before(label);
  const original=h1.textContent.trim(),prefix=original.match(/^.*?\bChapter\s+\d+(?:\s+Study)?\s*[:–—-]\s*/i)?.[0]||'';
  if(prefix){
    let left=prefix.length;const walk=document.createTreeWalker(h1,NodeFilter.SHOW_TEXT),pieces=[];
    while(walk.nextNode()&&left>0){const n=walk.currentNode,len=Math.min(left,n.length);pieces.push([n,len]);left-=len;}
    for(const [n,len] of pieces){if(len<n.length)n.splitText(len);const span=document.createElement('span');span.className='book-heading-prefix';n.before(span);span.append(n);}
  }
  if(!nativeLaw&&original.slice(prefix.length).toLowerCase()!==title.toLowerCase()){
    const prior=document.createElement('span'),full=document.createElement('span');prior.className='book-heading-prior';
    prior.append(...h1.childNodes);full.dataset.readerMetadata='canonical-title';full.textContent=title;h1.append(prior,full);
  }
  h1.classList.add('chapter-canonical-title');
  for(const image of copy.querySelectorAll('p>img:only-child')){
    const p=image.parentElement;if(p.textContent.trim()||p.closest('figure,table,button,a'))continue;
    const figure=document.createElement('figure'),next=p.nextElementSibling;
    figure.className='reader-plate';p.before(figure);figure.append(p);
    const tag=image.alt.match(/^(?:fig(?:ure)?\.?|table)\s+\d+[-–.]\d+[a-z]?/i)?.[0];
    if(tag&&next?.matches('blockquote,p')&&next.textContent.trim().toLowerCase().startsWith(tag.toLowerCase())){
      const caption=document.createElement('figcaption');figure.append(caption);caption.append(next);
    }
  }
  // These original scans include the same printed captions as the chapter.
  // The dimensions stop in the verified white gutter above the caption. The
  // viewer always receives the complete original scan, including its legend.
  const crops={
    '42':[[759,900,561],[1346,873,731],[1346,811,604],[1240,1098,958],[1119,742,657]],
    '55':[[1346,405,224],[1340,817,609],[1340,877,637]]
  }[base];
  if(crops){
    for(const [i,[width,height,artHeight]] of crops.entries()){
      const name='hazzard8e_ch'+base+'_figure'+base+'-'+(i+1)+'.png',img=copy.querySelector('img[src$="/'+name+'"]');
      if(!img||Number(img.getAttribute('width'))!==width||Number(img.getAttribute('height'))!==height)continue;
      const label='FIGURE '+base+'-'+(i+1)+'.',caption=[...copy.querySelectorAll('p')].find(p=>p.textContent.trim().toUpperCase().startsWith(label));
      if(!caption)continue;
      const clip=document.createElement('span');clip.className='book-art-crop';clip.style.aspectRatio=width+' / '+artHeight;
      img.before(clip);clip.append(img);caption.classList.add('printed-figure-caption');
      const figcaption=img.closest('figure')?.querySelector('figcaption');
      if(figcaption?.contains(caption)){
        const details=caption.closest('details');
        if(details){details.open=true;if(base==='55')figcaption.classList.add('continuous-caption');}
      }
      else if(figcaption&&figcaption.textContent.trim().toLowerCase()==='figure '+base+'-'+(i+1))figcaption.dataset.imageLabelOnly='';
    }
  }
  for(const img of copy.querySelectorAll('img:not(a img,button img)')){
    img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-haspopup','dialog');
    img.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();img.click();}});
  }
  for(const note of copy.querySelectorAll('.study-current-practice,blockquote,.note')){
    if(!/^(?:current (?:practice|guidance|clinical distinction)|\[sic\b)/i.test(note.textContent.trim()))continue;
    note.classList.add('reader-guidance');
    for(const p of note.querySelectorAll(':scope>p,:scope>.note>p')){
      if(!p.querySelector('a[href]')||p.closest('.clinical-sources'))continue;
      const sourceLine=/^sources?\s*:/i.test(p.textContent.trim());
      let first=null;
      if(!sourceLine){
        // Keep the clinical sentence intact. Only a terminal run of external
        // citations and their original separators enters the source disclosure.
        for(let node=p.lastChild;node;node=node.previousSibling){
          if(node.nodeType===1&&node.matches('a[href]')&&node.origin!==location.origin)first=node;
          else if(!/^[\s.·,;:()–—-]*$/u.test(node.textContent))break;
        }
        if(!first)continue;
      }
      const details=document.createElement('details'),summary=document.createElement('summary');details.className='clinical-sources';
      summary.dataset.readerMetadata='source-label';summary.textContent='Sources';details.append(summary);
      if(sourceLine){p.before(details);details.append(p);}
      else{p.after(details);for(let node=first;node;){const next=node.nextSibling;details.append(node);node=next;}}
      details.open=!!details.querySelector('[data-marked],[data-mark-key]');
    }
  }
}
return {renderMarkdown,smoothPageMarkers,searchText,searchBlocks,textKey,applyLayout,formatReadEndMatter,placeOpeningPage,presentChapter,headingLabel};
})();
