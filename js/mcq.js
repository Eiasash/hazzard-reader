/* MCQs use only their own store. Existing notebook, drill and progress formats
   are unchanged. Content-derived IDs prevent answers moving to another item. */
window.HazzardMCQ = (() => {
  const KEY = 'hazzard-mcq-v1';
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function validStore(value) {
    return record(value) && value.version === 1 && record(value.answers) && Object.entries(value.answers).every(([id,a]) =>
      /^mcq-[a-f0-9]{24}$/.test(id) && record(a) && (a.selected === null || Number.isInteger(a.selected) && a.selected >= 0 && a.selected <= 4) &&
      typeof a.checked === 'boolean' && (!a.checked || a.selected !== null) && Number.isFinite(a.at) && a.at >= 0);
  }
  function readStore() {
    const raw = localStorage.getItem(KEY), value = raw === null ? {version:1,answers:{}} : JSON.parse(raw);
    if (!validStore(value)) throw new Error('Unreadable MCQ answers');
    return value;
  }
  function mergeStore(current, incoming) {
    const answers = {...incoming.answers};
    for (const [id,a] of Object.entries(current.answers)) if (!answers[id] || a.at >= answers[id].at) answers[id] = a;
    return {version:1,answers};
  }
  let catalogPromise;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Question file unavailable');
    return response.json();
  }
  function loadIndex() {
    return catalogPromise ||= json('data/mcq/index.json').catch(error => { catalogPromise = null; throw error; });
  }
  function sourceLabel(q) {
    if (q.kind === 'practice') return 'Practice question · Hazzard-based';
    const match = /^(\d{4})(?:-([A-Za-z]+))?(?:-(Subspec|Basic))?$/.exec(q.t);
    if (!match) return 'Shlav A';
    return 'Shlav A ' + match[1] + (match[2] ? ' (' + match[2] + ')' : '') + (match[3] === 'Subspec' ? ' · Subspecialty' : '');
  }
  function rich(value) {
    const box = document.createElement('div');
    const decoder = document.createElement('textarea');
    let text = String(value).replace(/\\n/g, '\n').replace(/\\t/g, ' ');
    for(let i=0;i<6;i++){
      const next=text.replace(/\\+(["'“”״])/g,'$1').replace(/\\+(?=&(?:#\d+|#x[a-f0-9]+|[a-z]+);)/gi,'').replace(/&(?:#\d+|#x[a-f0-9]+|[a-z]+);/gi,entity=>{decoder.innerHTML=entity;return decoder.value;});
      if(next===text)break;text=next;
    }
    // Escape source HTML before interpreting the bank's Markdown. Links and
    // Markdown images are text only; exam images come from the copied manifest.
    box.innerHTML = marked.parse(escape(text));
    for (const node of box.querySelectorAll('a,img')) node.replaceWith(document.createTextNode(node.textContent || node.getAttribute('alt') || ''));
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.data.split(/(\([^()]*\))/g);
      if (parts.length < 2) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (/^\(\s*[A-Za-z]/.test(part)) {
          const bdi = document.createElement('bdi'); bdi.dir = 'ltr'; bdi.textContent = part; fragment.append(bdi);
        } else fragment.append(document.createTextNode(part));
      }
      node.replaceWith(fragment);
    }
    return box.innerHTML;
  }
  const PAPER_KEY='hazzard-mcq-papers-v1';
  const defaultSettings=()=>({length:50,sources:['past','practice'],year:'all',level:'all'});
  function validPaper(value){
    const p=value?.paper,s=value?.settings;
    if(!record(value)||value.version!==1||!Number.isFinite(value.at)||!record(s)||![25,50,100].includes(s.length)||!Array.isArray(s.sources)||new Set(s.sources).size!==s.sources.length||!s.sources.every(x=>['past','practice','law'].includes(x))||!(/^(all|\d{4})$/.test(s.year))||!['all','Basic','Subspec','unspecified'].includes(s.level))return false;
    return p===null||record(p)&&[25,50,100].includes(p.size)&&Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=100&&new Set(p.ids).size===p.ids.length&&p.ids.every(id=>/^mcq-[a-f0-9]{24}$/.test(id))&&validStore({version:1,answers:p.answers})&&Object.keys(p.answers).every(id=>p.ids.includes(id))&&typeof p.finished==='boolean'&&typeof p.retry==='boolean'&&Number.isInteger(p.position)&&p.position>=0&&p.position<p.ids.length&&Number.isFinite(p.at);
  }
  function readPaper(){const raw=localStorage.getItem(PAPER_KEY);if(raw===null)return null;const value=JSON.parse(raw);if(!validPaper(value))throw Error('Unreadable saved MCQ paper');return value;}
  function mergePaper(current,incoming){return current.at>=incoming.at?current:incoming;}
  function shuffle(items){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result;}
  function mount({chapter,viewport,readerScroll,onShow,onNotes,openImage}){
    const bankMode=chapter==='bank',mockMode=chapter==='mock';
    const host=document.createElement('section');host.id='mcqViewport';host.hidden=true;host.setAttribute('aria-label',bankMode?'Question bank':mockMode?'Mock paper':'Exam questions');viewport.append(host);
    let items=[],topics=[],filter='all',year='all',level='all',topic='all',sort='source',position=0,loaded=false,busy=false,paper=null,paperPending=false,storageError='',missedOnly=bankMode&&location.hash==='#missed',building=mockMode,settings=defaultSettings();
    const answers=new Map(),pending=new Map();
    let missedIds=null;
    function sync(){
      try{const saved=mockMode?readPaper():readStore();if(mockMode){if(saved&&!paperPending){paper=saved.paper;settings=saved.settings;}if(paper)position=paper.position;}else{answers.clear();for(const [id,a]of Object.entries(saved.answers))answers.set(id,a)}storageError='';}
      catch{storageError='Saved answers could not be read. Existing data has not been overwritten.';}
      for(const [id,a]of pending)answers.set(id,a);
      if(loaded)render();
    }
    function save(){
      try{
        if(pending.size){const saved=mergeStore(readStore(),{version:1,answers:Object.fromEntries(pending)});localStorage.setItem(KEY,JSON.stringify(saved));for(const id of pending.keys())answers.set(id,saved.answers[id]);pending.clear();}
        if(mockMode){if(paper){paper.position=position;paper.at=Date.now();}localStorage.setItem(PAPER_KEY,JSON.stringify({version:1,settings,paper,at:Date.now()}));paperPending=false;}
        storageError='';
      }catch{storageError='Answers could not be saved. Keep this page open and try again.';if(mockMode)paperPending=true;}
    }
    const controller={active:false,get hasUnsaved(){return pending.size>0||paperPending},sync,
      show(){controller.active=true;host.hidden=false;readerScroll.style.visibility='hidden';readerScroll.inert=true;onShow();if(!loaded)load();},
      notes(){controller.active=false;host.hidden=true;readerScroll.style.visibility='';readerScroll.inert=false;onNotes();}
    };
    const empty=()=>({selected:null,checked:false});
    function stateFor(q){return mockMode?(paper.answers[q.id]||empty()):(answers.get(q.id)||empty());}
    function visible(){
      if(mockMode){const byId=new Map(items.map(q=>[q.id,q]));return paper?paper.ids.map(id=>byId.get(id)).filter(Boolean):[];}
      if(missedOnly&&missedIds===null)missedIds=new Set(items.filter(q=>answers.get(q.id)?.checked&&!q.accepted.includes(answers.get(q.id).selected)).map(q=>q.id));
      let list=items.filter(q=>(filter==='all'||filter==='law'&&q.law||q.kind===filter)&&(year==='all'||q.t.startsWith(year))&&(level==='all'||(level==='unspecified'?!/-(Basic|Subspec)$/.test(q.t):q.t.endsWith('-'+level)))&&(topic==='all'||q.topic===Number(topic))&&(!missedOnly||missedIds.has(q.id)));
      if(bankMode)list.sort((a,b)=>sort==='topic'?(topics[a.topic]||'').localeCompare(topics[b.topic]||'')||a.t.localeCompare(b.t)||a.sourceIndex-b.sourceIndex:a.t.localeCompare(b.t)||a.topic-b.topic||a.sourceIndex-b.sourceIndex);
      return list;
    }
    function selection(name,value,choices,label){return '<label>'+label+'<select data-select="'+name+'">'+choices.map(([v,text])=>'<option value="'+escape(v)+'" '+(String(v)===value?'selected':'')+'>'+escape(text)+'</option>').join('')+'</select></label>';}
    function header(list){
      const title=bankMode?'Question bank':mockMode?'Mock paper'+(paper.retry?' · Retry missed':''):'Exam questions';
      let html='<div class="mcq-heading"><div><p class="eyebrow">'+(bankMode?'ALL BANK TOPICS':mockMode?'PRACTICE':'CHAPTER '+chapter+' · STUDY')+'</p><h1>'+title+'</h1></div>'+(!bankMode&&!mockMode?'<button data-mcq="notes" class="quiet">Study notes</button>':'')+'</div>';
      if(bankMode){
        html+='<div class="mcq-bank-filters">'+selection('source',filter,[['all','All sources'],['past','Shlav A past exams'],['practice','Hazzard practice'],['law','Israeli law / ethics']],'Source')+selection('topic',topic,[['all','All topics'],...topics.map((t,i)=>[String(i),t])],'Topic')+selection('year',year,[['all','All years'],...[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse().map(y=>[y,y])],'Year')+selection('level',level,[['all','All sittings'],['Basic','Basic'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Sitting')+selection('sort',sort,[['source','Source'],['topic','Topic']],'Sort by')+'</div>';
        html+='<label class="mcq-missed-filter"><input type="checkbox" data-select="missed" '+(missedOnly?'checked':'')+'> Missed only</label><p class="meta">'+list.length+' matching questions · Israeli law uses the bank’s regulatory/ethics index.</p>';
      }else if(!mockMode)html+='<nav class="mcq-filters" aria-label="Question type">'+[['all','All'],['past','Past exams'],['practice','Practice']].map(([id,label])=>'<button data-filter="'+id+'" aria-pressed="'+(filter===id)+'">'+label+'</button>').join('')+'</nav>';
      html+='<p class="meta mcq-count">'+(list.length?(position+1)+' of '+list.length:'0 questions')+'</p>';
      if(mockMode)html+='<button class="quiet" data-mcq="builder">Mock builder</button>';
      if(storageError)html+='<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>';
      return html;
    }
    function score(list){
      const correct=list.filter(q=>{const s=stateFor(q);return s.checked&&q.accepted.includes(s.selected)}).length,answered=list.filter(q=>stateFor(q).checked).length;
      return '<section class="mcq-score"><h2>Paper complete</h2><p class="mcq-score-value">'+correct+' / '+list.length+'</p><p>'+Math.round(100*correct/list.length)+'% correct · '+(answered-correct)+' incorrect · '+(list.length-answered)+' unanswered</p><button data-mcq="retry-missed" '+(correct===list.length?'disabled':'')+'>Retry missed ('+(list.length-correct)+')</button> <button data-mcq="review">Review answers</button><p class="meta">Retry includes unanswered questions.</p></section>';
    }
    function render(){
      if(mockMode&&building){renderBuilder();return;}
      const list=visible();position=Math.min(position,Math.max(0,list.length-1));const q=list[position];
      host.innerHTML='<div class="mcq-page">'+header(list)+'<div class="mcq-question"></div></div>';const content=host.querySelector('.mcq-question');
      if(mockMode&&paper.finished){content.innerHTML=score(list);return;}
      if(!q){content.innerHTML='<p>No questions match these filters.</p>'+(!bankMode&&!mockMode?'<button data-mcq="notes">Open study notes</button>':'');return;}
      const state=stateFor(q),accepted=q.accepted||[q.c],correct=accepted.includes(state.selected),letters=['א','ב','ג','ד','ה'];content.dataset.bankId=q.id;
      content.innerHTML='<span class="'+(q.kind==='past'?'exam-badge':'mcq-practice-tag')+'">'+(q.kind==='past'?'Past exam · '+escape(q.t):'Practice · Hazzard-based')+'</span>'+(bankMode||mockMode?'<p class="meta mcq-topic-label">'+escape(topics[q.topic]||'')+(q.chapter?' · Hazzard chapter '+escape(q.chapter):'')+'</p>':'')+'<div class="mcq-stem mcq-mixed" dir="auto" lang="he">'+rich(q.q)+'</div>'+
        (q.images||[]).map((url,i)=>'<button class="mcq-image" data-image="'+i+'" aria-label="Enlarge question image '+(i+1)+'"><img src="'+escape(url)+'" alt="Question image '+(i+1)+'" loading="lazy"></button>').join('')+
        '<div class="mcq-options" role="group" aria-label="Answer options" dir="rtl">'+q.o.map((option,i)=>'<button class="mcq-option '+(state.selected===i?'selected ':'')+(state.checked&&accepted.includes(i)?'correct ':'')+(state.checked&&state.selected===i&&!correct?'wrong':'')+'" data-option="'+i+'" aria-pressed="'+(state.selected===i)+'" '+(state.checked?'disabled':'')+'><span class="mcq-letter">'+(state.checked&&accepted.includes(i)?'✓':state.checked&&state.selected===i?'✕':letters[i]||String(i+1))+'</span><span class="mcq-mixed" dir="auto" lang="he">'+rich(option)+'</span></button>').join('')+'</div>'+
        '<div class="mcq-actions"><button class="mcq-pill mcq-check" data-mcq="check" '+(state.selected===null||state.checked?'disabled':'')+'>Check</button><button class="mcq-pill" data-mcq="retry" '+(state.selected===null?'hidden':'')+'>Try again</button><button class="mcq-pill" data-mcq="prev" '+(position===0?'disabled':'')+'>Prev</button><button class="mcq-pill" data-mcq="next" '+(!mockMode&&position>=list.length-1?'disabled':'')+'>Next</button></div>'+
        (state.checked?'<p class="mcq-result '+(correct?'correct':'wrong')+'" dir="rtl" role="status">'+(correct?'✓ תשובה נכונה':'✕ תשובה שגויה · '+(accepted.length>1?'תשובות מתקבלות: ':'התשובה הנכונה: ')+accepted.map(i=>letters[i]||String(i+1)).join(', '))+'</p><section class="mcq-explanation" dir="auto" lang="he"><h3 dir="rtl">הסבר</h3><div class="mcq-mixed" dir="auto">'+(q.explanation?rich(q.explanation):'<p>אין הסבר במאגר לשאלה זו.</p>')+'</div></section>':'')+'<p class="mcq-source" dir="ltr">'+escape(sourceLabel(q))+'</p>';
      for(const image of content.querySelectorAll('img'))image.onerror=()=>{image.parentElement.replaceWith(Object.assign(document.createElement('p'),{textContent:'Question image unavailable. Reconnect to finish downloading the reader.'}));for(const b of content.querySelectorAll('[data-option],[data-mcq="check"]'))b.disabled=true;};
    }
    function builderPool(){
      return [...new Map(items.filter(q=>(settings.sources.includes(q.kind)||settings.sources.includes('law')&&q.law)&&(q.kind!=='past'||(settings.year==='all'||q.t.startsWith(settings.year))&&(settings.level==='all'||(settings.level==='unspecified'?!/-(Basic|Subspec)$/.test(q.t):q.t.endsWith('-'+settings.level))))).map(q=>[q.id,q])).values()];
    }
    function renderBuilder(){
      const pool=builderPool(),years=[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse();
      host.innerHTML='<div class="mcq-page"><p class="eyebrow">PRACTICE</p><h1>Mock builder</h1><h2>Length</h2><div class="mcq-filters">'+[25,50,100].map(n=>'<button data-length="'+n+'" aria-pressed="'+(settings.length===n)+'">'+n+'</button>').join('')+'</div><h2>Sources</h2><div class="mcq-source-choices">'+[['past','Shlav A past exams'],['practice','Hazzard practice'],['law','Israeli law / ethics']].map(([id,label])=>'<button data-source="'+id+'" aria-pressed="'+settings.sources.includes(id)+'">'+label+'</button>').join('')+'</div><div class="mcq-bank-filters">'+selection('mock-year',settings.year,[['all','All years'],...years.map(y=>[y,y])],'Past-exam year')+selection('mock-level',settings.level,[['all','All sittings'],['Basic','Basic'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Past-exam sitting')+'</div><p class="mcq-pool-count" role="status">'+(pool.length<settings.length?'Only '+pool.length+' matching questions are available; this paper will use all '+pool.length+'.':pool.length+' matching questions · '+settings.length+' will be drawn at random.')+'</p><p class="meta">Choose any combination. Law overlaps are included once. Year and sitting filters apply to past-exam questions.</p><button data-mcq="start" class="primary" '+(!pool.length?'disabled':'')+'>Start paper</button>'+(paper?' <button data-mcq="resume">Resume current paper</button>':'')+(storageError?'<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>':'')+'</div>';
    }
    function newPaper(){
      const chosen=shuffle(builderPool()).slice(0,settings.length);if(!chosen.length)return;
      paper={size:settings.length,ids:chosen.map(q=>q.id),answers:{},finished:false,retry:false,position:0,at:Date.now()};position=0;building=false;paperPending=true;save();
      const url=new URL(location.href);url.searchParams.delete('n');url.searchParams.set('run','1');history.replaceState(history.state,'',url);
    }
    async function load(){
      if(busy)return;busy=true;host.innerHTML='<div class="mcq-page"><p role="status">Loading questions…</p></div>';
      try{
        [items,topics]=await Promise.all([json('data/mcq/'+(bankMode||mockMode?'all':chapter)+'.json'),json('data/mcq/topics.json')]);
        if(mockMode){
          const url=new URL(location.href),n=url.searchParams.get('n');
          if(storageError)throw Error(storageError);
          building=n==='builder'||!paper||!(n==='resume'||url.searchParams.get('run')==='1');
          const available=new Set(items.map(q=>q.id));if(paper&&!paper.ids.every(id=>available.has(id))){building=true;storageError='Some saved paper questions are unavailable in this release. Start a new paper.';}
        }
        loaded=true;render();
      }catch(error){host.innerHTML='<div class="mcq-page"><p role="alert">'+escape(error.message||'Questions could not be loaded.')+'</p><button data-mcq="load">Try again</button>'+(!bankMode&&!mockMode?' <button data-mcq="notes">Study notes</button>':'')+'</div>';}
      finally{busy=false;}
    }
    function commit(q,state){state.at=Date.now();answers.set(q.id,state);pending.set(q.id,state);if(mockMode){paper.answers[q.id]=state;paperPending=true;}save();}
    host.addEventListener('change',event=>{const name=event.target.dataset.select;if(!name)return;const value=event.target.value;
      if(name==='mock-year'||name==='mock-level'){settings[name==='mock-year'?'year':'level']=value;save();render();return;}
      if(name==='source'){filter=value;year='all';level='all';}else if(name==='year')year=value;else if(name==='level')level=value;else if(name==='topic')topic=value;else if(name==='sort')sort=value;else if(name==='missed'){missedOnly=event.target.checked;missedIds=null;}
      position=0;render();host.scrollTop=0;
    });
    host.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!host.contains(button)||button.disabled)return;const action=button.dataset.mcq;
      if(action==='notes'){controller.notes();return;}if(action==='load'){load();return;}if(action==='save'){save();render();return;}
      if(button.dataset.length){settings.length=Number(button.dataset.length);save();render();return;}
      if(button.dataset.source){const id=button.dataset.source;settings.sources=settings.sources.includes(id)?settings.sources.filter(s=>s!==id):[...settings.sources,id];save();render();return;}
      if(action==='start'){newPaper();render();host.scrollTop=0;return;}
      if(action==='builder'){building=true;const url=new URL(location.href);url.searchParams.delete('run');url.searchParams.delete('n');history.replaceState(history.state,'',url);render();host.scrollTop=0;return;}
      if(action==='resume'){building=false;position=paper.position;const url=new URL(location.href);url.searchParams.delete('n');url.searchParams.set('run','1');history.replaceState(history.state,'',url);render();return;}
      if(button.dataset.filter){filter=button.dataset.filter;position=0;render();host.scrollTop=0;return;}
      const list=visible();
      if(action==='review'){paper.finished=false;position=0;save();render();host.scrollTop=0;return;}
      if(action==='retry-missed'){const missed=list.filter(q=>{const s=stateFor(q);return !s.checked||!q.accepted.includes(s.selected)});paper.ids=missed.map(q=>q.id);paper.answers={};paper.finished=false;paper.retry=true;position=0;save();render();host.scrollTop=0;return;}
      const q=list[position];if(!q)return;if(button.dataset.image!==undefined){openImage(button.querySelector('img'));return;}
      const state={...stateFor(q)};
      if(action==='next'||action==='prev'){
        if(state.selected!==null&&!state.checked){state.checked=true;commit(q,state);render();host.querySelector('.mcq-result')?.scrollIntoView({block:'nearest'});return;}
        if(action==='next'&&position===list.length-1&&mockMode){paper.finished=true;save();render();host.scrollTop=0;return;}
        position+=action==='next'?1:-1;if(mockMode)save();render();host.scrollTop=0;return;
      }
      if(button.dataset.option!==undefined&&!state.checked)state.selected=Number(button.dataset.option);
      else if(action==='check'&&state.selected!==null)state.checked=true;
      else if(action==='retry'){state.selected=null;state.checked=false;}
      else return;
      commit(q,state);const y=host.scrollTop;render();host.scrollTop=y;
      const target=button.dataset.option!==undefined?'[data-option="'+state.selected+'"]':action==='check'?'[data-mcq="retry"]':'[data-option="0"]';host.querySelector(target)?.focus({preventScroll:true});
    });
    sync();addEventListener('storage',event=>{if(event.key===KEY||event.key===PAPER_KEY||event.key===null)sync()});addEventListener('pageshow',event=>{if(event.persisted)sync()});
    return controller;
  }
  return {KEY,PAPER_KEY,validStore,validPaper,mergeStore,mergePaper,readPaper,loadIndex,mount};
})();
