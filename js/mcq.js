/* MCQs use only their own store. Existing notebook, drill and progress formats
   are unchanged. Content-derived IDs prevent answers moving to another item. */
window.HazzardMCQ = (() => {
  const KEY = 'hazzard-mcq-v1';
  const GENERATED_FLAGS_KEY='hazzard-generated-flags-v1';
  const drillTier=q=>q.source==='drill'||!!q.sourceChecked;
  const generated=q=>q.kind==='practice'&&!drillTier(q);
  const validGeneratedFlags=value=>Array.isArray(value)&&value.every(flag=>flag!==null&&typeof flag==='object'&&!Array.isArray(flag)&&typeof flag.id==='string'&&flag.id.length>0&&Number.isFinite(flag.at)&&flag.at>=0);
  function generatedFlags(){const raw=localStorage.getItem(GENERATED_FLAGS_KEY);const entries=raw===null?[]:JSON.parse(raw);if(!validGeneratedFlags(entries))throw Error('Generated-practice flags could not be read.');return entries;}
  function showGeneratedCount(){const node=document.getElementById('generatedFlagCount');if(!node)return;try{node.textContent=new Set(generatedFlags().map(f=>f.id)).size+' generated practice items flagged';}catch{node.textContent='Generated-practice flag count unavailable.';}}
  showGeneratedCount();addEventListener('storage',showGeneratedCount);addEventListener('pageshow',showGeneratedCount);
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
    if(localStorage.getItem(MIGRATION_KEY)==='1'||HazzardStorage.blockedKeys().length)return;
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
  const SAVED_KEY='hazzard-mcq-saved-v1';
  const emptySaved=()=>({version:1,questions:{},topics:{}});
  function validSaved(v){return record(v)&&v.version===1&&['questions','topics'].every(kind=>record(v[kind])&&Object.entries(v[kind]).every(([id,r])=>(kind==='questions'?/^mcq-[a-f0-9]{24}$/:/^\d{1,3}$/).test(id)&&record(r)&&typeof r.saved==='boolean'&&Number.isFinite(r.at)&&r.at>=0));}
  function mergeSaved(a,b){
    const out=emptySaved();
    for(const kind of ['questions','topics'])for(const source of [b,a])for(const[id,r]of Object.entries(source[kind])){
      const key=kind==='questions'?currentId(id):id,old=out[kind][key];
      // Deletion wins a tie, including aliases of the same question.
      if(!old||r.at>old.at||r.at===old.at&&!r.saved)out[kind][key]={...r};
    }
    return out;
  }
  function readSaved(){return mergeSaved(emptySaved(),HazzardStorage.readProtected(SAVED_KEY,emptySaved));}
  let revisionUndo=null,revisionNotice='';
  function setSaved(kind,ids,saved){
    const value=readSaved(),at=Math.max(Date.now(),...ids.map(id=>(value[kind][id]?.at||0)+1));
    const previous=ids.map(id=>[id,!!value[kind][id]?.saved]);
    for(const id of ids)value[kind][id]={saved,at};
    HazzardStorage.setItem(SAVED_KEY,JSON.stringify(value));
    revisionUndo=saved?null:{kind,previous,at};revisionNotice=saved?'Saved for revision.':'Removed from saved.';
  }
  function revisionButtons(q){
    const value=readSaved(),question=!!value.questions[currentId(q.id)]?.saved,ids=membership(q).map(String),topic=ids.every(id=>value.topics[id]?.saved);
    return badButton(q)+'<button data-revision="questions" data-revision-ids="'+currentId(q.id)+'" aria-pressed="'+question+'">'+(question?'Saved':'Save question')+'</button><button data-revision="topics" data-revision-ids="'+ids.join(',')+'" aria-pressed="'+topic+'">'+(topic?'Topic saved':'Save topic')+'</button>';
  }
  function revisionStatus(){return badStatus()+(revisionNotice?'<p class="meta mcq-revision-status" role="status">'+escape(revisionNotice)+(revisionUndo?' <button data-revision="undo">Undo</button>':'')+'</p>':'');}
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-revision]');if(!button||button.disabled)return;
    try{
      const kind=button.dataset.revision;
      if(kind==='undo'){
        if(!revisionUndo)return;
        const value=readSaved(),{kind,previous,at}=revisionUndo;
        if(previous.some(([id])=>value[kind][id]?.at!==at))throw Error('Saved items changed in another tab.');
        const now=Math.max(Date.now(),at+1);for(const[id,saved]of previous)value[kind][id]={saved,at:now};
        HazzardStorage.setItem(SAVED_KEY,JSON.stringify(value));revisionUndo=null;revisionNotice='Removal undone.';
      }else{
        const ids=button.dataset.revisionIds.split(','),value=readSaved();
        setSaved(kind,ids,button.hasAttribute('data-revision-remove')?false:!ids.every(id=>value[kind][id]?.saved));
      }
    }catch(error){revisionNotice='Could not save revision changes. '+error.message;}
    dispatchEvent(new Event('hazzard-saved-change'));
  });

  const LOG_KEY='hazzard-mcq-log-v1',BAD_KEY='hazzard-mcq-bad-v1';
  const emptyLog=()=>({version:1,items:{}}),emptyBad=()=>({version:1,items:{}});
  const questionId=id=>/^mcq-[a-f0-9]{24}$/.test(id);
  function validLog(v){return record(v)&&v.version===1&&record(v.items)&&Object.entries(v.items).every(([id,entries])=>questionId(id)&&Array.isArray(entries)&&entries.every(e=>Array.isArray(e)&&e.length===6&&Number.isInteger(e[0])&&e[0]>=0&&['c','w','u'].includes(e[1])&&[0,1].includes(e[2])&&typeof e[3]==='string'&&e[3].length>0&&e[3].length<200&&['answer','unsure'].includes(e[4])&&typeof e[5]==='boolean'&&(e[4]!=='unsure'||e[1]==='u'&&e[2]===0)));}
  function mergeLog(a,b){
    const maps=new Map();
    for(const source of [b,a])for(const[id,entries]of Object.entries(source.items)){
      const key=currentId(id);if(!maps.has(key))maps.set(key,new Map());const events=maps.get(key);
      for(const e of entries){const old=events.get(e[3]);if(!old)events.set(e[3],[...e]);else{const winner=JSON.stringify(e.slice(0,5))<JSON.stringify(old.slice(0,5))?e:old;events.set(e[3],[...winner.slice(0,5),old[5]||e[5]]);}}
    }
    return {version:1,items:Object.fromEntries([...maps].sort(([a],[b])=>a.localeCompare(b)).map(([id,m])=>[id,[...m.values()].sort((a,b)=>a[0]-b[0]||a[3].localeCompare(b[3]))]))};
  }
  function validBad(v){return record(v)&&v.version===1&&record(v.items)&&Object.entries(v.items).every(([id,r])=>questionId(id)&&record(r)&&typeof r.bad==='boolean'&&Number.isFinite(r.at)&&r.at>=0);}
  function mergeBad(a,b){const out=emptyBad();for(const source of [b,a])for(const[id,r]of Object.entries(source.items)){const key=currentId(id),old=out.items[key];if(!old||r.at>old.at||r.at===old.at&&!r.bad)out.items[key]={...r};}return out;}
  // Strict reads are deliberately separate from recovery-backed UI reads.
  function rawValue(key,valid,empty){const raw=localStorage.getItem(key);if(raw===null)return empty();const value=JSON.parse(raw);if(!valid(value))throw Error('Unavailable store: '+key);return value;}
  function readBad(){return mergeBad(emptyBad(),rawValue(BAD_KEY,validBad,emptyBad));}
  function bad(id){try{return !!readBad().items[currentId(id)]?.bad;}catch{return false;}}
  let badUndo=null,badNotice='';
  function badButton(q){try{return '<button data-bad="'+currentId(q.id)+'" aria-pressed="'+bad(q.id)+'">'+(bad(q.id)?'Flagged bad':'Bad question')+'</button>';}catch{return '<span>Bad flags unavailable</span>';}}
  function badStatus(){return badNotice?'<p class="meta" role="status">'+escape(badNotice)+(badUndo?' <button data-bad-undo>Undo</button>':'')+'</p>':'';}
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-bad],[data-bad-undo]');if(!button)return;
    try{const value=readBad();let id,next;
      if(button.hasAttribute('data-bad-undo')){if(!badUndo)return;id=badUndo.id;if(value.items[id]?.at!==badUndo.at)throw Error('Flag changed in another tab.');next=true;}
      else{id=currentId(button.dataset.bad);next=!value.items[id]?.bad;}
      const at=Math.max(Date.now(),(value.items[id]?.at||0)+1);value.items[id]={bad:next,at};HazzardStorage.setItem(BAD_KEY,JSON.stringify(value));
      if(readBad().items[id]?.at!==at)throw Error('Flag not saved.');badUndo=next?null:{id,at};badNotice=next?'Flagged bad.':'Question unflagged.';
    }catch(error){badNotice='Bad flag could not be saved. '+error.message;}
    dispatchEvent(new Event('hazzard-bad-change'));
  });
  function logAction(q,kind='answer',eventId=crypto.randomUUID(),at=Date.now()){
    try{const before=currentAnswers(rawValue(KEY,validStore,()=>({version:1,answers:{}})).answers)[currentId(q.id)];return {id:currentId(q.id),entry:[Math.floor(at/60000),'u',kind==='answer'&&!(before?.checked===true&&Number.isInteger(before.selected))?1:0,eventId,kind,false]};}catch{return null;}
  }
  function appendLog(action){if(!action)return;try{const value=rawValue(LOG_KEY,validLog,emptyLog),incoming=emptyLog();incoming.items[action.id]=[action.entry];HazzardStorage.setItem(LOG_KEY,JSON.stringify(mergeLog(value,incoming)));}catch{/* Unreadable history is preserved, never replaced. */}}
  function persistedAnswer(id,a){try{const actual=currentAnswers(rawValue(KEY,validStore,()=>({version:1,answers:{}})).answers)[currentId(id)];return actual?.at===a.at&&actual?.checked===a.checked&&actual?.selected===a.selected;}catch{return false;}}
  function removeLog(action){if(!action)return;appendLog({...action,entry:[...action.entry.slice(0,5),true]});}

  const SYSTEM_KEY='hazzard-mcq-israeli-system-v1';
  const VIEW_KEY='hazzard-mcq-view-v1';
  const membership=q=>[...new Set([q.topic,...(q.topics||[])])];
  const choicesOf=value=>Array.isArray(value)?value:value==='all'?[]:[value];
  const validChoices=(value,allowed)=>typeof value==='string'?(value==='all'||allowed(value)):Array.isArray(value)&&new Set(value).size===value.length&&value.every(v=>typeof v==='string'&&allowed(v));
  const validYears=value=>validChoices(value,v=>/^\d{4}$/.test(v));
  const validLevels=value=>validChoices(value,v=>['Basic','Subspec','unspecified'].includes(v));
  const matchesYear=(q,value)=>!choicesOf(value).length||choicesOf(value).includes(q.t.slice(0,4));
  const matchesLevel=(q,value)=>!choicesOf(value).length||choicesOf(value).some(v=>v==='unspecified'?!/-(Basic|Subspec)$/.test(q.t):q.t.endsWith('-'+v));
  const validTopics=value=>/^(all|\d{1,3})$/.test(value)&&!Array.isArray(value)||Array.isArray(value)&&new Set(value.map(String)).size===value.length&&value.every(v=>/^[0-9]{1,3}$/.test(v));
  const topicChoicesOf=value=>choicesOf(value).map(String);
  const newSeed=previous=>{let seed;do{seed=crypto.getRandomValues(new Uint32Array(1))[0];}while(seed===previous);return seed;};
  function validView(v){return record(v)&&v.version===1&&/^mcq-[a-f0-9]{24}$/.test(v.id)&&['all','past','practice','drill','law','articles'].includes(v.filter)&&validYears(v.year)&&validLevels(v.level)&&validTopics(v.topic)&&['source','topic','shuffled'].includes(v.sort)&&(v.seed===undefined||Number.isInteger(v.seed)&&v.seed>=0&&v.seed<=0xffffffff)&&(v.sortChosen===undefined||typeof v.sortChosen==='boolean')&&typeof v.missedOnly==='boolean'&&typeof v.flagsView==='boolean'&&Number.isFinite(v.scroll)&&v.scroll>=0&&Number.isFinite(v.at)&&v.at>=0&&(v.missedIds==null||Array.isArray(v.missedIds)&&v.missedIds.every(id=>/^mcq-[a-f0-9]{24}$/.test(id)));}
  const mergeView=(a,b)=>a.at>=b.at?a:b;
  // Presentation only: every answer and accepted index stays in source coordinates.
  const P005_IDS=new Set(["mcq-445940e74ca4e81988f72948","mcq-cfcb08dc21c429cd1042b522","mcq-e3bc0e4c400793e7d44ff0c7","mcq-ef4fba8f2902602352e0d03a","mcq-2d2136158de144580f0bb96e","mcq-1bb58ede597bcaa0792a5057","mcq-fb203b324e8a2bd294d852d4","mcq-55281d9a845c3589d652473b","mcq-a41137559e41d3ccae4315c6","mcq-63b30df3a4d8c5a2eff5cde9","mcq-ef4e683f2133096fc7260d0c","mcq-128e49cd60a18dd603a134ce","mcq-25aee1b1318022a61b08a2b1","mcq-d6028ebbd88ff40f89a76314","mcq-93e64635664c322c2373bc71","mcq-5f7d0f91fb93252ece4cd37e","mcq-24929347c42da5c18dc20d1b","mcq-fd42d172bdbbbb55b8141a92","mcq-d6be202a752a1023532cb284","mcq-38230992ebe320c760d01c79","mcq-47b95e29816066a5b20b173d","mcq-e98711034845fd8462324fb7","mcq-0837a6515fdbd7f152a6ef73","mcq-2104f7bc0e98089cbf014728","mcq-1c41bd6a784295d55f4c2596","mcq-f30028539307c40ad42d8153","mcq-27c9522f7399889d7b6d97f2","mcq-22f162fd1a7df7479fe1bdb8","mcq-b4f4cd298cb9dc69bfec895a","mcq-4326a9fd491a4053b9910ae4","mcq-b06df8d06b254d4a88344a1c","mcq-5c169d916a8bf5757e5e1b31","mcq-1d7c2af18bedc9ae42315752","mcq-401fbc2cfe7b6b0384e9cb1d","mcq-bd3cafe99c31f9fec3a91125","mcq-a2cc06f4ec7abef33d3db8ff","mcq-5e86bb4c24a220acc42d4408","mcq-e7ac8258c9ea03300adec483","mcq-972e076c866a224901bfd4bd","mcq-07c52902550efd421aaa5182","mcq-b3d460a6362b7b9ac5c5ea9e","mcq-9bab953ea9f8a55a2b267262","mcq-592065279118ed6571a88b01","mcq-7c7f0ee2380167f2df4e2671","mcq-557672233ae9eb0d7b4fffe7","mcq-db40ee0abf34c7237ff61ea4","mcq-e320e2336fe1ba08a8874ccf","mcq-7678d0f0cb11329add5661f2","mcq-d6b4bb88d21cf2e2129180eb","mcq-b7b4437f160aeffe8eae6e91","mcq-755516e250bdebb7ab0dc8a0","mcq-23a61772b0cd1bc99b5f93d6","mcq-8935bc64881038952dbb8e30","mcq-62c2996ec9157c895f6f9d31","mcq-09535b884d302be802aece78","mcq-0775bc1f6dd8e5408581d977","mcq-96b896624f8bd5d0a8b42a01","mcq-a5775dc3f3b63d06765128e4","mcq-be03ba703e3a60cec057cf6b","mcq-56e863b7db74859b149e6b11","mcq-d3fa3a3a8945541ad8686762","mcq-97f8b83e00e75ce9ba219fcf","mcq-c8ac05492eb019648c556a92","mcq-c2c8a32c3fc69de1efe77d40","mcq-ae991feb0f18e623e8275d77","mcq-f40497dce170d4c065ef636a","mcq-eb4b7f5bcdaa52d76cfc4c36","mcq-f67a3eafe354eadb75dce541","mcq-0e573c2b91708358ad2fccf7"]);
  P005_IDS.add("mcq-c6f67c258931f981b38f21d0");
  const excluded=id=>P005_IDS.has(currentId(id));
  // Retired IDs also stay out of due and hidden-setting counts.
  const RETIRED_IDS=new Set(["mcq-699b4273355c31992364f1f1", "mcq-660fc34f37f3fe1432f26a67", "mcq-d9e9b335f768d1e86d09bef0", "mcq-d979aae832677997cb1ec3a5", "mcq-f9f713a941f2f2e330c614bc", "mcq-7db87995a797f5e507720fae", "mcq-9f8d7037088960a8ef814358", "mcq-66c7b713ba79de02b490ed75", "mcq-b1165d1cc2f7176dcde22187", "mcq-a123634fe43e01ca9d3ed602", "mcq-90f12c9da219a8f407f8e65a", "mcq-073b9a7d0bcb3934f98309b1", "mcq-38bc0abf7bc576c5c5482c6c", "mcq-e3f19e69e262a88b0d55fb6b", "mcq-78b26021e830fa359de80e66", "mcq-239f0c13003ce65b950cb76e", "mcq-39dfcd43e2048d61f5739915", "mcq-130d97e08ddb84a7858b4c55", "mcq-a70b0f47b2d732cef02426c9", "mcq-2c112419b704cf2ee7c61fc6", "mcq-34337a8c30021c8cfb10d7f7", "mcq-af2450a26aa2622ff6b15272", "mcq-321439623b418bc450fb8b55", "mcq-11cda3cf800da67d87b7ef1e", "mcq-85fc106feb538a0c7bf7475a", "mcq-3b739e5674dffc8044abd0f4", "mcq-8a2e0e6afcc4d6dfc3547d1b", "mcq-3a9307f8035b13b33778beee", "mcq-60e52c35d1bcd2882f47e4c3", "mcq-49cc0543456718a3076c6045", "mcq-8044e5976524be641141c648", "mcq-3cb90368c2ed36db8f6675e3", "mcq-20be0cad52ddc8e488192bbf", "mcq-66cfb59089803f7958244223", "mcq-2adaf9f02ab22b76cfbad1a5", "mcq-09ff26e2548551d17575e9ed", "mcq-c2c8a32c3fc69de1efe77d40", "mcq-66df9fb2064c7277ae4c8acf", "mcq-308fd50fb061d108ca145814", "mcq-4383c4d92923a12de298515f", "mcq-cb6654e5a0acd74f57b0b70e", "mcq-62ca800059668ecc4185efea", "mcq-475269ffe6e67d4223caa928", "mcq-54c5288e90331e34de673c84"]);
  for(const id of ["mcq-3afbf0f9b72106238069c283", "mcq-eb930fa58023870834e4de2a", "mcq-87ded8958c78f614611129e7", "mcq-d83b57579731130f5223d128", "mcq-5590fc958a0c9be33349042f", "mcq-a7166eeee0950320121fee29", "mcq-019bf231802c4f0babcf3e65", "mcq-10e277586d2f7f61487d08fa", "mcq-5507c165c4e52230feb53668", "mcq-dbca0ec187cc977ffcb45a5e", "mcq-a9ee28406aba3bbef8715ceb", "mcq-06686a5c7dc4ec3d4dc6d195", "mcq-c34569120a71dde31a3d8c16"])RETIRED_IDS.add(id);
  for(const id of ["mcq-c3651b79a2bff9be9d6167d3", "mcq-4eb7d8c6ec78250e52740308"])RETIRED_IDS.add(id);
  const retired=id=>RETIRED_IDS.has(currentId(id));
  const STANDOUT_IDS=new Set(["mcq-014bc0a93fc69d315ebcbd66","mcq-032a2c18787b874cc9ffbb4a","mcq-044911d4e0837ea15be57ab6","mcq-0483a63db9279ee11472c648","mcq-07fe2e1a5ab3a4dfc9a75e19","mcq-0b52c61d654f02debc281edf","mcq-0b6c7e93277203f52ba30f50","mcq-0baab030e7e3a28421bdef82","mcq-0c89e4620e4b0ee397959201","mcq-0e015d5218bea2dce9d6f10e","mcq-10df7b76df38a9f088ca263b","mcq-114d84d5185ca57f4f24a638","mcq-127bf515fc9a35b99c39325d","mcq-12bd8ee2ecd178423b7bd568","mcq-13629dd86cb32118a04a6dad","mcq-139db027298c95019723f985","mcq-1af78560668dcce3a6adcb18","mcq-1beb6d0b3c8c582ec4890d73","mcq-1de979eb6f87a866165b9192","mcq-1f7a97c4c65a535d6b4ca620","mcq-1f92adb433d6d5cfc18e09d5","mcq-2125164bf4974cd8e7f0ac23","mcq-23473602d9d9c912b573e2cb","mcq-2430b0cf4ece4ecc88cf9ca8","mcq-24bedb4fc2743f9050842ceb","mcq-25681be46ac5407bac11f90b","mcq-291a7496d603552cc0659be7","mcq-297d8fa36e34babe9751635b","mcq-29b376657542560d39ffc253","mcq-2a4c7ca09dd04d146cd757bf","mcq-2daec6b183c150d047ebc1a0","mcq-2e36238dd4f16c28277ae84c","mcq-2ef31d2fbe6112c80bee5926","mcq-31cf84cf197872047d98f8d3","mcq-31d5726d187e61198ded3224","mcq-326dd550869c47d2370c147d","mcq-3398a54d81e08867dbc745b8","mcq-346566c9e95c30f0aaf4f1dc","mcq-396c97aad9c833c90dca5a84","mcq-4144f7fef9e166f1aa853a6b","mcq-4162329a24c5d4d93d83a17d","mcq-444c15e90f9f516f44875745","mcq-460e60d9dc77b2d5eab3ec24","mcq-479b867f28a240a0e95cbc5b","mcq-4a11d13f17c9ea44607c6c01","mcq-4b596b9b45143301d1dbc87c","mcq-4caa65474b9733a526dfd9b6","mcq-4ea2377922759e0c039b487a","mcq-506721f729c67997bb5b959b","mcq-553fe001ba88c16bd58aa995","mcq-5684ea1bfb71d3cca1c89328","mcq-568a570a893c8db62fea050b","mcq-5b13e8a36f37d7675386033a","mcq-5b321318cff0af6d45fb810f","mcq-5b3c5045c946b0fc76f2d3a4","mcq-5ca0fc3396c3cd00ab34b99b","mcq-61d765bd35176cb394ea1d4c","mcq-6334045bcaf8296d2a9bfc3f","mcq-6397e304176572de212cb7a4","mcq-63b5261b256797d5f7e138f9","mcq-660fc34f37f3fe1432f26a67","mcq-6a7579842d9fd2be047cd3ef","mcq-6a7a6572c9f100e565672523","mcq-6b9e4ede159317599df8678f","mcq-6efa24d560c4df1b871e045b","mcq-70b366b6090d5c1e6c3f2011","mcq-72a7b9df0d32babbf8fe01ba","mcq-7552c02517105e401cb55fca","mcq-75a210c0bb3af94cbc0b1761","mcq-770045052f12dae4345fcca7","mcq-77053831d3b420e052be4b21","mcq-77ab4a1b1336f63d7d5d7285","mcq-78798ae739e1f8d9e54c733c","mcq-7b61f10b0e09da43b7a59bc6","mcq-7c91e769b4cc7ec153925566","mcq-827b974b0fd4183a6fda5d95","mcq-82a1a43cfaad7704a7d66750","mcq-8316e2fc95e543f3f26c8898","mcq-8614eb8a75afb81b95916577","mcq-8632b57e622908538b588c2d","mcq-86a94c9168328a53c8066e7a","mcq-88db767a3d22600681cc3403","mcq-8a606f8f8be548ad4507e14e","mcq-8a96f6dc4fc2a4b4a03b9cba","mcq-8c8078a68b054f62ac6634c1","mcq-8e03aa83677e26959c3ac715","mcq-8e41c4277ae6bd46dd267da7","mcq-8f25fd8fa77ad9a6c5799dd6","mcq-9045174da3177fda13606848","mcq-90affc0029710751b06319f5","mcq-90eda1202ecfd4470c08a2f3","mcq-9434c4a2307c199ddf5c5db3","mcq-96eb6727b86c119ebda68c71","mcq-98df5d0ab5206ceb23dbbfd6","mcq-995b608c3801b9d4ef2baa04","mcq-9e0e3ccff1eef7dc1644adde","mcq-9e7eddcbdf67f83af6ca4bec","mcq-9ec89992a83ad21a3ae50420","mcq-9f3576cbe0819766129ac2e3","mcq-a51ab6842992792d49b949f4","mcq-a6cde1a8daf57ef900597884","mcq-a77f2ce6d61e523b411e1a86","mcq-a8407f68b88325c137fe00c1","mcq-a912eb506f691dd06c69c737","mcq-abde25eef5f0f4c31580890d","mcq-adcf54cee53dc1acabd9a0c9","mcq-ae7e83ec05dc600cb58b280f","mcq-b27616507048c7e73ac32658","mcq-b32a891064795b871ca183b4","mcq-b59f5d9b56e7c0cc13830a9d","mcq-b6dba79002ef943bf98178b8","mcq-b76c93838a260bf35155ca1f","mcq-b8e17eb6e6ae4a67e9c089bf","mcq-bd49b19d4774e71a74783922","mcq-bdd6a773f35884709151ce30","mcq-bf21e07acd5b7256b808b263","mcq-bfb7f1c0236f077a9065015d","mcq-c023cce698b39c14e66237ce","mcq-c2f57e7777522d9743e16102","mcq-c754381222bdc39bc104bb3f","mcq-c9592e50929dba1beb796110","mcq-ca427d31f12efd5c058070ea","mcq-cab17152e55e1a2ecdb3bdb6","mcq-cb0d50d3969668c66ebdbf99","mcq-d1e785ccbc79adf72719b4d3","mcq-d36a24c3b9e02d84571b3ca0","mcq-d3b0cdb450de242399ac74be","mcq-d490d53a72d5e5cc71cec638","mcq-d6bb383b1aa45112cfa50963","mcq-d7fe8e06fdf78a07366e903e","mcq-da0e88d39eb186aa37c50253","mcq-dc51c43934ea045a98434f71","mcq-dda4ca9c5b00d7a7d07cb6da","mcq-dfe37bb79dbb60008ac1ddf5","mcq-e0ce5bb1476d0756e84c5f83","mcq-e2894e41e944457a17c7db83","mcq-e3e50422b2b80726d2954e05","mcq-e4fc9a27c99fc92d7fe46ffe","mcq-e51257b673dba22bf1696e12","mcq-e6f8098d395ff99d1bd7f305","mcq-e90ba9f3a5ff4e26159342cb","mcq-e99c86220a4824ffde49858e","mcq-e9f50d9717ad6d26c4585dcc","mcq-edabde6a768fcad04a392998","mcq-eec4c1f014d24403a5b5520d","mcq-f1793b202accb3a87f8b4ffe","mcq-f7d35dd38a1848bdd00d204a","mcq-f841cf856a7aeaf4bfa51422","mcq-fed6f1d217902c34dafe6e04"]);
  const STANDOUT_CHAPTER_COUNTS={"42":1,"43":3,"44":1,"45":1,"46":3,"47":5,"51":3,"52":2,"55":3,"58":2,"59":3,"60":2,"61":1,"65":1,"68":4,"81":1,"87":1,"99":2,"law":25};
  for(const id of RETIRED_IDS)STANDOUT_IDS.delete(id);
  const SETTINGS_KEY='hazzard-practice-settings-v1',PLACE_KEY='hazzard-practice-place-v1';
  const settingNames=['includeStandout','shufflePastOptions','generatedSelected','drillSelected'];
  const defaultPracticeSettings=()=>({version:1,includeStandout:false,shufflePastOptions:true,generatedSelected:false,drillSelected:false,at:0});
  function validSettings(v){return v!==null&&typeof v==='object'&&v.version===1&&settingNames.every(k=>typeof v[k]==='boolean')&&Number.isFinite(v.at)&&v.at>=0;}
  function settingsFromRaw(raw){try{const v=JSON.parse(raw);return validSettings(v)?v:null;}catch{return null;}}
  function readSettings(){return settingsFromRaw(localStorage.getItem(SETTINGS_KEY))||defaultPracticeSettings();}
  const mergeSettings=(a,b)=>!validSettings(a)?b:!validSettings(b)||a.at>=b.at?a:b;
  let {includeStandout,shufflePastOptions}=readSettings();
  const standoutCount=chapter=>includeStandout?0:(STANDOUT_CHAPTER_COUNTS[chapter]||0);
  const standoutHidden=id=>!includeStandout&&STANDOUT_IDS.has(currentId(id));
  const standoutLabel='Include unverifiable practice with a standout answer';
  function refreshSettings(){
    ({includeStandout,shufflePastOptions}=readSettings());
    document.getElementById('includeStandout')?.setAttribute('aria-checked',String(includeStandout));
    document.getElementById('shufflePastOptions')?.setAttribute('aria-checked',String(shufflePastOptions));
    const count=document.getElementById('standoutHiddenCount');if(count)count.textContent=(includeStandout?0:STANDOUT_IDS.size)+' questions hidden by this setting.';
    dispatchEvent(new Event('hazzard-practice-settings-change'));
    dispatchEvent(new Event('hazzard-review-change'));
  }
  function changeSetting(key,value){
    const settings=readSettings();settings[key]=value;settings.at=Math.max(Date.now(),settings.at+1);
    try{HazzardStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));refreshSettings();}
    catch{const note=document.getElementById('standoutHiddenCount');if(note)note.textContent='Practice settings could not be saved. Try again.';}
  }
  const practicePane=document.querySelector('[data-pane="practice"]');
  if(practicePane){
    const settings=document.createElement('section');
    settings.innerHTML='<h2>Practice settings</h2>'+[['includeStandout',standoutLabel],['shufflePastOptions','Shuffle answer options in past-exam questions']].map(([id,label])=>'<button type="button" class="mcq-missed-toggle" role="switch" id="'+id+'" aria-checked="'+readSettings()[id]+'"><span class="mcq-switch-track" aria-hidden="true"></span>'+label+'</button>').join('')+'<p class="meta" id="standoutHiddenCount">'+(includeStandout?0:STANDOUT_IDS.size)+' questions hidden by this setting.</p>';
    practicePane.append(settings);
    for(const key of ['includeStandout','shufflePastOptions'])document.getElementById(key).onclick=()=>changeSetting(key,!readSettings()[key]);
  }
  addEventListener('storage',e=>{if(e.key===SETTINGS_KEY||e.key===null)refreshSettings();});
  const practiceScreens=['bank','review','saved','saved-practice','flags','missed','changed','mock','simulation'];
  function readPracticePlace(){
    try{const p=JSON.parse(localStorage.getItem(PLACE_KEY));if(!record(p)||p.version!==1||!practiceScreens.includes(p.screen)||!Number.isFinite(p.scroll)||p.scroll<0)return null;
      if(p.id!=null&&!/^mcq-[a-f0-9]{24}$/.test(p.id))return null;
      if(p.view!=null&&!validView(p.view))return null;
      for(const key of ['redoIds','missedIds'])if(p[key]!=null&&(!Array.isArray(p[key])||!p[key].every(id=>/^mcq-[a-f0-9]{24}$/.test(id))))return null;
      if(p.retryAnswers!=null&&!validStore({version:1,answers:p.retryAnswers}))return null;
      return p;
    }catch{return null;}
  }
  function rememberPractice(screen,detail){try{localStorage.setItem(PLACE_KEY,JSON.stringify({version:1,screen,...detail}));}catch{}}
  function practiceURL(){const p=readPracticePlace(),screen=p?.screen||'bank';return '?chapter='+(['mock','simulation'].includes(screen)?'mock':'bank')+'&practiceResume=1'+({review:'&review=1',changed:'&redo=1','saved-practice':'&saved=1',simulation:'&simulation=1',mock:p?.building?'&n=builder':'&run=1',saved:'#saved',flags:'#flags',missed:'#missed'}[screen]||'');}
  const EXCLUDED_NOTE='Excluded by P005 (IMA required reading)';
  function linkedOptions(q){
    return q.o.some(o=>/(?:\b(?:all|none) of (?:the )?(?:above|these)|\bboth\s+[A-D]\s+(?:and|&)\s+[A-D]\b|כל (?:התשובות|האפשרויות|האמור לעיל|הנ["״']ל)|אף (?:אחת|אחד) (?:מהתשובות|מהאפשרויות|מהנ["״']ל)|(?:תשובות|אפשרויות)\s+[א-דA-D]['׳״"]?\s*(?:ו[- ]?|and|&)\s*[א-דA-D](?![\p{L}\p{N}]))/iu.test(o));
  }
  // These explanations mix answer labels with section/clinical labels ambiguously.
  const OFFICIAL_EXPLANATIONS=new Set([
    'mcq-18490c5933b53a866c445587', // DICE: answer letters and mnemonic letters.
    'mcq-dd8d86a52ab0a199b770a4f2', // סעיף used for an answer.
    'mcq-5323c51583402673a5d61738', // סעיף used for an answer.
    'mcq-8ceb825522dee040d6bc0a79', // סעיף used for both answers and statute.
    'mcq-00447e6d3dddf948ba023322', // A source-label range may cease to be contiguous.
    'mcq-2a3ea14e94c9dbd28fcf1c08' // שלב followed by an answer label.
  ]);
  function optionOrder(q,allowPast=true){
    const order=q.o.map((_,i)=>i);
    if((q.kind==='past'?(!allowPast||!shufflePastOptions||OFFICIAL_EXPLANATIONS.has(q.id)):q.sourceType!=='Hazzard practice')||linkedOptions(q))return order;
    let seed=2166136261;
    for(const c of q.id)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;
    for(let i=order.length-1;i>0;i--){
      seed=(seed+0x6D2B79F5)>>>0;
      let n=Math.imul(seed^(seed>>>15),1|seed);n^=n+Math.imul(n^(n>>>7),61|n);
      const j=Math.floor(((n^(n>>>14))>>>0)/4294967296*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
    return order;
  }
  function explanationText(q,order=optionOrder(q)){
    if(!q.explanation)return q.explanation;
    const map=c=>{const alphabet=/[A-D]/.test(c)?'ABCD':'אבגד';const i=order.indexOf(alphabet.indexOf(c));return i<0?c:'אבגד'[i];};
    // Locate all source labels first, then replace once so mappings cannot cascade.
    // Context keeps vitamin D, hepatitis B and mnemonic initials unchanged.
    const text=String(q.explanation||''),positions=new Set();
    function mark(regex){for(const m of text.matchAll(regex))positions.add(m.index+m[1].length);}
    mark(/((?:אפשרות|אפשרויות|אופציה|אופציות|תשובה|תשובות|מסיח|מסיחים|[Oo]ptions?|[Aa]nswers?|[Cc]hoices?)(?:\s+(?:הנכונה|הנכונות|השגויה|השגויות|היא|הן|is|are|correct|incorrect))*\s*[:\-]?\s*\**\(?)([A-Dאבגד])(?=['׳״"*\s.,;:()—–-]|$)/gu);
    mark(/(^[ \t]*(?:[-*] )?\**)([A-Dאבגד])(?=[.)׳'](?:\s|\*)|\s+[—–-])/gmu);
    mark(/((?<![\p{L}\p{N}]))([אבגד])(?=['׳״](?![\p{L}\p{N}]))/gu);
    mark(/(\*\*)([A-Dאבגד])(?=\*\*(?:\s|[:,.]))/gu);
    mark(/((?<![\p{L}\p{N}]))([אבגד])(?=\s+(?:נכון|נכונה|שגוי|שגויה|אינה|אינו)(?![\p{L}]))/gu);
    mark(/(\()([A-Dאבגד])(?=\s+option\))/gu);
    // Parenthesized single/list labels and explicit grouped answer references.
    for(const m of text.matchAll(/\(([A-Dאבגד](?:['׳]?\s*(?:,|ו-?|and|&)\s*[A-Dאבגד])*)\)/gu)){
      for(const c of m[1].matchAll(/[A-Dאבגד]/gu))positions.add(m.index+1+c.index);
    }
    // Extend a known label through comma/conjunction lists, including glosses.
    for(const position of positions){
      const tail=text.slice(position+1),next=/^['׳]?\**(?:\s*\([^\n)]*\))?\s*(?:,\s*|ו-?\s*|and\s+|&\s*)([A-Dאבגד])(?=['׳״"*\s.,;:()—–-]|$)/u.exec(tail);
      if(next)positions.add(position+1+next[0].lastIndexOf(next[1]));
    }
    // A bare Hebrew pair is also an option reference (e.g. ב ו-ג אינן...).
    for(const m of text.matchAll(/(?<![\p{L}\p{N}])([אבגד])\s+ו-?([אבגד])(?=\s+(?:אינן|שגויות|נכונות))/gu)){positions.add(m.index);positions.add(m.index+m[0].length-1);}
    {
      mark(/((?:תשובה|תשובות)(?:\s+(?:נכונה|נכונות|שגויה|שגויות|הנכונה|הנכונות|השגויה|השגויות|הרשמית|היא|קלינית|מבחינה|מדעית))*\s*[:—–\-]?\s*\**)([A-Dאבגד])(?=['׳״"*\s.,;:()—–-]|$)/gu);
      mark(/((?:למה|לגבי|במקרה|ולכן|לפיכך|Official IMA key:)\s*\**)([A-Dאבגד])(?=['׳״"*\s.,;:()—–-]|$)/gu);
      mark(/((?<![\p{L}\p{N}]))([A-Dאבגד])(?=\**\s+(?:היא|הוא|מציגה|נתמכת|מתאימה|פחות מתאימה|נכון|נכונה|שגוי|שגויה|אינה|אינו)(?![\p{L}]))/gu);
      mark(/(^[ \t|#✅❌*\-]*)([A-Dאבגד])(?=[.)׳'](?:\s|\*)|\s+[—–-])/gmu);
      mark(/(\*\*)([A-Dאבגד])(?=\s+[—–-])/gu);
      mark(/(^[ \t]*\|\s*)([אבגד])(?=$)/gmu);
      mark(/(,\s*)([אבגד])(?=\))/gu);
      mark(/((?<![\p{L}\p{N}])[ובכלמ]{1,2})([אבגד])(?=['׳](?![\p{L}\p{N}]))/gu);
      // Statute suffixes/subsections and clinical classifications are not answers.
      const protectedSpans=[
        /\d+[א-ת]*(?:\([\dא-ת]+\))+(?:\s+(?:או|ו[-־]?)\s*\([א-ת]+\))*/gu,
        /\d+[א-ת]+/gu,
        /[א-ת]["״][א-ת](?:["״][א-ת])?/gu,
        /(?:שלב|סוג|דרגה|סעיף|פרק|מדרגה|\bgrade|\bclass|\bstage|\btype|\bvitamin|\bhepatitis|ויטמין)\s+\**\(?[A-Dאבגד](?![\p{L}\p{N}])/giu
      ];
      for(const regex of protectedSpans)for(const m of text.matchAll(regex))for(let i=m.index;i<m.index+m[0].length;i++)positions.delete(i);
    }
    return text.split('').map((c,i)=>positions.has(i)?map(c):c).join('');
  }
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
    const value = HazzardStorage.readProtected(KEY,()=>({version:1,answers:{}}));
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
  function readFlags(){const value=HazzardStorage.readProtected(FLAGS_KEY,()=>({version:1,flags:{},lawTopics:{ids:[],at:0}}));if(!validFlags(value))throw Error('Unreadable personal topic flags');return value;}
  function mergeFlags(current,incoming){const flags={...incoming.flags};for(const[id,f]of Object.entries(current.flags))if(!flags[id]||f.at>=flags[id].at)flags[id]=f;return{version:1,flags,lawTopics:current.lawTopics.at>=incoming.lawTopics.at?current.lawTopics:incoming.lawTopics};}
  function validSystem(value){return record(value)&&value.version===1&&typeof value.selected==='boolean'&&Number.isFinite(value.at)&&record(value.flags)&&Object.entries(value.flags).every(([id,f])=>/^mcq-[a-f0-9]{24}$/.test(id)&&record(f)&&typeof f.hidden==='boolean'&&Number.isFinite(f.at));}
  function readSystem(){const value=HazzardStorage.readProtected(SYSTEM_KEY,()=>({version:1,selected:false,at:0,flags:{}}));if(!validSystem(value))throw Error('Unreadable Israeli law & system choices');return value;}
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
    if (q.sourceChecked) return 'Source-checked practice';
    if (q.source === 'drill') return 'Hazzard practice · Drill';
    if (q.kind === 'practice') return PRACTICE_LABEL;
    const match = /^(\d{4})(?:-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?(?:-(Subspec|Basic))?$/.exec(q.t);
    if (!match) return 'Shlav A';
    return 'Shlav A ' + (match[2] ? match[2] + ' ' : '') + match[1] + ' · Subspecialty' + (q.examNumber ? ' · Q' + q.examNumber : '');
  }
  const SOURCE_TITLES={"חוק החולה הנוטה למות, תשס_ו-2005.pdf":"חוק החולה הנוטה למות, תשס״ו-2005","חוק הכשרות המשפטית והאפוטרופסות, תשכ_ב-1962.pdf":"חוק הכשרות המשפטית והאפוטרופסות, תשכ״ב-1962","חוק זכויות החולה, תשנ_ו-1996.pdf":"חוק זכויות החולה, תשנ״ו-1996","10Redefiningtheobligation.pdf":"הגדרה מחדש של חובת ההודעה על נהגים עם מצבי בריאות העלולים לסכן את עצמם וזולתם","1GeriatricsDivisionBroad.pdf":"הגדרת מושגים - נספח","4Recommendations.pdf":"המלצות מותב הוועדה הארצית לחוק החולה הנוטה למות: PEG לחולה עם קיהיון [דמנציה, שיטיון] שהוא נוטה למות","5MedicalGuardianHospitalization.pdf":"מינוי אפוטרופוס על גופו של אדם ו/או רכושו במסגרת אשפוז ממושך","6Activating.pdf":"הפעלת ייפוי כוח מתמשך בביה״ח במקרים דחופים ללא אישור כניסה לתוקף מטעם האפוטרופוס הכללי","7Temporarydecision.pdf":"מקבל החלטות זמני לעניינים רפואיים","8LicensingandOperating.pdf":"אמות מידה לרישוי ותפעול מחלקה גריאטרית ״סיעוד מורכב״","9Procedurefortreatingelderly.pdf":"נוהל טיפול בזקנים נפגעי התעמרות","1_AGS-Beers-2023.pdf":"American Geriatrics Society 2023 updated AGS Beers Criteria® for potentially inappropriate medication use in older adults","B2_enduring-POA_guide_justice-ministry.pdf":"מדריך לממנה - ייפוי כוח מתמשך","hazzard marked .pdf":"Hazzard 8e"};
  function sourceTitle(value){let text=String(value||'');for(const [file,title] of Object.entries(SOURCE_TITLES))text=text.split(file).join(title);return text;}
  function preview(text,limit=180){if(text.length<=limit)return text;const part=text.slice(0,limit+1),end=part.search(/\s+\S*$/u);return (end>0?part.slice(0,end):text.split(/\s/u)[0])+'…';}
  function latinRuns(terminal=false){
    const base = String.raw`\p{Script=Latin}\p{Script=Greek}µ0-9\u2080-\u2089\u00b2\u00b3\u00b9\u2070-\u2079`;
    const word = `[${base}][${base}\\p{M}]*`;
    // An English closing bracket can also connect to the next Latin atom.
    const connector = String.raw`(?<=[\p{Script=Latin}0-9)])[ \t]*[&–—-][ \t]*(?=[\p{Script=Latin}0-9])`;
    const sign = String.raw`(?:(?<![^ \t(=:])[-−](?=\d)|[~≈±](?=\d))?`;
    const token = `${sign}${word}(?:(?:[.,'’°^/:+%−–<>=≤≥±×→←-]+|${connector})${word})*`;
    const quotes = `'"„“”‘’`;
    const body = `[${base}][${base}\\p{M} \\t.,;${quotes}°^:/+%−–—→←<>=≤≥±×&-]*`;
    const quoted = `(?<![${base}])[${quotes}]${body}[${quotes}](?![${base}])`;
    const bracketed = `\\([ \\t]*[${quotes}]?${body}[ \\t]*\\)`;
    const atom = `(?:${bracketed}|${quoted}|${token}%?)`;
    return new RegExp(`${atom}(?:(?:[.,;:]?[ \\t]+(?:[<>=≤≥±×→←]+[ \\t]*)?|${connector})${atom})*${terminal?'[.,;:!?]?':''}`, 'gu');
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
    text=text.replace(/(^|[^א-ת])([בהוכלמש])\s*([-־])\s*(?=[A-Za-z0-9~≈±])/gu,'$1$2$3').replace(/([-־])\s+(?=[~≈±]?\d)/gu,'$1');
    text=text.replace(/\n(?=\s*(?:\*\*)?[A-Dא-ד][.)׳]\s)/gu,'\n\n');
    box.innerHTML = marked.parse(escape(text));
    for (const node of box.querySelectorAll('a,img')) node.replaceWith(document.createTextNode(node.textContent || node.getAttribute('alt') || ''));
    // Markdown creates independent paragraphs, list items and table cells.
    // Hebrew prose sets RTL, including drug-first options. A Hebrew answer
    // label alone must not turn an otherwise English explanation into RTL.
    for (const block of box.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th')) {
      const text = block.textContent;
      const prose = (/[A-Za-z]/.test(text)?text.replace(/(?<![\p{L}])[אבגדה](?![\p{L}])/gu,''):text).replace(/\b(?:options?|answers?|choices?)(?:\s+(?:is|are|correct|incorrect))*\s*[:\-]?\s*\(?[אבגדה]['׳]?/giu, '');
      block.dir = /[\u05d0-\u05ea]/.test(prose) ? 'rtl' : 'ltr';
    }
    const citationWalker=document.createTreeWalker(box,NodeFilter.SHOW_TEXT),citationNodes=[];
    while(citationWalker.nextNode())citationNodes.push(citationWalker.currentNode);
    for(const node of citationNodes){
      const fragment=document.createDocumentFragment();let end=0;
      if(node.parentElement.closest('[dir]')?.dir==='ltr')continue;
      for(const m of node.data.matchAll(/\([^()\n]*\)|[A-Z][A-Za-z'’ \t]+,\s*מהדורה\s+\d+[.;]?/gu)){
        const body=m[0].replace(/^\(/,''),he=(body.match(/[א-ת]/g)||[]).length,latin=(body.match(/[A-Za-z0-9]/g)||[]).length;
        if(!he||!/^[^\p{L}\p{N}]*[A-Za-z0-9]/u.test(body)||latin<=he)continue;
        fragment.append(document.createTextNode(node.data.slice(end,m.index)));
        const bdi=document.createElement('bdi');bdi.dir='ltr';bdi.className='mcq-citation-run';
        let partEnd=0;
        for(const part of m[0].matchAll(/[א-ת](?:[^,;()]|[,;](?=\d))*/gu)){
          bdi.append(document.createTextNode(m[0].slice(partEnd,part.index)));
          const rtl=document.createElement('bdi');rtl.dir='rtl';rtl.className='mcq-citation-hebrew';rtl.textContent=part[0].trimEnd();bdi.append(rtl,document.createTextNode(part[0].slice(part[0].trimEnd().length)));partEnd=part.index+part[0].length;
        }
        bdi.append(document.createTextNode(m[0].slice(partEnd)));fragment.append(bdi);end=m.index+m[0].length;
      }
      if(end){fragment.append(document.createTextNode(node.data.slice(end)));node.replaceWith(fragment);}
    }
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const block = node.parentElement.closest('[dir]');
      // English prose uses native word wrapping. Isolate only Hebrew labels.
      if(block?.dir==='ltr'){
        node.data=node.data.replace(/←/g,'→');
        const fragment=document.createDocumentFragment();let end=0;
        for(const m of node.data.matchAll(/(?<![\p{L}])[א-ד][.)׳]/gu)){
          fragment.append(document.createTextNode(node.data.slice(end,m.index)));
          const label=document.createElement('bdi');label.dir='ltr';label.className='mcq-option-label';label.textContent=m[0];fragment.append(label);end=m.index+m[0].length;
        }
        if(end){fragment.append(document.createTextNode(node.data.slice(end)));node.replaceWith(fragment);}continue;
      }
      const fragment = document.createDocumentFragment();
      const prose=s=>block?.dir==='rtl'?s.replace(/→/g,'←'):s;
      // Keep terms, doses and numeric ranges in logical LTR order. Leave source
      // characters intact; CSS separates terms glued to Hebrew in the import.
      // A run starts with a letter/number, never a Hebrew prefix's hyphen.
      // Combining accents and Greek/micro units belong to the same LTR token.
      const runs = latinRuns();
      let end = 0;
      for (const match of node.data.matchAll(runs)) {
        fragment.append(document.createTextNode(prose(node.data.slice(end, match.index))));
        const bdi = document.createElement('bdi'); bdi.dir = 'ltr'; bdi.textContent = match[0];
        end = match.index + match[0].length;
        // Reserve room for an RTL sentence-ending mark beside a wrapped Latin run.
        if (block?.dir === 'rtl' && /^\?\s*$/.test(node.data.slice(end)) && node === block.lastChild) bdi.classList.add('mcq-terminal-latin');
        if (/[\u05d0-\u05ea]/.test(node.data[match.index - 1] || '')) bdi.classList.add('mcq-gap-before');
        if (/[\u05d0-\u05ea]/.test(node.data[end] || '')) bdi.classList.add('mcq-gap-after');
        fragment.append(bdi);
      }
      fragment.append(document.createTextNode(prose(node.data.slice(end))));
      node.replaceWith(fragment);
    }
    // Rebuild continuous Latin runs across inline emphasis, preserving the
    // formatting of each original character and explicit Markdown line breaks.
    const blocks='p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th';
    for(const block of box.querySelectorAll(blocks)){
      if(block.dir!=='rtl'||block.querySelector(blocks))continue;
      for(const bdi of [...block.querySelectorAll('bdi')])if(!bdi.closest('.mcq-citation-run'))bdi.replaceWith(...bdi.childNodes);
      const segments=new Map();let text='';
      function collect(node){
        const start=text.length,whole=node.nodeName==='BR'||node.classList?.contains('mcq-citation-run');
        if(node.nodeType===3)text+=node.data;
        else if(whole)text+='\n';
        else for(const child of node.childNodes)collect(child);
        segments.set(node,{start,end:text.length,whole});
      }
      for(const child of block.childNodes)collect(child);
      const runs = latinRuns(true);
      function slice(start,end){
        const fragment=document.createDocumentFragment();
        function copy(node){
          const seg=segments.get(node);
          if(seg.end<=start||seg.start>=end)return null;
          if(seg.whole)return node.cloneNode(true);
          if(node.nodeType===3)return document.createTextNode(node.data.slice(Math.max(0,start-seg.start),Math.min(node.length,end-seg.start)));
          const clone=node.cloneNode(false);for(const child of node.childNodes){const part=copy(child);if(part)clone.append(part);}return clone.childNodes.length?clone:null;
        }
        for(const child of block.childNodes){const part=copy(child);if(part)fragment.append(part);}return fragment;
      }
      const output=document.createDocumentFragment();let end=0;
      for(const m of text.matchAll(runs)){
        output.append(slice(end,m.index));const bdi=document.createElement('bdi');bdi.dir='ltr';bdi.className='mcq-latin-run';bdi.append(slice(m.index,m.index+m[0].length));
        if(/[א-ת]/.test(text[m.index-1]||''))bdi.classList.add('mcq-gap-before');
        if(/[א-ת]/.test(text[m.index+m[0].length]||''))bdi.classList.add('mcq-gap-after');
        // Join punctuation, internal hyphens and the edition to their word.
        const tw=document.createTreeWalker(bdi,NodeFilter.SHOW_TEXT),nodes=[];while(tw.nextNode())nodes.push(tw.currentNode);
        for(const node of nodes)node.data=node.data.replace(/[←→]/g,'→').replace(/([\p{Script=Latin}0-9])-(?=[\p{Script=Latin}0-9])/gu,'$1\u2060-\u2060').replace(/([.,;:!?])$/u,'\u2060$1');
        output.append(bdi);end=m.index+m[0].length;
      }
      output.append(slice(end,text.length));block.replaceChildren(output);
    }
    // Keep short English brackets whole; long titles keep their normal wrapping.
    const bracketWalker=document.createTreeWalker(box,NodeFilter.SHOW_TEXT),bracketNodes=[];
    while(bracketWalker.nextNode())bracketNodes.push(bracketWalker.currentNode);
    for(const node of bracketNodes){
      const fragment=document.createDocumentFragment();let end=0;
      for(const m of node.data.matchAll(/\([ \t]*['"„“”‘’]?[\p{Script=Latin}\p{Script=Greek}µ0-9][^()\nא-ת]*\)/gu)){
        const inner=m[0].slice(1,-1).replace(/\u2060/g,'');
        const short=inner.length<=30&&inner.trim().split(/\s+/u).length<=4;
        fragment.append(document.createTextNode(node.data.slice(end,m.index)));
        if(short){const span=document.createElement('span');span.className='mcq-short-bracket';span.textContent=m[0];fragment.append(span);}
        else {
          const first=m[0].match(/^\([ \t]*\S+/u)[0],last=m[0].match(/\S+[ \t]*\)$/u)[0];
          const edge=text=>{const span=document.createElement('span');span.className='mcq-bracket-edge';span.textContent=text;return span;};
          if(first.length+last.length>=m[0].length)fragment.append(document.createTextNode(m[0]));
          else fragment.append(edge(first),document.createTextNode(m[0].slice(first.length,m[0].length-last.length)),edge(last));
        }
        end=m.index+m[0].length;
      }
      if(end){fragment.append(document.createTextNode(node.data.slice(end)));node.replaceWith(fragment);}
    }
    for(const list of box.querySelectorAll('ul,ol'))list.dir=list.querySelector('li')?.dir||'auto';
    for(const block of box.querySelectorAll(blocks)){
      if(block.querySelector(blocks))continue;
      // A word joiner crosses the isolate boundary without splitting the Latin
      // phrase into independently reordered boxes. Its later words still wrap.
      const tw=document.createTreeWalker(block,NodeFilter.SHOW_TEXT),chars=[];let n;
      while(n=tw.nextNode())for(let i=0;i<n.length;i++)chars.push({node:n,offset:i,char:n.data[i]});
      for(const m of [...chars.map(c=>c.char).join('').matchAll(/[א-ת]+[-־](?=[~≈±]?[\p{Script=Latin}0-9])/gu)].reverse()){
        const last=chars[m.index+m[0].length-1],first=chars[m.index+m[0].length];
        last.node.insertData(last.offset+1,'\u2060');
        const bdi=first.node.parentElement.closest('bdi');if(bdi)bdi.classList.add('mcq-prefix-run');
      }
      if(block.dir==='rtl')for(const bdi of block.querySelectorAll('bdi')){
        const next=bdi.nextSibling;
        if(next?.nodeType===3&&/^[.,;:!?](?=\s*[א-ת]|\s*$)/u.test(next.data)){next.data='\u2060'+next.data;bdi.classList.add('mcq-terminal-latin');}
      }
      for(const bdi of block.querySelectorAll('bdi'))if(!bdi.textContent)bdi.remove();
    }
    return box.innerHTML;
  }
  function boldLabResults(text){
    const normal = /\([ \t]*(?:(?:נורמה|נורמלי|תקין|ערך תחתון תקין|normal(?: range)?)[ \t:–-]*(?:עד[ \t]+)?[<>≤≥]?[ \t]*\d[^()\n]*|\d+(?:\.\d+)?[ \t]*[-–][ \t]*\d+(?:\.\d+)?[ \t]*)\)/giu;
    const result = /(?<![\p{L}\p{N}./])(?:\d+(?:[.,]\d+)*)(?:[ \t]*(?:[munpfµμ]?g|[munpµμ]?mol|mEq|[munpµμ]?[iIlL]?U|mOsm)\/(?:dL|mL|L|l|kg)|[ \t]*נמול\/ל|%)?[ \t]*$/u;
    let output='',end=0;
    for(const m of text.matchAll(normal)){
      const before=text.slice(end,m.index),value=result.exec(before);
      if(!value)continue;
      const prefix=before.slice(0,value.index);
      // Unitless results require an explicit lab name; skip scores and strength.
      if(!/[/%]/.test(value[0])&&!/(?:TSH|T4|FT4|CRP|CK|PTH|B12|HbA1c)\s*(?:היא|הוא|=)?\s*$/iu.test(prefix))continue;
      // Include a directly attached test name and equals sign, as printed.
      const label=/(?:[A-Za-z][A-Za-z0-9]*[ \t]*=[ \t]*)$/u.exec(prefix);
      const start=end+value.index-(label?.[0].length||0),finish=m.index-before.match(/[ \t]*$/u)[0].length;
      if(text[start-1]==='*'||text[finish]==='*')continue;
      output+=text.slice(end,start)+'**'+text.slice(start,finish)+'**';end=finish;
    }
    return output+text.slice(end);
  }
  function stemHTML(q){
    const table=q.labTable;
    if(!table||!table.span||!q.q.includes(table.span))return rich(table?q.q:boldLabResults(q.q));
    const at=q.q.indexOf(table.span);
    const cell=value=>table.direction==='rtl'?rich(value):escape(value);
    return rich(q.q.slice(0,at))+'<div class="mcq-lab-scroll" tabindex="0" role="region" aria-label="'+escape(table.caption||'Laboratory results')+'"><table class="mcq-lab-table" dir="'+(table.direction==='rtl'?'rtl':'ltr')+'"><thead><tr>'+table.header.map(h=>'<th scope="col">'+cell(h)+'</th>').join('')+'</tr></thead><tbody>'+table.rows.map(row=>'<tr>'+row.map((v,i)=>i===0?'<th scope="row">'+cell(v)+'</th>':'<td>'+(table.header[i]?.startsWith('Value')?'<strong>'+cell(v)+'</strong>':cell(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+rich(q.q.slice(at+table.span.length));
  }
  const PAPER_KEY='hazzard-mcq-papers-v1';
  const defaultSettings=()=>({length:50,topic:'all',sources:['past','practice'],year:[],level:[]});
  function validPaper(value){
    const p=value?.paper,s=value?.settings;
    if(!record(value)||value.version!==1||!Number.isFinite(value.at)||!record(s)||![25,50,100].includes(s.length)||!Array.isArray(s.sources)||new Set(s.sources).size!==s.sources.length||!s.sources.every(x=>['past','practice','law'].includes(normalizeSource(x)))||!validYears(s.year)||!validLevels(s.level)||(s.topic!=null&&!/^(all|\d{1,3})$/.test(s.topic)))return false;
    return p===null||record(p)&&[25,50,100].includes(p.size)&&Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=100&&new Set(p.ids).size===p.ids.length&&p.ids.every(id=>/^mcq-[a-f0-9]{24}$/.test(id))&&validStore({version:1,answers:p.answers})&&Object.keys(p.answers).every(id=>p.ids.includes(id))&&typeof p.finished==='boolean'&&typeof p.retry==='boolean'&&Number.isInteger(p.position)&&p.position>=0&&p.position<p.ids.length&&Number.isFinite(p.at);
  }
  function readPaper(){const value=HazzardStorage.readProtected(PAPER_KEY,()=>null);if(value===null)return null;if(!validPaper(value))throw Error('Unreadable saved MCQ paper');return {...value,settings:{...value.settings,topic:value.settings.topic||'all',year:choicesOf(value.settings.year),level:[...new Set(choicesOf(value.settings.level).map(v=>v==='Basic'?'Subspec':v))],sources:[...new Set(value.settings.sources.map(normalizeSource))]}};}
  function mergePaper(current,incoming){return current.at>=incoming.at?current:incoming;}
  function shuffle(items){const result=[...items];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]]}return result;}
  function shuffledBank(list,seed,law){
    let state=seed>>>0;
    const random=()=>{state=(state+0x6D2B79F5)>>>0;let n=state;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return ((n^(n>>>14))>>>0)/4294967296;};
    const tier=q=>Number(generated(q))*2+(law&&q.kind!=='past'?1:0),result=[];
    for(const group of [0,1,2,3]){
      const pool=list.filter(q=>tier(q)===group);
      for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
      // Prefer a different topic and sitting where this tier permits it.
      const mixedTopics=new Set(pool.map(q=>q.topic)).size>1,mixedSittings=new Set(pool.map(q=>q.t)).size>1;
      for(let i=1;i<pool.length;i++){
        const previous=pool[i-1],differentTopic=q=>!mixedTopics||q.topic!==previous.topic,differentSitting=q=>!mixedSittings||q.t!==previous.t;
        if(differentTopic(pool[i])&&differentSitting(pool[i]))continue;
        let next=-1,fallback=-1;
        for(let j=i+1;j<pool.length;j++)if(differentTopic(pool[j])){if(fallback<0)fallback=j;if(differentSitting(pool[j])){next=j;break;}}
        if(next<0)next=fallback;
        if(next>=0)[pool[i],pool[next]]=[pool[next],pool[i]];
      }
      result.push(...pool);
    }
    return result;
  }
  function mount({chapter,viewport,readerScroll,onShow,onNotes,openImage,readOnlyChapter=false}){
    const bankMode=chapter==='bank',mockMode=chapter==='mock',redoMode=bankMode&&new URL(location.href).searchParams.get('redo')==='1',reviewMode=!redoMode&&bankMode&&new URL(location.href).searchParams.get('review')==='1';
    const resumePlace=readPracticePlace();
    let redoIds=new Set();
    const host=document.createElement('section');host.id='mcqViewport';host.hidden=true;host.setAttribute('aria-label',bankMode?'Question bank':mockMode?'Mock paper':'Exam questions');viewport.append(host);
    let studyTabs;
    if(!bankMode&&!mockMode){
      studyTabs=document.createElement('div');studyTabs.className='study-view-tabs';studyTabs.setAttribute('role','tablist');studyTabs.setAttribute('aria-label',readOnlyChapter?'Chapter view':'Study view');
      for(const [mode,label] of [['notes',readOnlyChapter?'Read chapter':'Study notes'],['questions','Exam questions']]){
        const button=document.createElement('button');button.type='button';button.dataset.studyView=mode;button.textContent=label;button.setAttribute('role','tab');button.onclick=()=>mode==='notes'?controller.notes():controller.show();studyTabs.append(button);
      }
      document.getElementById('chapterHeader').append(studyTabs);
      studyTabs.hidden=viewport.hidden;viewport.classList.add('has-study-tabs');
    }
    const selectTab=mode=>studyTabs?.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.studyView===mode)));
    const filtersObserver=new ResizeObserver(entries=>host.style.setProperty('--mcq-filter-height',(entries[0]?.target.getBoundingClientRect().height||0)+'px'));
    let items=[],topics=[],filter=new URL(location.href).searchParams.get('source')==='past'?'past':'all',year=[],level=[],topic='all',sort=bankMode?'shuffled':'source',seed=bankMode?newSeed():undefined,position=0,loaded=false,busy=false,paper=null,paperPending=false,storageError='',missedOnly=bankMode&&location.hash==='#missed',building=mockMode,settings=defaultSettings();
    const pendingLogs=new Map(),pendingUndos=new Map();
    const answers=new Map(),pending=new Map(),retryAnswers=new Map(),dismissed=new Set();
    let personal={version:1,flags:{},lawTopics:{ids:[],at:0}},flagsView=bankMode&&location.hash==='#flags',notice='';
    let systemPrefs={version:1,selected:false,at:0,flags:{}},collections={israeliSystem:{enabled:false,ids:[]},topicFallbacks:{}},lawIds=new Set(),articleIds=new Set(),articleSelected=false,drillSelected=readSettings().drillSelected,generatedSelected=readSettings().generatedSelected,lastAnswer=null;
    let savedView=bankMode&&location.hash==='#saved',savedOnly=bankMode&&new URL(location.href).searchParams.get('saved')==='1';
    let missedIds=null,reviewBatch=null,hiddenTarget=null;
    let evidence={questions:{},study:{}},chapterTitles={},bookChapters=[],viewTimer,restoringView=false,restoredViewUnchanged=false;
    function viewState(){const q=visible()[position]||items[0];return q?{version:1,id:currentId(q.id),filter,year,level,topic,sort,sortChosen:true,...(seed===undefined?{}:{seed}),missedOnly,flagsView,missedIds:missedIds?[...missedIds]:null,scroll:host.scrollTop,at:Date.now()}:null;}
    function practiceScreen(){return mockMode?'mock':redoMode?'changed':reviewMode?'review':savedView?'saved':flagsView?'flags':savedOnly?'saved-practice':missedOnly?'missed':'bank';}
    function savePracticePlace(){
      if(!loaded||!controller.active||viewport.hidden||restoringView||!(bankMode||mockMode))return;
      const screen=practiceScreen(),q=visible()[position];
      rememberPractice(screen,{id:q?.id||null,scroll:host.scrollTop,...(mockMode?{building,articleSelected}:{}),...(['saved','saved-practice','flags','changed'].includes(screen)?{view:viewState()}:{}),...(missedOnly||redoMode?{missedIds:missedIds?[...missedIds]:null,redoIds:[...redoIds],retryAnswers:Object.fromEntries(retryAnswers)}:{})});
    }
    function saveView(){
      savePracticePlace();
      if(!loaded||!controller.active||viewport.hidden||restoringView||redoMode||savedView||savedOnly)return;
      if(reviewMode){try{history.replaceState({...history.state,reviewView:{id:visible()[position]?.id,scroll:host.scrollTop,lastAnswer}},'');}catch{storageError='Review position could not be saved.';}return;}
      const view=viewState();if(!view)return;
      try{
        history.replaceState({...history.state,mcqView:{...view,missedIds:missedIds?[...missedIds]:null,retryAnswers:[...retryAnswers],lastAnswer}},'');
        // Restoring a legacy view must not migrate or overwrite its saved bytes.
        if(bankMode&&!restoredViewUnchanged)HazzardStorage.setItem(VIEW_KEY,JSON.stringify(view));
      }catch{notice='Question position could not be saved.';}
    }
    function restoreView(view){
      if(reviewMode||redoMode)return false;
      if(!validView(view))return false;
      ({filter,topic,sort,seed,missedOnly,flagsView}=view);restoredViewUnchanged=true;if(bankMode&&view.sortChosen!==true&&sort==='source')sort='shuffled';if(sort==='shuffled'&&seed===undefined)seed=newSeed();year=choicesOf(view.year);level=choicesOf(view.level);
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
      restoredViewUnchanged=false;filter=topic='all';year=[];level=[];sort=bankMode?'shuffled':'source';if(sort==='shuffled'&&seed===undefined)seed=newSeed();missedOnly=flagsView=savedView=savedOnly=false;missedIds=null;
      id=currentId(id);hiddenTarget=null;if(bad(id))hiddenTarget=id;if(standoutHidden(id)){hiddenTarget=id;notice='This question is hidden. To serve it, turn on '+standoutLabel+' in Practice settings.';}dismissed.delete(id);position=Math.max(0,visible().findIndex(q=>q.id===id));
      const url=new URL(location.href);url.searchParams.delete('q');url.hash='';history.replaceState({...history.state,mcqView:null},'',url);
      render();host.scrollTop=0;saveView();
      host.querySelector('.mcq-question')?.scrollIntoView({block:'start'});
    }
    function practicePage(q){
      if(q.kind!=='practice')return null;
      const chapter=String(q.bookChapter||q.chapter),ch=bookChapters.find(c=>c.chapter===chapter);
      const explicit=q.bookPage||Number(q.ref.match(/\bp\.?\s*(\d+)/i)?.[1]);
      return ch?{chapter,page:explicit||ch.start,available:true,chapterStart:!explicit}:null;
    }
    function sourceHTML(source){
      const parts=String(source).split(/((?:pp?\.?\s*|\u00a7{1,2}\s*)\d+(?:[.,\u2013-]\d+)*|\b\d+(?:[\u2013-]\d+)+)/g);
      return parts.map((part,i)=>i%2?'<bdi dir="ltr" class="mcq-source-locator">'+escape(part)+'</bdi>':'<bdi dir="auto">'+escape(part)+'</bdi>').join('');
    }
    function citationHTML(q){
      const ref=evidence.questions[q.id];
      const source=sourceTitle(q.ref).replace(/\s*·\s*/g,' ').replace(/\bp\. (?=\d+[-–,])/g,'pp. ');
      const practice=practicePage(q);
      let html='<div class="mcq-citations">'+(q.source==='drill'&&practice?'<button class="mcq-page-link" data-page="'+practice.page+'">Source: '+sourceHTML(source)+'</button>':'<p class="meta">Source: '+sourceHTML(source||sourceLabel(q))+'</p>');
      if(generated(q)&&practice&&!ref?.pages?.some(p=>p.available))html+='<button class="mcq-page-link" data-page="'+practice.page+'">Open page '+practice.page+(practice.chapterStart?' (chapter start)':'')+'</button>';
      if(q.referenceNote)html+='<p class="meta" dir="auto">'+escape(q.referenceNote)+'</p>';
      const assigned=ref?.chapters.length?ref.chapters:[String(q.chapter)];
      if(q.requiredReadingNote)html+='<p class="mcq-source-note" role="note">'+escape(q.requiredReadingNote)+'</p>';
      if(!q.requiredCard&&([...assigned,String(q.chapter)].some(c=>['2','3','4','5','6','34','62'].includes(c))||membership(q).includes(51)))html+='<p class="mcq-source-note" role="note">chapter not on the 2026 required list</p>';
      if(ref){
        const chapterLinked=['title-8e','topic-8e'].includes(ref.status);
        const unmapped=q.sourceType==='Hazzard'&&ref.status!=='resolved'&&!chapterLinked;
        html+='<p class="meta">'+escape(HazzardEvidence.sittingLabel(ref.sitting))+' paper'+(unmapped?(q.edition===7?' · 7e source: not mapped into this 8e reader':' · 8e page not mapped'):'')+'</p>';
        if(chapterLinked){
          const c=ref.chapters[0],method=ref.status==='title-8e'?'7e ch '+ref.chapter7+' -> 8e ch '+c+' ('+chapterTitles[c]+')':'topic match';
          html+='<p class="meta"><a class="mcq-chapter-link" href="?chapter='+encodeURIComponent(c)+'&amp;examBack=1&amp;chapterTop=1">'+escape(ref.reference+' - opens the 8e chapter ('+method+')')+'</a></p>';
        }
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
      if(reviewMode){try{reviewBatch=HazzardReview.read().batch;if(reviewBatch)position=reviewDisplayPosition();}catch{storageError='Review queue could not be read.';}}
      let flagsError='';try{personal=readFlags();systemPrefs=readSystem();}catch{flagsError='Personal topic flags or source choices could not be read. Existing data has not been overwritten.';}
      try{const saved=mockMode?readPaper():readStore();if(mockMode){if(saved&&!paperPending){paper=saved.paper;settings=saved.settings;}if(paper)position=paper.position;}else{answers.clear();for(const [id,a]of Object.entries(saved.answers))answers.set(id,a)}storageError='';}
      catch{storageError='Saved answers could not be read. Existing data has not been overwritten.';}
      for(const [id,a]of pending)answers.set(id,a);
      if(flagsError)storageError=flagsError;
      if(loaded)render();
    }
    function save(){
      try{
        if(pending.size){const saved=mergeStore(readStore(false),{version:1,answers:Object.fromEntries(pending)});HazzardStorage.setItem(KEY,JSON.stringify(saved));for(const [id,a] of pending){if(!persistedAnswer(id,a))throw Error('Answer not persisted');answers.set(id,saved.answers[id]);const action=pendingLogs.get(id);if(action){appendLog(action);pendingLogs.delete(id);}const undo=pendingUndos.get(id);if(undo){removeLog(undo);pendingUndos.delete(id);}pending.delete(id);}}
        if(mockMode){if(paper){paper.position=position;paper.at=Date.now();}HazzardStorage.setItem(PAPER_KEY,JSON.stringify({version:1,settings,paper,at:Date.now()}));paperPending=false;}
        storageError='';
      }catch{storageError='Answers could not be saved. Keep this page open and try again.';if(mockMode)paperPending=true;}
    }
    const controller={active:false,search(){saveView();if(mockMode)history.replaceState({...history.state,mcqMockView:{building,articleSelected}},'');search.open();},get hasUnsaved(){return pending.size>0||paperPending},sync,save,remember:saveView,
      show(source){if(source==='past'){filter='past';position=0;history.replaceState({...history.state,mcqView:null},'');}if(!bankMode&&!mockMode)history.replaceState({...history.state,hazzardStudyMode:"questions"},'');selectTab('questions');controller.active=true;host.hidden=false;readerScroll.style.visibility='hidden';readerScroll.inert=true;onShow();if(!loaded)load();else render();},
      notes(){if(bankMode||mockMode)return;history.replaceState({...history.state,hazzardStudyMode:"notes"},'');selectTab('notes');saveView();lastAnswer=null;controller.active=false;host.hidden=true;readerScroll.style.visibility='';readerScroll.inert=false;onNotes();}
    };
    const search=HazzardQuestionSearch.mount({
      getItems:async all=>{if(!loaded)throw Error('Questions are still loading. Try again.');return (all?items:mockMode?builderPool(true):flagsView?visible(true).filter(q=>activeFlags().some(([id])=>id===q.id)):visible(true)).filter(q=>!q.retired).map(q=>({id:q.id,label:sourceLabel(q),stem:q.q,note:excluded(q.id)?EXCLUDED_NOTE:standoutHidden(q.id)?'Hidden by Practice settings':'',text:[q.id,q.q,...q.o,q.explanation].join(' ')}));},
      openQuestion:id=>{saveView();location.href='?chapter=bank&q='+encodeURIComponent(id);}
    });
    const empty=()=>({selected:null,checked:false});
    const flagged=(q,scope)=>(['source:law','source:system'].includes(scope)&&!!systemPrefs.flags[q.id]?.hidden)||!!(personal.flags[q.id]?.hidden&&personal.flags[q.id].scopes.includes(scope));
    const topicsHidden=q=>membership(q).every(t=>flagged(q,'topic:'+t));
    const lawSelected=()=>settings.sources.includes('law')||systemPrefs.selected;
    function activeFlags(){const entries=new Map(Object.entries(personal.flags).filter(([,f])=>f.hidden).map(([id,f])=>[id,{...f,scopes:[...f.scopes]}]));for(const[id,f]of Object.entries(systemPrefs.flags))if(f.hidden){const item=entries.get(id)||{hidden:true,at:f.at,scopes:[]};item.scopes.push('source:system');item.at=Math.max(item.at,f.at);entries.set(id,item)}return [...entries];}
    const flagCount=()=>{try{return activeFlags().length+generatedFlags().length+Object.values(readBad().items).filter(r=>r.bad).length;}catch{return '?';}};
    const sourceChoices=()=>[['past','Shlav A past papers (official sittings)'],['practice',mockMode?'Include generated practice':'Hazzard practice'],['drill',mockMode?'Include drill / source-checked practice':'Drill / source-checked practice'],['law','Israeli law & ethics'],...(collections.suppliedArticles?.enabled?[['articles','Supplied articles']]:[])];
    const topicChoices=()=>topics.map((name,i)=>[String(i),name]).filter(([id])=>filter!=='law'||items.some(q=>lawIds.has(q.id)&&membership(q).includes(Number(id)))).sort((a,b)=>a[1].localeCompare(b[1],'en',{sensitivity:'base'}));
    const scopeLabel=scope=>scope.startsWith('topic:')?(topics[Number(scope.slice(6))]||scope):({'source:law':'Israeli law & ethics','source:past':'Shlav A past exams','source:practice':PRACTICE_LABEL,'source:system':'Israeli law & ethics','chapter:law':'Law study','mock':'Mock papers'}[scope]||scope.replace('chapter:','Chapter '));
    function writeFlag(q,undo=false){
      try{
        const saved=readFlags(),system=readSystem();let systemChanged=false;
        if(undo){if(saved.flags[q.id])saved.flags[q.id]={...saved.flags[q.id],hidden:false,at:Date.now()};if(system.flags[q.id]){system.flags[q.id]={hidden:false,at:Date.now()};systemChanged=true;}}
        else{
          const scopes=new Set(saved.flags[q.id]?.hidden?saved.flags[q.id].scopes:[]);const selectedTopic=mockMode?settings.topic:topicChoicesOf(topic).find(t=>membership(q).includes(Number(t)))||'all';
          scopes.add('topic:'+(selectedTopic!=='all'&&selectedTopic!=null&&membership(q).includes(Number(selectedTopic))?selectedTopic:membership(q)[0]));
          if(bankMode&&!topicChoicesOf(topic).length&&filter!=='all'&&filter!=='system'&&filter!=='articles')scopes.add('source:'+(filter==='drill'?'practice':filter));
          if(!bankMode&&!mockMode)scopes.add('chapter:'+chapter);
          if(chapter==='law'||lawIds.has(q.id)&&(filter==='law'||mockMode&&lawSelected()))scopes.add('source:law');
          if(mockMode){scopes.add('mock');if(settings.sources.includes(q.kind))scopes.add('source:'+q.kind);}
          saved.flags[q.id]={scopes:[...scopes],hidden:true,at:Date.now()};
        }
        HazzardStorage.setItem(FLAGS_KEY,JSON.stringify(saved));if(systemChanged)HazzardStorage.setItem(SYSTEM_KEY,JSON.stringify(system));personal=saved;systemPrefs=system;storageError='';
        if(undo){dismissed.delete(q.id);notice='Question restored to its filters.';}else{if(!bankMode||!topicChoicesOf(topic).length)dismissed.add(q.id);notice='Hidden from '+saved.flags[q.id].scopes.map(scopeLabel).join(' · ')+'. Undo in Flags.';}
        return true;
      }catch{storageError='The topic flag could not be saved. This question has not been hidden.';return false;}
    }
    function changeAnswerFlag(id,at=null){
      try{
        const entries=generatedFlags();
        if(at===null)entries.push({id,at:Date.now()});
        else{const index=entries.findIndex(f=>f.id===id&&f.at===at);if(index<0)return;entries.splice(index,1);}
        HazzardStorage.setItem(GENERATED_FLAGS_KEY,JSON.stringify(entries));showGeneratedCount();storageError='';
      }catch{storageError='Answer flag could not be saved; existing flags kept.';}
      render();
    }
    function answerFlagButton(q){
      try{const flagged=generatedFlags().some(f=>f.id===q.id);return '<button class="mcq-topic-flag" data-mcq="generated-flag" aria-pressed="'+flagged+'">'+(flagged?'Unflag answer':'This answer looks wrong')+'</button>';}
      catch{return '<span class="meta" role="alert">Answer flags could not be read.</span>';}
    }
    function answerFlagsList(byId){
      try{
        const entries=generatedFlags().filter(f=>!byId.get(f.id)?.retired).sort((a,b)=>b.at-a.at);
        const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
        return '<h2>Answer looks wrong ('+entries.length+')</h2>'+(entries.length?entries.map(f=>{
          const q=byId.get(f.id),stem=Array.from(q?q.q:'Question no longer in the current bank');
          const chapter=q?membership(q).map(t=>topics[t]||'').join(' · ')+(q.chapter?' · Reader chapter '+q.chapter:''):'';
          return '<section class="mcq-flag-row mcq-answer-flag-row"><a href="?chapter=bank&q='+encodeURIComponent(f.id)+'"><span class="mcq-mixed" dir="auto">'+escape(stem.slice(0,90).join(''))+(stem.length>90?'…':'')+'</span><span class="meta" dir="auto">'+escape(chapter)+'</span><time class="meta">'+escape(date.format(f.at).replaceAll('/','.'))+'</time></a><button class="quiet" data-unflag-answer="'+escape(f.id)+'" data-flag-at="'+f.at+'">Unflag</button></section>';
        }).join(''):'<p>No answer flags.</p>');
      }catch{return '<h2>Answer looks wrong</h2><p role="alert">Answer flags could not be read; existing flags kept.</p>';}
    }
    function savedCount(){const saved=readSaved();return [...Object.values(saved.questions),...Object.values(saved.topics)].filter(r=>r.saved).length;}
    function savedList(){
      const saved=readSaved(),byId=new Map(items.map(q=>[q.id,q])),entries=kind=>Object.entries(saved[kind]).filter(([,r])=>r.saved).sort((a,b)=>b[1].at-a[1].at);
      const remove=(kind,id)=>'<button data-revision="'+kind+'" data-revision-ids="'+id+'" data-revision-remove>Remove</button>';
      return '<h2>Saved for revision</h2><button data-mcq="practice-saved" '+(!entries('questions').length?'disabled':'')+'>Practice saved questions</button><h3>Questions</h3>'+(entries('questions').map(([id,r])=>{
        const q=byId.get(id),note=!q?'Question no longer in the current bank':q.retired?'This practice question has been retired. Saved answers are retained.':excluded(id)?EXCLUDED_NOTE:standoutHidden(id)?'Hidden by Practice settings':'';
        return '<section class="mcq-saved-row"><div class="mcq-mixed" dir="auto">'+rich(q?preview(q.q):id)+'</div><p class="meta">'+escape(q?sourceLabel(q):'Unavailable question')+' · '+new Date(r.at).toLocaleDateString('en-GB')+'</p>'+(note?'<p role="note">'+escape(note)+'</p>':'')+'<a href="?chapter=bank&amp;q='+id+'">Open</a> '+remove('questions',id)+'</section>';
      }).join('')||'<p>No saved questions.</p>')+'<h3>Topics</h3>'+(entries('topics').map(([id])=>'<section class="mcq-saved-row"><strong>'+escape(topics[id]||'Topic '+id)+'</strong><p class="meta">'+items.filter(q=>!q.retired&&!excluded(q.id)&&membership(q).includes(Number(id))).length+' questions</p><button data-saved-topic="'+id+'">Open</button> '+remove('topics',id)+'</section>').join('')||'<p>No saved topics.</p>');
    }
    function flagsList(){
      const byId=new Map(items.map(q=>[q.id,q])),entries=activeFlags().sort((a,b)=>b[1].at-a[1].at);
      return badList(byId)+'<h2>Topic flags</h2>'+(entries.length?entries.map(([id,f])=>{const q=byId.get(id);return '<section class="mcq-flag-row"><div class="mcq-mixed" dir="auto">'+rich(q?q.q:'Question no longer in the current bank')+'</div><p class="meta">'+escape(f.scopes.map(scopeLabel).join(' · '))+'</p><button class="quiet" data-undo-flag="'+id+'">Undo flag</button></section>';}).join(''):'<p>No topic flags.</p>')+answerFlagsList(byId);
    }
    function paperId(q){return paper.ids.filter(id=>currentId(id)===q.id).sort((a,b)=>(paper.answers[b]?.at??-1)-(paper.answers[a]?.at??-1))[0]||q.id;}
    function badList(byId){try{const entries=Object.entries(readBad().items).filter(([,r])=>r.bad).sort((a,b)=>b[1].at-a[1].at);return '<h2>Bad question ('+entries.length+')</h2>'+entries.map(([id,r])=>{const q=byId.get(id);return '<section class="mcq-flag-row"><p dir="auto">'+escape(q?.q.slice(0,180)||id)+'</p><p class="meta">'+escape(q?sourceLabel(q):'Unavailable question')+' \u00b7 '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',dateStyle:'short'}).format(r.at)+'</p><a href="?chapter=bank&amp;q='+id+'">Open</a> <button data-bad="'+id+'">Unflag</button></section>';}).join('')+badStatus();}catch{return '<h2>Bad question</h2><p>unavailable</p>';}}
    function stateFor(q){const saved=redoMode?(retryAnswers.get(q.id)||empty()):reviewMode?(reviewBatch?.answers[q.id]||empty()):mockMode?(paper.answers[paperId(q)]||empty()):missedOnly?(retryAnswers.get(q.id)||empty()):(answers.get(q.id)||empty());return saved.checked&&q.sourceChecked?.changedAt&&saved.at<Date.parse(q.sourceChecked.changedAt)?{...saved,checked:false,olderVersion:true}:saved;}
    function reviewDisplayPosition(){const list=visible(),i=list.findIndex(q=>reviewBatch.ids.findIndex(id=>currentId(id)===q.id)>=reviewBatch.position);return i<0?list.length:i;}
    function visible(includeHidden=false){
      const allowed=q=>(!bad(q.id)||hiddenTarget===q.id&&!savedOnly&&!savedView&&!flagsView&&!missedOnly&&!reviewMode&&!redoMode&&!mockMode)&&(includeHidden||!standoutHidden(q.id));
      if(redoMode){const byId=new Map(items.map(q=>[q.id,q]));return [...redoIds].map(id=>byId.get(id)).filter(q=>q&&!q.retired&&!excluded(q.id)&&allowed(q));}
      if(reviewMode){const byId=new Map(items.map(q=>[q.id,q]));return (reviewBatch?.ids||[]).map(id=>byId.get(currentId(id))).filter(q=>q&&!q.retired&&!excluded(q.id)&&allowed(q));}
      if(mockMode){const byId=new Map(items.map(q=>[q.id,q]));return paper?paper.ids.map(id=>byId.get(currentId(id))).filter(q=>q&&!q.retired&&!excluded(q.id)&&allowed(q)&&q.mockEligible!==false&&(settings.topic==='all'||membership(q).includes(Number(settings.topic))&&!flagged(q,'topic:'+settings.topic))&&!flagged(q,'mock')&&!dismissed.has(q.id)):[];}
      if(missedOnly&&missedIds===null)missedIds=new Set(items.filter(q=>answers.get(q.id)?.checked&&!q.accepted.includes(answers.get(q.id).selected)).map(q=>q.id));
      let list=items.filter(q=>!q.retired&&!excluded(q.id)&&allowed(q)&&!dismissed.has(q.id)&&(filter==='all'||filter==='law'&&lawIds.has(q.id)||filter==='articles'&&articleIds.has(q.id)||filter==='drill'&&drillTier(q)||q.kind===filter)&&(filter==='all'||!flagged(q,'source:'+(filter==='drill'?'practice':filter)))&&(!['law','articles'].includes(filter)||!topicsHidden(q))&&(chapter!=='law'||!flagged(q,'source:law')&&(!q.law||!topicsHidden(q)))&&(bankMode||!flagged(q,'chapter:'+chapter))&&matchesYear(q,year)&&matchesLevel(q,level)&&(!topicChoicesOf(topic).length||topicChoicesOf(topic).some(t=>membership(q).includes(Number(t))&&!flagged(q,'topic:'+t)))&&(!missedOnly||missedIds.has(q.id)));
      if(savedOnly){const saved=readSaved();list=list.filter(q=>saved.questions[q.id]?.saved);}
      if(bankMode&&sort==='shuffled')return shuffledBank(list,seed,filter==='law');
      if(bankMode)list.sort((a,b)=>Number(generated(a))-Number(generated(b))||(filter==='law'?(a.kind!=='past')-(b.kind!=='past'):0)||(sort==='topic'?(topics[a.topic]||'').localeCompare(topics[b.topic]||'')||a.t.localeCompare(b.t)||a.sourceIndex-b.sourceIndex:a.t.localeCompare(b.t)||a.topic-b.topic||a.sourceIndex-b.sourceIndex));
      if(!bankMode)list.sort((a,b)=>Number(generated(a))-Number(generated(b)));
      return list;
    }
    function selection(name,value,choices,label){return '<label>'+label+'<select data-select="'+name+'">'+choices.map(([v,text])=>'<option value="'+escape(v)+'" '+(String(v)===value?'selected':'')+'>'+escape(text)+'</option>').join('')+'</select></label>';}
    function multiSelection(name,value,choices,label){
      const selected=name==='topic'?topicChoicesOf(value):choicesOf(value),labels=choices.filter(([v])=>selected.includes(v)).map(([,text])=>text);
      const summary=labels.length>2?labels.length+(name==='topic'?' topics':name.endsWith('year')?' years':' levels'):labels.join(', ')||choices[0][1];
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
      if(reviewMode){const r=HazzardReview.read(),done=list.filter(q=>reviewBatch?.answers[q.id]?.checked).length;return '<p class="eyebrow">DAILY PRACTICE</p><h1>Review</h1><p class="meta">'+done+' / '+list.length+' answered · '+HazzardReview.due(r).length+' due</p><label class="mcq-review-size">Daily batch <select data-select="review-size">'+[10,30,50].map(n=>'<option value="'+n+'" '+(n===r.settings.size?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+(r.seed?.count?'<p class="meta">Started with '+r.seed.count+' previous wrong answers, spread at up to 30 per day.</p>':'')+'<p class="meta">1 → 3 → 7 → 21 days. Correct and not unsure advances. Wrong or unsure restarts tomorrow.</p><p class="meta">'+(list.length?Math.min(position+1,list.length)+' of '+list.length:'No questions due in this batch')+'</p>'+(storageError?'<p role="alert">'+escape(storageError)+'</p>':'')+(notice?'<p role="status">'+escape(notice)+'</p>':'');}
      const title=bankMode?(flagsView?'Missed / flags':'Question bank'):mockMode?'Mock paper'+(paper.retry?' · Retry missed':''):'Exam questions';
      let html='<div class="mcq-heading"><div><p class="eyebrow">'+(bankMode?'ALL BANK TOPICS':mockMode?'PRACTICE':chapter==='law'?'ISRAELI LAW · STUDY':'CHAPTER '+chapter+' · STUDY')+'</p><h1>'+title+'</h1></div>'+'</div>';
      if(bankMode)html+='<div class="mcq-view-links"><button class="quiet" data-mcq="questions" aria-pressed="'+(!flagsView&&!savedView)+'">Questions</button><button class="quiet" data-mcq="flags" aria-pressed="'+flagsView+'">Flags ('+flagCount()+')</button><button class="quiet" data-mcq="saved" aria-pressed="'+savedView+'">Saved ('+savedCount()+')</button></div>';
      if(bankMode&&!flagsView&&!savedView){
        const sittings=[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t))].sort().reverse();
        html+='<details class="mcq-jump"><summary>Go to sitting + Q</summary><form data-jump-form><label>Sitting<select name="sitting">'+sittings.map(s=>'<option value="'+escape(s)+'">'+escape(s.replace('-Subspec','').replace('-', ' '))+'</option>').join('')+'</select></label><label>Q<input name="number" type="number" min="1" max="100" inputmode="numeric" aria-label="Question number"></label><button type="submit">Go</button><span role="status" data-jump-status></span></form></details>';
        html+='<div class="mcq-bank-filters">'+selection('source',filter,[['all','All sources'],...sourceChoices()],'Source')+multiSelection('topic',topic,[['all','All topics'],...topicChoices()],'Topic')+multiSelection('year',year,[['all','All years'],...[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse().map(y=>[y,y])],'Year')+multiSelection('level',level,[['all','All levels'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Exam level')+'<div class="mcq-sort">'+selection('sort',sort,[['source','Source'],['topic','Topic'],['shuffled','Shuffled']],'Sort by')+(sort==='shuffled'?'<button type="button" data-mcq="reshuffle">Reshuffle</button>':'')+'</div>'+'<button class="mcq-missed-toggle" type="button" role="switch" data-mcq="missed" aria-checked="'+missedOnly+'"><span class="mcq-switch-track" aria-hidden="true"></span>Missed only</button></div>';
        html+='<p class="meta">'+(savedOnly?'Saved questions only · ':'')+list.length+' matching questions'+(filter==='law'?' · Official past exams only.':'')+'</p>';
      }else if(!mockMode&&!bankMode)html+='<nav class="mcq-filters" aria-label="Question type">'+[['all','All'],['past','Past exams'],['practice',PRACTICE_LABEL]].map(([id,label])=>'<button data-filter="'+id+'" aria-pressed="'+(filter===id)+'">'+label+'</button>').join('')+'</nav>';
      if(!flagsView&&!savedView)html+='<p class="meta mcq-count">'+(list.length?(position+1)+' of '+list.length:'0 questions')+'</p>';
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
    const hiddenNotice=n=>'<p class="meta mcq-standout-hidden">'+n+' questions hidden by the &ldquo;'+standoutLabel+'&rdquo; setting.</p>';
    function render(){
      requestAnimationFrame(savePracticePlace);
      if(mockMode&&building){renderBuilder();return;}
      const list=visible();position=Math.min(position,reviewMode?list.length:Math.max(0,list.length-1));const q=list[position];
      host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page">'+header(list)+(flagsView||savedView?'':hiddenNotice(visible(true).length-list.length))+'<div class="mcq-question"></div></div>';const content=host.querySelector('.mcq-question');
      filtersObserver.disconnect();const sticky=host.querySelector('nav.mcq-filters');if(sticky)filtersObserver.observe(sticky);
      if(bankMode&&savedView){content.innerHTML=savedList()+revisionStatus();return;}
      if(!reviewMode&&bankMode&&flagsView){content.innerHTML=flagsList();return;}
      if(reviewMode&&(!q||position===list.length)){content.innerHTML='<h2>'+(!list.length?'Nothing due today':'Daily batch complete')+'</h2><p>Your progress is saved. Come back tomorrow.</p><a href="?chapter=bank">Open question bank</a>';return;}
      if(!q){content.innerHTML='<p>No questions match these filters.</p>'+(!bankMode&&!mockMode?'<button data-mcq="notes">Open study notes</button>':'');return;}
      if(mockMode&&paper.finished){content.innerHTML=score(list);return;}
      const state=stateFor(q),review=HazzardReview.read().items[q.id],canUndo=lastAnswer?.id===q.id&&(lastAnswer.kind==='unsure'||lastAnswer.at===state.at&&state.checked),accepted=q.accepted||[q.c],correct=accepted.includes(state.selected),letters=['א','ב','ג','ד','ה'],order=optionOrder(q,bankMode);content.dataset.bankId=q.id;
      content.innerHTML='<span class="'+(q.kind==='past'?'exam-badge':'mcq-practice-tag')+'">'+(escape(sourceLabel(q)))+'</span><p class="meta mcq-topic-label">'+escape(membership(q).map(t=>topics[t]||'').join(' · '))+(q.chapter?' · Reader chapter '+escape(q.chapter):'')+' <button class="mcq-topic-flag" data-mcq="flag" aria-label="Wrong topic: '+escape(topics[topicChoicesOf(topic).find(t=>membership(q).includes(Number(t)))??q.topic]||'this question')+'">'+(personal.flags[q.id]?.hidden||systemPrefs.flags[q.id]?.hidden?'Flagged':'Wrong topic')+'</button></p>'+(generated(q)?'<p class="mcq-source-note" role="note">Generated practice, about 1 in 10 known wrong; if it disagrees with the book, the book wins.</p>'+answerFlagButton(q)+'<span class="meta" data-generated-status role="status"></span>':'')+(q.label?'<p class="mcq-source-note" role="note">'+sourceHTML(sourceTitle(q.label))+'</p>':'')+'<div class="mcq-stem mcq-mixed" dir="auto" lang="he">'+stemHTML(q)+'</div>'+
        (state.olderVersion?'<p class="mcq-source-note" role="note">Answered on an older version. Saved answer retained; answer again to check this version.</p>':'')+(redoMode?'<div class="mcq-confidence">'+revisionButtons(q)+'</div>':'<div class="mcq-confidence"><button data-mcq="unsure" title="Add to review without changing your answer" aria-pressed="'+!!review?.unsure+'">'+(review?.unsure?'✓ Unsure':'Unsure')+'</button>'+(canUndo?'<button class="mcq-answer-undo" data-mcq="undo">Undo</button>':'')+revisionButtons(q)+'</div>'+unsureStatus(q,state,review))+revisionStatus()+
        (q.images||[]).map((url,i)=>'<button class="mcq-image" data-image="'+i+'" aria-label="Enlarge question image '+(i+1)+'"><img src="'+escape(url)+'" alt="Question image '+(i+1)+'" loading="lazy"></button>').join('')+
        '<div class="mcq-options" role="group" aria-label="Answer options" dir="rtl">'+order.map((i,display)=>'<button class="mcq-option '+(state.selected===i?'selected ':'')+(state.checked&&accepted.includes(i)?'correct ':'')+(state.checked&&state.selected===i&&!correct?'wrong':'')+'" data-option="'+i+'" aria-pressed="'+(state.selected===i)+'" '+(state.checked?'disabled':'')+'><span class="mcq-letter">'+(letters[display]||String(display+1))+(state.checked&&accepted.includes(i)?' ✓':state.checked&&state.selected===i?' ✕':'')+'</span><span class="mcq-mixed" dir="auto" lang="he">'+rich(q.o[i])+'</span></button>').join('')+'</div>'+
        '<div class="mcq-actions"><button class="mcq-pill" data-mcq="prev" '+(position===0?'disabled':'')+'>Prev</button><button class="mcq-pill" data-mcq="next" '+((reviewMode&&!state.checked||!mockMode&&!reviewMode&&position>=list.length-1)?'disabled':'')+'>Next</button></div>'+
        (state.checked?'<p class="mcq-result '+(correct?'correct':'wrong')+'" dir="rtl" role="status">'+(correct?'✓ תשובה נכונה':'✕ תשובה שגויה · '+(accepted.length>1?'תשובות מתקבלות: ':'התשובה הנכונה: ')+accepted.map(i=>letters[order.indexOf(i)]||String(order.indexOf(i)+1)).join(', '))+'</p>'+(q.kind==='past'&&order.some((n,i)=>n!==i)?'<p class="mcq-source-note mcq-official-order" dir="ltr">Options shuffled. Official paper order: answer '+accepted.map(i=>letters[i]).join(', ')+'</p>':'')+'<section class="mcq-explanation" dir="auto" lang="he"><h3 dir="rtl">הסבר</h3><div class="mcq-mixed" dir="auto">'+(q.explanation?rich(explanationText(q,order)):'<p>אין הסבר במאגר לשאלה זו.</p>')+'</div></section>':'')+citationHTML(q);
      if(state.checked&&(q.explanationReviewNote||q.explanationIncomplete)){const note=document.createElement('p');note.className='mcq-source-note';note.setAttribute('role','note');note.dir='ltr';note.lang='en';note.textContent=q.explanationReviewNote||'Explanation incomplete in source.';content.querySelector('.mcq-explanation').append(note);}
      for(const image of content.querySelectorAll('img'))image.onerror=()=>{image.parentElement.replaceWith(Object.assign(document.createElement('p'),{textContent:'Question image unavailable. Reconnect to finish downloading the reader.'}));for(const b of content.querySelectorAll('[data-option]'))b.disabled=true;};
      if(q.kind==='past'&&!mockMode)HazzardLawCards.questionLinks(content,q.id);
      saveView();
    }
    function builderPool(includeHidden=false){
      return [...new Map(items.filter(q=>!q.retired&&!bad(q.id)&&!excluded(q.id)&&(includeHidden||!standoutHidden(q.id))&&q.mockEligible!==false&&(!generated(q)||generatedSelected)&&(!drillTier(q)||drillSelected)&&(settings.topic==='all'||membership(q).includes(Number(settings.topic))&&!flagged(q,'topic:'+settings.topic))&&!flagged(q,'mock')&&(drillTier(q)?drillSelected&&!flagged(q,'source:practice')&&!topicsHidden(q):(articleSelected&&articleIds.has(q.id)&&!topicsHidden(q)||(generated(q)?generatedSelected:settings.sources.includes(q.kind))&&!flagged(q,'source:'+q.kind)||lawSelected()&&lawIds.has(q.id)&&!flagged(q,'source:law')&&!topicsHidden(q)))&&(q.kind!=='past'||matchesYear(q,settings.year)&&matchesLevel(q,settings.level))).map(q=>[q.id,q])).values()];
    }
    function renderBuilder(){
      const pool=builderPool(),years=[...new Set(items.filter(q=>q.kind==='past').map(q=>q.t.slice(0,4)))].sort().reverse();
      host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page"><p class="eyebrow">PRACTICE</p><h1>Mock builder</h1><p><a class="sim-entry" href="?chapter=mock&amp;simulation=1">Exam simulation · one official sitting, timed</a></p><h2>Length</h2><div class="mcq-filters">'+[25,50,100].map(n=>'<button data-length="'+n+'" aria-pressed="'+(settings.length===n)+'">'+n+'</button>').join('')+'</div><h2>Sources</h2><div class="mcq-source-choices">'+sourceChoices().map(([id,label])=>'<button data-source="'+id+'" aria-pressed="'+(id==='law'?lawSelected():id==='articles'?articleSelected:id==='drill'?drillSelected:id==='practice'?generatedSelected:settings.sources.includes(id))+'">'+label+'</button>').join('')+'</div>'+(lawSelected()?'<p class="meta mcq-law-note">'+LAW_NOTE+'</p>':'')+'<div class="mcq-bank-filters">'+selection('mock-topic',settings.topic,[['all','All topics'],...topicChoices()],'Topic')+multiSelection('mock-year',settings.year,[['all','All years'],...years.map(y=>[y,y])],'Past-exam year')+multiSelection('mock-level',settings.level,[['all','All levels'],['Subspec','Subspecialty'],['unspecified','Not specified']],'Past-exam level')+'</div><p class="mcq-pool-count" role="status">'+(pool.length<settings.length?'Only '+pool.length+' matching questions are available; this paper will use all '+pool.length+'.':pool.length+' matching questions · '+settings.length+' will be drawn at random.')+'</p>'+hiddenNotice(builderPool(true).length-pool.length)+'<p class="meta">Choose any combination. Law overlaps are included once. Year and level filters apply to past-exam questions.</p><button data-mcq="start" class="primary" '+(!pool.length?'disabled':'')+'>Start paper</button>'+(paper?' <button data-mcq="resume">Resume current paper</button>':'')+(storageError?'<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>':'')+'</div>';
    }
    function newPaper(){
      const chosen=shuffle(builderPool()).slice(0,settings.length);if(!chosen.length)return;
      paper={size:settings.length,ids:chosen.map(q=>q.id),answers:{},finished:false,retry:false,position:0,at:Date.now()};position=0;building=false;paperPending=true;save();
      const url=new URL(location.href);url.searchParams.delete('n');url.searchParams.set('run','1');history.replaceState(history.state,'',url);
    }
    async function load(){
      if(busy)return;busy=true;host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page"><p role="status">Loading questions…</p></div>';
      try{
        evidence=await HazzardEvidence.load();
        bookChapters=(await json('data/mcq/hazzard8e-toc.json')).chapters;
        chapterTitles=Object.fromEntries(bookChapters.map(c=>[c.chapter,c.title]));
        const studyOnly=!!evidence.study[chapter]?.studyOnly;
        [items,topics,collections]=await Promise.all([studyOnly||readOnlyChapter?Promise.resolve([]):json('data/mcq/'+(bankMode||mockMode?'all':chapter)+'.json'),json('data/mcq/topics.json'),json('data/mcq/collections.json'),loadAliases()]);
        if(!bankMode&&!mockMode){const canonical=new Map((await json('data/mcq/all.json')).map(q=>[q.id,q]));items=items.map(q=>canonical.get(q.id)||q);}
        if(evidence.study[chapter]||readOnlyChapter){
          const ids=new Set(HazzardEvidence.studyIds(evidence,chapter)),all=await json('data/mcq/all.json');
          items=[...new Map([...all.filter(q=>ids.has(q.id)||drillTier(q)&&String(q.chapter)===chapter),...items.filter(q=>q.kind==='practice'&&(!q.sourceChecked||String(q.chapter)===chapter))].map(q=>[q.id,q])).values()];
        }
        if(redoMode)redoIds=new Set(HazzardChanged.pending(await HazzardChanged.load(),HazzardChanged.answers()).map(q=>q.id));
        else await HazzardReview.seed();
        if(reviewMode){reviewBatch=HazzardReview.batch(items.filter(q=>!excluded(q.id)));position=reviewDisplayPosition();}
        lawIds=new Set(collections.israeliLawEthics.ids);articleIds=new Set(collections.suppliedArticles?.ids||[]);
        if(mockMode){
          const url=new URL(location.href),n=url.searchParams.get('n');
          if(storageError)throw Error(storageError);
          building=n==='builder'||!paper||!(n==='resume'||url.searchParams.get('run')==='1');
          const available=new Set(items.map(q=>q.id));if(paper&&!paper.ids.every(id=>available.has(currentId(id)))){building=true;storageError='Some saved paper questions are unavailable in this release. Start a new paper.';}
        }
        if(mockMode&&new URL(location.href).searchParams.get('n')!=='builder'&&history.state?.mcqMockView){building=history.state.mcqMockView.building;articleSelected=history.state.mcqMockView.articleSelected;}
        let view=history.state?.mcqView;
        const target=bankMode&&!reviewMode?new URL(location.href).searchParams.get('q'):null;
        if(bankMode&&!reviewMode&&!redoMode&&!view&&!target&&!location.hash){try{view=JSON.parse(localStorage.getItem(VIEW_KEY));}catch{notice='Saved question position could not be read.';}}
        const explicitMissed=bankMode&&location.hash==='#missed'&&new URL(location.href).searchParams.get('practiceResume')!=='1';
        const samePlace=!explicitMissed&&!(mockMode&&new URL(location.href).searchParams.get('n')==='builder')&&!new URL(location.href).searchParams.has('statsFilter')&&!target&&resumePlace&&resumePlace.screen===practiceScreen();
        if(samePlace){
          if(resumePlace.screen==='missed'){try{view=JSON.parse(localStorage.getItem(VIEW_KEY));}catch{view=null;}}
          if(resumePlace.view&&!reviewMode&&!redoMode)view=resumePlace.view;
          if(redoMode&&resumePlace.redoIds)redoIds=new Set(resumePlace.redoIds.map(currentId));
          if(resumePlace.missedIds)missedIds=new Set(resumePlace.missedIds.map(currentId));
          for(const[id,a]of Object.entries(resumePlace.retryAnswers||{}))retryAnswers.set(currentId(id),a);
          if(mockMode){building=!!resumePlace.building;articleSelected=!!resumePlace.articleSelected;}
        }
        const statsFilter=new URL(location.href).searchParams.get('statsFilter');
        const restored=!explicitMissed&&!statsFilter&&!target&&restoreView(view);
        if(explicitMissed){filter=topic='all';year=[];level=[];missedOnly=true;flagsView=savedView=savedOnly=false;missedIds=null;position=0;}
        if(statsFilter){filter=['law','articles'].includes(statsFilter)?statsFilter:'all';topic=/^\d+$/.test(statsFilter)?statsFilter:'all';year=[];level=[];missedOnly=flagsView=savedView=savedOnly=false;position=0;}
        if(bankMode&&!resumePlace&&new URL(location.href).searchParams.get('practiceResume')==='1'){flagsView=savedView=savedOnly=missedOnly=false;const n=visible().findIndex(q=>q.id===view?.id);position=Math.max(0,n);}
        if(samePlace&&resumePlace.id&&(redoMode||savedOnly)){const n=visible().findIndex(q=>q.id===resumePlace.id);if(n>=0)position=n;}
        loaded=true;restoringView=restored;search.restore();
        if(target&&items.some(q=>q.id===currentId(target)&&q.retired)){notice='This practice question has been retired. Saved answers are retained.';render();}
        else if(target&&excluded(target)){const q=items.find(q=>q.id===currentId(target));host.innerHTML='<div class="mcq-page"><h1>Question search</h1><div class="mcq-question"><p role="note">'+EXCLUDED_NOTE+'</p>'+(q?'<div class="mcq-stem" dir="auto">'+stemHTML(q)+'</div>':'')+'<a href="?chapter=bank">Open question bank</a></div></div>';}
        else if(target){if(items.some(q=>q.id===currentId(target)&&!q.retired))jump(target);else{notice='That question is unavailable.';render();}}
        else{
          const rv=reviewMode?history.state?.reviewView:null;
          if(rv&&visible()[position]?.id===rv.id){lastAnswer=rv.lastAnswer||null;restoringView=true;}
          if(samePlace)restoringView=true;
          render();if(samePlace)restoreScroll(resumePlace);else if(restored)restoreScroll(view);else if(restoringView&&rv)restoreScroll(rv);
        }
      }catch(error){host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page"><p role="alert">'+escape(error.message||'Questions could not be loaded.')+'</p><button data-mcq="load">Reload questions</button>'+(!bankMode&&!mockMode?' <button data-mcq="notes">'+(readOnlyChapter?'Read chapter':'Study notes')+'</button>':'')+'</div>';}
      finally{busy=false;}
    }
    function commit(q,state,log){if(log)pendingLogs.set(q.id,log);state.at=Math.max(Date.now(),(answers.get(q.id)?.at||0)+1,(state.at||0)+1);answers.set(q.id,state);pending.set(q.id,state);if(missedOnly)retryAnswers.set(q.id,state);if(mockMode){paper.answers[paperId(q)]=state;paperPending=true;}save();}
    host.addEventListener('scroll',()=>{clearTimeout(viewTimer);viewTimer=setTimeout(saveView,200);},{passive:true});
    for(const event of ['pointerdown','touchstart','wheel','keydown'])host.addEventListener(event,()=>{restoringView=false;restoredViewUnchanged=false;},{passive:true});
    host.addEventListener('click',()=>queueMicrotask(saveView));
    host.addEventListener('change',()=>queueMicrotask(saveView));
    addEventListener('pagehide',saveView);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveView();});
    host.addEventListener('submit',event=>{
      if(!event.target.matches('[data-jump-form]'))return;event.preventDefault();
      const form=new FormData(event.target),q=items.find(q=>q.kind==='past'&&q.t===form.get('sitting')&&q.examNumber===Number(form.get('number')||1));
      if(q)jump(q.id);else event.target.querySelector('[data-jump-status]').textContent='No question with that sitting and number.';
    });
    host.addEventListener('change',event=>{
      hiddenTarget=null;const name=event.target.dataset.select;if(!name)return;restoredViewUnchanged=false;lastAnswer=null;const value=event.target.value;
      if(name==='mock-topic'){settings.topic=value;save();render();return;}
      if(name==='review-size'){try{const r=HazzardReview.size(Number(value),items.filter(q=>!excluded(q.id)));reviewBatch=r.batch;position=reviewDisplayPosition();notice='Batch size saved. Completed answers are kept.';}catch{storageError='Batch size could not be saved.';}render();return;}
      if(['topic','year','level','mock-year','mock-level'].includes(name)){
        const isMock=name.startsWith('mock-'),key=name==='topic'?'topic':name.endsWith('year')?'year':'level',previous=isMock?settings[key]:key==='topic'?topic:key==='year'?year:level;
        const selected=key==='topic'?topicChoicesOf(previous):choicesOf(previous),next=value==='all'?[]:event.target.checked?[...new Set([...selected,value])]:selected.filter(v=>v!==value);
        const y=host.scrollTop;
        if(isMock){settings[key]=next;save();}else{if(key==='topic')topic=next;else if(key==='year')year=next;else level=next;position=0;}
        render();if(!isMock)saveView();host.querySelector('[data-multi="'+name+'"]').open=true;host.scrollTop=y;
        host.querySelector('[data-select="'+name+'"][value="'+value+'"]').focus({preventScroll:true});return;
      }
      if(name==='source'){filter=normalizeSource(value);year=[];level=[];topic='all';}else if(name==='sort'){sort=value;if(sort==='shuffled'&&seed===undefined)seed=newSeed();}
      position=0;render();host.scrollTop=0;
    });
    host.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!host.contains(button)||button.disabled)return;restoredViewUnchanged=false;const action=button.dataset.mcq;
      if(['flags','questions','saved','practice-saved','missed','reshuffle','next','prev','notes'].includes(action)||button.dataset.savedTopic!==undefined)hiddenTarget=null;
      if(!button.hasAttribute('data-revision')&&button.dataset.option===undefined&&button.dataset.image===undefined&&button.dataset.page===undefined&&!['undo','unsure','save'].includes(action))lastAnswer=null;
      if(action==='notes'){controller.notes();return;}if(action==='load'){load();return;}if(action==='save'){save();render();return;}
      if(['flags','questions','saved'].includes(action)){flagsView=action==='flags';savedView=action==='saved';if(action==='questions')savedOnly=false;const url=new URL(location.href);url.hash=savedView?'saved':flagsView?'flags':'';url.searchParams.delete('q');url.searchParams.delete('saved');history.replaceState(history.state,'',url);render();host.scrollTop=0;return;}
      if(action==='practice-saved'){savedOnly=true;savedView=flagsView=missedOnly=false;filter=topic='all';year=[];level=[];position=0;const url=new URL(location.href);url.hash='';url.searchParams.delete('q');url.searchParams.set('saved','1');history.replaceState(history.state,'',url);render();host.scrollTop=0;return;}
      if(button.dataset.savedTopic!==undefined){savedOnly=savedView=flagsView=missedOnly=false;filter='all';topic=[button.dataset.savedTopic];year=[];level=[];position=0;const url=new URL(location.href);url.hash='';url.searchParams.delete('saved');url.searchParams.delete('q');history.replaceState(history.state,'',url);render();host.scrollTop=0;return;}
      if(button.dataset.unflagAnswer){changeAnswerFlag(button.dataset.unflagAnswer,Number(button.dataset.flagAt));return;}
      if(button.dataset.undoFlag){writeFlag({id:button.dataset.undoFlag},true);render();return;}
      if(action==='reshuffle'){seed=newSeed(seed);position=0;render();host.scrollTop=0;host.querySelector('[data-mcq="reshuffle"]')?.focus({preventScroll:true});return;}
      if(action==='missed'){missedOnly=!missedOnly;missedIds=null;retryAnswers.clear();position=0;render();host.querySelector('[data-mcq="missed"]')?.focus({preventScroll:true});return;}
      if(button.dataset.length){settings.length=Number(button.dataset.length);save();render();return;}
      if(button.dataset.source==='practice'&&mockMode){changeSetting('generatedSelected',!generatedSelected);return;}
      if(button.dataset.source==='drill'){changeSetting('drillSelected',!drillSelected);return;}
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
      if(button.dataset.page){const p=evidence.questions[q.id]?.pages.find(p=>p.page===Number(button.dataset.page)&&p.available)||practicePage(q);if(p){saveView();HazzardEvidence.openPage(p,history.state.mcqView);}return;}
      if(action==='generated-flag'&&generated(q)){
        const status=host.querySelector('[data-generated-status]');
        try{const entry=generatedFlags().filter(f=>f.id===q.id).sort((a,b)=>b.at-a.at)[0];changeAnswerFlag(q.id,entry?entry.at:null);host.querySelector('[data-generated-status]').textContent=storageError?'':entry?' Flag removed':' Flag saved';}catch{status.textContent=' Flag could not be saved; existing flags kept.';}return;
      }
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
          const log=unsure?logAction(q,'unsure'):null,saved=HazzardReview.set(q.id,value);if(log){const raw=rawValue(HazzardReview.KEY,HazzardReview.valid,()=>null);if(raw.items[q.id]?.at===saved.items[q.id].at&&raw.items[q.id].unsure)appendLog(log);}unsureRemoved=unsure?null:{id:q.id,until:Date.now()+3000};lastAnswer={kind:'unsure',log,id:q.id,previousReview,reviewAt:saved.items[q.id].at,previousAction,attempt};
        }catch{storageError='Uncertainty could not be saved. Try again.';}
        const y=host.scrollTop;render();host.scrollTop=y;return;
      }
      if(action==='undo'){
        if(lastAnswer?.id!==q.id)return;
        try{if(HazzardReview.read().items[q.id]?.at!==lastAnswer.reviewAt){lastAnswer=null;notice='Review state changed in another tab. Undo is no longer available.';sync();return;}}catch{storageError='Review state could not be read safely.';render();return;}
        if(lastAnswer.kind==='unsure'){try{const undo=lastAnswer,saved=HazzardReview.set(q.id,undo.previousReview);if(rawValue(HazzardReview.KEY,HazzardReview.valid,()=>null).items[q.id]?.at===saved.items[q.id].at)removeLog(undo.log);lastAnswer=undo.previousAction;if(lastAnswer)lastAnswer.reviewAt=saved.items[q.id].at;}catch{storageError='Undo could not be saved.';}render();return;}
        if(lastAnswer.at!==state.at||!state.checked)return;
        try{if(pending.get(q.id)?.at!==lastAnswer.at&&readStore().answers[q.id]?.at!==lastAnswer.at){lastAnswer=null;sync();return;}}catch{storageError='The answer could not be read safely.';render();return;}
        const undo=lastAnswer,at=Math.max(Date.now(),state.at+1);
        try{const r=HazzardReview.set(q.id,undo.previousReview,reviewMode?undo.previousBatchAnswer||null:undefined);if(reviewMode)reviewBatch=r.batch;}catch{storageError='Review Undo could not be saved.';render();return;}
        const restored={...(undo.previousAnswer||empty()),at};
        pendingLogs.delete(q.id);if(undo.log)pendingUndos.set(q.id,undo.log);answers.set(q.id,restored);pending.set(q.id,restored);
        if(missedOnly){if(undo.previousRetry)retryAnswers.set(q.id,undo.previousRetry);else retryAnswers.delete(q.id);}
        if(mockMode){if(undo.previousPaperAnswer)paper.answers[undo.paperId]={...undo.previousPaperAnswer,at};else delete paper.answers[undo.paperId];position=undo.position;paper.finished=undo.finished;paperPending=true;}
        save();lastAnswer=null;render();host.querySelector('[data-option="0"]')?.focus({preventScroll:true});return;
      }
      if(action==='next'||action==='prev'){
        if(action==='next'&&position===list.length-1&&reviewMode){position=list.length;HazzardReview.position(reviewBatch.ids.length);render();host.scrollTop=0;return;}
        if(action==='next'&&position===list.length-1&&mockMode){paper.finished=true;save();render();host.scrollTop=0;return;}
        position+=action==='next'?1:-1;if(reviewMode)HazzardReview.position(reviewBatch.ids.findIndex(id=>currentId(id)===list[position].id));if(mockMode)save();render();if(bankMode)host.querySelector('.mcq-question').scrollIntoView({block:'start'});else host.scrollTop=0;return;
      }
      if(button.dataset.option!==undefined&&!state.checked){state.selected=Number(button.dataset.option);state.checked=true;}
      else return;
      const log=logAction(q);if(log)log.entry[1]=HazzardReview.read().items[q.id]?.unsure?'u':q.accepted.includes(state.selected)?'c':'w';
      if(redoMode){commit(q,state,log);retryAnswers.set(q.id,state);render();HazzardChanged.refresh();host.querySelector('[data-mcq="next"]')?.focus({preventScroll:true});return;}
      let previousAnswer;try{previousAnswer=readStore().answers[q.id];}catch{storageError='The previous answer could not be read safely.';render();return;}
      const previousReview=HazzardReview.read().items[q.id]||null;
      const undo={id:q.id,previousReview,previousBatchAnswer:reviewBatch?.answers[q.id],previousAnswer:previousAnswer?{...previousAnswer}:null,previousRetry:retryAnswers.get(q.id),paperId:mockMode?paperId(q):null,previousPaperAnswer:mockMode?paper.answers[paperId(q)]:null,position,finished:mockMode?paper.finished:false};
      try{const saved=HazzardReview.set(q.id,HazzardReview.result(previousReview,{correct:q.accepted.includes(state.selected),unsure:!!previousReview?.unsure,review:reviewMode}),reviewMode?{...state,at:Date.now()}:undefined);undo.reviewAt=saved.items[q.id].at;if(reviewMode)reviewBatch=saved.batch;}catch{storageError='Review progress could not be saved. Try answering again.';render();return;}
      commit(q,state,log);if(reviewMode){reviewBatch.answers[q.id]=state;try{const r=HazzardReview.read();r.batch=reviewBatch;r.batchAt=Math.max(Date.now(),r.batchAt+1);HazzardReview.write(r);}catch{storageError='Review answer could not be saved.';}}lastAnswer={...undo,at:state.at,log};const y=host.scrollTop;render();host.scrollTop=y;
      host.querySelector('[data-mcq="next"]')?.focus({preventScroll:true});
    });
    addEventListener('hazzard-practice-settings-change',()=>{({generatedSelected,drillSelected}=readSettings());if(loaded){if(hiddenTarget&&!standoutHidden(hiddenTarget)){const id=hiddenTarget;hiddenTarget=null;notice='';jump(id);}else{const y=host.scrollTop;render();host.scrollTop=y;}}});
    addEventListener('hazzard-option-order-change',()=>{if(loaded&&controller.active){const y=host.scrollTop;render();host.scrollTop=y;}});
    addEventListener('hazzard-standout-change',()=>{if(hiddenTarget&&!standoutHidden(hiddenTarget)&&loaded){const id=hiddenTarget;hiddenTarget=null;notice='';jump(id);}else{position=0;sync();}});
    addEventListener('hazzard-bad-change',()=>{if(loaded){hiddenTarget=null;render();}});
    addEventListener('hazzard-saved-change',()=>{if(loaded){const y=host.scrollTop;render();host.scrollTop=y;}});
    sync();addEventListener('storage',event=>{if(event.key===KEY||event.key===PAPER_KEY||event.key===FLAGS_KEY||event.key===GENERATED_FLAGS_KEY||event.key===SAVED_KEY||event.key===SYSTEM_KEY||event.key===HazzardReview.KEY||event.key===null)sync()});addEventListener('pageshow',event=>{if(event.persisted)sync()});
    return controller;
  }
  return {LOG_KEY,BAD_KEY,emptyLog,emptyBad,validLog,validBad,mergeLog,mergeBad,readBad,bad,rawValue,currentAnswers,logAction,appendLog,persistedAnswer,retired,sourceTitle,SETTINGS_KEY,PLACE_KEY,validSettings,settingsFromRaw,readSettings,mergeSettings,refreshSettings,readPracticePlace,rememberPractice,practiceURL,SAVED_KEY,emptySaved,validSaved,mergeSaved,readSaved,revisionButtons,revisionStatus,optionOrder,linkedOptions,explanationText,excluded,standoutHidden,standoutCount,EXCLUDED_NOTE,rich,stemHTML,membership,readStore,sourceLabel,KEY,PAPER_KEY,FLAGS_KEY,GENERATED_FLAGS_KEY,validGeneratedFlags,SYSTEM_KEY,VIEW_KEY,validView,mergeView,MIGRATION_KEY,loadAliases,migrateSaved,migrateValue,currentId,validSystem,mergeSystem,validStore,validPaper,validFlags,mergeStore,mergePaper,mergeFlags,readPaper,loadIndex,mount};
})();
