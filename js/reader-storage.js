/* Primary writes remain synchronous and keep their exact existing formats.
   IndexedDB holds five checksummed, complete reader-only snapshots. */
window.HazzardStorage = (() => {
  const DB_NAME='hazzard-reader-snapshots-v1',STORE='snapshots',KEEP=5;
  const PLACE_KEY='hazzard-place-v1',BOOKMARK_KEY='hazzard-bookmarks-v1',MOCK_KEY='hazzard-mock-v1',DRILL_KEY='hazzard-drills-v1',READING_KEY='hazzard-reading-progress-v1',MISSED_KEY='hazzard-missed-v1',TIMER_KEY='hazzard-timer-v2';
  const keys=new Set([PLACE_KEY,BOOKMARK_KEY,MOCK_KEY,DRILL_KEY,READING_KEY,MISSED_KEY,TIMER_KEY,'hazzard-timer-v1','stage-a-display-v4','hazzard-chapters-sort-v1',HazzardMCQ.KEY,HazzardMCQ.PAPER_KEY,HazzardMCQ.FLAGS_KEY,HazzardMCQ.SYSTEM_KEY,'hazzard-last-backup-v1']);
  keys.add(HazzardMCQ.MIGRATION_KEY);
  keys.add(HazzardMCQ.VIEW_KEY);
  keys.add(HazzardReview.KEY);
  keys.add(HazzardSimulation.KEY);
  const owns=key=>typeof key==='string'&&(keys.has(key)||key.startsWith('stage-a-highlights-v1:'));
  const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const stringList=value=>Array.isArray(value)&&value.every(x=>typeof x==='string');
  const validHighlight=mark=>mark&&['yellow','green','blue'].includes(mark.colour)&&typeof mark.text==='string';
  const sizes={small:12,medium:13.5,large:15};
  const validTimer=state=>Number.isInteger(state?.phase)&&state.phase>=0&&state.phase<3&&Number.isFinite(state.left)&&state.left>=0&&state.left<=[1500,300,300][state.phase]&&typeof state.running==='boolean'&&Number.isFinite(state.end)&&state.end>=0&&(!state.running||state.end>0);
  function validateNotebookValue(key,value){
  const place=p=>isRecord(p)&&typeof p.chapter==='string'&&Number.isFinite(p.at)&&Number.isFinite(p.ratio)&&p.ratio>=0&&p.ratio<=1&&(p.snippet===undefined||typeof p.snippet==='string')&&(p.unit==null||typeof p.unit==='string');
  const progress=p=>isRecord(p)&&(p.grades===undefined||isRecord(p.grades)&&Object.values(p.grades).every(g=>g===0||g===1))&&(p.revealed===undefined||stringList(p.revealed))&&(p.retryIds==null||stringList(p.retryIds));
  let valid=false;
  if(key.startsWith('stage-a-highlights-v1:')){
    valid=isRecord(value)&&value.version===1&&value.chapterId===key.slice('stage-a-highlights-v1:'.length)&&isRecord(value.marks)&&Object.entries(value.marks).every(([id,m])=>/^u\d+$/.test(id)&&validHighlight(m))
      &&(value.history===undefined||Array.isArray(value.history)&&value.history.every(m=>/^u\d+$/.test(m.id)&&validHighlight(m)))
      &&(value.ranges===undefined||isRecord(value.ranges)&&Object.entries(value.ranges).every(([id,m])=>/^r[\w-]*$/.test(id)&&validHighlight(m)&&(m.prefix===undefined||typeof m.prefix==='string')&&(m.suffix===undefined||typeof m.suffix==='string')));
  }else if(key===PLACE_KEY)valid=isRecord(value)&&(value.chapters===undefined||isRecord(value.chapters)&&Object.entries(value.chapters).every(([id,p])=>/^(?:\d+s?|laws?|mock)$/.test(id)&&place(p)))&&(value.last==null||place(value.last));
  else if(key===BOOKMARK_KEY)valid=Array.isArray(value)&&value.every(place);
  else if(key===MOCK_KEY)valid=progress(value)&&stringList(value.ids);
  else if(key===DRILL_KEY)valid=isRecord(value)&&(value.chapters===undefined||isRecord(value.chapters)&&Object.entries(value.chapters).every(([id,p])=>/^(?:\d+s|laws)$/.test(id)&&progress(p)));
  else if(key===READING_KEY)valid=isRecord(value)&&isRecord(value.chapters)&&Object.values(value.chapters).every(p=>isRecord(p)&&Number.isFinite(p.ratio)&&p.ratio>=0&&p.ratio<=1&&typeof p.read==='boolean');
  else if(key===MISSED_KEY)valid=isRecord(value)&&isRecord(value.questions)&&Object.entries(value.questions).every(([id,p])=>/^(?:\d+s|laws):\d+$/.test(id)&&isRecord(p)&&(p.grade===0||p.grade===1)&&Number.isFinite(p.at));
  else if(key===HazzardMCQ.KEY)valid=HazzardMCQ.validStore(value);
  else if(key===HazzardMCQ.PAPER_KEY)valid=HazzardMCQ.validPaper(value);
  else if(key===HazzardMCQ.FLAGS_KEY)valid=HazzardMCQ.validFlags(value);
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
  // Unreadable practice stores stay byte-for-byte intact until an explicit recovery.
  const protectedStores=new Map([
    [HazzardReview.KEY,{label:'Review history',fresh:'review',empty:()=>({version:1,items:{},seed:{count:0,at:Date.now()},settings:{size:30,at:0},batch:null,batchAt:0})}],
    [HazzardMCQ.KEY,{label:'Answers',fresh:'answers',empty:()=>({version:1,answers:{}})}],
    [HazzardMCQ.FLAGS_KEY,{label:'Topic flags',fresh:'topic flags',empty:()=>({version:1,flags:{},lawTopics:{ids:[],at:0}})}],
    [HazzardMCQ.SYSTEM_KEY,{label:'Source choices',fresh:'source choices',empty:()=>({version:1,selected:false,at:0,flags:{}})}],
    [HazzardMCQ.PAPER_KEY,{label:'Saved paper',fresh:'paper',empty:()=>({version:1,settings:{length:25,sources:['past','practice'],year:'all',level:'all',topic:'all'},paper:null,at:0})}],
    [HazzardSimulation.KEY,{label:'Exam simulation',fresh:'simulation',empty:()=>({version:1,at:0,session:null,history:{}})}]
  ]);
  const unreadable=new Map();
  function protect(key){
    const spec=protectedStores.get(key);if(!spec)return false;
    const raw=localStorage.getItem(key);
    if(raw===null||validRaw(key,raw)){unreadable.delete(key);return false;}
    if(unreadable.get(key)?.raw!==raw){
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format().replaceAll('-','');
      const side=key+'-unreadable-'+date;
      try{if(localStorage.getItem(side)===null)localStorage.setItem(side,raw);}catch{/* The original remains intact even if storage is full. */}
      unreadable.set(key,{raw,value:spec.empty()});
    }
    return true;
  }
  function blockedKeys(){for(const key of protectedStores.keys())protect(key);return [...unreadable.keys()];}
  function readProtected(key,fallback){
    if(protect(key))return structuredClone(unreadable.get(key).value);
    const raw=localStorage.getItem(key);return raw===null?fallback():JSON.parse(raw);
  }
  function startFresh(key){
    if(!protect(key))return;
    localStorage.setItem(key,JSON.stringify(protectedStores.get(key).empty()));
    unreadable.delete(key);snapshot();
  }
  function recoveryHTML(){
    return blockedKeys().map(key=>{const spec=protectedStores.get(key);return '<section class="mcq-recovery" role="alert"><p>'+spec.label+' could not be read.</p><button data-storage-cloud>Restore from cloud</button> <button data-storage-file>Restore from file</button> <button data-storage-fresh="'+key+'">Start '+spec.fresh+' fresh</button><p class="meta">Cloud uploads paused. This history stays unchanged until you restore or start fresh; temporary changes last only in this tab.</p></section>';}).join('');
  }
  blockedKeys();
  const status={persisted:null,restored:0,snapshotAt:null,error:''};
  const notify=()=>dispatchEvent(new CustomEvent('hazzard-storage-status',{detail:{...status}}));
  const persistence=(async()=>{try{status.persisted=typeof navigator.storage?.persist==='function'?await navigator.storage.persist():null;}catch{status.persisted=null;}notify();return status.persisted;})();
  async function requestPersistence(){
    try{await navigator.storage?.persist?.();status.persisted=await navigator.storage?.persisted?.()??false;}catch{status.persisted=false;}notify();return status.persisted;
  }
  let db=null,tail=Promise.resolve(),queuedPayload=null;
  function capture(){
    const storage={};for(const key of Object.keys(localStorage).filter(owns).sort()){const raw=localStorage.getItem(key);if(!validRaw(key,raw))throw Error('A saved reader item is unreadable. Automatic copies have been kept.');storage[key]=raw;}
    return storage;
  }
  async function hash(storage){const bytes=new TextEncoder().encode(JSON.stringify(storage));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function transaction(mode){try{return db.transaction(STORE,mode,{durability:'strict'});}catch{return db.transaction(STORE,mode);}}
  function rows(){return new Promise((resolve,reject)=>{const tx=transaction('readonly'),request=tx.objectStore(STORE).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function usable(row){return row?.version===1&&Number.isFinite(row.at)&&isRecord(row.storage)&&Object.entries(row.storage).every(([k,v])=>validRaw(k,v))&&typeof row.hash==='string'&&row.hash===await hash(row.storage);}
  function snapshot(){
    // Capture the whole reader state at the change, not at pagehide. Primary
    // localStorage has already acknowledged this write before we get here.
    if(blockedKeys().length){notify();return tail;}
    let storage;try{storage=capture();}catch(error){status.error=error.message;notify();return tail;}
    const payload=JSON.stringify(storage),at=Date.now();
    if(payload===queuedPayload)return tail;
    queuedPayload=payload;
    tail=tail.then(async()=>{
      if(!db)throw Error('Automatic local snapshots are unavailable. Manual backup still works.');
      const digest=await hash(storage);
      await new Promise((resolve,reject)=>{
        const tx=transaction('readwrite'),store=tx.objectStore(STORE);store.add({version:1,at,storage,hash:digest});
        const request=store.getAll();request.onsuccess=()=>{const ordered=request.result.sort((a,b)=>b.at-a.at||b.id-a.id);for(const row of ordered.slice(KEEP))store.delete(row.id);};
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Automatic snapshot could not be written'));tx.onerror=()=>{};
      });
      status.snapshotAt=at;status.error='';notify();
      dispatchEvent(new Event('hazzard-snapshot-saved'));
    }).catch(error=>{if(queuedPayload===payload)queuedPayload=null;status.error=error.message||'Automatic local snapshot failed.';notify();});
    return tail;
  }
  const ready=(async()=>{
    try{
      db=await new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Automatic snapshots are blocked by another tab.'));});
      const saved=(await rows()).sort((a,b)=>b.at-a.at||b.id-a.id);let latest=null;
      for(const row of saved){if(await usable(row)){latest=row;break;}}
      if(latest){
        status.snapshotAt=latest.at;
        // Restore only absent or invalid values. Valid empty marks/grades are
        // intentional changes and must not be resurrected from older copies.
        for(const [key,raw]of Object.entries(latest.storage))if(!protect(key)&&!validRaw(key,localStorage.getItem(key))){localStorage.setItem(key,raw);status.restored++;}
      }
      await snapshot();
    }catch(error){status.error=error.message||'Automatic recovery is unavailable.';}
    notify();
  })();
  function setItem(key,raw){if(protect(key)){unreadable.get(key).value=JSON.parse(raw);return;}localStorage.setItem(key,raw);if(owns(key))snapshot();}
  function removeItem(key){if(protect(key))return;localStorage.removeItem(key);if(owns(key))snapshot();}
  addEventListener('storage',event=>{if(event.storageArea===localStorage&&owns(event.key))snapshot();});
  return {readProtected,blockedKeys,recoveryHTML,startFresh,requestPersistence,ready,persistence,status,setItem,removeItem,snapshot,flush:()=>tail,validate:validateNotebookValue,owns};
})();
