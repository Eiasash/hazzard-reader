/* Primary writes remain synchronous and keep their exact existing formats.
   IndexedDB holds five checksummed, complete reader-only snapshots. */
window.HazzardStorage = (() => {
  const DB_NAME='hazzard-reader-snapshots-v1',STORE='snapshots',KEEP=5;
  const PLACE_KEY='hazzard-place-v1',BOOKMARK_KEY='hazzard-bookmarks-v1',MOCK_KEY='hazzard-mock-v1',DRILL_KEY='hazzard-drills-v1',READING_KEY='hazzard-reading-progress-v1',MISSED_KEY='hazzard-missed-v1',TIMER_KEY='hazzard-timer-v2';
  const keys=new Set([PLACE_KEY,BOOKMARK_KEY,MOCK_KEY,DRILL_KEY,READING_KEY,MISSED_KEY,TIMER_KEY,'hazzard-timer-v1','stage-a-display-v4','hazzard-chapters-sort-v1',HazzardMCQ.KEY,HazzardMCQ.PAPER_KEY,HazzardMCQ.FLAGS_KEY,HazzardMCQ.GENERATED_FLAGS_KEY,HazzardMCQ.SAVED_KEY,HazzardMCQ.LOG_KEY,HazzardMCQ.BAD_KEY,HazzardMCQ.SYSTEM_KEY,'hazzard-last-backup-v1']);
  keys.add('hazzard-removals-v1');
  keys.add(HazzardAnswerHighlights.KEY);
  keys.add(HazzardMCQ.MIGRATION_KEY);
  keys.add(HazzardMCQ.VIEW_KEY);
  keys.add(HazzardMCQ.SETTINGS_KEY);
  keys.add(HazzardMCQ.PLACE_KEY);
  keys.add(HazzardReview.KEY);
  keys.add(HazzardSimulation.KEY);
  const highlightKey=key=>typeof key==='string'&&key.startsWith('stage-a-highlights-v1:')&&!key.includes('-unreadable-');
  const owns=key=>typeof key==='string'&&(keys.has(key)||highlightKey(key));
  const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const stringList=value=>Array.isArray(value)&&value.every(x=>typeof x==='string');
  const validHighlight=mark=>mark&&['yellow','green','blue'].includes(mark.colour)&&typeof mark.text==='string';
  const sizes={small:12,medium:13.5,large:15};
  const validTimer=state=>Number.isInteger(state?.phase)&&state.phase>=0&&state.phase<3&&Number.isFinite(state.left)&&state.left>=0&&state.left<=[1500,300,300][state.phase]&&typeof state.running==='boolean'&&Number.isFinite(state.end)&&state.end>=0&&(!state.running||state.end>0);

  const REMOVALS_KEY='hazzard-removals-v1',REMOVALS_MAX=5000,REMOVALS_AGE=365*86400000;
  const emptyRemovals=()=>({version:1,bookmarks:{},generatedFlags:{},highlights:{}});
  const removalTimes=v=>isRecord(v)&&Object.values(v).every(at=>Number.isFinite(at)&&at>=0);
  function validRemovals(v){return isRecord(v)&&v.version===1&&Object.keys(v).every(k=>['version','bookmarks','generatedFlags','highlights'].includes(k))&&removalTimes(v.bookmarks)&&removalTimes(v.generatedFlags)&&isRecord(v.highlights)&&Object.entries(v.highlights).every(([chapter,entries])=>/^(?:\d+s?|laws?|mock|bank)$/.test(chapter)&&removalTimes(entries)&&Object.keys(entries).every(k=>/^m:u\d+$/.test(k)||k.startsWith('r:')));}
  const bookmarkSignature=b=>JSON.stringify([b.chapter,b.unit??null,b.snippet??null,b.ratio]);
  const rangeSignature=m=>'r:'+JSON.stringify([m.text,m.prefix||'',m.suffix||'']);
  const addTime=m=>Number.isFinite(m?.at)?m.at:0;
  function mergeRemovals(a,b,now=Date.now()){
    const out=emptyRemovals(),entries=[];
    for(const v of [a,b]){
      if(v==null)continue;if(!validRemovals(v))throw Error('Removal records could not be read. Saved data kept.');
      for(const section of ['bookmarks','generatedFlags'])for(const [id,at]of Object.entries(v[section]))out[section][id]=Math.max(out[section][id]??-1,at);
      for(const [chapter,marks]of Object.entries(v.highlights)){const target=out.highlights[chapter]||={};for(const [id,at]of Object.entries(marks))target[id]=Math.max(target[id]??-1,at);}
    }
    for(const section of ['bookmarks','generatedFlags'])for(const [id,at]of Object.entries(out[section]))entries.push({map:out[section],id,at,order:section+id});
    for(const [chapter,marks]of Object.entries(out.highlights))for(const [id,at]of Object.entries(marks))entries.push({map:marks,id,at,order:'highlights'+chapter+id});
    entries.sort((a,b)=>a.at-b.at||(a.order<b.order?-1:a.order>b.order?1:0));
    const expired=entries.filter(e=>e.at<now-REMOVALS_AGE).length,remove=Math.max(expired,entries.length-REMOVALS_MAX);
    for(const e of entries.slice(0,remove))delete e.map[e.id];
    for(const [chapter,marks]of Object.entries(out.highlights))if(!Object.keys(marks).length)delete out.highlights[chapter];
    return out;
  }
  function readRemovals(){if(protect(REMOVALS_KEY))return structuredClone(unreadable.get(REMOVALS_KEY).value);const raw=localStorage.getItem(REMOVALS_KEY);if(raw===null)return emptyRemovals();const v=JSON.parse(raw);if(!validRemovals(v))throw Error('Removal records could not be read. Saved data kept.');return v;}
  function applyRemovals(key,value,removals){
    const survives=(item,at)=>at===undefined||addTime(item)>at;
    if(key===BOOKMARK_KEY)return value.filter(b=>survives(b,removals.bookmarks[bookmarkSignature(b)]));
    if(key===HazzardMCQ.GENERATED_FLAGS_KEY)return value.filter(f=>survives(f,removals.generatedFlags[f.id+'@'+f.at]));
    if(key.startsWith('stage-a-highlights-v1:')){const records=removals.highlights[value.chapterId]||{};return {...value,marks:Object.fromEntries(Object.entries(value.marks).filter(([id,m])=>survives(m,records['m:'+id]))),...(value.ranges===undefined?{}:{ranges:Object.fromEntries(Object.entries(value.ranges).filter(([id,m])=>survives(m,records[rangeSignature(m)])))}),...(value.history===undefined?{}:{history:value.history.filter(m=>survives(m,records['m:'+m.id]))})};}
    return value;
  }
  function removalChange(key,raw){
    if(key!==BOOKMARK_KEY&&key!==HazzardMCQ.GENERATED_FLAGS_KEY&&!key.startsWith('stage-a-highlights-v1:'))return null;
    const previous=localStorage.getItem(key),next=JSON.parse(raw);validateNotebookValue(key,next);
    if(previous===null)return null;const before=JSON.parse(previous);validateNotebookValue(key,before);
    const out=readRemovals(),at=Date.now();let changed=false;
    const put=(map,id)=>{map[id]=Math.max(map[id]??-1,at);changed=true;};
    if(key===BOOKMARK_KEY){const kept=new Set(next.map(bookmarkSignature));for(const b of before)if(!kept.has(bookmarkSignature(b)))put(out.bookmarks,bookmarkSignature(b));}
    else if(key===HazzardMCQ.GENERATED_FLAGS_KEY){const kept=new Set(next.map(f=>f.id+'@'+f.at));for(const f of before)if(!kept.has(f.id+'@'+f.at))put(out.generatedFlags,f.id+'@'+f.at);}
    else{
      const records=out.highlights[before.chapterId]||={},kept=new Set([...Object.keys(next.marks),...(next.history||[]).map(m=>m.id)]);
      for(const id of [...Object.keys(before.marks),...(before.history||[]).map(m=>m.id)])if(!kept.has(id)){
        // Reattaching the same saved sentence is a move, not a removal.
        const old=before.marks[id]||(before.history||[]).find(m=>m.id===id);
        if(!Object.entries(next.marks).some(([nextId,m])=>!Object.hasOwn(before.marks,nextId)&&m.text===old.text&&addTime(m)===addTime(old)))put(records,'m:'+id);
      }
      const ranges=new Set(Object.values(next.ranges||{}).map(rangeSignature));for(const m of Object.values(before.ranges||{}))if(!ranges.has(rangeSignature(m)))put(records,rangeSignature(m));
    }
    return changed?JSON.stringify(mergeRemovals(out,null)):null;
  }
  const removals={key:REMOVALS_KEY,empty:emptyRemovals,valid:validRemovals,read:readRemovals,merge:mergeRemovals,apply:applyRemovals,bookmarkSignature,rangeSignature,addTime};
  function validateNotebookValue(key,value){
  const place=p=>isRecord(p)&&typeof p.chapter==='string'&&Number.isFinite(p.at)&&Number.isFinite(p.ratio)&&p.ratio>=0&&p.ratio<=1&&(p.snippet===undefined||typeof p.snippet==='string')&&(p.unit==null||typeof p.unit==='string');
  const progress=p=>isRecord(p)&&(p.grades===undefined||isRecord(p.grades)&&Object.values(p.grades).every(g=>g===0||g===1))&&(p.revealed===undefined||stringList(p.revealed))&&(p.retryIds==null||stringList(p.retryIds));
  if(key===REMOVALS_KEY){if(!validRemovals(value))throw Error('Removal records could not be read. Saved data kept.');return;}
  let valid=false;
  if(key.startsWith('stage-a-highlights-v1:')){
    valid=isRecord(value)&&value.version===1&&value.chapterId===key.slice('stage-a-highlights-v1:'.length)&&isRecord(value.marks)&&Object.entries(value.marks).every(([id,m])=>/^u\d+$/.test(id)&&validHighlight(m))
      &&(value.history===undefined||Array.isArray(value.history)&&value.history.every(m=>/^u\d+$/.test(m.id)&&validHighlight(m)))
      &&(value.ranges===undefined||isRecord(value.ranges)&&Object.entries(value.ranges).every(([id,m])=>/^r[\w-]*$/.test(id)&&validHighlight(m)&&(m.prefix===undefined||typeof m.prefix==='string')&&(m.suffix===undefined||typeof m.suffix==='string')));
  }else if(key===PLACE_KEY)valid=isRecord(value)&&(value.chapters===undefined||isRecord(value.chapters)&&Object.entries(value.chapters).every(([id,p])=>/^(?:\d+s?|laws?|mock|bank)$/.test(id)&&place(p)))&&(value.last==null||place(value.last));
  else if(key===BOOKMARK_KEY)valid=Array.isArray(value)&&value.every(place);
  else if(key===MOCK_KEY)valid=progress(value)&&stringList(value.ids);
  else if(key===DRILL_KEY)valid=isRecord(value)&&(value.chapters===undefined||isRecord(value.chapters)&&Object.entries(value.chapters).every(([id,p])=>/^(?:\d+s|laws)$/.test(id)&&progress(p)));
  else if(key===READING_KEY)valid=isRecord(value)&&isRecord(value.chapters)&&Object.values(value.chapters).every(p=>isRecord(p)&&Number.isFinite(p.ratio)&&p.ratio>=0&&p.ratio<=1&&typeof p.read==='boolean');
  else if(key===MISSED_KEY)valid=isRecord(value)&&isRecord(value.questions)&&Object.entries(value.questions).every(([id,p])=>/^(?:\d+s|laws):\d+$/.test(id)&&isRecord(p)&&(p.grade===0||p.grade===1)&&Number.isFinite(p.at));
  else if(key===HazzardAnswerHighlights.KEY)valid=HazzardAnswerHighlights.valid(value);
  else if(key===HazzardMCQ.KEY)valid=HazzardMCQ.validStore(value);
  else if(key===HazzardMCQ.PAPER_KEY)valid=HazzardMCQ.validPaper(value);
  else if(key===HazzardMCQ.SETTINGS_KEY)valid=HazzardMCQ.validSettings(value);
  else if(key===HazzardMCQ.PLACE_KEY)valid=HazzardMCQ.validPracticePlace(value);
  else if(key===HazzardMCQ.LOG_KEY)valid=HazzardMCQ.validLog(value);
  else if(key===HazzardMCQ.BAD_KEY)valid=HazzardMCQ.validBad(value);
  else if(key===HazzardMCQ.SAVED_KEY)valid=HazzardMCQ.validSaved(value);
  else if(key===HazzardMCQ.FLAGS_KEY)valid=HazzardMCQ.validFlags(value);
  else if(key===HazzardMCQ.GENERATED_FLAGS_KEY)valid=HazzardMCQ.validGeneratedFlags(value);
  else if(key===HazzardMCQ.SYSTEM_KEY)valid=HazzardMCQ.validSystem(value);
  else if(key===HazzardReview.KEY)valid=HazzardReview.valid(value);
  else if(key===HazzardSimulation.KEY)valid=HazzardSimulation.valid(value);
  else if(key===HazzardMCQ.VIEW_KEY)valid=HazzardMCQ.validView(value);
  else if(key===TIMER_KEY||key==='hazzard-timer-v1')valid=validTimer(value);
  else if(key==='hazzard-chapters-sort-v1')valid=['number','title','yield'].includes(value);
  else if(key==='stage-a-display-v4')valid=isRecord(value)&&Object.hasOwn(sizes,value.size)&&['yellow','green','blue'].includes(value.colour)&&['light','dark'].includes(value.theme);
  if(!valid)throw new Error('This backup contains unreadable notebook data. Nothing was restored.');
}
  function validRaw(key,raw){
    try{
      if(typeof raw!=='string'||!owns(key))return false;
      if(key==='hazzard-last-backup-v1')return Number.isFinite(Number(raw))&&Number(raw)>=0;
      if(key===HazzardMCQ.MIGRATION_KEY)return raw==='1';
      validateNotebookValue(key,key==='hazzard-chapters-sort-v1'?raw:JSON.parse(raw));return true;
    }catch{return false;}
  }
  // Unreadable stores stay byte-for-byte intact until an explicit recovery.
  const sharedRecoveryStore=key=>key===DRILL_KEY||key===MOCK_KEY||key===MISSED_KEY||key===TIMER_KEY||key===REMOVALS_KEY;
  const readerStore=key=>key===PLACE_KEY||key===BOOKMARK_KEY||key===READING_KEY||sharedRecoveryStore(key)||key===HazzardAnswerHighlights.KEY||highlightKey(key);
  const protectedStores=new Map([
    [HazzardAnswerHighlights.KEY,{label:'Answer-key highlights',fresh:'answer-key highlights',empty:HazzardAnswerHighlights.empty}],
    [PLACE_KEY,{label:'Reading place',fresh:'reading place',empty:()=>({chapters:{}})}],
    [BOOKMARK_KEY,{label:'Bookmarks',fresh:'bookmarks',empty:()=>[]}],
    [READING_KEY,{label:'Reading progress',fresh:'reading progress',empty:()=>({chapters:{}})}],
    [DRILL_KEY,{label:'Drill grades',fresh:'drill grades',empty:()=>({})}],
    [MOCK_KEY,{label:'Legacy mock progress',fresh:'legacy mock progress',empty:()=>({ids:[],grades:{},revealed:[]})}],
    [MISSED_KEY,{label:'Missed questions',fresh:'missed questions',empty:()=>({questions:{}})}],
    [TIMER_KEY,{label:'Study timer',fresh:'study timer',empty:()=>({phase:0,left:1500,running:false,end:0})}],
    [REMOVALS_KEY,{label:'Deletion records',fresh:'deletion records',empty:emptyRemovals}],
    [HazzardMCQ.SETTINGS_KEY,{label:'Practice settings',fresh:'practice settings',empty:()=>({version:1,includeStandout:false,shufflePastOptions:true,generatedSelected:true,drillSelected:true,at:0})}],
    [HazzardMCQ.PLACE_KEY,{label:'Practice place',fresh:'practice place',empty:()=>({version:1,screen:'bank',id:null,scroll:0})}],
    [HazzardMCQ.LOG_KEY,{label:'Weekly answer log',fresh:'weekly log',empty:HazzardMCQ.emptyLog}],
    [HazzardMCQ.BAD_KEY,{label:'Bad question flags',fresh:'bad flags',empty:HazzardMCQ.emptyBad}],
    [HazzardReview.KEY,{label:'Review history',fresh:'review',empty:()=>({version:1,items:{},seed:{count:0,at:Date.now()},settings:{size:30,at:0},batch:null,batchAt:0})}],
    [HazzardMCQ.KEY,{label:'Answers',fresh:'answers',empty:()=>({version:1,answers:{}})}],
    [HazzardMCQ.SAVED_KEY,{label:'Saved revision',fresh:'saved revision',empty:HazzardMCQ.emptySaved}],
    [HazzardMCQ.FLAGS_KEY,{label:'Topic flags',fresh:'topic flags',empty:()=>({version:1,flags:{},lawTopics:{ids:[],at:0}})}],
    [HazzardMCQ.GENERATED_FLAGS_KEY,{label:'Generated-practice flags',fresh:'generated-practice flags',empty:()=>[]}],
    [HazzardMCQ.SYSTEM_KEY,{label:'Source choices',fresh:'source choices',empty:()=>({version:1,selected:false,at:0,flags:{}})}],
    [HazzardMCQ.PAPER_KEY,{label:'Saved paper',fresh:'paper',empty:()=>({version:1,settings:{length:25,sources:['past','practice'],year:'all',level:'all',topic:'all'},paper:null,at:0})}],
    [HazzardSimulation.KEY,{label:'Exam simulation',fresh:'simulation',empty:()=>({version:1,at:0,session:null,history:{}})}]
  ]);
  function protectedStore(key){
    if(!protectedStores.has(key)&&highlightKey(key)){
      const chapterId=key.slice('stage-a-highlights-v1:'.length);
      protectedStores.set(key,{label:'Highlights ('+chapterId+')',fresh:'highlights',empty:()=>({version:1,chapterId,marks:{},history:[]})});
    }
    return protectedStores.get(key);
  }
  const unreadable=new Map(),recoverySnapshots=new Map();
  function preserveUnreadable(key,raw){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format().replaceAll('-','');
  const side=key+'-unreadable-'+date;
    if(raw!==null&&localStorage.getItem(side)===null)localStorage.setItem(side,raw);
  }
  function protect(key){
    const spec=protectedStore(key);if(!spec)return false;
    const raw=localStorage.getItem(key);
    if((raw===null&&!(key===HazzardMCQ.PLACE_KEY&&recoverySnapshots.has(key)))||validRaw(key,raw)){unreadable.delete(key);return false;}
    if(unreadable.get(key)?.raw!==raw){
      try{preserveUnreadable(key,raw);}catch{/* The original remains intact even if storage is full. */}
      unreadable.set(key,{raw,value:spec.empty()});
    }
    return true;
  }
  function blockedKeys(){for(const key of Object.keys(localStorage))if(readerStore(key))protectedStore(key);for(const key of protectedStores.keys())protect(key);return [...unreadable.keys()];}
  function readProtected(key,fallback){
    if(protect(key))return structuredClone(unreadable.get(key).value);
    const raw=localStorage.getItem(key);return raw===null?fallback():JSON.parse(raw);
  }
  function applySavedRemovals(records){
    for(const key of Object.keys(localStorage)){
      if(key!==BOOKMARK_KEY&&key!==HazzardMCQ.GENERATED_FLAGS_KEY&&!highlightKey(key))continue;
      const inMemory=protect(key),value=inMemory?unreadable.get(key).value:JSON.parse(localStorage.getItem(key));
      const next=applyRemovals(key,value,records),raw=JSON.stringify(next);
      if(raw===JSON.stringify(value))continue;
      if(inMemory)unreadable.get(key).value=next;else localStorage.setItem(key,raw);
    }
  }
  function startFresh(key){
    if(!protect(key))return;
    const base=protectedStores.get(key).empty();
    const next=key===REMOVALS_KEY?mergeRemovals(base,unreadable.get(key).value):base;
    localStorage.setItem(key,JSON.stringify(next));
    unreadable.delete(key);
    if(key===REMOVALS_KEY)applySavedRemovals(next);
    snapshot();
  }
  function snapshotTime(at){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
    const part=name=>parts.find(p=>p.type===name).value;
    return part('day')+'.'+part('month')+'.'+part('year')+' '+part('hour')+':'+part('minute');
  }
  async function restoreSnapshot(key){
    if(!protect(key))return;
    const selected=recoverySnapshots.get(key);
    const row=selected&&db&&(await rows()).find(row=>row.id===selected.id);
    if(!row||row.hash!==selected.hash||!Object.hasOwn(row.storage,key)||!await usable(row))throw Error('That local snapshot is unavailable. Existing history kept.');
    // Explicit recovery keeps the raw side copy; recovered removals also prune deleted marks.
    if(!protect(key))return;
    const records=key===REMOVALS_KEY?mergeRemovals(JSON.parse(row.storage[key]),unreadable.get(key).value):null;
    localStorage.setItem(key,records?JSON.stringify(records):row.storage[key]);
    unreadable.delete(key);
    if(records)applySavedRemovals(records);
    snapshot();
  }
  function recoveryHTML(reader=false){
    const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return blockedKeys().filter(key=>reader===null||readerStore(key)===reader||sharedRecoveryStore(key)).map(rawKey=>{const spec=protectedStores.get(rawKey),saved=recoverySnapshots.get(rawKey),key=escape(rawKey);
      const local=saved?'<button data-storage-snapshot="'+key+'">Restore latest local snapshot ('+snapshotTime(saved.at)+')</button> ':'';
      return '<section class="mcq-recovery" role="alert"><p>'+escape(spec.label)+' could not be read.</p>'+local+'<button data-storage-cloud>Restore from cloud</button> <button data-storage-file>Restore from file</button> <button data-storage-fresh="'+key+'">Start '+spec.fresh+' fresh</button><p class="meta">Cloud paused: a saved store could not be read. This history stays unchanged until you restore or start fresh; temporary changes last only in this tab.</p></section>';
    }).join('');
  }
  blockedKeys();
  const status={persisted:null,restored:0,snapshotAt:null,error:''};
  const notify=()=>dispatchEvent(new CustomEvent('hazzard-storage-status',{detail:{...status}}));
  const persistence=(async()=>{try{status.persisted=typeof navigator.storage?.persist==='function'?await navigator.storage.persist():null;}catch{status.persisted=null;}notify();return status.persisted;})();
  async function requestPersistence(){
    try{await navigator.storage?.persist?.();status.persisted=await navigator.storage?.persisted?.()??false;}catch{status.persisted=false;}notify();return status.persisted;
  }
  let db=null,tail=Promise.resolve(),queuedPayload=null;
  function capture(preserveInvalid=false){
    const storage={};for(const key of Object.keys(localStorage).filter(owns).sort()){const raw=localStorage.getItem(key);if(!preserveInvalid&&!protectedStores.has(key)&&!validRaw(key,raw))continue;if(!(preserveInvalid&&!protectedStores.has(key))&&!validRaw(key,raw))throw Error('A saved reader item is unreadable. Automatic copies have been kept.');storage[key]=raw;}
    return storage;
  }
  async function hash(storage){const bytes=new TextEncoder().encode(JSON.stringify(storage));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function transaction(mode){try{return db.transaction(STORE,mode,{durability:'strict'});}catch{return db.transaction(STORE,mode);}}
  function rows(){return new Promise((resolve,reject)=>{const tx=transaction('readonly'),request=tx.objectStore(STORE).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function usable(row){return row?.version===1&&Number.isFinite(row.at)&&isRecord(row.storage)&&Object.entries(row.storage).every(([k,v])=>validRaw(k,v))&&typeof row.hash==='string'&&row.hash===await hash(row.storage);}
  async function indexSnapshots(){
    const saved=(await rows()).sort((a,b)=>b.at-a.at||b.id-a.id);let latest=null;
    recoverySnapshots.clear();
    for(const row of saved){if(await usable(row)){
      latest??=row;
      for(const key of Object.keys(row.storage))protectedStore(key);
      for(const key of protectedStores.keys())if(!recoverySnapshots.has(key)&&Object.hasOwn(row.storage,key))recoverySnapshots.set(key,{id:row.id,at:row.at,hash:row.hash});
    }}
    return latest;
  }
  function snapshot({preserveInvalid=false}={}){
    // Capture the whole reader state at the change, not at pagehide. Primary
    // localStorage has already acknowledged this write before we get here.
    if(blockedKeys().length){notify();return tail;}
    let storage;try{storage=capture(preserveInvalid);}catch(error){status.error=error.message;notify();return tail;}
    const payload=JSON.stringify(storage),at=Date.now();
    if(payload===queuedPayload&&!preserveInvalid)return tail;
    queuedPayload=payload;
    tail=tail.then(async()=>{
      if(!db)throw Error('Automatic local snapshots are unavailable. Manual backup still works.');
      const digest=await hash(storage);
      await new Promise((resolve,reject)=>{
        const tx=transaction('readwrite'),store=tx.objectStore(STORE);store.add({version:1,at,storage,hash:digest});
        const request=store.getAll();request.onsuccess=()=>{const ordered=request.result.sort((a,b)=>b.at-a.at||b.id-a.id);for(const row of ordered.slice(KEEP))store.delete(row.id);};
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Automatic snapshot could not be written'));tx.onerror=()=>{};
      });
      await indexSnapshots();
      status.snapshotAt=at;status.error='';notify();
      dispatchEvent(new Event('hazzard-snapshot-saved'));
    }).catch(error=>{if(queuedPayload===payload)queuedPayload=null;status.error=error.message||'Automatic local snapshot failed.';notify();});
    return tail;
  }
  const ready=(async()=>{
    try{
      db=await new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Automatic snapshots are blocked by another tab.'));});
      const latest=await indexSnapshots();
      if(latest){
        status.snapshotAt=latest.at;
        // Restore only absent or invalid values. Valid empty marks/grades are
        // intentional changes and must not be resurrected from older copies.
        for(const [key,raw]of Object.entries(latest.storage))if(key!==HazzardMCQ.SETTINGS_KEY&&!protect(key)&&!validRaw(key,localStorage.getItem(key))){localStorage.setItem(key,raw);status.restored++;}
      }
      await snapshot();
    }catch(error){status.error=error.message||'Automatic recovery is unavailable.';}
    notify();
  })();
  function setItem(key,raw){
    if(protect(key)){unreadable.get(key).value=JSON.parse(raw);return;}
    const change=removalChange(key,raw),protectedRemovals=change!==null&&protect(REMOVALS_KEY),previous=localStorage.getItem(REMOVALS_KEY),previousValue=protectedRemovals?structuredClone(unreadable.get(REMOVALS_KEY).value):null;
    if(change!==null){if(protectedRemovals)unreadable.get(REMOVALS_KEY).value=JSON.parse(change);else localStorage.setItem(REMOVALS_KEY,change);}
    try{localStorage.setItem(key,raw);}catch(error){if(change!==null){if(protectedRemovals)unreadable.get(REMOVALS_KEY).value=previousValue;else if(previous===null)localStorage.removeItem(REMOVALS_KEY);else localStorage.setItem(REMOVALS_KEY,previous);}throw error;}
    if(owns(key))snapshot();
  }
  function removeItem(key){if(protect(key))return;localStorage.removeItem(key);if(owns(key))snapshot();}
  addEventListener('storage',event=>{if(event.storageArea===localStorage&&owns(event.key))snapshot();});
  return {removals,preserveUnreadable,readProtected,blockedKeys,recoveryHTML,startFresh,restoreSnapshot,requestPersistence,ready,persistence,status,setItem,removeItem,snapshot,flush:()=>tail,validate:validateNotebookValue,owns};
})();
