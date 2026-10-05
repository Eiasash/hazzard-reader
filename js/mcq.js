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
    if(key===HazzardReview.KEY)return HazzardReview.canonical(value);
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
  const VIEW_KEY='hazzard-mcq-view-v1';
  const membership=q=>[...new Set([q.topic,...(q.topics||[])])];
  const choicesOf=value=>Array.isArray(value)?value:value==='all'?[]:[value];
  const validChoices=(value,allowed)=>typeof value==='string'?(value==='all'||allowed(value)):Array.isArray(value)&&new Set(value).size===value.length&&value.every(v=>typeof v==='string'&&allowed(v));
  const validYears=value=>validChoices(value,v=>/^\d{4}$/.test(v));
  const validLevels=value=>validChoices(value,v=>['Basic','Subspec','unspecified'].includes(v));
  const matchesYear=(q,value)=>!choicesOf(value).length||choicesOf(value).includes(q.t.slice(0,4));
  const matchesLevel=(q,value)=>!choicesOf(value).length||choicesOf(value).some(v=>v==='unspecified'?!/-(Basic|Subspec)$/.test(q.t):q.t.endsWith('-'+v));
  function validView(v){return record(v)&&v.version===1&&/^mcq-[a-f0-9]{24}$/.test(v.id)&&['all','past','practice','law','articles'].includes(v.filter)&&validYears(v.year)&&validLevels(v.level)&&/^(all|\d{1,3})$/.test(v.topic)&&['source','topic'].includes(v.sort)&&typeof v.missedOnly==='boolean'&&typeof v.flagsView==='boolean'&&Number.isFinite(v.scroll)&&v.scroll>=0&&Number.isFinite(v.at)&&v.at>=0&&(v.missedIds==null||Array.isArray(v.missedIds)&&v.missedIds.every(id=>/^mcq-[a-f0-9]{24}$/.test(id)));}
  const mergeView=(a,b)=>a.at>=b.at?a:b;
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
    return catalogPromise ||= Promise.all([json('data/mcq/index.json'),HazzardEvidence.load()]).then(([index,evidence])=>Object.fromEntries([...new Set([...Object.keys(index),...Object.keys(evidence.study)])].map(ch=>[ch,{...index[ch],...(evidence.study[ch]?{past:evidence.study[ch].past,practice:evidence.study[ch].practice}: {})}]))).catch(error => { catalogPromise = null; throw error; });
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
    // Hebrew anywhere in a block sets its base direction, including drug-first
    // options. The existing Latin/measurement isolation remains independent.
    for (const block of box.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th')) block.dir = /[\u05d0-\u05ea]/.test(block.textContent) ? 'rtl' : 'ltr';
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const block = node.parentElement.closest('[dir]');
      // Keep only the leading Latin run visible to dir=auto. Later runs still
      // need isolation when an English-first block switches back to Hebrew.
      let keepLeading = false;
      if (block?.dir === 'ltr' && /^[^\p{L}]*[\p{Script=Latin}\p{Script=Greek}µ]/u.test(block.textContent)) {
        const prefix = document.createRange(); prefix.selectNodeContents(block); prefix.setEndBefore(node);
        keepLeading = !/\p{L}/u.test(prefix.toString());
      }
      const fragment = document.createDocumentFragment();
      // Keep terms, doses and numeric ranges in logical LTR order. Leave source
      // characters intact; CSS separates terms glued to Hebrew in the import.
      // A run starts with a letter/number, never a Hebrew prefix's hyphen.
      // Combining accents and Greek/micro units belong to the same LTR token.
      const base = String.raw`\p{Script=Latin}\p{Script=Greek}µ0-9\u2080-\u2089\u00b2\u00b3\u00b9\u2070-\u2079`;
      const word = `[${base}][${base}\\p{M}]*`;
      const token = `${word}(?:[.,'’°^/:+%−–<>=≤≥±×→←-]+${word})*`;
      const runs = new RegExp(`\\([ \\t]*[${base}][${base}\\p{M} \\t.,;'’°^:/+%−–→←<>=≤≥±×-]*\\)|${token}(?:[ \\t]+(?:[<>=≤≥±×→←]+[ \\t]*)?${token})*%?`, 'gu');
      let end = 0;
      for (const match of node.data.matchAll(runs)) {
        fragment.append(document.createTextNode(node.data.slice(end, match.index)));
        if (keepLeading && !/\p{L}/u.test(node.data.slice(0, match.index))) {
          fragment.append(document.createTextNode(match[0])); end = match.index + match[0].length;
          continue;
        }
        const bdi = document.createElement('bdi'); bdi.dir = 'ltr'; bdi.textContent = match[0];
        end = match.index + match[0].length;
        if (/[\u0590-\u05ff]/.test(node.data[match.index - 1] || '')) bdi.classList.add('mcq-gap-before');
        if (/[\u0590-\u05ff]/.test(node.data[end] || '')) bdi.classList.add('mcq-gap-after');
        fragment.append(bdi);
      }
      fragment.append(document.createTextNode(node.data.slice(end)));
      node.replaceWith(fragment);
    }
    // Markdown emphasis may split a single word (for example **V**isual).
    // Isolate that whole logical word while retaining its inline formatting.
    const blocks='p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th';
    for(const block of box.querySelectorAll(blocks)){
      if(block.querySelector(blocks))continue;
      const tw=document.createTreeWalker(block,NodeFilter.SHOW_TEXT),chars=[];let node;
      while(node=tw.nextNode())for(let i=0;i<node.length;i++)chars.push({node,offset:i,char:node.data[i]});
      const text=chars.map(c=>c.char).join('');
      const words=[...text.matchAll(/[\p{Script=Latin}\p{Script=Greek}µ0-9][\p{Script=Latin}\p{Script=Greek}\p{M}µ0-9'’°^²³₀-₉.,/:+%−–<>=≤≥±×→←-]*/gu)];
      for(const match of words.reverse()){
        const run=chars.slice(match.index,match.index+match[0].length);
        if(new Set(run.map(c=>c.node.parentElement.closest('bdi')).filter(Boolean)).size<2)continue;
        const range=document.createRange();range.setStart(run[0].node,run[0].offset);range.setEnd(run.at(-1).node,run.at(-1).offset+1);
        const contents=range.extractContents();for(const bdi of contents.querySelectorAll('bdi'))bdi.replaceWith(...bdi.childNodes);
        const bdi=document.createElement('bdi');bdi.dir='ltr';bdi.append(contents);range.insertNode(bdi);
      }
    }
    return box.innerHTML;
  }
  function stemHTML(q){
    const table=q.labTable;
    if(!table||!table.span||!q.q.includes(table.span))return rich(q.q);
    const at=q.q.indexOf(table.span);
    const cell=value=>table.direction==='rtl'?rich(value):escape(value);
    return rich(q.q.slice(0,at))+'<div class="mcq-lab-scroll" tabindex="0" role="region" aria-label="'+escape(table.caption||'Laboratory results')+'"><table class="mcq-lab-table" dir="'+(table.direction==='rtl'?'rtl':'ltr')+'"><thead><tr>'+table.header.map(h=>'<th scope="col">'+cell(h)+'</th>').join('')+'</tr></thead><tbody>'+table.rows.map(row=>'<tr>'+row.map((v,i)=>i===0?'<th scope="row">'+cell(v)+'</th>':'<td>'+cell(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+rich(q.q.slice(at+table.span.length));
  }
  const PAPER_KEY='hazzard-mcq-papers-v1';
  const defaultSettings=()=>({length:50,topic:'all',sources:['past','practice'],year:[],level:[]});
  function validPaper(value){
    const p=value?.paper,s=value?.settings;
    if(!record(value)||value.version!==1||!Number.isFinite(value.at)||!record(s)||![25,50,100].includes(s.length)||!Array.isArray(s.sources)||new Set(s.sources).size!==s.sources.length||!s.sources.every(x=>['past','practice','law'].includes(normalizeSource(x)))||!validYears(s.year)||!validLevels(s.level)||(s.topic!=null&&!/^(all|\d{1,3})$/.test(s.topic)))return false;
    return p===null||record(p)&&[25,50,100].includes(p.size)&&Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=100&&new Set(p.ids).size===p.ids.length&&p.ids.every(id=>/^mcq-[a-f0-9]{24}$/.test(id))&&validStore({version:1,answers:p.answers})&&Object.keys(p.answers).every(id=>p.ids.includes(id))&&typeof p.finished==='boolean'&&typeof p.retry==='boolean'&&Number.isInteger(p.position)&&p.position>=0&&p.position<p.ids.length&&Number.isFinite(p.at);
  }
  function readPaper(){const raw=localStorage.getItem(PAPER_KEY);if(raw===null)return null;const value=JSON.parse(raw);if(!validPaper(value))throw Error('Unreadable saved MCQ paper');return {...value,settings:{...value.settings,topic:value.settings.topic||'all',year:choicesOf(value.settings.year),level:[...new Set(choicesOf(value.settings.level).map(v=>v==='Basic'?'Subspec':v))],sources:[...new Set(value.settings.sources.map(normalizeSource))]}};}
  function mergePaper(current,incoming){return current.at>=incoming.at?current:incoming;}
  function shuffle(items){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result;}
  function mount({chapter,viewport,readerScroll,onShow,onNotes,openImage,readOnlyChapter=false}){
    const bankMode=chapter==='bank',mockMode=chapter==='mock',redoMode=bankMode&&new URL(location.href).searchParams.get('redo')==='1',reviewMode=!redoMode&&bankMode&&new URL(location.href).searchParams.get('review')==='1';
    let redoIds=new Set();
    const host=document.createElement('section');host.id='mcqViewport';host.hidden=true;host.setAttribute('aria-label',bankMode?'Question bank':mockMode?'Mock paper':'Exam questions');viewport.append(host);
    let studyTabs;
    if(!bankMode&&!mockMode){
      studyTabs=document.createElement('div');studyTabs.className='study-view-tabs';studyTabs.setAttribute('role','tablist');studyTabs.setAttribute('aria-label',readOnlyChapter?'Chapter view':'Study view');
      for(const [mode,label] of [['notes',readOnlyChapter?'Read chapter':'Study notes'],['questions','Exam questions']]){
        const button=document.createElement('button');button.type='button';button.dataset.studyView=mode;button.textContent=label;button.setAttribute('role','tab');button.onclick=()=>mode==='notes'?controller.notes():controller.show();studyTabs.append(button);
      }
      viewport.prepend(studyTabs);
    }
    const selectTab=mode=>studyTabs?.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.studyView===mode)));
    const filtersObserver=new ResizeObserver(entries=>host.style.setProperty('--mcq-filter-height',(entries[0]?.target.getBoundingClientRect().height||0)+'px'));
    let items=[],topics=[],filter='all',year=[],level=[],topic='all',sort='source',position=0,loaded=false,busy=false,paper=null,paperPending=false,storageError='',missedOnly=bankMode&&location.hash==='#missed',building=mockMode,settings=defaultSettings();
    const answers=new Map(),pending=new Map(),retryAnswers=new Map(),dismissed=new Set();
    let personal={version:1,flags:{},lawTopics:{ids:[],at:0}},flagsView=bankMode&&location.hash==='#flags',notice='';
    let systemPrefs={version:1,selected:false,at:0,flags:{}},collections={israeliSystem:{enabled:false,ids:[]},topicFallbacks:{}},lawIds=new Set(),articleIds=new Set(),articleSelected=false,lastAnswer=null;
    let missedIds=null,reviewBatch=null;
    let evidence={questions:{},study:{}},chapterTitles={},viewTimer,restoringView=false;
    function viewState(){const q=visible()[position]||items[0];return q?{version:1,id:currentId(q.id),filter,year,level,topic,sort,missedOnly,flagsView,missedIds:missedIds?[...missedIds]:null,scroll:host.scrollTop,at:Date.now()}:null;}
    function saveView(){
      if(!loaded||!controller.active||restoringView||redoMode)return;
      if(reviewMode){try{HazzardReview.position(position);history.replaceState({...history.state,reviewView:{id:visible()[position]?.id,scroll:host.scrollTop,lastAnswer}},'');}catch{storageError='Review position could not be saved.';}return;}
      const view=viewState();if(!view)return;
      try{
        history.replaceState({...history.state,mcqView:{...view,missedIds:missedIds?[...missedIds]:null,retryAnswers:[...retryAnswers],lastAnswer}},'');
        if(bankMode)HazzardStorage.setItem(VIEW_KEY,JSON.stringify(view));
      }catch{notice='Question position could not be saved.';}
    }
    function restoreView(view){
      if(reviewMode||redoMode)return false;
      if(!validView(view))return false;
      ({filter,topic,sort,missedOnly,flagsView}=view);year=choicesOf(view.year);level=choicesOf(view.level);
      lastAnswer=view.lastAnswer||null;
      if(Array.isArray(view.missedIds))missedIds=new Set(view.missedIds.map(currentId));
      if(Array.isArray(view.retryAnswers))for(const[id,a]of view.retryAnswers)retryAnswers.set(currentId(id),a);
      const found=visible().findIndex(q=>q.id===currentId(view.id));position=Math.max(0,found);
      return found>=0;
    }
    async function restoreScroll(view){
      // Image questions acquire their height after decode. Restoring earlier
      // clamps the saved scroll to the shorter, image-free layout.
      for(const img of host.querySelectorAll('img'))img.loading='eager';
      await Promise.all([...host.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
      requestAnimationFrame(()=>{if(!restoringView)return;host.scrollTop=view.scroll;restoringView=false;saveView();});
    }
    function jump(id){
      filter=topic='all';year=[];level=[];sort='source';missedOnly=flagsView=false;missedIds=null;
      id=currentId(id);dismissed.delete(id);position=Math.max(0,visible().findIndex(q=>q.id===id));
      const url=new URL(location.href);url.searchParams.delete('q');url.hash='';history.replaceState({...history.state,mcqView:null},'',url);
      render();host.scrollTop=0;saveView();
      host.querySelector('.mcq-question')?.scrollIntoView({block:'start'});
    }
    function citationHTML(q){
      const ref=evidence.questions[q.id];
      const source=q.ref.replace(/\s*·\s*/g,' ').replace(/\bp\. (?=\d+[-–,])/g,'pp. ');
      let html='<div class="mcq-citations"><p class="meta">Source: '+escape(source||sourceLabel(q))+'</p>';
      if(q.referenceNote)html+='<p class="meta" dir="auto">'+escape(q.referenceNote)+'</p>';
      const assigned=ref?.chapters.length?ref.chapters:[String(q.chapter)];
      if(q.requiredReadingNote)html+='<p class="mcq-source-note" role="note">'+escape(q.requiredReadingNote)+'</p>';
      if(!q.requiredCard&&([...assigned,String(q.chapter)].some(c=>['2','3','4','5','6','34','62'].includes(c))||membership(q).includes(51)))html+='<p class="mcq-source-note" role="note">chapter not on the 2026 required list</p>';
      if(ref){
        const unmapped=q.sourceType==='Hazzard'&&ref.status!=='resolved';
        html+='<p class="meta">'+escape(HazzardEvidence.sittingLabel(ref.sitting))+' paper'+(unmapped?(q.edition===7?' · 7e source: not mapped into this 8e reader':' · 8e page not mapped'):'')+'</p>';
        for(const p of ref.pages)html+=p.available?'<button class="mcq-page-link" data-page="'+p.page+'">Open page '+p.page+'</button>':'<span class="mcq-page-unavailable">Page '+p.page+' · chapter '+escape(p.chapter||'?')+' unavailable in reader</span>';
        const chapters=q.requiredCard?[]:assigned;
        for(const c of chapters){
          const ch=evidence.study[c];if(!ch)continue;
          const title=chapterTitles[c]||(c===String(q.chapter)?q.chapterTitle:'');
          html+='<p class="meta"><a href="?chapter='+encodeURIComponent(ch.studyOnly?c+'s':c)+'">Study: Chapter '+escape(c)+' - '+escape(title)+'</a></p>';
        }
        if(ref.tables.length)html+='<p class="meta">'+escape(ref.tables.map(t=>'Table '+t).join(', '))+'</p>';
      }
      if(q.keySource)html+='<p class="meta">'+escape(q.keySource)+'</p>';
      return html+'</div>';
    }
    function sync(){
      if(reviewMode){try{reviewBatch=HazzardReview.read().batch;if(reviewBatch)position=reviewBatch.position;}catch{storageError='Review queue could not be read.';}}
      let flagsError='';try{personal=readFlags();systemPrefs=readSystem();}catch{flagsError='Personal topic flags or source choices could not be read. Existing data has not been overwritten.';}
      try{const saved=mockMode?readPaper():readStore();if(mockMode){if(saved&&!paperPending){paper=saved.paper;settings=saved.settings;}if(paper)position=paper.position;}else{answers.clear();for(const [id,a]of Object.entries(saved.answers))answers.set(id,a)}storageError='';}
      catch{storageError='Saved answers could not be read. Existing data has not been overwritten.';}
      for(const [id,a]of pending)answers.set(id,a);
      if(flagsError)storageError=flagsError;
      if(loaded)render();
    }
    function save(){
      try{
        if(pending.size){const saved=mergeStore(readStore(false),{version:1,answers:Object.fromEntries(pending)});HazzardStorage.setItem(KEY,JSON.stringify(saved));for(const id of pending.keys())answers.set(id,saved.answers[id]);pending.clear();}
        if(mockMode){if(paper){paper.position=position;paper.at=Date.now();}HazzardStorage.setItem(PAPER_KEY,JSON.stringify({version:1,settings,paper,at:Date.now()}));paperPending=false;}
        storageError='';
      }catch{storageError='Answers could not be saved. Keep this page open and try again.';if(mockMode)paperPending=true;}
    }
    const controller={active:false,search(){saveView();if(mockMode)history.replaceState({...history.state,mcqMockView:{building,articleSelected}},'');search.open();},get hasUnsaved(){return pending.size>0||paperPending},sync,save,remember:saveView,
      show(){if(!bankMode&&!mockMode)history.replaceState({...history.state,hazzardStudyMode:"questions"},'');selectTab('questions');controller.active=true;host.hidden=false;readerScroll.style.visibility='hidden';readerScroll.inert=true;onShow();if(!loaded)load();else render();},
      notes(){if(bankMode||mockMode)return;history.replaceState({...history.state,hazzardStudyMode:"notes"},'');selectTab('notes');saveView();lastAnswer=null;controller.active=false;host.hidden=true;readerScroll.style.visibility='';readerScroll.inert=false;onNotes();}
    };
    const search=HazzardQuestionSearch.mount({
      getItems:async all=>{if(!loaded)throw Error('Questions are still loading. Try again.');return (all?items:mockMode?builderPool():flagsView?visible().filter(q=>activeFlags().some(([id])=>id===q.id)):visible()).map(q=>({id:q.id,label:sourceLabel(q),stem:q.q,text:[q.q,...q.o,q.explanation].join(' ')}));},
      openQuestion:id=>{saveView();location.href='?chapter=bank&q='+encodeURIComponent(id);}
    });
    const empty=()=>({selected:null,checked:false});
    const flagged=(q,scope)=>(['source:law','source:system'].includes(scope)&&!!systemPrefs.flags[q.id]?.hidden)||!!(personal.flags[q.id]?.hidden&&personal.flags[q.id].scopes.includes(scope));
    const topicsHidden=q=>membership(q).every(t=>flagged(q,'topic:'+t));
    const lawSelected=()=>settings.sources.includes('law')||systemPrefs.selected;
    function activeFlags(){const entries=new Map(Object.entries(personal.flags).filter(([,f])=>f.hidden).map(([id,f])=>[id,{...f,scopes:[...f.scopes]}]));for(const[id,f]of Object.entries(systemPrefs.flags))if(f.hidden){const item=entries.get(id)||{hidden:true,at:f.at,scopes:[]};item.scopes.push('source:system');item.at=Math.max(item.at,f.at);entries.set(id,item)}return [...entries];}
    const flagCount=()=>activeFlags().length;
    const sourceChoices=()=>[['past','Shlav A past papers (official sittings)'],['practice','Hazzard practice'],['law','Israeli law & ethics'],...(collections.suppliedArticles?.enabled?[['articles','Supplied articles']]:[])];
    const topicChoices=()=>topics.map((name,i)=>[String(i),name]).filter(([id])=>filter!=='law'||items.some(q=>lawIds.has(q.id)&&membership(q).includes(Number(id)))).sort((a,b)=>a[1].localeCompare(b[1],'en',{sensitivity:'base'}));
    const scopeLabel=scope=>scope.startsWith('topic:')?(topics[Number(scope.slice(6))]||scope):({'source:law':'Israeli law & ethics','source:past':'Shlav A past exams','source:practice':PRACTICE_LABEL,'source:system':'Israeli law & ethics','chapter:law':'Law study','mock':'Mock papers'}[scope]||scope.replace('chapter:','Chapter '));
    function writeFlag(q,undo=false){
      try{
        const saved=readFlags(),system=readSystem();let systemChanged=false;
        if(undo){if(saved.flags[q.id])saved.flags[q.id]={...saved.flags[q.id],hidden:false,at:Date.now()};if(system.flags[q.id]){system.flags[q.id]={hidden:false,at:Date.now()};systemChanged=true;}}
        else{
          const scopes=new Set(saved.flags[q.id]?.hidden?saved.flags[q.id].scopes:[]);const selectedTopic=mockMode?settings.topic:topic;
          scopes.add('topic:'+(selectedTopic!=='all'&&selectedTopic!=null&&membership(q).includes(Number(selectedTopic))?selectedTopic:membership(q)[0]));
          if(bankMode&&topic==='all'&&filter!=='all'&&filter!=='system'&&filter!=='articles')scopes.add('source:'+filter);
          if(!bankMode&&!mockMode)scopes.add('chapter:'+chapter);
          if(chapter==='law'||lawIds.has(q.id)&&(filter==='law'||mockMode&&lawSelected()))scopes.add('source:law');
          if(mockMode){scopes.add('mock');if(settings.sources.includes(q.kind))scopes.add('source:'+q.kind);}
          saved.flags[q.id]={scopes:[...scopes],hidden:true,at:Date.now()};
        }
        HazzardStorage.setItem(FLAGS_KEY,JSON.stringify(saved));if(systemChanged)HazzardStorage.setItem(SYSTEM_KEY,JSON.stringify(system));personal=saved;systemPrefs=system;storageError='';
        if(undo){dismissed.delete(q.id);notice='Question restored to its filters.';}else{if(!bankMode||topic==='all')dismissed.add(q.id);notice='Hidden from '+saved.flags[q.id].scopes.map(scopeLabel).join(' · ')+'. Undo in Flags.';}
        return true;
      }catch{storageError='The topic flag could not be saved. This question has not been hidden.';return false;}
    }
    function flagsList(){
      const byId=new Map(items.map(q=>[q.id,q])),entries=activeFlags().sort((a,b)=>b[1].at-a[1].at);
      return '<h2>Topic flags</h2>'+(entries.length?entries.map(([id,f])=>{const q=byId.get(id);return '<section class="mcq-flag-row"><div class="mcq-mixed" dir="auto">'+rich(q?q.q:'Question no longer in the current bank')+'</div><p class="meta">'+escape(f.scopes.map(scopeLabel).join(' · '))+'</p><button class="quiet" data-undo-flag="'+id+'">Undo flag</button></section>';}).join(''):'<p>No topic flags.</p>');
    }
    function paperId(q){return paper.ids.filter(id=>currentId(id)===q.id).sort((a,b)=>(paper.answers[b]?.at??-1)-(paper.answers[a]?.at??-1))[0]||q.id;}
    function stateFor(q){return redoMode?(retryAnswers.get(q.id)||empty()):reviewMode?(reviewBatch?.answers[q.id]||empty()):mockMode?(paper.answers[paperId(q)]||empty()):missedOnly?(retryAnswers.get(q.id)||empty()):(answers.get(q.id)||empty());}
    function visible(){
      if(redoMode)return items.filter(q=>redoIds.has(q.id));
      if(reviewMode){const byId=new Map(items.map(q=>[q.id,q]));return (reviewBatch?.ids||[]).map(id=>byId.get(currentId(id))).filter(Boolean);}
      if(mockMode){const byId=new Map(items.map(q=>[q.id,q]));return paper?paper.ids.map(id=>byId.get(currentId(id))).filter(q=>q&&q.mockEligible!==false&&(settings.topic==='all'||membership(q).includes(Number(settings.topic))&&!flagged(q,'topic:'+settings.topic))&&!flagged(q,'mock')&&!dismissed.has(q.id)):[];}
      if(missedOnly&&missedIds===null)missedIds=new Set(items.filter(q=>answers.get(q.id)?.checked&&!q.accepted.includes(answers.get(q.id).selected)).map(q=>q.id));
      let list=items.filter(q=>!dismissed.has(q.id)&&(filter==='all'||filter==='law'&&lawIds.has(q.id)||filter==='articles'&&articleIds.has(q.id)||q.kind===filter)&&(filter==='all'||!flagged(q,'source:'+filter))&&(!['law','articles'].includes(filter)||!topicsHidden(q))&&(topic==='all'||!flagged(q,'topic:'+topic))&&(chapter!=='law'||!flagged(q,'source:law')&&(!q.law||!topicsHidden(q)))&&(bankMode||!flagged(q,'chapter:'+chapter))&&matchesYear(q,year)&&matchesLevel(q,level)&&(topic==='all'||membership(q).includes(Number(topic)))&&(!missedOnly||missedIds.has(q.id)));
      if(bankMode)list.sort((a,b)=>(filter==='law'?(a.kind!=='past')-(b.kind!=='past'):0)||(sort==='topic'?(topics[a.topic]||'').localeCompare(topics[b.topic]||'')||a.t.localeCompare(b.t)||a.sourceIndex-b.sourceIndex:a.t.localeCompare(b.t)||a.topic-b.topic||a.sourceIndex-b.sourceIndex));
      return list;
    }
    function selection(name,value,choices,label){return '<label>'+label+'<select data-select="'+name+'">'+choices.map(([v,text])=>'<option value="'+escape(v)+'" '+(String(v)===value?'selected':'')+'>'+escape(text)+'</option>').join('')+'</select></label>';}
    function multiSelection(name,value,choices,label){
      const selected=choicesOf(value),labels=choices.filter(([v])=>selected.includes(v)).map(([,text])=>text);
      const summary=labels.length>2?labels.length+(name.endsWith('year')?' years':' levels'):labels.join(', ')||choices[0][1];
      return '<div class="mcq-multi"><span>'+label+'</span><details data-multi="'+name+'"><summary aria-label="'+label+': '+escape(summary)+'">'+escape(summary)+'</summary><div class="mcq-multi-options" role="group" aria-label="'+label+'">'+choices.map(([v,text])=>'<label><input type="checkbox" data-select="'+name+'" value="'+escape(v)+'" '+((v==='all'?!selected.length:selected.includes(v))?'checked':'')+'><span>'+escape(text)+'</span></label>').join('')+'</div></details></div>';
    }
    let unsureRemoved=null;
    function unsureStatus(q,state,review){
      const removed=unsureRemoved?.id===q.id&&Date.now()<unsureRemoved.until;
      let message='';
      if(review?.unsure){
        const due=review.due?'due '+review.due.slice(8,10)+'.'+review.due.slice(5,7):'due tomorrow';
        message=state.checked?'In Review - '+due+'. Score not affected.':'Marked unsure - will go to Review when you answer. Score not affected.';
      }else if(removed)message='Unsure removed';
      return '<p class="mcq-unsure-status'+(!review?.unsure&&removed?' mcq-unsure-removed':'')+'" role="status" aria-live="polite" '+(!message?'hidden':'')+'>'+message+'</p>';
    }
    function header(list){
      if(redoMode)return '<p class="eyebrow">PRACTICE</p><h1>Changed questions - redo</h1><p class="meta">'+(list.length?(position+1)+' of '+list.length:'All changed questions answered')+'</p><p>Answer again after the change to clear each question from the collection.</p><a href="?chapter=bank">Open question bank</a>'+(storageError?'<p role="alert">'+escape(storageError)+'</p>':'');
      if(reviewMode){const r=HazzardReview.read(),done=Object.values(reviewBatch?.answers||{}).filter(a=>a.checked).length;return '<p class="eyebrow">DAILY PRACTICE</p><h1>Review</h1><p class="meta">'+done+' / '+list.length+' answered · '+HazzardReview.due(r).length+' due</p><label class="mcq-review-size">Daily batch <select data-select="review-size">'+[10,30,50].map(n=>'<option value="'+n+'" '+(n===r.settings.size?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+(r.seed?.count?'<p class="meta">Started with '+r.seed.count+' previous wrong answers, spread at up to 30 per day.</p>':'')+'<p class="meta">1 → 3 → 7 → 21 days. Correct and not unsure advances. Wrong or unsure restarts tomorrow.</p><p class="meta">'+(list.length?Math.min(position+1,list.length)+' of '+list.length:'No questions due in this batch')+'</p>'+(storageError?'<p role="alert">'+escape(storageError)+'</p>':'')+(notice?'<p role="status">'+escape(notice)+'</p>':'');}
      const title=bankMode?(flagsView?'Missed / flags':'Question bank'):mockMode?'Mock paper'+(paper.retry?' · Retry missed':''):'Exam questions';
      let html='<div class="mcq-heading"><div><p class="eyebrow">'+(bankMode?'ALL BANK TOPICS':mockMode?'PRACTICE':chapter==='law'?'ISRAELI LAW · STUDY':'CHAPTER '+chapter+' · STUDY')+'</p><h1>'+title+'</h1></div>'+'</div>';
      if(bankMode)html+='<div class="mcq-view-links"><button class="quiet" data-mcq="questions" aria-pressed="'+!flagsView+'">Questions</button><button class="quiet" data-mcq="flags" aria-pressed="'+flagsView+'">Flags ('+flagCount()+')</button></div>';
      if(bankMode&&!flagsView){
        const sittings=[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t))].sort().reverse();
        html+='<details class="mcq-jump"><summary>Go to sitting + Q</summary><form data-jump-form><label>Sitting<select name="sitting">'+sittings.map(s=>'<option value="'+escape(s)+'">'+escape(s.replace('-Subspec','').replace('-', ' '))+'</option>').join('')+'</select></label><label>Q<input name="number" type="number" min="1" max="100" inputmode="numeric" aria-label="Question number"></label><button type="submit">Go</button><span role="status" data-jump-status></span></form></details>';
        html+='<div class="mcq-bank-filters">'+selection('source',filter,[['all','All sources'],...sourceChoices()],'Source')+selection('topic',topic,[['all','All topics'],...topicChoices()],'Topic')+multiSelection('year',year,[['all','All years'],...[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse().map(y=>[y,y])],'Year')+multiSelection('level',level,[['all','All levels'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Exam level')+selection('sort',sort,[['source','Source'],['topic','Topic']],'Sort by')+'<button class="mcq-missed-toggle" type="button" role="switch" data-mcq="missed" aria-checked="'+missedOnly+'"><span class="mcq-switch-track" aria-hidden="true"></span>Missed only</button></div>';
        html+='<p class="meta">'+list.length+' matching questions'+(filter==='law'?' · Official past exams only.':'')+'</p>';
      }else if(!mockMode&&!bankMode)html+='<nav class="mcq-filters" aria-label="Question type">'+[['all','All'],['past','Past exams'],['practice',PRACTICE_LABEL]].map(([id,label])=>'<button data-filter="'+id+'" aria-pressed="'+(filter===id)+'">'+label+'</button>').join('')+'</nav>';
      if(!flagsView)html+='<p class="meta mcq-count">'+(list.length?(position+1)+' of '+list.length:'0 questions')+'</p>';
      if(filter==='law'||chapter==='law')html+='<p class="meta mcq-law-note">'+(chapter==='law'?'Israeli law: past-exam items are the target; Hazzard items use US law':LAW_NOTE)+'</p>';
      if(collections.topicFallbacks[chapter])html+='<p class="meta mcq-topic-fallback">Practice questions by topic: '+escape(collections.topicFallbacks[chapter].name)+'. Official past questions link to their source pages when available.</p>';
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
      const list=visible();position=Math.min(position,reviewMode?list.length:Math.max(0,list.length-1));const q=list[position];
      host.innerHTML='<div class="mcq-page">'+header(list)+'<div class="mcq-question"></div></div>';const content=host.querySelector('.mcq-question');
      filtersObserver.disconnect();const sticky=host.querySelector('nav.mcq-filters');if(sticky)filtersObserver.observe(sticky);
      if(!reviewMode&&bankMode&&flagsView){content.innerHTML=flagsList();return;}
      if(reviewMode&&(!q||position===list.length)){content.innerHTML='<h2>'+(!list.length?'Nothing due today':'Daily batch complete')+'</h2><p>Your progress is saved. Come back tomorrow.</p><a href="?chapter=bank">Open question bank</a>';return;}
      if(!q){content.innerHTML='<p>No questions match these filters.</p>'+(!bankMode&&!mockMode?'<button data-mcq="notes">Open study notes</button>':'');return;}
      if(mockMode&&paper.finished){content.innerHTML=score(list);return;}
      const state=stateFor(q),review=HazzardReview.read().items[q.id],canUndo=lastAnswer?.id===q.id&&(lastAnswer.kind==='unsure'||lastAnswer.at===state.at&&state.checked),accepted=q.accepted||[q.c],correct=accepted.includes(state.selected),letters=['א','ב','ג','ד','ה'];content.dataset.bankId=q.id;
      content.innerHTML='<span class="'+(q.kind==='past'?'exam-badge':'mcq-practice-tag')+'">'+(escape(sourceLabel(q)))+'</span><p class="meta mcq-topic-label">'+escape(membership(q).map(t=>topics[t]||'').join(' · '))+(q.chapter?' · Reader chapter '+escape(q.chapter):'')+' <button class="mcq-topic-flag" data-mcq="flag" aria-label="Wrong topic: '+escape(topics[topic==='all'?q.topic:Number(topic)]||'this question')+'">'+(personal.flags[q.id]?.hidden||systemPrefs.flags[q.id]?.hidden?'Flagged':'Wrong topic')+'</button></p>'+(q.label?'<p class="mcq-source-note" role="note">'+escape(q.label)+'</p>':'')+'<div class="mcq-stem mcq-mixed" dir="auto" lang="he">'+stemHTML(q)+'</div>'+
        (redoMode?'':'<div class="mcq-confidence"><button data-mcq="unsure" title="Add to review without changing your answer" aria-pressed="'+!!review?.unsure+'">'+(review?.unsure?'✓ Unsure':'Unsure')+'</button>'+(canUndo?'<button class="mcq-answer-undo" data-mcq="undo">Undo</button>':'')+'</div>'+unsureStatus(q,state,review))+
        (q.images||[]).map((url,i)=>'<button class="mcq-image" data-image="'+i+'" aria-label="Enlarge question image '+(i+1)+'"><img src="'+escape(url)+'" alt="Question image '+(i+1)+'" loading="lazy"></button>').join('')+
        '<div class="mcq-options" role="group" aria-label="Answer options" dir="rtl">'+q.o.map((option,i)=>'<button class="mcq-option '+(state.selected===i?'selected ':'')+(state.checked&&accepted.includes(i)?'correct ':'')+(state.checked&&state.selected===i&&!correct?'wrong':'')+'" data-option="'+i+'" aria-pressed="'+(state.selected===i)+'" '+(state.checked?'disabled':'')+'><span class="mcq-letter">'+(state.checked&&accepted.includes(i)?'✓':state.checked&&state.selected===i?'✕':letters[i]||String(i+1))+'</span><span class="mcq-mixed" dir="auto" lang="he">'+rich(option)+'</span></button>').join('')+'</div>'+
        '<div class="mcq-actions"><button class="mcq-pill" data-mcq="prev" '+(position===0?'disabled':'')+'>Prev</button><button class="mcq-pill" data-mcq="next" '+((reviewMode&&!state.checked||!mockMode&&!reviewMode&&position>=list.length-1)?'disabled':'')+'>Next</button></div>'+
        (state.checked?'<p class="mcq-result '+(correct?'correct':'wrong')+'" dir="rtl" role="status">'+(correct?'✓ תשובה נכונה':'✕ תשובה שגויה · '+(accepted.length>1?'תשובות מתקבלות: ':'התשובה הנכונה: ')+accepted.map(i=>letters[i]||String(i+1)).join(', '))+'</p><section class="mcq-explanation" dir="auto" lang="he"><h3 dir="rtl">הסבר</h3><div class="mcq-mixed" dir="auto">'+(q.explanation?rich(q.explanation):'<p>אין הסבר במאגר לשאלה זו.</p>')+'</div></section>':'')+citationHTML(q);
      if(state.checked&&(q.explanationReviewNote||q.explanationIncomplete)){const note=document.createElement('p');note.className='mcq-source-note';note.setAttribute('role','note');note.dir='ltr';note.lang='en';note.textContent=q.explanationReviewNote||'Explanation incomplete in source.';content.querySelector('.mcq-explanation').append(note);}
      for(const image of content.querySelectorAll('img'))image.onerror=()=>{image.parentElement.replaceWith(Object.assign(document.createElement('p'),{textContent:'Question image unavailable. Reconnect to finish downloading the reader.'}));for(const b of content.querySelectorAll('[data-option]'))b.disabled=true;};
      if(q.kind==='past'&&!mockMode)HazzardLawCards.questionLinks(content,q.id);
      saveView();
    }
    function builderPool(){
      return [...new Map(items.filter(q=>q.mockEligible!==false&&(settings.topic==='all'||membership(q).includes(Number(settings.topic))&&!flagged(q,'topic:'+settings.topic))&&!flagged(q,'mock')&&(articleSelected&&articleIds.has(q.id)&&!topicsHidden(q)||settings.sources.includes(q.kind)&&!flagged(q,'source:'+q.kind)||lawSelected()&&lawIds.has(q.id)&&!flagged(q,'source:law')&&!topicsHidden(q))&&(q.kind!=='past'||matchesYear(q,settings.year)&&matchesLevel(q,settings.level))).map(q=>[q.id,q])).values()];
    }
    function renderBuilder(){
      const pool=builderPool(),years=[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse();
      host.innerHTML='<div class="mcq-page"><p class="eyebrow">PRACTICE</p><h1>Mock builder</h1><p><a class="sim-entry" href="?chapter=mock&amp;simulation=1">Exam simulation · one official sitting, timed</a></p><h2>Length</h2><div class="mcq-filters">'+[25,50,100].map(n=>'<button data-length="'+n+'" aria-pressed="'+(settings.length===n)+'">'+n+'</button>').join('')+'</div><h2>Sources</h2><div class="mcq-source-choices">'+sourceChoices().map(([id,label])=>'<button data-source="'+id+'" aria-pressed="'+(id==='law'?lawSelected():id==='articles'?articleSelected:settings.sources.includes(id))+'">'+label+'</button>').join('')+'</div>'+(lawSelected()?'<p class="meta mcq-law-note">'+LAW_NOTE+'</p>':'')+'<div class="mcq-bank-filters">'+selection('mock-topic',settings.topic,[['all','All topics'],...topicChoices()],'Topic')+multiSelection('mock-year',settings.year,[['all','All years'],...years.map(y=>[y,y])],'Past-exam year')+multiSelection('mock-level',settings.level,[['all','All levels'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Past-exam level')+'</div><p class="mcq-pool-count" role="status">'+(pool.length<settings.length?'Only '+pool.length+' matching questions are available; this paper will use all '+pool.length+'.':pool.length+' matching questions · '+settings.length+' will be drawn at random.')+'</p><p class="meta">Choose any combination. Law overlaps are included once. Year and level filters apply to past-exam questions.</p><button data-mcq="start" class="primary" '+(!pool.length?'disabled':'')+'>Start paper</button>'+(paper?' <button data-mcq="resume">Resume current paper</button>':'')+(storageError?'<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>':'')+'</div>';
    }
    function newPaper(){
      const chosen=shuffle(builderPool()).slice(0,settings.length);if(!chosen.length)return;
      paper={size:settings.length,ids:chosen.map(q=>q.id),answers:{},finished:false,retry:false,position:0,at:Date.now()};position=0;building=false;paperPending=true;save();
      const url=new URL(location.href);url.searchParams.delete('n');url.searchParams.set('run','1');history.replaceState(history.state,'',url);
    }
    async function load(){
      if(busy)return;busy=true;host.innerHTML='<div class="mcq-page"><p role="status">Loading questions…</p></div>';
      try{
        evidence=await HazzardEvidence.load();
        chapterTitles=Object.fromEntries((await json('data/mcq/hazzard8e-toc.json')).chapters.map(c=>[c.chapter,c.title]));
        const studyOnly=!!evidence.study[chapter]?.studyOnly;
        [items,topics,collections]=await Promise.all([studyOnly||readOnlyChapter?Promise.resolve([]):json('data/mcq/'+(bankMode||mockMode?'all':chapter)+'.json'),json('data/mcq/topics.json'),json('data/mcq/collections.json'),loadAliases()]);
        if(evidence.study[chapter]||readOnlyChapter){
          const ids=new Set(HazzardEvidence.studyIds(evidence,chapter)),all=await json('data/mcq/all.json');
          items=[...all.filter(q=>ids.has(q.id)),...items.filter(q=>q.kind==='practice')];
        }
        if(redoMode)redoIds=new Set(HazzardChanged.pending(await HazzardChanged.load(),HazzardChanged.answers()).map(q=>q.id));
        else await HazzardReview.seed();
        if(reviewMode){reviewBatch=HazzardReview.batch(items);position=reviewBatch.position;}
        lawIds=new Set(collections.israeliLawEthics.ids);articleIds=new Set(collections.suppliedArticles?.ids||[]);
        if(mockMode){
          const url=new URL(location.href),n=url.searchParams.get('n');
          if(storageError)throw Error(storageError);
          building=n==='builder'||!paper||!(n==='resume'||url.searchParams.get('run')==='1');
          const available=new Set(items.map(q=>q.id));if(paper&&!paper.ids.every(id=>available.has(currentId(id)))){building=true;storageError='Some saved paper questions are unavailable in this release. Start a new paper.';}
        }
        if(mockMode&&history.state?.mcqMockView){building=history.state.mcqMockView.building;articleSelected=history.state.mcqMockView.articleSelected;}
        let view=history.state?.mcqView;
        const target=bankMode&&!reviewMode?new URL(location.href).searchParams.get('q'):null;
        if(bankMode&&!reviewMode&&!redoMode&&!view&&!target&&!location.hash){try{view=JSON.parse(localStorage.getItem(VIEW_KEY));}catch{notice='Saved question position could not be read.';}}
        const restored=!target&&restoreView(view);
        loaded=true;restoringView=restored;search.restore();
        if(target){if(items.some(q=>q.id===currentId(target)))jump(target);else{notice='That question is unavailable.';render();}}
        else{
          const rv=reviewMode?history.state?.reviewView:null;
          if(rv&&visible()[position]?.id===rv.id){lastAnswer=rv.lastAnswer||null;restoringView=true;}
          render();if(restored)restoreScroll(view);else if(restoringView&&rv)restoreScroll(rv);
        }
      }catch(error){host.innerHTML='<div class="mcq-page"><p role="alert">'+escape(error.message||'Questions could not be loaded.')+'</p><button data-mcq="load">Reload questions</button>'+(!bankMode&&!mockMode?' <button data-mcq="notes">'+(readOnlyChapter?'Read chapter':'Study notes')+'</button>':'')+'</div>';}
      finally{busy=false;}
    }
    function commit(q,state){state.at=Math.max(Date.now(),(answers.get(q.id)?.at||0)+1,(state.at||0)+1);answers.set(q.id,state);pending.set(q.id,state);if(missedOnly)retryAnswers.set(q.id,state);if(mockMode){paper.answers[paperId(q)]=state;paperPending=true;}save();}
    host.addEventListener('scroll',()=>{clearTimeout(viewTimer);viewTimer=setTimeout(saveView,200);},{passive:true});
    for(const event of ['pointerdown','touchstart','wheel','keydown'])host.addEventListener(event,()=>{restoringView=false;},{passive:true});
    addEventListener('pagehide',saveView);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveView();});
    host.addEventListener('submit',event=>{
      if(!event.target.matches('[data-jump-form]'))return;event.preventDefault();
      const form=new FormData(event.target),q=items.find(q=>q.kind==='past'&&q.t===form.get('sitting')&&q.examNumber===Number(form.get('number')||1));
      if(q)jump(q.id);else event.target.querySelector('[data-jump-status]').textContent='No question with that sitting and number.';
    });
    host.addEventListener('change',event=>{const name=event.target.dataset.select;if(!name)return;lastAnswer=null;const value=event.target.value;
      if(name==='mock-topic'){settings.topic=value;save();render();return;}
      if(name==='review-size'){try{const r=HazzardReview.size(Number(value),items);reviewBatch=r.batch;position=reviewBatch.position;notice='Batch size saved. Completed answers are kept.';}catch{storageError='Batch size could not be saved.';}render();return;}
      if(['year','level','mock-year','mock-level'].includes(name)){
        const isMock=name.startsWith('mock-'),key=name.endsWith('year')?'year':'level',previous=isMock?settings[key]:key==='year'?year:level;
        const selected=choicesOf(previous),next=value==='all'?[]:event.target.checked?[...new Set([...selected,value])]:selected.filter(v=>v!==value);
        const y=host.scrollTop;
        if(isMock){settings[key]=next;save();}else{if(key==='year')year=next;else level=next;position=0;}
        render();if(!isMock)saveView();host.querySelector('[data-multi="'+name+'"]').open=true;host.scrollTop=y;
        host.querySelector('[data-select="'+name+'"][value="'+value+'"]').focus({preventScroll:true});return;
      }
      if(name==='source'){filter=normalizeSource(value);year=[];level=[];topic='all';}else if(name==='topic')topic=value;else if(name==='sort')sort=value;
      position=0;render();host.scrollTop=0;
    });
    host.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!host.contains(button)||button.disabled)return;const action=button.dataset.mcq;
      if(button.dataset.option===undefined&&button.dataset.image===undefined&&button.dataset.page===undefined&&!['undo','unsure','save'].includes(action))lastAnswer=null;
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
      if(action==='retry-missed'){const missed=list.filter(q=>{const s=stateFor(q);return !s.checked||!q.accepted.includes(s.selected)});paper.ids=[...new Set(missed.map(q=>q.id))];paper.answers={};paper.finished=false;paper.retry=true;position=0;save();render();host.scrollTop=0;return;}
      const q=list[position];if(!q)return;if(button.dataset.image!==undefined){openImage(button.querySelector('img'));return;}
      if(button.dataset.page){const p=evidence.questions[q.id]?.pages.find(p=>p.page===Number(button.dataset.page)&&p.available);if(p){saveView();HazzardEvidence.openPage(p,history.state.mcqView);}return;}
      if(action==='flag'){
        if(personal.flags[q.id]?.hidden||systemPrefs.flags[q.id]?.hidden){location.assign('?chapter=bank#flags');return;}
        if(writeFlag(q)){render();if(mockMode)save();}else render();return;
      }
      const state={...stateFor(q)};
      if(action==='unsure'){
        try{
          const previousReview=HazzardReview.read().items[q.id]||null,unsure=!previousReview?.unsure,previousAction=lastAnswer;
          const attempt=lastAnswer?.kind==='unsure'?lastAnswer.attempt:lastAnswer;
          const value=state.checked?HazzardReview.result(attempt?.id===q.id?attempt.previousReview:previousReview,{correct:q.accepted.includes(state.selected),unsure,review:reviewMode&&attempt?.id===q.id}):{...(previousReview||HazzardReview.blank()),unsure,...(unsure?{active:true,step:0,due:HazzardReview.plus(HazzardReview.day(),1)}:{})};
          const saved=HazzardReview.set(q.id,value);unsureRemoved=unsure?null:{id:q.id,until:Date.now()+3000};lastAnswer={kind:'unsure',id:q.id,previousReview,reviewAt:saved.items[q.id].at,previousAction,attempt};
        }catch{storageError='Uncertainty could not be saved. Try again.';}
        const y=host.scrollTop;render();host.scrollTop=y;return;
      }
      if(action==='undo'){
        if(lastAnswer?.id!==q.id)return;
        try{if(HazzardReview.read().items[q.id]?.at!==lastAnswer.reviewAt){lastAnswer=null;notice='Review state changed in another tab. Undo is no longer available.';sync();return;}}catch{storageError='Review state could not be read safely.';render();return;}
        if(lastAnswer.kind==='unsure'){try{const undo=lastAnswer,saved=HazzardReview.set(q.id,undo.previousReview);lastAnswer=undo.previousAction;if(lastAnswer)lastAnswer.reviewAt=saved.items[q.id].at;}catch{storageError='Undo could not be saved.';}render();return;}
        if(lastAnswer.at!==state.at||!state.checked)return;
        try{if(pending.get(q.id)?.at!==lastAnswer.at&&readStore().answers[q.id]?.at!==lastAnswer.at){lastAnswer=null;sync();return;}}catch{storageError='The answer could not be read safely.';render();return;}
        const undo=lastAnswer,at=Math.max(Date.now(),state.at+1);
        try{const r=HazzardReview.set(q.id,undo.previousReview,reviewMode?undo.previousBatchAnswer||null:undefined);if(reviewMode)reviewBatch=r.batch;}catch{storageError='Review Undo could not be saved.';render();return;}
        const restored={...(undo.previousAnswer||empty()),at};
        answers.set(q.id,restored);pending.set(q.id,restored);
        if(missedOnly){if(undo.previousRetry)retryAnswers.set(q.id,undo.previousRetry);else retryAnswers.delete(q.id);}
        if(mockMode){if(undo.previousPaperAnswer)paper.answers[undo.paperId]={...undo.previousPaperAnswer,at};else delete paper.answers[undo.paperId];position=undo.position;paper.finished=undo.finished;paperPending=true;}
        save();lastAnswer=null;render();host.querySelector('[data-option="0"]')?.focus({preventScroll:true});return;
      }
      if(action==='next'||action==='prev'){
        if(action==='next'&&position===list.length-1&&reviewMode){position=list.length;HazzardReview.position(position);render();host.scrollTop=0;return;}
        if(action==='next'&&position===list.length-1&&mockMode){paper.finished=true;save();render();host.scrollTop=0;return;}
        position+=action==='next'?1:-1;if(mockMode)save();render();if(bankMode)host.querySelector('.mcq-question').scrollIntoView({block:'start'});else host.scrollTop=0;return;
      }
      if(button.dataset.option!==undefined&&!state.checked){state.selected=Number(button.dataset.option);state.checked=true;}
      else return;
      if(redoMode){commit(q,state);retryAnswers.set(q.id,state);render();HazzardChanged.refresh();host.querySelector('[data-mcq="next"]')?.focus({preventScroll:true});return;}
      let previousAnswer;try{previousAnswer=readStore().answers[q.id];}catch{storageError='The previous answer could not be read safely.';render();return;}
      const previousReview=HazzardReview.read().items[q.id]||null;
      const undo={id:q.id,previousReview,previousBatchAnswer:reviewBatch?.answers[q.id],previousAnswer:previousAnswer?{...previousAnswer}:null,previousRetry:retryAnswers.get(q.id),paperId:mockMode?paperId(q):null,previousPaperAnswer:mockMode?paper.answers[paperId(q)]:null,position,finished:mockMode?paper.finished:false};
      try{const saved=HazzardReview.set(q.id,HazzardReview.result(previousReview,{correct:q.accepted.includes(state.selected),unsure:!!previousReview?.unsure,review:reviewMode}),reviewMode?{...state,at:Date.now()}:undefined);undo.reviewAt=saved.items[q.id].at;if(reviewMode)reviewBatch=saved.batch;}catch{storageError='Review progress could not be saved. Try answering again.';render();return;}
      commit(q,state);if(reviewMode){reviewBatch.answers[q.id]=state;try{const r=HazzardReview.read();r.batch=reviewBatch;r.batchAt=Math.max(Date.now(),r.batchAt+1);HazzardReview.write(r);}catch{storageError='Review answer could not be saved.';}}lastAnswer={...undo,at:state.at};const y=host.scrollTop;render();host.scrollTop=y;
      host.querySelector('[data-mcq="next"]')?.focus({preventScroll:true});
    });
    sync();addEventListener('storage',event=>{if(event.key===KEY||event.key===PAPER_KEY||event.key===FLAGS_KEY||event.key===SYSTEM_KEY||event.key===HazzardReview.KEY||event.key===null)sync()});addEventListener('pageshow',event=>{if(event.persisted)sync()});
    return controller;
  }
  return {rich,stemHTML,membership,readStore,sourceLabel,KEY,PAPER_KEY,FLAGS_KEY,SYSTEM_KEY,VIEW_KEY,validView,mergeView,MIGRATION_KEY,loadAliases,migrateSaved,migrateValue,currentId,validSystem,mergeSystem,validStore,validPaper,validFlags,mergeStore,mergePaper,mergeFlags,readPaper,loadIndex,mount};
})();
