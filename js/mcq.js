/* MCQs use only their own store. Existing notebook, drill and progress formats
   are unchanged. Content-derived IDs prevent answers moving to another item. */
window.HazzardMCQ = (() => {
  const KEY = 'hazzard-mcq-v1';
  const MIGRATION_KEY='hazzard-mcq-id-aliases-v53-r1';
  let aliases={},aliasesPromise;
  const currentId=id=>aliases[id]||id;
  function loadAliases(){return aliasesPromise ||= json('data/mcq/id-aliases.json').then(value=>{aliases=value;}).catch(error=>{aliasesPromise=null;throw error;});}
  function currentAnswers(source){
    const answers={};
    // Prefer the canonical record on a timestamp tie, including Undo tombstones.
    for(const [id,a] of Object.entries(source).sort(([a],[b])=>Number(!!aliases[b])-Number(!!aliases[a]))){
      const target=currentId(id);if(!answers[target]||a.at>=answers[target].at)answers[target]=a;
    }
    return answers;
  }
  function migrateValue(key,value){
    // Keep every historical record. Canonical copies allow old and new clients
    // to coexist; read-time resolution also covers papers without changing IDs.
    return key===KEY?{...value,answers:{...value.answers,...currentAnswers(value.answers)}}:value;
  }
  async function migrateSaved(){
    await loadAliases();
    if(localStorage.getItem(MIGRATION_KEY)==='1')return;
    for(;;){
      const raw=localStorage.getItem(KEY);
      const next=raw===null?null:JSON.stringify(migrateValue(KEY,readStore(false)));
      await HazzardStorage.snapshot();
      if(HazzardStorage.status.error)throw Error(HazzardStorage.status.error);
      // Another open tab may save while the snapshot transaction is pending.
      if(localStorage.getItem(KEY)!==raw)continue;
      if(next!==raw)HazzardStorage.setItem(KEY,next);
      break;
    }
    HazzardStorage.setItem(MIGRATION_KEY,'1');
    await HazzardStorage.flush();
  }
  const FLAGS_KEY='hazzard-mcq-flags-v1',LAW_TOPICS=[30,31,32,33,34];
  const SYSTEM_KEY='hazzard-mcq-israeli-system-v1';
  const PRACTICE_LABEL='Hazzard practice - US framing';
  const LAW_NOTE='Official past-exam questions on Israeli law, health systems and ethics.';
  const normalizeSource=value=>['system','Law & ethics','Israeli law & system','Israeli law & ethics'].includes(value)?'law':value;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function validStore(value) {
    return record(value) && value.version === 1 && record(value.answers) && Object.entries(value.answers).every(([id,a]) =>
      /^mcq-[a-f0-9]{24}$/.test(id) && record(a) && (a.selected === null || Number.isInteger(a.selected) && a.selected >= 0 && a.selected <= 4) &&
      typeof a.checked === 'boolean' && (!a.checked || a.selected !== null) && Number.isFinite(a.at) && a.at >= 0);
  }
  function readStore(resolve=true) {
    const raw = localStorage.getItem(KEY), value = raw === null ? {version:1,answers:{}} : JSON.parse(raw);
    if (!validStore(value)) throw new Error('Unreadable MCQ answers');
    return resolve?{...value,answers:currentAnswers(value.answers)}:value;
  }
  function mergeStore(current, incoming) {
    const answers = {...incoming.answers};
    for (const [id,a] of Object.entries(current.answers)) if (!answers[id] || a.at >= answers[id].at) answers[id] = a;
    return {version:1,answers};
  }
  function validFlags(value){
    return record(value)&&value.version===1&&record(value.flags)&&record(value.lawTopics)&&Array.isArray(value.lawTopics.ids)&&new Set(value.lawTopics.ids).size===value.lawTopics.ids.length&&value.lawTopics.ids.every(t=>LAW_TOPICS.includes(t))&&Number.isFinite(value.lawTopics.at)&&Object.entries(value.flags).every(([id,f])=>/^mcq-[a-f0-9]{24}$/.test(id)&&record(f)&&typeof f.hidden==='boolean'&&Number.isFinite(f.at)&&Array.isArray(f.scopes)&&f.scopes.length>0&&new Set(f.scopes).size===f.scopes.length&&f.scopes.every(s=>/^(?:topic:\d{1,3}|source:(?:past|practice|law)|chapter:(?:\d+|law)|mock)$/.test(s)));
  }
  function readFlags(){const raw=localStorage.getItem(FLAGS_KEY),value=raw===null?{version:1,flags:{},lawTopics:{ids:[],at:0}}:JSON.parse(raw);if(!validFlags(value))throw Error('Unreadable personal topic flags');return value;}
  function mergeFlags(current,incoming){const flags={...incoming.flags};for(const[id,f]of Object.entries(current.flags))if(!flags[id]||f.at>=flags[id].at)flags[id]=f;return{version:1,flags,lawTopics:current.lawTopics.at>=incoming.lawTopics.at?current.lawTopics:incoming.lawTopics};}
  function validSystem(value){return record(value)&&value.version===1&&typeof value.selected==='boolean'&&Number.isFinite(value.at)&&record(value.flags)&&Object.entries(value.flags).every(([id,f])=>/^mcq-[a-f0-9]{24}$/.test(id)&&record(f)&&typeof f.hidden==='boolean'&&Number.isFinite(f.at));}
  function readSystem(){const raw=localStorage.getItem(SYSTEM_KEY),value=raw===null?{version:1,selected:false,at:0,flags:{}}:JSON.parse(raw);if(!validSystem(value))throw Error('Unreadable Israeli law & system choices');return value;}
  function mergeSystem(current,incoming){const flags={...incoming.flags};for(const[id,f]of Object.entries(current.flags))if(!flags[id]||f.at>=flags[id].at)flags[id]=f;const newest=current.at>=incoming.at?current:incoming;return{version:1,selected:newest.selected,at:newest.at,flags};}
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
    if (q.kind === 'practice') return PRACTICE_LABEL;
    const match = /^(\d{4})(?:-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?(?:-(Subspec|Basic))?$/.exec(q.t);
    if (!match) return 'Shlav A';
    return 'Shlav A ' + (match[2] ? match[2] + ' ' : '') + match[1] + ' · Subspecialty' + (q.examNumber ? ' · Q' + q.examNumber : '');
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
    // Markdown creates independent paragraphs, list items and table cells.
    // Let each block choose its own base direction before isolating Latin runs.
    for (const block of box.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th')) block.dir = 'auto';
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const block = node.parentElement.closest('[dir="auto"]');
      // Keep the leading Latin text visible to dir=auto in English paragraphs.
      if (/^[^A-Za-z\u0590-\u05ff]*[A-Za-z]/.test(block?.textContent || '')) continue;
      const fragment = document.createDocumentFragment();
      // Keep terms, doses and numeric ranges in logical LTR order. Leave source
      // characters intact; CSS separates terms glued to Hebrew in the import.
      const runs = /\([ \t]*[A-Za-z0-9][A-Za-z0-9 \t.,;:/+%\u2212\u2013\u2192\u2190<>=-]*\)|[A-Za-z0-9]+(?:[./:+%−–-][A-Za-z0-9]+)*(?:[ \t]+[A-Za-z0-9]+(?:[./:+%−–-][A-Za-z0-9]+)*)*%?/g;
      let end = 0;
      for (const match of node.data.matchAll(runs)) {
        fragment.append(document.createTextNode(node.data.slice(end, match.index)));
        const bdi = document.createElement('bdi'); bdi.dir = 'ltr'; bdi.textContent = match[0];
        end = match.index + match[0].length;
        if (/[\u0590-\u05ff]/.test(node.data[match.index - 1] || '')) bdi.classList.add('mcq-gap-before');
        if (/[\u0590-\u05ff]/.test(node.data[end] || '')) bdi.classList.add('mcq-gap-after');
        fragment.append(bdi);
      }
      fragment.append(document.createTextNode(node.data.slice(end)));
      node.replaceWith(fragment);
    }
    return box.innerHTML;
  }
  const PAPER_KEY='hazzard-mcq-papers-v1';
  const defaultSettings=()=>({length:50,sources:['past','practice'],year:'all',level:'all'});
  function validPaper(value){
    const p=value?.paper,s=value?.settings;
    if(!record(value)||value.version!==1||!Number.isFinite(value.at)||!record(s)||![25,50,100].includes(s.length)||!Array.isArray(s.sources)||new Set(s.sources).size!==s.sources.length||!s.sources.every(x=>['past','practice','law'].includes(normalizeSource(x)))||!(/^(all|\d{4})$/.test(s.year))||!['all','Basic','Subspec','unspecified'].includes(s.level))return false;
    return p===null||record(p)&&[25,50,100].includes(p.size)&&Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=100&&new Set(p.ids).size===p.ids.length&&p.ids.every(id=>/^mcq-[a-f0-9]{24}$/.test(id))&&validStore({version:1,answers:p.answers})&&Object.keys(p.answers).every(id=>p.ids.includes(id))&&typeof p.finished==='boolean'&&typeof p.retry==='boolean'&&Number.isInteger(p.position)&&p.position>=0&&p.position<p.ids.length&&Number.isFinite(p.at);
  }
  function readPaper(){const raw=localStorage.getItem(PAPER_KEY);if(raw===null)return null;const value=JSON.parse(raw);if(!validPaper(value))throw Error('Unreadable saved MCQ paper');return {...value,settings:{...value.settings,sources:[...new Set(value.settings.sources.map(normalizeSource))]}};}
  function mergePaper(current,incoming){return current.at>=incoming.at?current:incoming;}
  function shuffle(items){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result;}
  function mount({chapter,viewport,readerScroll,onShow,onNotes,openImage}){
    const bankMode=chapter==='bank',mockMode=chapter==='mock';
    const host=document.createElement('section');host.id='mcqViewport';host.hidden=true;host.setAttribute('aria-label',bankMode?'Question bank':mockMode?'Mock paper':'Exam questions');viewport.append(host);
    let items=[],topics=[],filter='all',year='all',level='all',topic='all',sort='source',position=0,loaded=false,busy=false,paper=null,paperPending=false,storageError='',missedOnly=bankMode&&location.hash==='#missed',building=mockMode,settings=defaultSettings();
    const answers=new Map(),pending=new Map(),retryAnswers=new Map(),dismissed=new Set();
    let personal={version:1,flags:{},lawTopics:{ids:[],at:0}},flagsView=bankMode&&location.hash==='#flags',notice='';
    let systemPrefs={version:1,selected:false,at:0,flags:{}},collections={israeliSystem:{enabled:false,ids:[]},topicFallbacks:{}},lawIds=new Set(),articleIds=new Set(),articleSelected=false,lastAnswer=null;
    let missedIds=null;
    function sync(){
      let flagsError='';try{personal=readFlags();systemPrefs=readSystem();}catch{flagsError='Personal topic flags or source choices could not be read. Existing data has not been overwritten.';}
      try{const saved=mockMode?readPaper():readStore();if(mockMode){if(saved&&!paperPending){paper=saved.paper;settings=saved.settings;}if(paper)position=paper.position;}else{answers.clear();for(const [id,a]of Object.entries(saved.answers))answers.set(id,a)}storageError='';}
      catch{storageError='Saved answers could not be read. Existing data has not been overwritten.';}
      for(const [id,a]of pending)answers.set(id,a);
      if(flagsError)storageError=flagsError;
      if(settings.level==='Basic')settings={...settings,level:'Subspec'};
      if(loaded)render();
    }
    function save(){
      try{
        if(pending.size){const saved=mergeStore(readStore(false),{version:1,answers:Object.fromEntries(pending)});HazzardStorage.setItem(KEY,JSON.stringify(saved));for(const id of pending.keys())answers.set(id,saved.answers[id]);pending.clear();}
        if(mockMode){if(paper){paper.position=position;paper.at=Date.now();}HazzardStorage.setItem(PAPER_KEY,JSON.stringify({version:1,settings,paper,at:Date.now()}));paperPending=false;}
        storageError='';
      }catch{storageError='Answers could not be saved. Keep this page open and try again.';if(mockMode)paperPending=true;}
    }
    const controller={active:false,get hasUnsaved(){return pending.size>0||paperPending},sync,save,
      show(){controller.active=true;host.hidden=false;readerScroll.style.visibility='hidden';readerScroll.inert=true;onShow();if(!loaded)load();else render();},
      notes(){lastAnswer=null;controller.active=false;host.hidden=true;readerScroll.style.visibility='';readerScroll.inert=false;onNotes();}
    };
    const empty=()=>({selected:null,checked:false});
    const flagged=(q,scope)=>(['source:law','source:system'].includes(scope)&&!!systemPrefs.flags[q.id]?.hidden)||!!(personal.flags[q.id]?.hidden&&personal.flags[q.id].scopes.includes(scope));
    const lawSelected=()=>settings.sources.includes('law')||systemPrefs.selected;
    function activeFlags(){const entries=new Map(Object.entries(personal.flags).filter(([,f])=>f.hidden).map(([id,f])=>[id,{...f,scopes:[...f.scopes]}]));for(const[id,f]of Object.entries(systemPrefs.flags))if(f.hidden){const item=entries.get(id)||{hidden:true,at:f.at,scopes:[]};item.scopes.push('source:system');item.at=Math.max(item.at,f.at);entries.set(id,item)}return [...entries];}
    const flagCount=()=>activeFlags().length;
    const sourceChoices=()=>[['past','Shlav A past papers (official sittings)'],['practice','Hazzard practice'],['law','Israeli law & ethics'],...(collections.suppliedArticles?.enabled?[['articles','Supplied articles']]:[])];
    const topicChoices=()=>topics.map((name,i)=>[String(i),name]).filter(([id])=>filter!=='law'||items.some(q=>lawIds.has(q.id)&&q.topic===Number(id))).sort((a,b)=>a[1].localeCompare(b[1],'en',{sensitivity:'base'}));
    const scopeLabel=scope=>scope.startsWith('topic:')?(topics[Number(scope.slice(6))]||scope):({'source:law':'Israeli law & ethics','source:past':'Shlav A past exams','source:practice':PRACTICE_LABEL,'source:system':'Israeli law & ethics','chapter:law':'Law study','mock':'Mock papers'}[scope]||scope.replace('chapter:','Chapter '));
    function writeFlag(q,undo=false){
      try{
        const saved=readFlags(),system=readSystem();let systemChanged=false;
        if(undo){if(saved.flags[q.id])saved.flags[q.id]={...saved.flags[q.id],hidden:false,at:Date.now()};if(system.flags[q.id]){system.flags[q.id]={hidden:false,at:Date.now()};systemChanged=true;}}
        else{
          const scopes=new Set(saved.flags[q.id]?.hidden?saved.flags[q.id].scopes:[]);scopes.add('topic:'+q.topic);
          if(bankMode&&filter!=='all'&&filter!=='system'&&filter!=='articles')scopes.add('source:'+filter);
          if(!bankMode&&!mockMode)scopes.add('chapter:'+chapter);
          if(chapter==='law'||lawIds.has(q.id)&&(filter==='law'||mockMode&&lawSelected()))scopes.add('source:law');
          if(mockMode){scopes.add('mock');if(settings.sources.includes(q.kind))scopes.add('source:'+q.kind);}
          saved.flags[q.id]={scopes:[...scopes],hidden:true,at:Date.now()};
        }
        HazzardStorage.setItem(FLAGS_KEY,JSON.stringify(saved));if(systemChanged)HazzardStorage.setItem(SYSTEM_KEY,JSON.stringify(system));personal=saved;systemPrefs=system;storageError='';
        if(undo){dismissed.delete(q.id);notice='Question restored to its filters.';}else{dismissed.add(q.id);notice='Hidden from '+saved.flags[q.id].scopes.map(scopeLabel).join(' · ')+'. Undo in Flags.';}
        return true;
      }catch{storageError='The topic flag could not be saved. This question has not been hidden.';return false;}
    }
    function flagsList(){
      const byId=new Map(items.map(q=>[q.id,q])),entries=activeFlags().sort((a,b)=>b[1].at-a[1].at);
      return '<h2>Topic flags</h2>'+(entries.length?entries.map(([id,f])=>{const q=byId.get(id);return '<section class="mcq-flag-row"><div class="mcq-mixed" dir="auto">'+rich(q?q.q:'Question no longer in the current bank')+'</div><p class="meta">'+escape(f.scopes.map(scopeLabel).join(' · '))+'</p><button class="quiet" data-undo-flag="'+id+'">Undo flag</button></section>';}).join(''):'<p>No topic flags.</p>');
    }
    function paperId(q){return paper.ids.filter(id=>currentId(id)===q.id).sort((a,b)=>(paper.answers[b]?.at??-1)-(paper.answers[a]?.at??-1))[0]||q.id;}
    function stateFor(q){return mockMode?(paper.answers[paperId(q)]||empty()):missedOnly?(retryAnswers.get(q.id)||empty()):(answers.get(q.id)||empty());}
    function visible(){
      if(mockMode){const byId=new Map(items.map(q=>[q.id,q]));return paper?paper.ids.map(id=>byId.get(currentId(id))).filter(q=>q&&q.mockEligible!==false&&!flagged(q,'mock')&&!dismissed.has(q.id)):[];}
      if(missedOnly&&missedIds===null)missedIds=new Set(items.filter(q=>answers.get(q.id)?.checked&&!q.accepted.includes(answers.get(q.id).selected)).map(q=>q.id));
      let list=items.filter(q=>!dismissed.has(q.id)&&(filter==='all'||filter==='law'&&lawIds.has(q.id)||filter==='articles'&&articleIds.has(q.id)||q.kind===filter)&&(filter==='all'||!flagged(q,'source:'+filter))&&(!['law','articles'].includes(filter)||!flagged(q,'topic:'+q.topic))&&(topic==='all'||!flagged(q,'topic:'+topic))&&(chapter!=='law'||!flagged(q,'source:law')&&(!q.law||!flagged(q,'topic:'+q.topic)))&&(bankMode||!flagged(q,'chapter:'+chapter))&&(year==='all'||q.t.startsWith(year))&&(level==='all'||(level==='unspecified'?!/-(Basic|Subspec)$/.test(q.t):q.t.endsWith('-'+level)))&&(topic==='all'||q.topic===Number(topic))&&(!missedOnly||missedIds.has(q.id)));
      if(bankMode)list.sort((a,b)=>(filter==='law'?(a.kind!=='past')-(b.kind!=='past'):0)||(sort==='topic'?(topics[a.topic]||'').localeCompare(topics[b.topic]||'')||a.t.localeCompare(b.t)||a.sourceIndex-b.sourceIndex:a.t.localeCompare(b.t)||a.topic-b.topic||a.sourceIndex-b.sourceIndex));
      return list;
    }
    function selection(name,value,choices,label){return '<label>'+label+'<select data-select="'+name+'">'+choices.map(([v,text])=>'<option value="'+escape(v)+'" '+(String(v)===value?'selected':'')+'>'+escape(text)+'</option>').join('')+'</select></label>';}
    function header(list){
      const title=bankMode?(flagsView?'Missed / flags':'Question bank'):mockMode?'Mock paper'+(paper.retry?' · Retry missed':''):'Exam questions';
      let html='<div class="mcq-heading"><div><p class="eyebrow">'+(bankMode?'ALL BANK TOPICS':mockMode?'PRACTICE':chapter==='law'?'ISRAELI LAW · STUDY':'CHAPTER '+chapter+' · STUDY')+'</p><h1>'+title+'</h1></div>'+(!bankMode&&!mockMode?'<button data-mcq="notes" class="quiet">Study notes</button>':'')+'</div>';
      if(bankMode)html+='<div class="mcq-view-links"><button class="quiet" data-mcq="questions" aria-pressed="'+!flagsView+'">Questions</button><button class="quiet" data-mcq="flags" aria-pressed="'+flagsView+'">Flags ('+flagCount()+')</button></div>';
      if(bankMode&&!flagsView){
        html+='<div class="mcq-bank-filters">'+selection('source',filter,[['all','All sources'],...sourceChoices()],'Source')+selection('topic',topic,[['all','All topics'],...topicChoices()],'Topic')+selection('year',year,[['all','All years'],...[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse().map(y=>[y,y])],'Year')+selection('level',level,[['all','All sittings'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Sitting')+selection('sort',sort,[['source','Source'],['topic','Topic']],'Sort by')+'<button class="mcq-missed-toggle" type="button" role="switch" data-mcq="missed" aria-checked="'+missedOnly+'"><span class="mcq-switch-track" aria-hidden="true"></span>Missed only</button></div>';
        html+='<p class="meta">'+list.length+' matching questions'+(filter==='law'?' · Official past exams only.':'')+'</p>';
      }else if(!mockMode&&!bankMode)html+='<nav class="mcq-filters" aria-label="Question type">'+[['all','All'],['past','Past exams'],['practice',PRACTICE_LABEL]].map(([id,label])=>'<button data-filter="'+id+'" aria-pressed="'+(filter===id)+'">'+label+'</button>').join('')+'</nav>';
      if(!flagsView)html+='<p class="meta mcq-count">'+(list.length?(position+1)+' of '+list.length:'0 questions')+'</p>';
      if(filter==='law'||chapter==='law')html+='<p class="meta mcq-law-note">'+(chapter==='law'?'Israeli law: past-exam items are the target; Hazzard items use US law':LAW_NOTE)+'</p>';
      if(collections.topicFallbacks[chapter])html+='<p class="meta mcq-topic-fallback">Questions by topic: '+escape(collections.topicFallbacks[chapter].name)+'</p>';
      if(mockMode)html+='<p class="meta">'+Object.values(paper.answers).filter(a=>a.checked).length+' answered (including saved unavailable questions)</p><button class="quiet" data-mcq="builder">Mock builder</button>';
      if(storageError)html+='<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>';
      if(notice)html+='<p class="meta" role="status">'+escape(notice)+' <a href="?chapter=bank#flags">Review flags</a></p>';
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
      if(bankMode&&flagsView){content.innerHTML=flagsList();return;}
      if(!q){content.innerHTML='<p>No questions match these filters.</p>'+(!bankMode&&!mockMode?'<button data-mcq="notes">Open study notes</button>':'');return;}
      if(mockMode&&paper.finished){content.innerHTML=score(list);return;}
      const state=stateFor(q),canUndo=lastAnswer?.id===q.id&&lastAnswer.at===state.at&&state.checked,accepted=q.accepted||[q.c],correct=accepted.includes(state.selected),letters=['א','ב','ג','ד','ה'];content.dataset.bankId=q.id;
      content.innerHTML='<span class="'+(q.kind==='past'?'exam-badge':'mcq-practice-tag')+'">'+(escape(sourceLabel(q)))+'</span><p class="meta mcq-topic-label">'+escape(topics[q.topic]||'')+(q.chapter?' · Reader chapter '+escape(q.chapter):'')+' <button class="mcq-topic-flag" data-mcq="flag" aria-label="Wrong topic: '+escape(topics[q.topic]||'this question')+'">'+(personal.flags[q.id]?.hidden||systemPrefs.flags[q.id]?.hidden?'Flagged':'Wrong topic')+'</button></p>'+(q.label?'<p class="mcq-source-note" role="note">'+escape(q.label)+'</p>':'')+'<div class="mcq-stem mcq-mixed" dir="auto" lang="he">'+rich(q.q)+'</div>'+
        (q.images||[]).map((url,i)=>'<button class="mcq-image" data-image="'+i+'" aria-label="Enlarge question image '+(i+1)+'"><img src="'+escape(url)+'" alt="Question image '+(i+1)+'" loading="lazy"></button>').join('')+
        '<div class="mcq-options" role="group" aria-label="Answer options" dir="rtl">'+q.o.map((option,i)=>'<button class="mcq-option '+(state.selected===i?'selected ':'')+(state.checked&&accepted.includes(i)?'correct ':'')+(state.checked&&state.selected===i&&!correct?'wrong':'')+'" data-option="'+i+'" aria-pressed="'+(state.selected===i)+'" '+(state.checked?'disabled':'')+'><span class="mcq-letter">'+(state.checked&&accepted.includes(i)?'✓':state.checked&&state.selected===i?'✕':letters[i]||String(i+1))+'</span><span class="mcq-mixed" dir="auto" lang="he">'+rich(option)+'</span></button>').join('')+'</div>'+
        '<div class="mcq-actions"><button class="mcq-pill" data-mcq="prev" '+(position===0?'disabled':'')+'>Prev</button><button class="mcq-pill" data-mcq="next" '+(!mockMode&&position>=list.length-1?'disabled':'')+'>Next</button></div>'+
        (state.checked?'<p class="mcq-result '+(correct?'correct':'wrong')+'" dir="rtl" role="status">'+(correct?'✓ תשובה נכונה':'✕ תשובה שגויה · '+(accepted.length>1?'תשובות מתקבלות: ':'התשובה הנכונה: ')+accepted.map(i=>letters[i]||String(i+1)).join(', '))+(canUndo?' <button class="mcq-answer-undo" data-mcq="undo" dir="ltr">Undo</button>':'')+'</p><section class="mcq-explanation" dir="auto" lang="he"><h3 dir="rtl">הסבר</h3><div class="mcq-mixed" dir="auto">'+(q.explanation?rich(q.explanation):'<p>אין הסבר במאגר לשאלה זו.</p>')+'</div></section>':'')+'<p class="mcq-source" dir="auto">'+escape(sourceLabel(q))+'<br>'+escape(q.sourceType==='Other'?'Other source · '+q.ref:q.ref)+(q.referenceSource?'<br>'+escape(q.referenceSource):'')+(q.keySource?'<br>'+escape(q.keySource):'')+'</p>';
      for(const image of content.querySelectorAll('img'))image.onerror=()=>{image.parentElement.replaceWith(Object.assign(document.createElement('p'),{textContent:'Question image unavailable. Reconnect to finish downloading the reader.'}));for(const b of content.querySelectorAll('[data-option]'))b.disabled=true;};
    }
    function builderPool(){
      return [...new Map(items.filter(q=>q.mockEligible!==false&&!flagged(q,'mock')&&(articleSelected&&articleIds.has(q.id)&&!flagged(q,'topic:'+q.topic)||settings.sources.includes(q.kind)&&!flagged(q,'source:'+q.kind)||lawSelected()&&lawIds.has(q.id)&&!flagged(q,'source:law')&&!flagged(q,'topic:'+q.topic))&&(q.kind!=='past'||(settings.year==='all'||q.t.startsWith(settings.year))&&(settings.level==='all'||(settings.level==='unspecified'?!/-(Basic|Subspec)$/.test(q.t):q.t.endsWith('-'+settings.level))))).map(q=>[q.id,q])).values()];
    }
    function renderBuilder(){
      const pool=builderPool(),years=[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse();
      host.innerHTML='<div class="mcq-page"><p class="eyebrow">PRACTICE</p><h1>Mock builder</h1><h2>Length</h2><div class="mcq-filters">'+[25,50,100].map(n=>'<button data-length="'+n+'" aria-pressed="'+(settings.length===n)+'">'+n+'</button>').join('')+'</div><h2>Sources</h2><div class="mcq-source-choices">'+sourceChoices().map(([id,label])=>'<button data-source="'+id+'" aria-pressed="'+(id==='law'?lawSelected():id==='articles'?articleSelected:settings.sources.includes(id))+'">'+label+'</button>').join('')+'</div>'+(lawSelected()?'<p class="meta mcq-law-note">'+LAW_NOTE+'</p>':'')+'<div class="mcq-bank-filters">'+selection('mock-year',settings.year,[['all','All years'],...years.map(y=>[y,y])],'Past-exam year')+selection('mock-level',settings.level,[['all','All sittings'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Past-exam sitting')+'</div><p class="mcq-pool-count" role="status">'+(pool.length<settings.length?'Only '+pool.length+' matching questions are available; this paper will use all '+pool.length+'.':pool.length+' matching questions · '+settings.length+' will be drawn at random.')+'</p><p class="meta">Choose any combination. Law overlaps are included once. Year and sitting filters apply to past-exam questions.</p><button data-mcq="start" class="primary" '+(!pool.length?'disabled':'')+'>Start paper</button>'+(paper?' <button data-mcq="resume">Resume current paper</button>':'')+(storageError?'<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>':'')+'</div>';
    }
    function newPaper(){
      const chosen=shuffle(builderPool()).slice(0,settings.length);if(!chosen.length)return;
      paper={size:settings.length,ids:chosen.map(q=>q.id),answers:{},finished:false,retry:false,position:0,at:Date.now()};position=0;building=false;paperPending=true;save();
      const url=new URL(location.href);url.searchParams.delete('n');url.searchParams.set('run','1');history.replaceState(history.state,'',url);
    }
    async function load(){
      if(busy)return;busy=true;host.innerHTML='<div class="mcq-page"><p role="status">Loading questions…</p></div>';
      try{
        [items,topics,collections]=await Promise.all([json('data/mcq/'+(bankMode||mockMode?'all':chapter)+'.json'),json('data/mcq/topics.json'),json('data/mcq/collections.json')]);
        lawIds=new Set(collections.israeliLawEthics.ids);articleIds=new Set(collections.suppliedArticles?.ids||[]);
        if(mockMode){
          const url=new URL(location.href),n=url.searchParams.get('n');
          if(storageError)throw Error(storageError);
          building=n==='builder'||!paper||!(n==='resume'||url.searchParams.get('run')==='1');
          const available=new Set(items.map(q=>q.id));if(paper&&!paper.ids.every(id=>available.has(currentId(id)))){building=true;storageError='Some saved paper questions are unavailable in this release. Start a new paper.';}
        }
        loaded=true;render();
      }catch(error){host.innerHTML='<div class="mcq-page"><p role="alert">'+escape(error.message||'Questions could not be loaded.')+'</p><button data-mcq="load">Reload questions</button>'+(!bankMode&&!mockMode?' <button data-mcq="notes">Study notes</button>':'')+'</div>';}
      finally{busy=false;}
    }
    function commit(q,state){state.at=Math.max(Date.now(),(answers.get(q.id)?.at||0)+1,(state.at||0)+1);answers.set(q.id,state);pending.set(q.id,state);if(missedOnly)retryAnswers.set(q.id,state);if(mockMode){paper.answers[paperId(q)]=state;paperPending=true;}save();}
    host.addEventListener('change',event=>{const name=event.target.dataset.select;if(!name)return;lastAnswer=null;const value=event.target.value;
      if(name==='mock-year'||name==='mock-level'){settings[name==='mock-year'?'year':'level']=value;save();render();return;}
      if(name==='source'){filter=normalizeSource(value);year='all';level='all';topic='all';}else if(name==='year')year=value;else if(name==='level')level=value;else if(name==='topic')topic=value;else if(name==='sort')sort=value;
      position=0;render();host.scrollTop=0;
    });
    host.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!host.contains(button)||button.disabled)return;const action=button.dataset.mcq;
      if(button.dataset.option===undefined&&button.dataset.image===undefined&&!['undo','save'].includes(action))lastAnswer=null;
      if(action==='notes'){controller.notes();return;}if(action==='load'){load();return;}if(action==='save'){save();render();return;}
      if(action==='flags'||action==='questions'){flagsView=action==='flags';render();host.scrollTop=0;return;}
      if(button.dataset.undoFlag){writeFlag({id:button.dataset.undoFlag},true);render();return;}
      if(action==='missed'){missedOnly=!missedOnly;missedIds=null;retryAnswers.clear();position=0;render();host.querySelector('[data-mcq="missed"]')?.focus({preventScroll:true});return;}
      if(button.dataset.length){settings.length=Number(button.dataset.length);save();render();return;}
      if(button.dataset.source==='articles'){articleSelected=!articleSelected;render();return;}
      if(button.dataset.source==='law'){
        const selected=!lawSelected();
        try{if(systemPrefs.selected){const saved=readSystem();saved.selected=false;saved.at=Date.now();HazzardStorage.setItem(SYSTEM_KEY,JSON.stringify(saved));systemPrefs=saved;}}catch{storageError='Source choice could not be saved.';render();return;}
        settings.sources=settings.sources.filter(id=>id!=='law');if(selected)settings.sources.push('law');save();render();return;
      }
      if(button.dataset.source){const id=button.dataset.source;settings.sources=settings.sources.includes(id)?settings.sources.filter(s=>s!==id):[...settings.sources,id];save();render();return;}
      if(action==='start'){newPaper();render();host.scrollTop=0;return;}
      if(action==='builder'){building=true;const url=new URL(location.href);url.searchParams.delete('run');url.searchParams.delete('n');history.replaceState(history.state,'',url);render();host.scrollTop=0;return;}
      if(action==='resume'){building=false;position=paper.position;const url=new URL(location.href);url.searchParams.delete('n');url.searchParams.set('run','1');history.replaceState(history.state,'',url);render();return;}
      if(button.dataset.filter){filter=button.dataset.filter;position=0;render();host.scrollTop=0;return;}
      const list=visible();
      if(action==='review'){paper.finished=false;position=0;save();render();host.scrollTop=0;return;}
      if(action==='retry-missed'){const missed=list.filter(q=>{const s=stateFor(q);return !s.checked||!q.accepted.includes(s.selected)});paper.ids=missed.map(q=>q.id);paper.answers={};paper.finished=false;paper.retry=true;position=0;save();render();host.scrollTop=0;return;}
      const q=list[position];if(!q)return;if(button.dataset.image!==undefined){openImage(button.querySelector('img'));return;}
      if(action==='flag'){
        if(personal.flags[q.id]?.hidden||systemPrefs.flags[q.id]?.hidden){location.assign('?chapter=bank#flags');return;}
        if(writeFlag(q)){render();if(mockMode)save();}else render();return;
      }
      const state={...stateFor(q)};
      if(action==='undo'){
        if(lastAnswer?.id!==q.id||lastAnswer.at!==state.at||!state.checked)return;
        try{if(pending.get(q.id)?.at!==lastAnswer.at&&readStore().answers[q.id]?.at!==lastAnswer.at){lastAnswer=null;sync();return;}}catch{storageError='The answer could not be read safely.';render();return;}
        const undo=lastAnswer,at=Math.max(Date.now(),state.at+1);
        const restored={...(undo.previousAnswer||empty()),at};
        answers.set(q.id,restored);pending.set(q.id,restored);
        if(missedOnly){if(undo.previousRetry)retryAnswers.set(q.id,undo.previousRetry);else retryAnswers.delete(q.id);}
        if(mockMode){if(undo.previousPaperAnswer)paper.answers[undo.paperId]={...undo.previousPaperAnswer,at};else delete paper.answers[undo.paperId];position=undo.position;paper.finished=undo.finished;paperPending=true;}
        save();lastAnswer=null;render();host.querySelector('[data-option="0"]')?.focus({preventScroll:true});return;
      }
      if(action==='next'||action==='prev'){
        if(action==='next'&&position===list.length-1&&mockMode){paper.finished=true;save();render();host.scrollTop=0;return;}
        position+=action==='next'?1:-1;if(mockMode)save();render();host.scrollTop=0;return;
      }
      if(button.dataset.option!==undefined&&!state.checked){state.selected=Number(button.dataset.option);state.checked=true;}
      else return;
      let previousAnswer;try{previousAnswer=readStore().answers[q.id];}catch{storageError='The previous answer could not be read safely.';render();return;}
      const undo={id:q.id,previousAnswer:previousAnswer?{...previousAnswer}:null,previousRetry:retryAnswers.get(q.id),paperId:mockMode?paperId(q):null,previousPaperAnswer:mockMode?paper.answers[paperId(q)]:null,position,finished:mockMode?paper.finished:false};
      commit(q,state);lastAnswer={...undo,at:state.at};const y=host.scrollTop;render();host.scrollTop=y;
      host.querySelector('[data-mcq="next"]')?.focus({preventScroll:true});
    });
    sync();addEventListener('storage',event=>{if(event.key===KEY||event.key===PAPER_KEY||event.key===FLAGS_KEY||event.key===SYSTEM_KEY||event.key===null)sync()});addEventListener('pageshow',event=>{if(event.persisted)sync()});
    return controller;
  }
  return {KEY,PAPER_KEY,FLAGS_KEY,SYSTEM_KEY,MIGRATION_KEY,loadAliases,migrateSaved,migrateValue,currentId,validSystem,mergeSystem,validStore,validPaper,validFlags,mergeStore,mergePaper,mergeFlags,readPaper,loadIndex,mount};
})();
