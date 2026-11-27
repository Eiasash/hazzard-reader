/* Source-cited study metadata; deliberately outside saved highlight/drill units. */
window.HazzardLawCards = (() => {
  let promise;
  // Keep parentheses, section signs, suffixes and subclauses in one LTR run.
  const subclause=/\((?:\d+|[\u05d0-\u05ea]{1,3})\)/.source;
  const section=/\d+[\u05d0-\u05ea]{0,3}/.source+'(?:'+subclause+')*';
  const sections=/\u00a7{1,2}[ \t]*/.source+section+'(?:'+/[ \t]*[,/–—-][ \t]*/.source+'(?:'+section+'|'+subclause+'))*';
  const locators=new RegExp('\\('+sections+'\\)|'+sections,'gu');
  const numberList=/\d+(?:[.\-–/]\d+)*(?:,\s*\d+(?:[.\-–/]\d+)*)*/u;
  const englishLocators=new RegExp(locators.source+'|'+numberList.source,'gu');
  function isolateLocators(root,pattern=locators){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode())if((pattern===englishLocators||walker.currentNode.data.includes('\u00a7'))&&!walker.currentNode.parentElement?.closest('bdi,script,style,textarea'))nodes.push(walker.currentNode);
    for(const node of nodes){
      const fragment=document.createDocumentFragment();let offset=0;
      for(const match of node.data.matchAll(pattern)){
        const bdi=document.createElement('bdi');bdi.dir='ltr';bdi.textContent=match[0];
        fragment.append(node.data.slice(offset,match.index),bdi);offset=match.index+match[0].length;
      }
      if(offset){fragment.append(node.data.slice(offset));node.replaceWith(fragment);}
    }
  }
  function cardText(node,value,layout){
    const runs=layout[value];
    if(!runs){node.append(document.createTextNode(value));return;}
    const [rtl,parts,baseLanguage]=runs;
    if(baseLanguage==='en'){
      node.dir='ltr';node.lang='en';
      // The native paragraph algorithm orders the Hebrew terms in English prose.
      node.append(document.createTextNode(value));isolateLocators(node,englishLocators);HazzardChapterContent.formatHebrewReferences(node);return;
    }
    if(rtl){node.dir='rtl';node.lang='he';}
    parts.forEach((part,i)=>{
      if(!part)return;
      if(!(i%2)){node.append(document.createTextNode(part));return;}
      const run=document.createElement('bdi');run.dir='ltr';if(/[A-Za-z]/.test(part))run.lang='en';run.textContent=part;node.append(run);
    });
  }
  function read() {
    return promise ||= Promise.all(['data/law-cards.json','data/law-card-layout.json'].map(path=>fetch(path).then(response => {
      if (!response.ok) throw Error('Law cards unavailable. Reconnect and retry.');
      return response.json();
    }))).then(([data,layout])=>({...data,layout})).catch(error => { promise = null; throw error; });
  }
  const isHarrisonCard = card => card.id.startsWith('ima-harrison-') && card.id !== 'ima-harrison-22e';
  async function questionLinks(host, id, question, studyOnly = false) {
    try {
      const data = await read();
      if (host.dataset.bankId !== id || !host.querySelector('.mcq-result')) return;
      const citations = host.querySelector('.mcq-citations');
      const harrisonCards = data.cards.filter(card => teaches(card) && isHarrisonCard(card) && (card.id === question?.chapter || card.questions.some(q => q.id === id)));
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
      for (const card of [...data.cards, ...(data.articles?.cards || [])].filter(c => teaches(c) && !isHarrisonCard(c) && (c.imaItem || c.articleItem || c.citedInPastPapers || c.questions.some(q => q.id === id && q.showBasis)) && c.questions.some(q => q.id === id))) {
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
  function teaches(card){
    return !card.companionOf&&card.id!=='ima-harrison-22e'&&!/^not read/i.test(card.coverage||'')&&card.bullets?.some(t=>t.trim());
  }
  function sourceURL(id){return '?chapter=laws&lawCard='+encodeURIComponent(id)+'#law-card-'+encodeURIComponent(id);}
  function sourcesFor(card,layout){
    const details=document.createElement('details');details.className='law-sources';details.dataset.readerMetadata='source';
    const label=document.createElement('summary');label.textContent='Sources';details.append(label);
    for(const item of card.sources||[]){
      const line=document.createElement('p'),name=item.url&&/^https?:\/\//i.test(item.url)?document.createElement('a'):document.createElement('span');
      if(name.tagName==='A')name.href=item.url;cardText(name,item.document,layout);
      if(item.locator){name.append(' — ');cardText(name,item.locator,layout);}line.append(name);details.append(line);
    }
    for(const text of [card.provenance,card.editionNotice,card.gap].filter(Boolean)){
      const p=document.createElement('p');cardText(p,text,layout);details.append(p);
    }
    for(const q of card.questions||[]){
      if(!q.showBasis&&!q.editionComparison)continue;
      const p=document.createElement('p');p.append(HazzardEvidence.label(q)+' — ');
      cardText(p,[q.showBasis&&q.basis,q.editionComparison].filter(Boolean).join(' '),layout);details.append(p);
    }
    return details.childElementCount>1?details:null;
  }
  function lesson(card,layout){
    const section=document.createElement('section');section.id='law-card-'+card.id;section.className='law-lesson';
    const heading=document.createElement('h2');cardText(heading,card.title,layout);section.append(heading);
    const list=document.createElement('ul');for(const text of new Set(card.bullets)){
      if(!text.trim())continue;
      const li=document.createElement('li');cardText(li,text,layout);list.append(li);
    }
    section.append(list);
    if(card.questions?.length){const asked=HazzardEvidence.askedBadge(card.questions.map(q=>[q.id,q]),card.title);asked.classList.remove('exam-links');section.append(asked);}
    const source=sourcesFor(card,layout);if(source)section.append(source);
    return section;
  }
  function sourceIndex(cards,selected){
    const details=document.createElement('details'),heading=document.createElement('summary');
    details.dataset.readerMetadata='source-index';details.className='law-source-index';heading.textContent='Clinical sources';details.append(heading);
    details.addEventListener('toggle',()=>{
      if(!details.open||details.childElementCount>1)return;
      const list=document.createElement('ul');
      for(const card of cards){
        if(card.id===selected)continue;
        const li=document.createElement('li'),a=document.createElement('a');a.href=sourceURL(card.id);a.textContent=card.title;li.append(a);list.append(li);
      }
      details.append(list);
    });
    return details;
  }
  async function decorate(copy,selected='',saved={}){
    if(copy.dataset.chapterId!=='laws'||copy.querySelector('.law-lessons'))return;
    const data=await read(),all=[...data.cards,...data.articles.cards],byId=new Map(all.map(c=>[c.id,c]));
    let requested=byId.get(selected);if(requested?.companionOf)requested=byId.get(requested.companionOf);
    const clinical=c=>isHarrisonCard(c)||!!c.articleItem||data.articles.cards.includes(c);
    const extra=all.filter(c=>teaches(c)&&clinical(c));
    const focus=requested&&teaches(requested)&&clinical(requested)?requested:null;
    const wrap=document.createElement('div');wrap.className='law-lessons';copy.dataset.lawSource=selected;
    const quotes=[...Object.values(saved?.ranges||{}),...Object.values(saved?.marks||{})].map(m=>m.text?.trim()).filter(Boolean);
    for(const card of all){
      if(!teaches(card))continue;
      const show=focus?card.id===focus.id:!clinical(card);
      if(!show&&!quotes.some(q=>card.bullets.some(t=>t.includes(q))))continue;
      const section=lesson(card,data.layout);section.hidden=!show;
      for(const alias of all.filter(c=>c.companionOf===card.id)){const spot=document.createElement('span');spot.id='law-card-'+alias.id;spot.dataset.readerMetadata='alias';section.prepend(spot);}
      wrap.append(section);
    }
    if(focus){
      const back=document.createElement('a');back.href='?chapter=laws';back.textContent='Israeli law';back.dataset.readerMetadata='source';wrap.prepend(back);
    }else if(extra.length)wrap.append(sourceIndex(extra));
    const nav=copy.querySelector('.chapter-nav');if(nav)nav.before(wrap);else copy.append(wrap);
  }


  return {decorate, questionLinks, isolateLocators};
})();
