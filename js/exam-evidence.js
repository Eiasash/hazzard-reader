/* Citation metadata is separate from imported questions and answer stores. */
window.HazzardEvidence = (() => {
  let promise, referencePromise;
  function references() {
    return referencePromise ||= fetch('data/mcq/exam-references.json').then(r=>{
      if (!r.ok) throw Error('Exam references unavailable. Reconnect and reload.');
      return r.json();
    }).catch(e=>{referencePromise=null;throw e;});
  }
  function load() {
    return promise ||= Promise.all([references(),HazzardQuestionData.catalog()]).then(([data,bank]) => {
      const all=bank;data.currentChapters={};
      for(const q of all)if(!q.retired&&q.chapter!=null)(data.currentChapters[String(q.chapter)]||=[]).push(q.id);
      // A bibliography can cite two chapters or name one chapter and print a page in another.
      for(const [chapter, membership] of Object.entries(data.study)){
        data.currentChapters[chapter]=[...new Set([...(data.currentChapters[chapter]||[]),...membership.ids])];
      }
      return data;
    }).catch(e => { promise = null; throw e; });
  }
  const sittingLabel = sitting => {const [year,month]=sitting.split('-');const months={Jan:'January',Feb:'February',Mar:'March',Apr:'April',May:'May',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Oct:'October',Nov:'November',Dec:'December'};return (months[month]?months[month]+' ':'')+year+(sitting.endsWith('-Basic')?' · Basic track':'');};
  const label = entry => sittingLabel(entry.sitting) + ' Q' + entry.number;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sittingDate = sitting => Number(sitting.slice(0,4))*100+months.indexOf(sitting.split('-')[1])+1;
  // Numeric chapter practice follows current assignments; special collections keep their membership.
  function studyIds(data, chapter) {
    if (/^\d+$/.test(chapter)&&data.currentChapters)return data.currentChapters[chapter]||[];
    if (data.study[chapter]) return data.study[chapter].ids;
    // Read-only chapters share the same resolved/page-free chapter membership.
    return /^\d+$/.test(chapter) ? Object.entries(data.questions).filter(([,entry]) => ['resolved','title-8e','topic-8e'].includes(entry.status) && entry.chapters.includes(String(chapter))).map(([id]) => id) : [];
  }
  function counts(data, chapter) {
    const totals = new Map();
    for (const id of new Set(studyIds(data, chapter))) {
      const entry = data.questions[id];
      if (entry) totals.set(entry.sitting, (totals.get(entry.sitting) || 0) + 1);
    }
    return [...totals].sort((a,b) => sittingDate(b[0])-sittingDate(a[0]));
  }
  async function citationLine(chapter, open, reader=false) {
    const data = await load(), entries = counts(data, chapter);
    if (!entries.length) return null;
    const link = document.createElement('a');
    link.className = 'chapter-exams'; link.href = '?chapter='+chapter+(data.study[chapter]?'s':'')+'&view=questions&source=past';
    if(reader){
      link.classList.add('chapter-exams-reader');
      link.append('Exam questions');
      link.title=entries.map(([sitting,total])=>sittingLabel(sitting)+' ×'+total).join(' · ');
    }else{
      link.append('Exams: ');
      for (const [i, [sitting, count]] of entries.entries()) {
        if (i) link.append(' · ');
        const span = document.createElement('span'), [year, month] = sitting.split('-');
        span.textContent = (sitting.endsWith('-Basic')?sittingLabel(sitting):(['2024','2021'].includes(year) && month ? month+' ' : '')+year)+(count>1?' ×'+count:'');
        if (year === '2026') span.className = 'chapter-exams-latest';
        link.append(span);
      }
    }
    const record=document.createElement('span');record.className='chapter-exams-record';record.textContent=' \u00b7 '+await HazzardStats.chapter(chapter,data);link.append(record);
    if (open) link.onclick = event => {event.preventDefault();open();};
    return link;
  }
  const questionURL = id => '?chapter=bank&q=' + encodeURIComponent(HazzardMCQ.currentId(id));
  function openPage(page, view) {
    // The source history entry holds its own view, including Study/mock context.
    // A browser Back never writes an answer or changes a saved paper's identity.
    history.replaceState({...history.state, mcqView: view}, '');
    const url = new URL(location.href);
    url.search = ''; url.searchParams.set('chapter', page.readerChapter || page.chapter);
    url.searchParams.set('examBack', '1'); url.hash = page.anchor || 'p' + page.page;
    location.assign(url);
  }
  const rebuilt = new Set(['1','3','7','8','11','15','17','22','26','27','30','31','34','37','38','42','43','44','45','46','47','48','49','51','52','53','55','58','59','60','61','62','65','67','68','72','74','75','76','77','78','79','80','81','83','87','88','89','94','95','97','98','99','100','104']);
  const isRebuilt = chapter => rebuilt.has(String(chapter));
  async function addPassages(copy,chapter,data){
    data ||= await references();
    const wanted=new Map();
    for(const [id,entry] of Object.entries(data.questions)){
      for(const p of entry.pages){
        if(p.chapter!==chapter||!p.printedAnchorAlias||copy.querySelector('[id="'+p.printedAnchorAlias+'"]'))continue;
        const page=copy.querySelector('[id="p'+p.page+'"]');
        if(page){
          // Old shared links to a reclassified passage still open its published page.
          const alias=document.createElement('span');alias.id=p.printedAnchorAlias;
          alias.dataset.readerMetadata='exam';page.after(alias);
        }
      }
      for(const p of [...entry.pages,...(entry.supportPages||[])])if(String(p.chapter)===chapter&&p.passage&&p.anchor){
        // The full reader and the preview can wrap a printed-page break on
        // either side of the corresponding words. The exact quote determines
        // the location; both known page contexts are candidates.
        const locations=new Set([p.contextPage??p.page]);
        if(p.rangeText)locations.add(p.page);
        for(const location of locations){
          if(!wanted.has(location))wanted.set(location,[]);
          wanted.get(location).push({id,printed:entry.pages.includes(p),...p});
        }
      }
    }
    if(!wanted.size)return;
    function place(p,node,boundary){
      if(copy.querySelector('[id="'+p.anchor+'"]'))return;
      const marker=document.createElement('span');
      marker.id=p.anchor;
      marker.className='exam-passage-target';
      if(p.printed){marker.dataset.examIds=p.id;marker.dataset.examReadPage=String(p.page);}
      else if(data.study[chapter]?.ids.includes(p.id)&&!data.questions[p.id].chapters.includes(chapter)){
        marker.dataset.practiceIds=p.id;
      }
      marker.dataset.readerMetadata='exam';
      if(boundary)boundary.insertNode(marker);
      else if(node.tagName==='IMG')node.before(marker);
      else node.prepend(marker);
    }
    let active;
    for(const node of copy.querySelectorAll('a.pg,a[id^="p"],p,li,td,th,img,h2,h3,h4,h5,h6')){
      if(/^p\d+$/.test(node.id)||node.matches('a.pg')){
        active=wanted.get(Number(node.dataset.page||node.id.slice(1)));
        // The full reader joins paragraphs split by a printed page break.
        // A paragraph-start cue in the preview can start just after that break here.
        const block=active?.length&&node.closest('p,li,td,th');
        if(block){
          const after=document.createRange();
          after.selectNodeContents(block);after.setStartAfter(node);
          const rest=after.toString().trimStart();
          for(let i=active.length-1;i>=0;i--){
            const p=active[i];
            if(!p.rangeText&&!p.imageFile&&rest.startsWith(p.passage)){
              const boundary=after.cloneRange();boundary.collapse(true);
              place(p,block,boundary);active.splice(i,1);
            }
          }
        }
        continue;
      }
      if(!active?.length||node.closest('[data-reader-metadata]'))continue;
      const text=(node.tagName==='IMG'?(node.alt||''):node.textContent).replace(/\s+/g,' ').trim();
      for(let index=active.length-1;index>=0;index--){
        const p=active[index];
        let boundary;
        if(p.imageFile){
          if(node.tagName!=='IMG'||(node.dataset.src||node.getAttribute('src')||'').split('/').pop()!==p.imageFile)continue;
        }else if(p.rangeText){
          if(!text.includes(p.rangeText))continue;
          // During reflow a printed page marker can sit inside a paragraph.
          // Land at the verified words on that page, also in the question preview.
          const indexed=window.HazzardHighlighter.textIndex(node),at=indexed.s.indexOf(p.rangeText);
          if(at<0)continue;
          boundary=document.createRange();
          boundary.setStart(indexed.nodes[at],indexed.offs[at]);
          boundary.collapse(true);
        }else if(text!==p.passage&&!(p.passage.length>=90&&text.startsWith(p.passage)))continue;
        active.splice(index,1);
        place(p,node,boundary);
      }
    }
  }
  const fitRows=new WeakMap();
  const rowObserver=new ResizeObserver(changes=>{
    for(const badge of new Set(changes.map(change=>change.target.closest('.exam-links'))))fitRows.get(badge)?.();
  });
  function askedBadge(entries, description, anchor, prefix='Asked') {
    const badge = document.createElement('span');
    badge.className = 'exam-evidence exam-links';
    badge.dataset.readerMetadata = 'exam';
    badge.id = anchor;
    badge.setAttribute('role','group');
    badge.setAttribute('aria-label',description);
    const headline=document.createElement('span'),count=document.createElement('span');
    headline.className='exam-link-line';count.className='exam-link-count';
    const ordered=[...new Map(entries)].sort((a,b)=>sittingDate(b[1].sitting)-sittingDate(a[1].sitting)||a[1].number-b[1].number);
    const nextSitting=ordered.findIndex(([,entry])=>entry.sitting!==ordered[0][1].sitting);
    if(nextSitting>1){
      const [next]=ordered.splice(nextSitting,1);
      ordered.splice(1,0,next);
    }
    count.textContent=prefix+' '+ordered.length;
    headline.append(count);badge.append(headline);
    const links=ordered.map(([id,entry])=>{
      const link=document.createElement('a');
      const [year,month]=entry.sitting.split('-');
      link.href=questionURL(id);
      link.textContent=(month?month+' ':'')+year+(entry.sitting.endsWith('-Basic')?' Basic':'')+' Q'+entry.number;
      link.setAttribute('aria-label',prefix+': '+label(entry));
      return link;
    });
    if(links.length===1){headline.append(links[0]);return badge;}
    badge.classList.add('exam-link-group');
    const toggle=document.createElement('button'),extra=document.createElement('span');
    toggle.type='button';extra.id=anchor+'-more';extra.className='exam-link-extra';
    toggle.setAttribute('aria-controls',extra.id);
    headline.append(toggle);badge.append(extra);extra.append(...links);
    let open=history.state?.examReturn?.anchor===anchor&&history.state.examReturn.expanded===true;
    let visible=0,measure='';
    function disclose(){
      const rest=links.length-visible;
      toggle.hidden=rest===0;
      extra.hidden=!open||rest===0;
      toggle.setAttribute('aria-expanded',String(!extra.hidden));
      toggle.textContent=open?'Less':'+'+rest+' more';
      toggle.setAttribute('aria-label',open?'Show fewer exam links':'Show '+rest+' more exam link'+(rest===1?'':'s'));
    }
    function preview(n){
      for(let i=visible;i<n;i++)headline.insertBefore(links[i],toggle);
      for(let i=visible-1;i>=n;i--)extra.prepend(links[i]);
      visible=n;
      disclose();
    }
    function fit(){
      const width=headline.clientWidth,signature=width+'|'+count.getBoundingClientRect().width;
      if(!width||signature===measure)return;
      measure=signature;
      const focus=document.activeElement;
      let n=Math.min(2,links.length);
      preview(n);
      while(n>0&&headline.scrollWidth>width)preview(--n);
      if(focus&&links.includes(focus)&&focus!==document.activeElement){
        if(extra.contains(focus)&&extra.hidden){open=true;disclose();}
        focus.focus({preventScroll:true});
      }
    }
    preview(1);
    toggle.addEventListener('click',()=>{open=!open;disclose();});
    fitRows.set(badge,fit);rowObserver.observe(headline);rowObserver.observe(count);
    return badge;
  }
  function refreshExamList(copy,chapter,data){
    const original=[...copy.querySelectorAll('p')].find(p=>/^(?:No past-exam questions are currently linked to this chapter|Past-exam questions linked to this chapter \(\d+\))/.test(p.textContent.trim()));
    if(!original)return;
    const ids=data.study[chapter]?.ids||[], list=original.nextElementSibling;
    const old=list?.tagName==='UL'?[...list.querySelectorAll('a[href*="q="]')].map(a=>new URL(a.getAttribute('href'),location.href).searchParams.get('q')):[];
    const current=new Set(ids),previous=new Set(old);
    if(current.size===previous.size&&[...current].every(id=>previous.has(id)))return;
    original.hidden=true;
    if(list?.tagName==='UL'&&old.length)list.hidden=true;
    const details=document.createElement('details'),summary=document.createElement('summary');
    details.dataset.readerMetadata='exam';
    details.className='chapter-exam-membership';
    summary.textContent=ids.length+' past-exam question'+(ids.length===1?'':'s');
    details.append(summary);
    const ordered=ids.map(id=>[id,data.questions[id]]).filter(([,entry])=>entry)
      .sort((a,b)=>b[1].sitting.localeCompare(a[1].sitting)||a[1].number-b[1].number);
    const items=document.createElement('ul');
    for(const [id,entry] of ordered){
      const item=document.createElement('li'),link=document.createElement('a');
      link.href=questionURL(id);link.textContent=label(entry);item.append(link);items.append(item);
    }
    details.append(items);original.after(details);
  }
  async function decorate(copy, chapter) {
    const sourceChapter=chapter.replace(/s$/,''), study=sourceChapter!==chapter, compact=isRebuilt(sourceChapter);
    if(!/^\d+$/.test(sourceChapter))return;
    const data=await references(), byPage=new Map(), earlier=[], chapterOnly=[], related=[];
    if(study)refreshExamList(copy,sourceChapter,data);
    if(!study)await addPassages(copy,sourceChapter,data);
    const memberIds=new Set(data.study[sourceChapter]?.ids||[]);
    const explicit=new Map();
    const annotated=new Set([...copy.querySelectorAll('[data-exam-ids]')].flatMap(node=>node.dataset.examIds.split(/\s+/)));
    for(const marker of copy.querySelectorAll('[data-exam-ids][data-exam-read-page]')){
      for(const id of marker.dataset.examIds.split(/\s+/)){
        if(!explicit.has(id))explicit.set(id,new Set());
        explicit.get(id).add(Number(marker.dataset.examReadPage));
      }
    }
    for(const [id,entry] of Object.entries(data.questions)){
      if(Number(entry.sitting.slice(0,4))<2023){
        if(memberIds.has(id)||entry.chapters.includes(sourceChapter))earlier.push([id,entry]);
        continue;
      }
      if(memberIds.has(id)&&!entry.chapters.includes(sourceChapter)&&!annotated.has(id))related.push([id,entry]);
      if(entry.chapters.includes(sourceChapter) && !entry.pages.some(p=>p.chapter===sourceChapter && p.available && !p.citationOnly))chapterOnly.push([id,entry]);
      if(entry.status!=='resolved')continue;
      for(const p of entry.pages){
        if((p.readerChapter||p.chapter)!==sourceChapter||!p.available||p.citationOnly||explicit.get(id)?.has(p.page))continue;
        if(!byPage.has(p.page))byPage.set(p.page,[]);
        byPage.get(p.page).push([id,entry]);
      }
    }
    const annotations=[], sections=[];
    function labelAt(marker,entries,description,anchor,prefix){
      if(!marker||!entries.length)return;
      const badge=askedBadge(entries,description,anchor,prefix);
      // Keep the citation anchor at its source, but put its visible links after the prose.
      const block=marker.closest('p,li,td,th,figcaption,h1,h2,h3,h4,h5,h6');
      if(block&&block!==marker)block.append(badge);else marker.after(badge);
      if(compact&&!study)annotations.push({element:badge,ids:entries.map(([id])=>id)});
    }
    if(earlier.length)labelAt(copy.querySelector('h1'),earlier,'Asked in this chapter','asked-chapter');
    if(chapterOnly.length)labelAt(copy.querySelector('h1'),chapterOnly,'Chapter reference without a matching printed passage','cited-chapter','Cited');
    if(related.length)labelAt(copy.querySelector('h1'),related,'Exam questions related by topic; their bibliography is shown with the question','related-exams','Related exam');
    copy.addEventListener('click',event=>{
      const link=event.target.closest('.exam-links a,.section-practice a');
      if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const group=link.closest('.exam-links,.section-practice'),scroller=document.getElementById('readerScroll');
      const url=new URL(location.href);url.hash=group.id;
      const offset=group.getBoundingClientRect().top-scroller.getBoundingClientRect().top;
      const expanded=group.querySelector('button[aria-expanded="true"]')!==null;
      history.replaceState({...history.state,hazzardReaderY:scroller.scrollTop,examReturn:{anchor:group.id,offset,expanded}},'',url);
    });
    if(study&&!compact){
      // Older Study notes cite their pages inline. Attach links to the first
      // matching passage and keep the original sentence/highlight units intact.
      const seen=new Set();
      for(const paragraph of copy.querySelectorAll('p,li')){
        if(paragraph.closest('[data-reader-metadata]')||!byPage.size)continue;
        const picked=new Map();
        for(const ref of paragraph.textContent.matchAll(/\b(?:pp?|pages?)\.?\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?((?:\s*,\s*\d{1,4}(?:\s*[-–—]\s*\d{1,4})?)*)/gi)){
          for(const span of [ref[1]+(ref[2]?'-'+ref[2]:''),...ref[3].split(',').filter(Boolean)]){
            const [first,last=first]=span.trim().split(/\s*[-–—]\s*/).map(Number);
            for(const [page,entries] of byPage){
              if(page<first||page>last||seen.has(page))continue;
              seen.add(page);
              for(const [id,entry] of entries)picked.set(id,entry);
            }
          }
        }
        if(picked.size)labelAt(paragraph,[...picked],'Exam questions citing this passage','study-exam-'+seen.size);
      }
      const remaining=new Map();
      for(const [page,entries] of byPage)if(!seen.has(page))for(const [id,entry] of entries)remaining.set(id,entry);
      if(remaining.size)labelAt(copy.querySelector('h1'),[...remaining],'Exam questions on pages outside these notes','study-exam-other');
      return;
    }
    const teachingTargets=new Map();
    if(!study){
      for(const [id,entry] of Object.entries(data.questions)){
        for(const p of [...(entry.supportPages||[]),...(entry.relatedTeaching||[])]){
          if(String(p.readerChapter||p.chapter)!==sourceChapter||p.available===false)continue;
          const anchor=p.anchor||'p'+p.page;
          if(!teachingTargets.has(anchor))teachingTargets.set(anchor,new Set());
          teachingTargets.get(anchor).add(id);
        }
      }
    }
    let section,serial=0;
    const markers=study?'h2,[data-exam-page],[data-exam-ids],[data-practice-ids]':'a.pg,a[id^="p"],[data-exam-ids],[data-practice-ids]';
    for(const marker of copy.querySelectorAll(markers)){
      if(marker.tagName==='H2'){
        if(section)section.end=marker;
        section={ids:new Set(),end:null};
        sections.push(section);
        continue;
      }
      const page=Number(marker.dataset.examPage||marker.dataset.page||(/^p\d+$/.test(marker.id)?marker.id.slice(1):0));
      const entries=page ? byPage.get(page)||[] : (marker.dataset.examIds||'').split(/\s+/).filter(id=>data.questions[id]).map(id=>[id,data.questions[id]]);
      const practice=(marker.dataset.practiceIds||'').split(/\s+/).filter(id=>data.questions[id]);
      if(section)for(const id of [...entries.map(([id])=>id),...practice])section.ids.add(id);
      const relatedHere=practice.filter(id=>{
        const entry=data.questions[id];
        if(Number(entry.sitting.slice(0,4))<2023)return false;
        if(entry.chapters.includes(sourceChapter)){
          // A bibliography can name the right chapter but only give unrelated pages.
          // Label a separate teaching passage when its marked page matches the verified support.
          const cited=entry.pages.filter(p=>String(p.readerChapter||p.chapter)===sourceChapter);
          const teachingPage=Number(marker.dataset.examReadPage);
          return cited.length>0&&cited.every(p=>p.citationOnly)&&entry.supportPages?.some(p=>
            String(p.readerChapter||p.chapter)===sourceChapter&&p.page===teachingPage&&p.available);
        }
        return memberIds.has(id)||entry.relatedTeaching?.some(target=>String(target.chapter)===sourceChapter);
      });
      const otherPractice=practice.filter(id=>!relatedHere.includes(id));
      if(!study&&otherPractice.length)annotations.push({element:marker,ids:otherPractice});
      if(page && entries.length)marker.classList.add('exam-page-marker');
      const asked=[],companions=new Set(relatedHere);
      for(const [id,entry] of entries){
        if(Number(entry.sitting.slice(0,4))<2023)continue;
        const printed=page||Number(marker.dataset.examReadPage);
        if(entry.pages.some(p=>p.available&&!p.citationOnly&&String(p.readerChapter||p.chapter)===sourceChapter&&(!printed||p.page===printed))){
          asked.push([id,entry]);
        }else companions.add(id);
      }
      for(const id of teachingTargets.get(marker.id)||[])companions.add(id);
      teachingTargets.delete(marker.id);
      labelAt(marker,asked,page?'Asked here, page '+page:'Exam questions on this passage','asked-at-'+(++serial));
      if(companions.size)labelAt(marker,[...companions].map(id=>[id,data.questions[id]]),'Related exam questions on this teaching passage','related-at-'+serial,'Related exam');
    }
    for(const [anchor,ids] of teachingTargets){
      const marker=copy.querySelector('[id="'+CSS.escape(anchor)+'"]');
      labelAt(marker,[...ids].map(id=>[id,data.questions[id]]),'Related exam questions on this teaching passage','related-source-'+anchor,'Related exam');
    }
    if(!compact)return;
    const counts=[];
    for(const {ids,end} of sections){
      if(!ids.size)continue;
      const line=document.createElement('p'),link=document.createElement('a'),status=document.createElement('span');
      line.dataset.readerMetadata='exam';line.className='section-practice';
      line.id='practise-section-'+(counts.length+1);
      link.href=HazzardMCQ.sessionURL([...ids])+'&sectionPractice=1';
      link.textContent='Practise the '+ids.size+' exam question'+(ids.size===1?'':'s')+' on this section';
      line.append(link,status);
      if(end)end.before(line);else copy.append(line);
      counts.push({element:status,ids:[...ids]});
    }
    const bank=new Map((await HazzardQuestionData.catalog()).map(q=>[q.id,q]));
    function refresh(){
      let answers;
      try{answers=HazzardMCQ.currentAnswers(HazzardMCQ.rawValue(HazzardMCQ.KEY,HazzardMCQ.validStore,()=>({version:1,answers:{}})).answers);}catch{}
      function record(ids){
        let answered=0,missed=0;
        for(const id of ids){
          const a=answers?.[id],q=bank.get(id);
          if(q && a?.checked===true && Number.isInteger(a.selected)){
            answered++;
            if(!q.accepted.includes(a.selected))missed++;
          }
        }
        return {answered,missed};
      }
      for(const c of counts){
        const r=record(c.ids);
        c.element.textContent=answers?' · '+r.answered+' answered · '+r.missed+' missed':' · Answer record unavailable';
      }
      for(const item of annotations){
        const missed=record(item.ids).missed;
        if(!missed){item.mark?.remove();item.mark=null;continue;}
        if(!item.mark){
          item.mark=document.createElement('small');item.mark.className='exam-missed';item.mark.dataset.readerMetadata='exam';
          item.element.after(item.mark);
        }
        item.mark.textContent='missed';item.mark.title=missed+' linked question'+(missed===1?'':'s')+' answered incorrectly';
      }
    }
    refresh();addEventListener('pageshow',refresh);
    addEventListener('storage',e=>{if(!e.key||e.key===HazzardMCQ.KEY)refresh();});
    addEventListener('hazzard-saved-change',refresh);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  }
  function backControl(viewport) {
    if (new URL(location.href).searchParams.get('examBack') !== '1') return;
    const bar = document.createElement('div');bar.className = 'exam-return';
    const button = document.createElement('button');button.textContent = 'Back to question';
    button.onclick = () => history.back();bar.append(button);viewport.append(bar);viewport.classList.add('has-exam-return');
  }
  return {sittingLabel,load,preload:references, label, questionURL, openPage, decorate, addPassages, backControl,studyIds,counts,citationLine,isRebuilt};
})();
