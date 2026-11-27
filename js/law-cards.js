/* Source-cited study metadata; deliberately outside saved highlight/drill units. */
window.HazzardLawCards = (() => {
  let promise;
  // Keep parentheses, section signs, suffixes and subclauses in one LTR run.
  const subclause=/\((?:\d+|[\u05d0-\u05ea]{1,3})\)/.source;
  const section=/\d+[\u05d0-\u05ea]{0,3}/.source+'(?:'+subclause+')*';
  const sections=/\u00a7{1,2}[ \t]*/.source+section+'(?:'+/[ \t]*[,/–—-][ \t]*/.source+'(?:'+section+'|'+subclause+'))*';
  const locators=new RegExp('\\('+sections+'\\)|'+sections,'gu');
  function isolateLocators(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode())if(walker.currentNode.data.includes('\u00a7')&&!walker.currentNode.parentElement?.closest('bdi,script,style,textarea'))nodes.push(walker.currentNode);
    for(const node of nodes){
      const fragment=document.createDocumentFragment();let offset=0;
      for(const match of node.data.matchAll(locators)){
        const bdi=document.createElement('bdi');bdi.dir='ltr';bdi.textContent=match[0];
        fragment.append(node.data.slice(offset,match.index),bdi);offset=match.index+match[0].length;
      }
      if(offset){fragment.append(node.data.slice(offset));node.replaceWith(fragment);}
    }
  }
  // Keep the visible LTR run intact even when a link or a saved mark ends
  // between its last digit and punctuation. Generated controls add no text
  // to the chapter, its links or the character offsets in a saved highlight.
  function watchNumberRanges(root){
    const block='p,li,td,th,summary,h1,h2,h3,h4,h5,h6,button,figcaption,blockquote,div,section';
    const skip='bdi,script,style,textarea,input,option,svg,[contenteditable="true"]';
    const pattern=/(?<![\d.])\d+(?:[.,]\d+)?(?:[ \t]*[–—−-][ \t]*\d+(?:[.,]\d+)?)+(?:[%‰])?[.,;:!?]*(?!\d)/gu;
    const latin=/\p{Script=Latin}[\p{Script=Latin}\p{M}\d]*(?:(?:[-’'/_.:]|[ \t]+|,[ \t]+)[\p{Script=Latin}\d][\p{Script=Latin}\p{M}\d]*)*/u;
    const date=/\d{1,2}\.\d{1,2}\.\d{4}/u;
    const mixed=new RegExp([pattern.source,date.source,latin.source].join('|'),'gu');
    const hebrew=/[\u0590-\u05ff]/u;
    function hebrewLed(el){
      return el.matches('p,li')&&el.closest('.reading-copy')&&hebrew.test(el.textContent.match(/\p{L}/u)?.[0]||'');
    }
    function format(el){
      const text=el.textContent;
      if(!/[\u0590-\u05ff]/u.test(text)&&!el.matches(':dir(rtl)'))return;
      const paragraph=hebrewLed(el);
      if(paragraph){el.dir='rtl';el.lang='he';}
      const nodes=[],walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      let line='',n;
      while(n=walk.nextNode()){
        if(n.parentElement.closest(skip)||n.parentElement.closest(block)!==el){line+='\0';continue;}
        nodes.push([n,line.length]);line+=n.data;
      }
      for(const m of [...line.matchAll(paragraph?mixed:pattern)].reverse()){
        const lo=m.index,hi=lo+m[0].length;
        for(const [node,offset] of nodes){
          const a=Math.max(0,lo-offset),b=Math.min(node.length,hi-offset);
          if(b<=a||node.parentElement.closest('[data-bidi-edge]'))continue;
          const first=offset+a===lo,last=offset+b===hi;
          const english=paragraph&&/\p{Script=Latin}/u.test(m[0]);
          const span=document.createElement(paragraph&&first&&last?'bdi':'span');
          if(span.tagName==='BDI')span.dir='ltr';
          if(english)span.lang='en';
          span.dataset.bidiEdge=first&&last?'both':first?'start':last?'end':'middle';
          const part=a?node.splitText(a):node;
          if(b-a<part.length)part.splitText(b-a);
          part.before(span);span.append(part);
        }
      }
    }
    const candidates=new Set();
    function collect(node){
      if(node.nodeType===Node.TEXT_NODE){
        if((hebrew.test(node.data)||(/[A-Za-z]/.test(node.data)&&node.parentElement?.closest('p[lang="he"],li[lang="he"]')))&&!node.parentElement?.closest(skip+',[data-bidi-edge]')){
          const paragraph=node.parentElement?.closest('p,li');
          if(paragraph?.closest('.reading-copy')){
            candidates.add(paragraph);
            const li=paragraph.parentElement?.closest('li');if(li)candidates.add(li);
          }
        }
        if(/[\d–—-]/.test(node.data)&&!node.parentElement?.closest(skip+',[data-bidi-edge]')){
          const el=node.parentElement?.closest(block);if(el)candidates.add(el);
        }
      }else if(node.nodeType===Node.ELEMENT_NODE&&!node.matches(skip+',[data-bidi-edge]')&&/[\u0590-\u05ff]/u.test(node.textContent)){
        if(hebrewLed(node))candidates.add(node);
        for(const child of node.querySelectorAll('p,li'))if(hebrewLed(child))candidates.add(child);
        const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);while(w.nextNode())collect(w.currentNode);
      }
    }
    function flush(){for(const el of candidates)if(el.isConnected&&(hebrewLed(el)||/[–—−-]/.test(el.textContent)))format(el);candidates.clear();}
    collect(root);flush();
    new MutationObserver(changes=>{
      for(const m of changes){
        if(m.type==='characterData')collect(m.target);
        else for(const n of m.addedNodes)collect(n);
      }
      flush();
    }).observe(root,{childList:true,subtree:true,characterData:true});
  }

  function read() {
    return promise ||= fetch('data/law-cards.json').then(response => {
      if (!response.ok) throw Error('Law cards unavailable. Reconnect and retry.');
      return response.json();
    }).catch(error => { promise = null; throw error; });
  }
  const isHarrisonCard = card => card.id.startsWith('ima-harrison-') && card.id !== 'ima-harrison-22e';
  async function questionLinks(host, id, question, studyOnly = false) {
    try {
      const data = await read();
      if (host.dataset.bankId !== id || !host.querySelector('.mcq-result')) return;
      const citations = host.querySelector('.mcq-citations');
      const harrisonCards = data.cards.filter(card => isHarrisonCard(card) && (card.id === question?.chapter || card.questions.some(q => q.id === id)));
      if (citations) for (const card of harrisonCards.filter(card => !harrisonCards.some(other => other.id === card.id + '-cited-pages'))) {
        if (citations.querySelector('[data-harrison-card="' + card.id + '"]')) continue;
        const line = document.createElement('p'); line.className = 'meta mcq-harrison-study'; line.dataset.harrisonCard = card.id;
        const link = document.createElement('a');
        link.href = '?chapter=laws&lawCard=' + encodeURIComponent(card.id) + '#law-card-' + encodeURIComponent(card.id);
        link.textContent = 'Study: ' + card.title;
        line.append(link); citations.append(line);
      }
      if (studyOnly || host.querySelector('.law-question-links')) return;
      const links = document.createElement('div'); links.className = 'exam-evidence law-question-links';
      for (const card of [...data.cards, ...(data.articles?.cards || [])].filter(c => !isHarrisonCard(c) && (c.imaItem || c.articleItem || c.citedInPastPapers || c.questions.some(q => q.id === id && q.showBasis)) && c.questions.some(q => q.id === id))) {
        const link = document.createElement('a'); link.dir = 'auto';
        link.href = '?chapter=laws&lawCard=' + encodeURIComponent(card.id) + '#law-card-' + encodeURIComponent(card.id);
        link.textContent = card.id.startsWith('valve-') ? 'Study: ' + card.title : (card.articleItem ? 'IMA article ' + card.articleItem : card.imaItem ? 'IMA ' + card.imaItem : 'Cited source') + ' · ' + card.title;
        const question=card.questions.find(q=>q.id===id);
        if(question.note)link.textContent+=' · '+question.note;
        links.append(link);
      }
      if (links.childElementCount) (host.querySelector('.mcq-citations') || host).append(links);
    } catch { /* The question remains usable if optional card metadata is unavailable. */ }
  }
  async function decorate(copy) {
    if (copy.dataset.chapterId !== 'laws' || copy.querySelector('.law-cards')) return;
    await decoratePanel(copy, false);
    await decoratePanel(copy, true);
  }
  async function decoratePanel(copy, articles) {
    const panel = document.createElement('details');
    panel.className = 'law-cards' + (articles ? ' article-cards' : ''); panel.dataset.readerMetadata = articles ? 'article-cards' : 'law-cards';
    const summary = document.createElement('summary'); summary.textContent = articles ? 'Articles: required and additional reading' : 'Law cards · IMA required reading';
    const body = document.createElement('div'); body.className = 'law-cards-body';
    panel.append(summary, body);
    if (articles) copy.querySelector('.law-cards').after(panel);
    else copy.prepend(panel);
    async function load() {
      body.textContent = articles ? 'Loading required articles…' : 'Loading law cards…';
      try {
        const data = await read();
        const fragment = document.createDocumentFragment();
        if (articles ? data.articles : data.requiredReading) {
          const note = document.createElement('p'); note.className = 'law-card-source';
          note.textContent = articles ? data.articles.note : data.requiredReading.document + ' · pp. 2–3. ' + data.requiredReading.note;
          fragment.append(note);
        }
        let pastPaperHeading = false;
        for (const card of [...(articles ? data.articles.cards : data.cards)].sort((a,b) => (a.imaItem || a.articleItem || 100) - (b.imaItem || b.articleItem || 100))) {
          if (card.citedInPastPapers && !pastPaperHeading) {
            const heading = document.createElement('h2'); heading.dir = 'ltr';
            heading.textContent = 'Additional cited reading';
            fragment.append(heading); pastPaperHeading = true;
          }
          const numbered = card.imaItem || card.articleItem;
          const collapsible=articles || numbered || card.requiredBook || card.citedInPastPapers;
          const section = document.createElement(collapsible ? 'details' : 'section'); section.className = 'law-card';
          section.id = 'law-card-' + card.id;
          if (collapsible) section.dir = card.direction || 'rtl';
          const heading = document.createElement(collapsible ? 'summary' : 'h2');
          heading.textContent = (numbered ? numbered + '. ' : '') + card.title + (card.coverage ? ' · ' + card.coverage : '');
          const list = document.createElement('ul');
          for (const text of card.bullets) {
            const line = document.createElement('li'); line.textContent = text; list.append(line);
          }
          section.append(heading);
          if (card.editionNotice) {
            const notice = document.createElement('p'); notice.className = 'law-card-gap';
            notice.dir = 'ltr'; notice.textContent = card.editionNotice; section.append(notice);
          }
          section.append(list);
          if (card.provenance) {
            const provenance = document.createElement('p'); provenance.className = 'law-card-source';
            provenance.dir = 'ltr'; provenance.textContent = card.provenance; section.append(provenance);
          }
          if (card.gap) {
            const gap = document.createElement('p'); gap.className = 'law-card-gap'; gap.textContent = card.gap;
            section.append(gap);
          }
          for (const source of card.sources) {
            const line = document.createElement('p'); line.className = 'law-card-source';
            line.textContent = 'Source: ' + source.document + ' — ' + source.locator;
            section.append(line);
          }
          if (card.questionHeading) {
            const heading = document.createElement('h3'); heading.dir = 'ltr';
            heading.textContent = card.questionHeading; section.append(heading);
          }
          const links = document.createElement('div'); links.className = 'exam-evidence';
          for (const question of card.questions) {
            const link = document.createElement('a');
            link.href = HazzardEvidence.questionURL(question.id);
            link.textContent = 'Asked: ' + HazzardEvidence.label(question);
            if(question.note)link.textContent+=' · '+question.note;
            link.title = question.reference;
            links.append(link);
            if (question.showBasis && question.basis) {
              const basis = document.createElement('p'); basis.className = 'law-card-source';
              basis.dir = 'ltr'; basis.textContent = 'Basis: ' + question.basis; links.append(basis);
            }
            if (question.editionComparison) {
              const comparison = document.createElement('p'); comparison.className = 'law-card-source';
              comparison.dir = 'ltr'; comparison.textContent = question.editionComparison; links.append(comparison);
            }
          }
          if (card.questions.length) section.append(links);
          else if (!card.requiredBook) {
            const note = document.createElement('p'); note.className = 'law-card-source';
            note.textContent = 'No matching official question identified for this item.';
            section.append(note);
          }
          fragment.append(section);
        }
        if (articles) for (const entry of data.articles.entries) {
          const row = document.createElement('section'); row.className = 'law-card';
          const heading = document.createElement('h2'); heading.textContent = entry.title + ' — ' + entry.status;
          const source = document.createElement('p'); source.className = 'law-card-source'; source.textContent = entry.provenance;
          row.append(heading, source); fragment.append(row);
        }
        for (const line of fragment.querySelectorAll('.law-card-source')) line.dir = 'auto';
        isolateLocators(fragment);
        body.replaceChildren(fragment);
        const selected = new URL(location.href).searchParams.get('lawCard');
        const target = selected && [...body.children].find(e => e.id === 'law-card-' + selected);
        if (target) {
          panel.open = true;
          if (target.tagName === 'DETAILS') target.open = true;
          requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
        }
      } catch (error) {
        const message = document.createElement('p'); message.setAttribute('role', 'alert');
        message.textContent = error.message || 'Required reading could not be loaded.';
        const retry = document.createElement('button'); retry.textContent = articles ? 'Retry required articles' : 'Retry law cards';
        retry.onclick = load; body.replaceChildren(message, retry);
      }
    }
    await load();
  }
  return {decorate, questionLinks, isolateLocators, watchNumberRanges};
})();
