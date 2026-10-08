/* Statistics reads validated raw values only. It never recovers or seeds stores. */
window.HazzardStats=(()=>{
  const M=()=>HazzardMCQ;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active=false,filesPromise;
  async function json(path){const r=await fetch(path);if(!r.ok)throw Error('Question data unavailable');return r.json();}
  function files(){return filesPromise ||= Promise.all([json('data/mcq/all.json'),json('data/mcq/topics.json'),json('data/mcq/collections.json'),HazzardChanged.load(),M().loadAliases()]).then(([all,topics,collections,changes])=>({all,topics,collections,changes})).catch(e=>{filesPromise=null;throw e;});}
  function raw(key,valid,empty){try{return {ok:true,value:M().rawValue(key,valid,empty)};}catch{return {ok:false,value:null};}}
  function snapshot(){
    const m=M(),answers=raw(m.KEY,m.validStore,()=>({version:1,answers:{}})),review=raw(HazzardReview.KEY,HazzardReview.valid,()=>({version:1,items:{},seed:null,settings:{size:30,at:0},batch:null,batchAt:0})),bad=raw(m.BAD_KEY,m.validBad,m.emptyBad),log=raw(m.LOG_KEY,m.validLog,m.emptyLog),settings=raw(m.SETTINGS_KEY,m.validSettings,()=>({version:1,includeStandout:false,shufflePastOptions:true,generatedSelected:false,drillSelected:false,at:0})),simulation=raw(HazzardSimulation.KEY,HazzardSimulation.valid,()=>({version:1,at:0,session:null,history:{}})),paper=raw(m.PAPER_KEY,v=>v===null||m.validPaper(v),()=>null);
    if(answers.ok)answers.value=m.currentAnswers(answers.value.answers);
    if(review.ok)review.value=HazzardReview.canonical(review.value).items;
    if(bad.ok)bad.value=m.mergeBad(m.emptyBad(),bad.value).items;
    if(log.ok)log.value=m.mergeLog(m.emptyLog(),log.value).items;
    return {answers,review,bad,log,settings,simulation,paper};
  }
  function model(data,s=snapshot()){
    const changes=new Map();for(const c of data.changes){const id=M().currentId(c.id),at=Date.parse(c.changedAt);changes.set(id,Math.max(changes.get(id)||0,at));}
    const ready=s.answers.ok&&s.review.ok&&s.bad.ok&&s.settings.ok;
    const eligible=q=>!q.retired&&!M().retired(q.id)&&!s.bad.value?.[q.id]?.bad&&!(q.kind!=='past'&&!s.settings.value?.includeStandout&&M().standoutHidden(q.id));
    const all=[...new Map(data.all.map(q=>[M().currentId(q.id),{...q,id:M().currentId(q.id)}])).values()];
    const questions=all.filter(eligible).filter(q=>!changes.has(q.id)||(s.answers.value?.[q.id]?.checked===true&&Number.isInteger(s.answers.value[q.id].selected)&&s.answers.value[q.id].at>=changes.get(q.id)));
    const answered=q=>{const a=s.answers.value?.[q.id];return a?.checked===true&&Number.isInteger(a.selected);};
    const clean=q=>{const a=s.answers.value[q.id],r=s.review.value[q.id];return q.accepted.includes(a.selected)&&!r?.unsure&&(changes.has(q.id)||!r?.active&&!(r?.step>0));};
    const measure=list=>{const done=list.filter(answered),n=done.length,c=ready?done.filter(clean).length:0;return {total:list.length,answered:n,clean:c,rate:n?c/n:null};};
    return {s,all,questions,changes,ready,eligible,answered,clean,measure};
  }
  const rate=(r,min=5)=>r.answered>=min?Math.round(100*r.rate)+'%':'?';
  const bar=r=>r.rate===null?'':'<div class="stats-bar" aria-hidden="true"><span style="width:'+Math.round(100*r.rate)+'%"></span></div>';
  const count=(r,total=r.total)=>'answered '+r.answered+' of '+total+(r.answered>=5?', clean '+rate(r):'');
  const section=(id,title,html)=>'<section class="stats-section" id="stats-'+id+'"><h2>'+title+'</h2>'+html+'</section>';
  const date=at=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short',hour12:false}).format(at).replaceAll('/','.');
  function overview(m){if(!m.ready)return '<p>unavailable ? Answers, Review, Bad flags or Practice settings could not be read.</p>';const official=m.questions.filter(q=>q.kind==='past'),practice=m.measure(m.questions.filter(q=>q.kind!=='past')),n=m.measure(official).answered;
    const editions=[['2023?26 papers (Hazzard 8e)',q=>+q.t.slice(0,4)>=2023],['2020?22 papers (Hazzard 7e keys)',q=>+q.t.slice(0,4)<=2022]];
    return '<p class="stats-total">'+n+' / 800 official questions answered</p>'+editions.map(([label,test])=>{const r=m.measure(official.filter(test));return '<p>'+label+': '+(r.answered?Math.round(r.rate*100)+'% clean':'no answers yet')+' ('+r.answered+' answered)</p>'+bar(r);}).join('')+'<p>'+m.questions.filter(q=>m.s.review.value[q.id]?.unsure).length+' currently marked Unsure</p><p>'+m.questions.filter(q=>m.answered(q)&&m.s.answers.value[q.id].at>=Date.now()-7*86400000).length+' answered in the last 7 days</p><p class="meta">Practice questions (generated keys are about 1 in 10 wrong): '+practice.answered+' answered'+(practice.answered?', '+Math.round(100*practice.rate)+'% clean':'')+'</p>';
  }
  function topicRows(data,m){if(!m.ready)return '<p>unavailable</p>';const official=m.questions.filter(q=>q.kind==='past'),rows=[];
    for(const[id,name]of Object.entries(data.topics)){const list=official.filter(q=>M().membership(q).map(String).includes(id));if(list.length)rows.push({id,name,...m.measure(list)});}
    for(const[id,name,key]of [['law','Israeli law & ethics','israeliLawEthics'],['articles','Required articles','suppliedArticles']]){const ids=new Set((data.collections[key]?.ids||[]).map(M().currentId));rows.push({id,name,collection:true,...m.measure(official.filter(q=>ids.has(q.id)))});}
    for(const r of rows){r.frequency=r.total/8;r.risk=r.answered>=5?r.frequency*(1-r.rate):null;}
    const ranked=rows.filter(r=>r.answered>=5).sort((a,b)=>b.risk-a.risk||a.name.localeCompare(b.name)),untested=rows.filter(r=>r.answered<5).sort((a,b)=>b.frequency-a.frequency||a.name.localeCompare(b.name));
    const html=r=>'<article class="stats-topic" data-stats-topic="'+r.id+'"><h3>'+esc(r.name)+'</h3><p>'+r.answered+' / '+r.total+' answered ? '+(r.answered>=5?rate(r)+' clean':'not yet tested')+'</p><p class="meta">'+r.frequency.toFixed(1)+' questions per sitting ? Points at risk: '+(r.risk===null?'?':r.risk.toFixed(1))+'</p>'+(r.answered>=5?bar(r):'')+'<div class="stats-actions"><a href="?chapter=bank&amp;statsFilter='+r.id+'">Practice this '+(r.collection?'set':'topic')+'</a>'+(r.collection?'':'<button data-revision="topics" data-revision-ids="'+r.id+'">Save topic</button>')+'</div></article>';
    const strongest=[...ranked.filter(r=>!r.collection)].sort((a,b)=>b.rate-a.rate||b.answered-a.answered).slice(0,Math.ceil(ranked.filter(r=>!r.collection).length/3));
    return ranked.map(html).join('')+'<details><summary>Strongest topics ('+strongest.length+')</summary>'+strongest.map(html).join('')+'</details><h3>Not yet tested</h3>'+untested.map(html).join('');
  }
  function sittings(m){if(!m.ready)return '<p>unavailable</p>';return [...new Set(m.all.filter(q=>q.kind==='past').map(q=>q.t))].sort().reverse().map(t=>{const r=m.measure(m.questions.filter(q=>q.kind==='past'&&q.t===t));return '<article><h3>'+esc(HazzardEvidence.sittingLabel(t))+'</h3><p>'+count(r,100)+'</p>'+(r.answered>=5?bar(r):'')+'</article>';}).join('');}
  function simulations(m){const rows=[],s=m.s;let warning='';if(s.simulation.ok)for(const r of Object.values(s.simulation.value.history))rows.push({at:r.at,label:'Simulation ? '+HazzardEvidence.sittingLabel(r.sitting),correct:r.correct,total:r.total});else warning+='<p>Simulations unavailable</p>';
    if(!s.paper.ok)warning+='<p>Current mock unavailable</p>';else if(s.paper.value?.paper?.finished){const p=s.paper.value.paper,byId=new Map(m.all.map(q=>[q.id,q])),list=p.ids.map(id=>({q:byId.get(M().currentId(id)),a:p.answers[id]}));rows.push({at:s.paper.value.at,label:'Current mock ? last saved',correct:list.filter(({q,a})=>q&&a?.checked&&q.accepted.includes(a.selected)).length,total:p.ids.length});}
    return warning+(rows.length?rows.sort((a,b)=>b.at-a.at).map(r=>'<p>'+esc(r.label)+' ? '+date(r.at)+'<br><strong>'+r.correct+' / '+r.total+'</strong> ? includes questions seen before</p>').join(''):'<p>No retained completed simulations or mock.</p>')+'<p class="meta">Only the current mock is retained. Starting another mock or retrying replaces it. Choosing Review answers temporarily removes it from this completed-only list until it is finished again.</p>';
  }
  const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  function week(at){const d=day(at),n=Date.parse(d+'T12:00:00Z');return new Date(n-new Date(n).getUTCDay()*86400000).toISOString().slice(0,10);}
  function weekly(m){if(!m.s.log.ok||!m.s.bad.ok||!m.s.settings.ok||!m.s.answers.ok)return '<p>unavailable</p>';const eligible=new Map(m.questions.map(q=>[q.id,q])),events=[];for(const[id,entries]of Object.entries(m.s.log.value))if(eligible.has(id))for(const e of entries)if(!e[5]&&(!m.changes.has(id)||(e[0]+1)*60000>m.changes.get(id)))events.push({id,e});
    const start=Date.parse(week(Date.now())+'T12:00:00Z')-11*7*86400000,first=events.length?events.map(({e})=>week(e[0]*60000)).sort()[0]:null;
    return '<p class="meta">The weekly record starts with this release; answers given before it are not included.</p>'+Array.from({length:12},(_,i)=>{const w=new Date(start+i*7*86400000).toISOString().slice(0,10),end=new Date(start+(i*7+6)*86400000).toISOString().slice(0,10),entries=events.filter(({e})=>week(e[0]*60000)===w),answers=entries.filter(({e})=>e[4]==='answer'),tries=answers.filter(({id,e})=>e[2]===1&&eligible.get(id).kind==='past'),unsure=new Set(entries.filter(({e})=>e[1]==='u').map(({id})=>id)),clean=tries.filter(({id,e})=>e[1]==='c'&&!unsure.has(id)).length,r={rate:tries.length?clean/tries.length:null};return '<article data-stats-week="'+w+'"><h3>'+w.split('-').reverse().join('.')+' ? '+end.split('-').reverse().join('.')+'</h3><p>'+new Set(answers.map(x=>x.id)).size+' questions answered ? '+tries.length+' official first tries'+(tries.length>=10?' ? '+Math.round(100*r.rate)+'% first-try clean':'')+'</p>'+(tries.length>=10?bar(r):'')+(!first||w<first?'<small>Weekly record not yet started.</small>':'')+'</article>';}).join('');
  }
  async function open(viewport){active=true;let host=document.getElementById('statsViewport');if(!host){host=document.createElement('section');host.id='statsViewport';host.setAttribute('aria-label','Statistics');viewport.append(host);}host.hidden=false;host.innerHTML='<div class="mcq-page"><h1>Statistics</h1><p>Loading?</p></div>';
    try{const data=await files(),m=model(data);host.innerHTML='<div class="mcq-page stats-page"><h1>Statistics</h1><nav class="stats-actions">'+[['overview','Overview'],['topics','Topics'],['sittings','Exam sittings'],['simulations','Simulations and mocks'],['weekly','Week by week']].map(([id,label])=>'<button data-stats-section="'+id+'">'+label+'</button>').join('')+'</nav>'+section('overview','Overview',overview(m)+'<p class="meta">A miss stays counted after you redo it correctly. Misses corrected before the Review queue began may be missing, and a corrected question counts from your first answer after the correction.</p>')+section('topics','Topics',topicRows(data,m))+section('sittings','Exam sittings',sittings(m))+section('simulations','Simulations and mocks',simulations(m))+section('weekly','Week by week',weekly(m))+'</div>';host.onclick=e=>{const b=e.target.closest('[data-stats-section]');if(b)host.querySelector('#stats-'+b.dataset.statsSection).scrollIntoView({block:'start'});};}catch{host.innerHTML='<div class="mcq-page"><h1>Statistics</h1><p>Question data unavailable</p>'+['Overview','Topics','Exam sittings','Simulations and mocks','Week by week'].map(t=>'<h2>'+t+'</h2><p>unavailable</p>').join('')+'</div>';}
  }
  async function chapter(chapter,evidence){try{const data=await files(),m=model(data);if(!m.ready)return 'record unavailable';const ids=new Set(HazzardEvidence.studyIds(evidence,String(chapter)).map(M().currentId));return count(m.measure(m.questions.filter(q=>q.kind==='past'&&ids.has(q.id))));}catch{return 'record unavailable';}}
  addEventListener('hazzard-saved-change',()=>{const host=document.getElementById('statsViewport');if(!active||!host)return;try{const saved=M().readSaved();for(const b of host.querySelectorAll('[data-revision="topics"]')){const on=!!saved.topics[b.dataset.revisionIds]?.saved;b.textContent=on?'Topic saved':'Save topic';b.setAttribute('aria-pressed',String(on));}}catch{}});
  return {get active(){return active;},open,chapter,files,snapshot,model,week};
})();
