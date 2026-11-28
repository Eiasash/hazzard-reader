/* Bank and chapter browsing share the canonical question directory. */
window.HazzardPracticeDirectory = (() => {
  const PAGE = 16;
  const kinds = [['past','Official'],['practice','Practice'],['all','All']];
  const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const heading = (q) => q.kind === 'past' ? HazzardMCQ.sourceLabel(q) : q.sourceChecked ? 'Book-verified practice' : 'Practice';
  let optionsRequest,optionText;
  const prepared=new Map(),memberships=new Map();
  function chapterIds(chapter){
    if(!memberships.has(chapter)){
      const request=HazzardStudyHome.libraryStats().then(data=>new Set(data.evidence.currentChapters[chapter]||[]))
        .catch(error=>{memberships.delete(chapter);throw error;});
      memberships.set(chapter,request);
    }
    return memberships.get(chapter);
  }
  const settledChapterIds=new Map();
  async function prepareSearch(rows,term){
    const query=HazzardSearchTerms.compile(term);
    if(query.chapter){settledChapterIds.set(query.chapter,await chapterIds(query.chapter));return;}
    if(!query.text)return;
    optionsRequest ||= fetch('data/mcq/search-options.json').then(r=>{if(!r.ok)throw Error('Question options unavailable');return r.json();})
      .then(data=>{optionText=data;}).catch(error=>{optionsRequest=null;throw error;});
    await Promise.all([fullStems(rows),optionsRequest]);
  }
  function matches(rows,kind,term){
    const query=HazzardSearchTerms.compile(term),pool=rows.filter(q=>kind==='all'||q.kind===kind);
    if(query.chapter){const members=settledChapterIds.get(query.chapter);return pool.filter(q=>String(q.chapter)===query.chapter||members?.has(q.id));}
    if(!query.text)return pool;
    const ranked=[];
    for(const q of pool){
      let text=prepared.get(q.id);
      if(!text){
        text=HazzardSearchTerms.prepare([q.q,...(optionText?.[q.id]||[]),q.t,heading(q),q.id,q.chapter&&'Chapter '+q.chapter].filter(Boolean).map(clean).join(' '));
        prepared.set(q.id,text);
      }
      const rank=query.rank(text);if(Number.isFinite(rank))ranked.push({q,rank});
    }
    const literal=ranked.some(row=>row.rank<3);
    return ranked.filter(row=>!literal||row.rank<3).sort((a,b)=>a.rank-b.rank).map(row=>row.q);
  }
  let firstStems;
  function addStems(rows, stems){
    if(stems)for(const row of rows){if(stems[row.id]!=null)row.q=stems[row.id];}
  }
  async function fullStems(rows){
    const missing=rows.filter(q=>q.q==null);if(!missing.length)return;
    const catalog=await HazzardQuestionData.catalog(),byId=new Map(catalog.map(q=>[q.id,q.q]));
    for(const row of missing)row.q=byId.get(row.id);
  }
  function startStems(){
    return firstStems ||= fetch('data/mcq/directory-start.json').then(r=>r.ok?r.json():null).catch(()=>null);
  }
  function ordered(rows) {
    return [...rows].sort((a,b) => Number(b.kind==='past')-Number(a.kind==='past') ||
      (a.kind==='past' && b.kind==='past' ? b.t.localeCompare(a.t) || a.examNumber-b.examNumber : a.sourceIndex-b.sourceIndex));
  }
  function element(tag, name, text) {
    const node = document.createElement(tag);
    if(name)node.className=name;
    if(text)node.textContent=text;
    return node;
  }
  function mount(host, rows, {chapter, answers, saved, signal, resume}) {
    const prior=history.state?.hazzardDirectory || {};
    const params=new URL(location.href).searchParams;
    let kind=prior.kind || params.get('kind') || (params.get('source')==='practice'?'practice':'past');
    if(!kinds.some(([key])=>key===kind))kind='past';
    let term=prior.term??params.get('term')??'',limit=Number(prior.limit)||PAGE;
    const page=element('div','mcq-page practice-directory'),list=element('ol','directory-list');
    const title=element('h1','',chapter==='bank'?'Browse questions':'Chapter questions');
    const search=element('input','directory-search');search.type='search';search.autocomplete='off';search.placeholder='Search questions, drugs or chapters';search.setAttribute('aria-label',search.placeholder);search.value=term;
    const types=element('div','directory-types'),count=element('p','directory-count'),more=element('button','directory-more','Show more questions');
    types.setAttribute('role','group');types.setAttribute('aria-label','Question source');count.setAttribute('role','status');
    const links=element('div','directory-tools');const link=(label,href)=>{const a=element('a','',label);a.href=href;links.append(a);};
    if(chapter==='bank'){
      link(resume?'Resume practice':'Start practice','?chapter=bank&practiceResume=1');
      link('Practice filters','?chapter=bank&practiceResume=1&openFilters=1');
    }
    page.append(title,search,types);if(links.childElementCount)page.append(links);page.append(count,list,more);host.replaceChildren(page);
    const remember=()=>{
      if(signal.aborted)return;
      const previous=history.state?.hazzardDirectory,scroll=host.scrollTop;
      if(previous?.kind===kind&&previous.term===term&&previous.limit===limit&&previous.scroll===scroll)return;
      history.replaceState({...history.state,hazzardDirectory:{kind,term,limit,scroll}},'');
    };
    let drawTurn=0;
    const draw=async()=>{
      const ticket=++drawTurn;
      for(const b of types.children)b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
      try{
        if(term.trim()){count.textContent='Searching…';await prepareSearch(rows,term);}
        if(ticket!==drawTurn||signal.aborted)return;
        const showing=matches(rows,kind,term).slice(0,limit);
        if(showing.some(q=>q.q==null)){
          count.textContent='Loading questions…';addStems(rows,await startStems());
          if(showing.some(q=>q.q==null))await fullStems(rows);
        }
      }catch{if(ticket===drawTurn&&!signal.aborted){count.textContent='Question text could not load.';more.hidden=false;more.textContent='Try again';}return;}
      if(ticket!==drawTurn||signal.aborted)return;
      more.textContent='Show more questions';
      const filtered=matches(rows,kind,term);
      for(const b of types.children)b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
      count.textContent=filtered.length+' '+(filtered.length===1?'question':'questions');
      const frag=document.createDocumentFragment();
      for(const q of filtered.slice(0,limit)){
        const li=element('li'),a=element('a','directory-question'),text=element('strong','directory-stem',clean(q.q)),meta=element('span','directory-meta');
        const script=HazzardMCQ.questionScript(q);text.dir=script.dir;text.lang=script.lang;
        const url=new URL(location.href);
        url.searchParams.delete('browse');url.searchParams.set('q',q.id);url.searchParams.set('from','questions');url.searchParams.set('kind',kind);
        if(term)url.searchParams.set('term',term);else url.searchParams.delete('term');url.hash='';
        a.href=url.href;a.dataset.questionId=q.id;
        const labels=[heading(q)];if(chapter==='bank'&&/^\d+$/.test(q.chapter||''))labels.push('Ch '+q.chapter);
        if(saved.questions[q.id]?.saved)labels.push('Saved');
        const answer=answers.get(q.id);if(answer?.checked)labels.push(q.accepted.includes(answer.selected)?'Answered':'Missed');
        meta.textContent=labels.join(' · ');a.append(text,meta);li.append(a);frag.append(li);
      }
      list.replaceChildren(frag);more.hidden=filtered.length<=limit;
      if(!filtered.length)count.textContent=term?'No questions match this search.':'No questions in this source.';
    };
    for(const [key,label] of kinds){const b=element('button','',label);b.type='button';b.dataset.kind=key;b.onclick=()=>{kind=key;limit=PAGE;draw();remember();};types.append(b);}
    search.oninput=()=>{term=search.value;limit=PAGE;draw();remember();};
    more.type='button';more.onclick=()=>{limit+=PAGE;draw();remember();};
    list.onclick=event=>{const a=event.target.closest('a');if(!a||event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();remember();HazzardRouter.go(a.href,{state:{hazzardDirectoryBack:true}});};
    draw().then(()=>{if(Number.isFinite(prior.scroll))requestAnimationFrame(()=>{if(!signal.aborted)host.scrollTop=prior.scroll;});});
    return remember;
  }
  return {ordered,matches,mount,addStems,fullStems,prepareSearch,chapterIds};
})();
