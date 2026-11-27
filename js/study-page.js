/* Study disclosures preserve the printed order of headings and text. */
window.HazzardStudyPage = (() => {
  const repeats = new WeakMap();
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const generated = '[data-reader-metadata]';
  function sourceText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(text) {
        return text.parentElement.closest(generated) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let text = '', part;
    while ((part = walker.nextNode())) text += part.data;
    return normalize(text);
  }

  function family(text) {
    if (/^(?:what (?:the )?exams? asked|(?:\d{4} )?exam questions?|past[- ](?:paper|exam) questions?)\b/i.test(text)) return 'exams';
    if (/^exam traps?\b/i.test(text)) return 'traps';
    if (/^(?:recall|(?:chapter |self[- ])?drill|\u05ea\u05e8\u05d2\u05d5\u05dc)(?:\s|$|[:—–-])/i.test(text)) return 'recall';
    if (/^(?:israeli? context|in israel)\b/i.test(text)) return 'israel';
    if (/^(?:summary|\u05e1\u05d9\u05db\u05d5\u05dd)$/i.test(text)) return 'summary';
    return null;
  }

  // Some older notes place the printed rule and the labelled update in one
  // list item, occasionally split by the user's highlight markup. Keep every
  // fragment in its original mark unit, including the first piece of text.
  function practiceDisclosure(){
    const details=document.createElement('details'), summary=document.createElement('summary');
    details.className='study-current-practice';
    summary.dataset.readerMetadata='study-heading';
    summary.textContent='Current practice';
    details.append(summary);
    return details;
  }
  function foldInline(paragraph,label,register){
    const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);
    const start=paragraph.textContent.search(label);
    let offset=0,node;
    while(node=walker.nextNode()){
      if(offset+node.length<=start){offset+=node.length;continue;}
      const range=document.createRange();
      range.setStart(node,start-offset);range.setEnd(paragraph,paragraph.childNodes.length);
      const suffix=range.extractContents(),details=practiceDisclosure();
      details.append(suffix);paragraph.append(details);
      // extractContents clones an inline ancestor only when the cut divides it.
      // Both halves continue to belong to the same saved sentence.
      for(const part of details.querySelectorAll('span[data-unit]'))register(part);
      return;
    }
  }

  function foldPractice(copy,register) {
    if(structured(copy)){
      for(const note of copy.querySelectorAll('.note')){
        const title=note.querySelector('p:first-child>strong:first-child');
        if(!title?.textContent.startsWith('Current practice: '))continue;
        const details=practiceDisclosure();
        details.firstElementChild.textContent=title.textContent.replace(/\.$/,'');
        title.hidden=true;note.before(details);details.append(note);
      }
      return;
    }
    const labelled = /(?:current practice\s*\(not the book\)|current guidance\s*\(separate from the book\)|current clinical distinction)\s*[:.]/i;
    for (const paragraph of copy.querySelectorAll('p,li')) {
      if (paragraph.closest(generated + ',summary,.study-current-practice,.study-inline-body') || paragraph.querySelector('p,li')) continue;
      const at = sourceText(paragraph).search(labelled);
      if (at < 0) continue;
      if (at > 0) { foldInline(paragraph, labelled, register); continue; }
      const note = paragraph.parentElement.matches('.note,blockquote') && paragraph.parentElement.childElementCount === 1 ? paragraph.parentElement : paragraph;
      const details = practiceDisclosure();
      if (note.tagName === 'LI') {
        details.append(...note.childNodes);
        note.append(details);
      } else {
        note.before(details);
        details.append(note);
      }
    }
  }

  function signature(node) {
    // Never conflate similar doses, different printed pages or distinct answer
    // keys. Source destinations and image URLs are part of the identity.
    const links = [...node.querySelectorAll('a[href],img')].filter(n => !n.closest(generated))
      .map(n => n.getAttribute('href') ?? n.dataset.src ?? n.getAttribute('src'));
    return JSON.stringify([sourceText(node), links]);
  }

  function mergeRepeats(copy) {
    const seen = new Map();
    for (const node of copy.querySelectorAll('.study-group p, .study-group li')) {
      if (node.hidden || !node.closest('.study-group') || node.closest(generated)) continue;
      if (node.closest('.study-current-practice,.drill-q,table') || node.querySelector('p,li,details,button,input')) continue;
      const text = sourceText(node);
      if (text.length < 32 && !node.querySelector('a[href]')) continue;
      const kind = node.closest('.study-group').dataset.studyGroup;
      const key = kind + ':' + signature(node);
      const first = seen.get(key);
      if (!first) { seen.set(key, node); continue; }
      const set = repeats.get(first) || {shown:first, items:[first]};
      set.items.push(node); repeats.set(first, set); repeats.set(node, set);
      // A preexisting saved mark takes precedence over an unmarked twin.
      if (node.querySelector('[data-marked]') && !set.shown.querySelector('[data-marked]')) {
        set.shown.hidden = true; set.shown = node;
      } else node.hidden = true;

    }
  }

  function reveal(target) {
    const raw = target instanceof Range ? target.startContainer : target;
    const el = raw?.nodeType === Node.TEXT_NODE ? raw.parentElement : raw;
    if (!el?.closest?.('.study-page')) return target;
    for (let node = el; node && !node.matches('.study-page'); node = node.parentElement) {
      const repeat = repeats.get(node);
      if (repeat && repeat.shown !== node) {
        for (const twin of repeat.items) {
          twin.hidden = twin !== node;
        }
        repeat.shown = node;
      }
      if (node.tagName === 'DETAILS') node.open = true;
    }
    return target;
  }

  function indexBookObjects(copy,chapter) {
    const n=String(chapter);
    if(!/^\d+$/.test(n))return;
    const label=new RegExp('^(?:\\[p\\.\\s*\\d+\\]\\s*)?(table|figure|fig\\.)\\s*('+n+')\\s*[-–—.]\\s*(\\d+[a-z]?)\\b','i');
    const ids=new Set();
    function anchor(node,match){
      if(!match)return;
      const id='book-'+(match[1].toLowerCase()==='table'?'table':'figure')+'-'+match[2]+'-'+match[3].toLowerCase();
      if(ids.has(id)||copy.querySelector('#'+CSS.escape(id)))return;
      ids.add(id);
      if(!node.id){node.id=id;return;}
      const spot=document.createElement('span');spot.id=id;spot.dataset.readerMetadata='book-reference';spot.className='book-reference-target';
      node.before(spot);
    }
    for(const img of copy.querySelectorAll('img')){
      const fig=img.closest('figure')||img,caption=fig.querySelector('figcaption');
      const filename=(img?.dataset.src||img?.getAttribute('src')||'').split('/').pop();
      const match=[img?.alt,caption?.textContent,filename?.replace(/^.*?(table|figure|fig)[_-]?/i,'$1 ').replace(/_/g,'-')].filter(Boolean).map(t=>t.trim().match(label)).find(Boolean);
      anchor(fig,match);
    }
    for(const caption of copy.querySelectorAll('p>strong,p>b')){
      const text=caption.textContent.trim(),match=text.match(label);
      if(match&&(/^[^—■]+\s*[—■]/.test(text)||text.toLowerCase()===match[0].toLowerCase()))anchor(caption.parentElement,match);
    }
    for(const el of copy.querySelectorAll('caption,h2,h3,h4,h5,p,dt')){
      if(el.closest('[data-reader-metadata],figure,blockquote,.note'))continue;
      const match=el.textContent.trim().match(label);if(!match)continue;
      const first=el.querySelector('strong,b');
      const table=el.nextElementSibling?.matches('table,.table-wrap,[data-table],.table-open')||el.nextElementSibling?.querySelector('table,img');
      if(el.tagName!=='P'||first?.textContent.trim().match(label)||table)anchor(el,match);
    }
  }

  const wordingByPage=new WeakMap();
  function usesPrior(rule,saved){
    return Object.values(saved.ranges||{}).some(mark=>{
      const quote=normalize(mark.text||'');
      return quote.length>=24 && !rule.current.includes(quote) && rule.prior.includes(quote);
    });
  }
  function prepareWording(copy,saved){
    const rules=[];
    for(const template of copy.querySelectorAll('template[data-study-prior]')){
      const span=copy.querySelector('[data-study-phrase="'+CSS.escape(template.dataset.studyPrior)+'"]');
      if(!span)continue;
      const rule={current:normalize(span.textContent),prior:normalize(template.content.textContent)};
      rule.applied=usesPrior(rule,saved);
      if(rule.applied)span.replaceChildren(template.content.cloneNode(true));
      template.remove();rules.push(rule);
    }
    if(rules.length)wordingByPage.set(copy,rules);
  }
  function needsPriorWording(copy,saved){return wordingByPage.get(copy)?.some(rule=>!rule.applied&&usesPrior(rule,saved))||false;}
  function structured(copy) {
    return !!copy?.querySelector('[data-study-template="2"]');
  }
  function mountStructured(copy) {
    copy.classList.add('study-v2');
    const headings=[...copy.querySelectorAll(':scope > h2')];
    const numbers=headings.find(h=>sourceText(h)==='Key numbers');
    if(numbers){
      const box=document.createElement('aside');box.className='study-numbers';
      numbers.before(box);box.append(numbers);
      while(box.nextElementSibling&&!box.nextElementSibling.matches('h2,.chapter-nav'))box.append(box.nextElementSibling);
    }
    const test=headings.find(h=>sourceText(h)==='Test yourself');
    if(test){
      const details=document.createElement('details'),summary=document.createElement('summary');
      details.className='study-test';test.before(details);summary.append(test);details.append(summary);
      while(details.nextSibling&&!details.nextSibling.matches?.('h2,.chapter-nav'))details.append(details.nextSibling);
    }
  }


  function mount(copy, chapter) {
    if (!copy || !/^(?:\d+s|laws)$/.test(String(chapter)) || copy.dataset.notLoaded || copy.classList.contains('study-page')) return;
    copy.classList.add('study-page');
    if(structured(copy)){mountStructured(copy);return;}
    // Native disclosures keep the visual, keyboard and quote orders identical.
    // Clinical headings and their teaching remain at their published position.
    for(const heading of [...copy.querySelectorAll(':scope > h2')]){
      const group=family(sourceText(heading));
      if(!group)continue;
      const details=document.createElement('details'),summary=document.createElement('summary');
      details.className='study-group';details.dataset.studyGroup=group;
      details.open=group==='summary';heading.before(details);summary.append(heading);details.append(summary);
      while(details.nextSibling&&!details.nextSibling.matches?.('h2,.chapter-nav,.study-flashcards,.law-cards,.article-cards'))details.append(details.nextSibling);
    }
    mergeRepeats(copy);
  }
  return {mount, reveal, foldPractice, indexBookObjects, structured, prepareWording, needsPriorWording};
})();
