/* Review scheduling is independent of answer correctness and answer storage. */
window.HazzardReview = (() => {
  const KEY='hazzard-mcq-review-v1',STEPS=[1,3,7,21];
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const idOK=id=>/^mcq-[a-f0-9]{24}$/.test(id),stamp=n=>Number.isFinite(n)&&n>=0;
  const day=(at=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  const plus=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  const blank=()=>({active:false,unsure:false,step:0,due:null,at:0});
  const empty=()=>({version:1,items:{},seed:null,settings:{size:30,at:0},batch:null,batchAt:0});
  function valid(v){
    return record(v)&&v.version===1&&record(v.items)&&Object.entries(v.items).every(([id,r])=>idOK(id)&&record(r)&&typeof r.active==='boolean'&&typeof r.unsure==='boolean'&&Number.isInteger(r.step)&&r.step>=0&&r.step<4&&(r.active?dateOK(r.due):r.due===null)&&stamp(r.at))&&
      (v.seed===null||record(v.seed)&&stamp(v.seed.at)&&Number.isInteger(v.seed.count)&&v.seed.count>=0)&&record(v.settings)&&[10,30,50].includes(v.settings.size)&&stamp(v.settings.at)&&stamp(v.batchAt)&&
      (v.batch===null||record(v.batch)&&dateOK(v.batch.day)&&Array.isArray(v.batch.ids)&&v.batch.ids.length<=50&&new Set(v.batch.ids).size===v.batch.ids.length&&v.batch.ids.every(idOK)&&Number.isInteger(v.batch.position)&&v.batch.position>=0&&v.batch.position<=v.batch.ids.length&&HazzardMCQ.validStore({version:1,answers:v.batch.answers})&&Object.keys(v.batch.answers).every(id=>v.batch.ids.includes(id)));
  }
  function canonical(v){
    const items={};
    for(const [id,r] of Object.entries(v.items).sort(([a],[b])=>Number(a===HazzardMCQ.currentId(a))-Number(b===HazzardMCQ.currentId(b)))){
      const target=HazzardMCQ.currentId(id);if(!items[target]||r.at>=items[target].at)items[target]=r;
    }
    let batch=v.batch;
    if(batch){const answers={};for(const [id,a]of Object.entries(batch.answers)){const target=HazzardMCQ.currentId(id);if(!answers[target]||a.at>=answers[target].at)answers[target]=a;}const ids=[...new Set(batch.ids.map(HazzardMCQ.currentId))];batch={...batch,ids,answers,position:Math.min(batch.position,ids.length)};}
    return {...v,items,batch};
  }
  function read(){const v=HazzardStorage.readProtected(KEY,empty);if(!valid(v))throw Error('Unreadable review queue');return canonical(v);}
  function merge(a,b){a=canonical(a);b=canonical(b);const items={...b.items};for(const[id,r]of Object.entries(a.items))if(!items[id]||r.at>=items[id].at)items[id]=r;const newest=a.batchAt>=b.batchAt?a:b;return {version:1,items,seed:!a.seed?b.seed:!b.seed?a.seed:a.seed.at<=b.seed.at?a.seed:b.seed,settings:a.settings.at>=b.settings.at?a.settings:b.settings,batch:newest.batch,batchAt:newest.batchAt};}
  function write(v){if(!valid(v))throw Error('Review queue could not be saved');HazzardStorage.setItem(KEY,JSON.stringify(v));dispatchEvent(new Event('hazzard-review-change'));return v;}
  function due(v=read(),today=day(),includeHidden=false){return Object.entries(v.items).filter(([id,r])=>!HazzardMCQ.retired(id)&&!HazzardMCQ.bad(id)&&!HazzardMCQ.excluded(id)&&(includeHidden||!HazzardMCQ.standoutHidden(id))&&r.active&&r.due<=today).sort((a,b)=>a[1].due.localeCompare(b[1].due)||a[1].at-b[1].at||a[0].localeCompare(b[0])).map(([id])=>id);}
  function result(previous,{correct,unsure,review=false},now=Date.now()){
    const r={...(previous||blank()),unsure,at:Math.max(now,(previous?.at||0)+1)};
    if(!correct||unsure)return {...r,active:true,step:0,due:plus(day(now),1)};
    if(review&&r.active){if(r.step===3)return {...r,active:false,due:null};r.step++;r.due=plus(day(now),STEPS[r.step]);}
    return r;
  }
  function set(id,value,answer){const v=read();id=HazzardMCQ.currentId(id);v.items[id]={...(value||blank()),at:Math.max(Date.now(),(v.items[id]?.at||0)+1)};if(answer!==undefined&&v.batch?.ids.includes(id)){if(answer===null)delete v.batch.answers[id];else v.batch.answers[id]=answer;v.batchAt=Math.max(Date.now(),v.batchAt+1);}return write(v);}
  let seedPromise;
  function seed(){return seedPromise ||= (async()=>{
    await HazzardMCQ.loadAliases();if(HazzardStorage.blockedKeys().includes(KEY))return null;if(read().seed)return read().seed;
    const response=await fetch('data/mcq/all.json');if(!response.ok)throw Error('Review questions unavailable');const all=await response.json();
    const saved=HazzardMCQ.readStore(false);if(!HazzardMCQ.validStore(saved))throw Error('Unreadable MCQ answers');
    const answers={};for(const[id,a]of Object.entries(saved.answers)){const target=HazzardMCQ.currentId(id);if(!answers[target]||a.at>=answers[target].at)answers[target]=a;}
    const v=read();if(v.seed)return v.seed;let count=0;const now=Date.now(),today=day(now);
    for(const q of all){const a=answers[q.id];if(a?.checked&&!q.accepted.includes(a.selected)&&!v.items[q.id]){v.items[q.id]={active:true,unsure:false,step:0,due:plus(today,Math.floor(count/30)),at:now};count++;}}
    v.seed={count,at:now};write(v);return v.seed;
  })().finally(()=>{seedPromise=null;});}
  function batch(items){const v=read(),today=day(),available=new Set(items.map(q=>q.id));if(!v.batch||v.batch.day!==today){v.batch={day:today,ids:due(v,today,true).filter(id=>available.has(id)).slice(0,v.settings.size),answers:{},position:0};v.batchAt=Math.max(Date.now(),v.batchAt+1);write(v);}return v.batch;}
  function position(n){const v=read();if(v.batch&&v.batch.position!==n){v.batch.position=n;v.batchAt=Math.max(Date.now(),v.batchAt+1);write(v);}}
  function size(n,items){
    const v=read();v.settings={size:n,at:Math.max(Date.now(),v.settings.at+1)};
    if(v.batch){
      const current=v.batch.ids[v.batch.position],available=new Set(items.map(q=>q.id));
      const answered=v.batch.ids.filter(id=>v.batch.answers[id]?.checked);
      const candidates=[...new Set([...v.batch.ids,...due(v,day(),true)])].filter(id=>available.has(id)&&!answered.includes(id));
      // Completed answers are retained even when shrinking below today's count.
      const keep=new Set([...answered,...candidates.slice(0,Math.max(0,n-answered.length))]);
      v.batch.ids=[...new Set([...v.batch.ids,...candidates])].filter(id=>keep.has(id));
      v.batch.position=Math.max(0,v.batch.ids.indexOf(current));
      v.batchAt=Math.max(Date.now(),v.batchAt+1);
    }
    return write(v);
  }
  return {KEY,STEPS,day,plus,blank,valid,canonical,read,merge,write,due,result,set,seed,batch,position,size};
})();
