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
      for(const chapter of rebuilt){
        const cited=Object.entries(data.questions).filter(([,entry])=>entry.chapters.includes(chapter)).map(([id])=>id);
        data.currentChapters[chapter]=[...new Set([...(data.currentChapters[chapter]||[]),...cited])];
      }
      return data;
    }).catch(e => { promise = null; throw e; });
  }
  const sittingLabel = sitting => {const [year,month]=sitting.split('-');const months={Jan:'January',Feb:'February',Mar:'March',Apr:'April',May:'May',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Oct:'October',Nov:'November',Dec:'December'};return (months[month]?months[month]+' ':'')+year+(sitting.endsWith('-Basic')?' · Basic track':'');};
  const label = entry => sittingLabel(entry.sitting) + ' Q' + entry.number;
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
    const month = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const date = sitting => Number(sitting.slice(0,4))*100+(month[sitting.split('-')[1]]||0);
    return [...totals].sort((a,b) => date(b[0])-date(a[0]));
  }
  async function citationLine(chapter, open) {
    const data = await load(), entries = counts(data, chapter);
    if (!entries.length) return null;
    const link = document.createElement('a');
    link.className = 'chapter-exams'; link.href = '?chapter='+chapter+(data.study[chapter]?'s':'')+'&view=questions&source=past';
    link.append('Exams: ');
    for (const [i, [sitting, count]] of entries.entries()) {
      if (i) link.append(' · ');
      const span = document.createElement('span'), [year, month] = sitting.split('-');
      span.textContent = (sitting.endsWith('-Basic')?sittingLabel(sitting):(['2024','2021'].includes(year) && month ? month+' ' : '')+year)+(count>1?' ×'+count:'');
      if (year === '2026') span.className = 'chapter-exams-latest';
      link.append(span);
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
    url.searchParams.set('examBack', '1'); url.hash = 'p' + page.page;
    location.assign(url);
  }
  const rebuilt = new Set(['1','3','22','46','55','58','59','61','99']);
  function askedBadge(entries, description, anchor, compact) {
    const badge = document.createElement('span');
    badge.className = compact ? 'exam-evidence exam-links' : 'exam-evidence';
    badge.dataset.readerMetadata = 'exam';
    badge.id = anchor;
    badge.setAttribute('aria-label',description);
    if(compact) badge.append('Asked:');
    for(const [index,[id,entry]] of entries.entries()){
      const link=document.createElement('a');
      const [year,month]=entry.sitting.split('-');
      if(compact && index)badge.append('·');
      link.href=questionURL(id);
      link.textContent=compact ? (month?month+' ':'')+year+(entry.sitting.endsWith('-Basic')?' Basic':'')+' Q'+entry.number : 'Asked: '+label(entry);
      link.setAttribute('aria-label','Asked: '+label(entry));
      badge.append(link);
    }
    return badge;
  }
  async function decorate(copy, chapter) {
    const sourceChapter=chapter.replace(/s$/,''), study=sourceChapter!==chapter, compact=rebuilt.has(sourceChapter);
    if(study&&!compact)return;
    const data=compact?await load():await references(), byPage=new Map(), earlier=[];
    const memberIds=new Set(data.currentChapters?.[sourceChapter]||[]);
    const explicit=new Map();
    for(const marker of copy.querySelectorAll('[data-exam-ids][data-exam-read-page]')){
      for(const id of marker.dataset.examIds.split(/\s+/)){
        if(!explicit.has(id))explicit.set(id,new Set());
        explicit.get(id).add(Number(marker.dataset.examReadPage));
      }
    }
    for(const [id,entry] of Object.entries(data.questions)){
      if(Number(entry.sitting.slice(0,4))<2023){
        if(compact && (memberIds.has(id)||entry.chapters.includes(sourceChapter)))earlier.push([id,entry]);
        continue;
      }
      if(entry.status!=='resolved')continue;
      for(const p of entry.pages){
        if((p.readerChapter||p.chapter)!==sourceChapter||!p.available||explicit.get(id)?.has(p.page))continue;
        if(!byPage.has(p.page))byPage.set(p.page,[]);
        byPage.get(p.page).push([id,entry]);
      }
    }
    const annotations=[], sections=[];
    function labelAt(marker,entries,description,anchor){
      if(!marker||!entries.length)return;
      const badge=askedBadge(entries,description,anchor,compact);
      marker.after(badge);
      if(compact&&!study)annotations.push({element:badge,ids:entries.map(([id])=>id)});
    }
    if(earlier.length)labelAt(copy.querySelector('h1'),earlier,'Asked in this chapter','asked-chapter');
    let section,serial=0;
    const markers=study?'h2,[data-exam-page],[data-exam-ids],[data-practice-ids]':'a.pg,[data-exam-ids],[data-practice-ids]';
    for(const marker of copy.querySelectorAll(markers)){
      if(marker.tagName==='H2'){
        if(section)section.end=marker;
        section={ids:new Set(),end:null};
        sections.push(section);
        continue;
      }
      const page=Number(marker.dataset.examPage||marker.dataset.page||0);
      const entries=page ? byPage.get(page)||[] : (marker.dataset.examIds||'').split(/\s+/).filter(id=>data.questions[id]).map(id=>[id,data.questions[id]]);
      const practice=(marker.dataset.practiceIds||'').split(/\s+/).filter(id=>data.questions[id]);
      if(section)for(const id of [...entries.map(([id])=>id),...practice])section.ids.add(id);
      if(!study && practice.length)annotations.push({element:marker,ids:practice});
      if(page && entries.length)marker.classList.add('exam-page-marker');
      const visible=compact&&study ? entries.filter(([,e])=>Number(e.sitting.slice(0,4))>=2023) : entries;
      labelAt(marker,visible,page?'Asked here, page '+page:'Related exam questions','asked-at-'+(++serial));
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
    // The reader scrolls an inner viewport. Anchor its own history entry before leaving.
    copy.addEventListener('click',event=>{
      const link=event.target.closest('.exam-links a,.section-practice a');
      if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const url=new URL(location.href);url.hash=link.parentElement.id;
      const scroller=document.getElementById('readerScroll');
      const offset=link.parentElement.getBoundingClientRect().top-scroller.getBoundingClientRect().top;
      history.replaceState({...history.state,hazzardReaderY:scroller.scrollTop,examReturn:{anchor:link.parentElement.id,offset}},'',url);
    });
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
  return {sittingLabel,load,preload:references, label, questionURL, openPage, decorate, backControl,studyIds,counts,citationLine};
})();
