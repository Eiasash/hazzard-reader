/* Statistics reads validated raw values only. It never recovers or seeds stores. */
window.HazzardStats=(()=>{
  const M=()=>HazzardMCQ;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active=false,filesPromise;
  async function json(path){const r=await fetch(path);if(!r.ok)throw Error('Question data unavailable');return r.json();}
  function files(){return filesPromise ||= Promise.all([json('data/mcq/all.json'),json('data/mcq/topics.json'),json('data/mcq/collections.json'),HazzardChanged.load(),M().loadAliases()]).then(([all,topics,collections,changes])=>({all,topics,collections,changes})).catch(e=>{filesPromise=null;throw e;});}
  function raw(key,valid,empty){try{return {ok:true,value:M().rawValue(key,valid,empty)};}catch{return {ok:false,value:null};}}
  function snapshot(){
    const m=M(),answers=raw(m.KEY,m.validStore,()=>({version:1,answers:{}})),review=raw(HazzardReview.KEY,HazzardReview.valid,()=>({version:1,items:{},seed:null,settings:{size:30,at:0},batch:null,batchAt:0})),bad=raw(m.BAD_KEY,m.validBad,m.emptyBad),log=raw(m.LOG_KEY,m.validLog,m.emptyLog),settings=raw(m.SETTINGS_KEY,m.validSettings,()=>({version:1,includeStandout:false,shufflePastOptions:true,generatedSelected:true,drillSelected:true,at:0})),simulation=raw(HazzardSimulation.KEY,HazzardSimulation.valid,()=>({version:1,at:0,session:null,history:{}})),paper=raw(m.PAPER_KEY,v=>v===null||m.validPaper(v),()=>null);
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
    const questions=all.filter(eligible).filter(q=>{const a=s.answers.value?.[q.id];return !changes.has(q.id)||a?.checked!==true||!Number.isInteger(a.selected)||a.at>=changes.get(q.id);});
    const answered=q=>{const a=s.answers.value?.[q.id];return a?.checked===true&&Number.isInteger(a.selected);};
    const clean=q=>{const a=s.answers.value[q.id],r=s.review.value[q.id];return q.accepted.includes(a.selected)&&!r?.unsure&&(changes.has(q.id)||!r?.active&&!(r?.step>0));};
    const measure=list=>{const done=list.filter(answered),n=done.length,c=ready?done.filter(clean).length:0;return {total:list.length,answered:n,clean:c,rate:n?c/n:null};};
    return {s,all,questions,changes,ready,eligible,answered,clean,measure};
  }
  const rate=(r,min=5)=>r.answered>=min?Math.round(100*r.rate)+'%':'\u2014';
  const bar=r=>r.rate===null?'':'<div class="stats-bar" aria-hidden="true"><span style="width:'+Math.round(100*r.rate)+'%"></span></div>';
  const count=(r,total=r.total)=>'answered '+r.answered+' of '+total+(r.answered>=5?', clean '+rate(r):'');
  const section=(id,title,html)=>'<section class="stats-section" id="stats-'+id+'"><h2>'+title+'</h2>'+html+'</section>';
  const date=at=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short',hour12:false}).format(at).replaceAll('/','.');
  const disclosure=(id,title,html)=>'<details class="stats-section stats-disclosure" id="stats-'+id+'"><summary>'+title+'</summary>'+html+'</details>';
  const pill=r=>'<span class="stats-pill '+(r.rate===null?'':r.rate<.6?'stats-red':r.rate<.8?'stats-amber':'stats-green')+'">'+(r.rate===null?'No answers':Math.round(1000*r.rate)/10+'% clean')+'</span>';
  function donut(value,total,label,legend,small=false){
    const percent=total?Math.round(100*value/total):0;
    return '<figure class="stats-donut'+(small?' stats-donut-small':'')+'"><svg viewBox="0 0 100 100" role="img" aria-label="'+esc(label+': '+value+' of '+total+'; '+(legend||(total-value)+' not yet answered'))+'"><circle class="stats-ring" cx="50" cy="50" r="40"/><circle class="stats-arc" cx="50" cy="50" r="40" pathLength="100" stroke-dasharray="'+percent+' 100" transform="rotate(-90 50 50)"/><text x="50" y="51" text-anchor="middle" dominant-baseline="middle">'+(total?percent+'%':'\u2014')+'</text></svg>'+(small?'':'<figcaption><strong>'+esc(label)+'</strong><span>'+esc(legend)+'</span></figcaption>')+'</figure>';
  }
  function overview(m){if(!m.ready)return '<p>unavailable - Answers, Review, Bad flags or Practice settings could not be read.</p>';const official=m.questions.filter(q=>q.kind==='past'),practice=m.measure(m.questions.filter(q=>q.kind!=='past'&&!M().excluded(q.id))),r=m.measure(official);
    const editions=[['8e',q=>+q.t.slice(0,4)>=2023],['7e',q=>+q.t.slice(0,4)<=2022]];
    return '<div class="stats-donuts">'+donut(r.answered,800,'Official progress',r.answered+' answered \u00b7 '+(800-r.answered)+' left')+donut(r.clean,r.answered,'Official accuracy',r.clean+' clean \u00b7 '+(r.answered-r.clean)+' missed')+'</div><p class="meta stats-split">'+editions.map(([label,test])=>{const e=m.measure(official.filter(test));return label+': '+e.answered+' answered'+(e.answered?', '+Math.round(e.rate*100)+'%':'');}).join(' \u00b7 ')+'</p><p class="meta">Practice: '+practice.answered+' answered'+(practice.answered?', '+Math.round(100*practice.rate)+'% clean':'')+'</p><p class="meta">'+m.questions.filter(q=>m.s.review.value[q.id]?.unsure).length+' Unsure \u00b7 '+m.questions.filter(q=>m.answered(q)&&m.s.answers.value[q.id].at>=Date.now()-7*86400000).length+' answered in the last 7 days</p>';
  }
  function topicRows(data,m){if(!m.ready)return {weak:'<p>unavailable</p>',untested:'<p>unavailable</p>',all:'<p>unavailable</p>'};const official=m.questions.filter(q=>q.kind==='past'),rows=[];
    for(const[id,name]of Object.entries(data.topics)){const list=official.filter(q=>M().membership(q).map(String).includes(id));if(list.length)rows.push({id,name,...m.measure(list)});}
    for(const[id,name,key]of [['law','Israeli law & ethics','israeliLawEthics'],['articles','Required articles','suppliedArticles']]){const ids=new Set((data.collections[key]?.ids||[]).map(M().currentId));rows.push({id,name,collection:true,...m.measure(official.filter(q=>ids.has(q.id)))});}
    for(const r of rows){
      r.frequency=r.total/8;r.risk=null;
      if(r.answered>=5){const n=r.answered,p=r.clean/n,z=1.96,z2=z*z,lower=(p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/(1+z2/n);r.risk=r.frequency*(1-lower);}
    }
    const ranked=rows.filter(r=>r.answered>=5).sort((a,b)=>b.risk-a.risk||a.name.localeCompare(b.name)),untested=rows.filter(r=>r.answered<5).sort((a,b)=>b.frequency-a.frequency||a.name.localeCompare(b.name));
    const link=(r,label)=>'<a href="?chapter=bank&amp;statsFilter='+r.id+'">'+label+'</a>';
    const html=(r,kind)=>'<article class="stats-topic stats-compact" data-stats-topic="'+r.id+'"><div class="stats-row-heading"><h3 dir="auto">'+esc(r.name)+'</h3>'+pill(r)+'</div><p class="meta">'+(kind==='weak'?'about '+r.risk.toFixed(1)+' questions lost per exam':r.answered+' / '+r.total+' answered'+(kind==='new'?' \u00b7 '+r.frequency.toFixed(1)+' per exam':''))+'</p><div class="stats-actions">'+link(r,kind==='weak'?'Practice this topic':'Practice')+(kind==='all'&&!r.collection?'<button data-revision="topics" data-revision-ids="'+r.id+'">Save topic</button>':'')+'</div></article>';
    const weak=ranked.filter(r=>r.rate<.8).slice(0,5),unlock=untested.reduce((n,r)=>n+5-r.answered,0);
    return {weak:weak.map(r=>html(r,'weak')).join('')+(weak.length<5?'<p class="meta">'+(untested.length?unlock+' more answers across '+untested.length+' topics unlock the rest.':'All topics have enough answers; '+(weak.length?'the rest are':'all are')+' at least 80% clean.')+'</p>':''),untested:untested.slice(0,5).map(r=>html(r,'new')).join('')||'<p>Every topic has at least 5 answers.</p>',all:[...ranked,...untested].map(r=>html(r,'all')).join('')};
  }
  function sittings(m){if(!m.ready)return '<p>unavailable</p>';return [...new Set(m.all.filter(q=>q.kind==='past').map(q=>q.t))].sort().reverse().map(t=>{const r=m.measure(m.questions.filter(q=>q.kind==='past'&&q.t===t));return '<article class="stats-sitting">'+donut(r.answered,100,HazzardEvidence.sittingLabel(t)+' answered','',true)+'<div><h3>'+esc(HazzardEvidence.sittingLabel(t))+'</h3><p class="meta">'+r.answered+' / 100 answered</p>'+pill(r)+'</div></article>';}).join('');}
  function simulations(m){const rows=[],s=m.s;let warning='';if(s.simulation.ok)for(const r of Object.values(s.simulation.value.history))rows.push({at:r.at,label:'Simulation \u00b7 '+HazzardEvidence.sittingLabel(r.sitting),correct:r.correct,total:r.total});else warning+='<p>Simulations unavailable</p>';
    if(!s.paper.ok)warning+='<p>Current mock unavailable</p>';else if(s.paper.value?.paper?.finished){const p=s.paper.value.paper,byId=new Map(m.all.map(q=>[q.id,q])),list=p.ids.map(id=>({q:byId.get(M().currentId(id)),a:p.answers[id]}));rows.push({at:s.paper.value.at,label:'Current mock \u00b7 last saved',correct:list.filter(({q,a})=>q&&a?.checked&&q.accepted.includes(a.selected)).length,total:p.ids.length});}
    return warning+(rows.length?rows.sort((a,b)=>b.at-a.at).map(r=>'<p>'+esc(r.label)+' \u00b7 '+date(r.at)+'<br><strong>'+r.correct+' / '+r.total+'</strong> \u00b7 includes questions seen before</p>').join(''):'<p>No retained completed simulations or mock.</p>')+'<p class="meta">Only the current mock is retained. Starting another mock or retrying replaces it. Choosing Review answers temporarily removes it from this completed-only list until it is finished again.</p>';
  }
  const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  function week(at){const d=day(at),n=Date.parse(d+'T12:00:00Z');return new Date(n-new Date(n).getUTCDay()*86400000).toISOString().slice(0,10);}
  function weekly(m){if(!m.s.log.ok||!m.s.bad.ok||!m.s.settings.ok||!m.s.answers.ok)return '<p>unavailable</p>';const eligible=new Map(m.questions.map(q=>[q.id,q])),events=[];for(const[id,entries]of Object.entries(m.s.log.value))if(eligible.has(id))for(const e of entries)if(!e[5]&&(!m.changes.has(id)||(e[0]+1)*60000>m.changes.get(id)))events.push({id,e});
    const current=week(Date.now()),start=Date.parse(current+'T12:00:00Z')-11*7*86400000;
    return '<p class="meta">The weekly record starts with this release; answers given before it are not included.</p>'+Array.from({length:12},(_,i)=>{const w=new Date(start+i*7*86400000).toISOString().slice(0,10),end=new Date(start+(i*7+6)*86400000).toISOString().slice(0,10),entries=events.filter(({e})=>week(e[0]*60000)===w),answers=entries.filter(({e})=>e[4]==='answer'),tries=answers.filter(({id,e})=>e[2]===1&&eligible.get(id).kind==='past'),unsure=new Set(entries.filter(({e})=>e[1]==='u').map(({id})=>id)),clean=tries.filter(({id,e})=>e[1]==='c'&&!unsure.has(id)).length,r={rate:tries.length?clean/tries.length:null};if(!answers.length&&w!==current)return '';return '<article data-stats-week="'+w+'"><h3>'+w.split('-').reverse().join('.')+' \u00b7 '+end.split('-').reverse().join('.')+'</h3><p>'+new Set(answers.map(x=>x.id)).size+' questions answered \u00b7 '+tries.length+' official first tries'+(tries.length>=10?' \u00b7 '+Math.round(100*r.rate)+'% first-try clean':'')+'</p>'+(tries.length>=10?bar(r):'')+'</article>';}).join('');
  }
  async function open(viewport){active=true;let host=document.getElementById('statsViewport');if(!host){host=document.createElement('section');host.id='statsViewport';host.setAttribute('aria-label','Statistics');viewport.append(host);}host.hidden=false;host.innerHTML='<div class="mcq-page"><h1>Statistics</h1><p>Loading\u2026</p></div>';
    try{const data=await files(),m=model(data),topics=topicRows(data,m);host.innerHTML='<div class="mcq-page stats-page"><h1>Statistics</h1>'+section('overview',"How you're doing",overview(m))+section('weak','Weak spots',topics.weak)+section('new','Not started yet',topics.untested)+section('sittings','Exam sittings',sittings(m))+disclosure('topics','All topics',topics.all)+disclosure('simulations','Simulations and mocks',simulations(m))+disclosure('weekly','Week by week',weekly(m))+disclosure('counting','How this is counted','<p class="meta">A miss stays counted after you redo it correctly. Misses corrected before the Review queue began may be missing, and a corrected question counts from your first answer after the correction.</p><p class="meta">Weak spots have at least 5 answers and less than 80% clean. They are ranked by average questions per exam \u00d7 a cautious miss rate, using the same risk estimate as before. Topics and collections can overlap.</p>')+'</div>';host.onclick=null;}catch{host.innerHTML='<div class="mcq-page"><h1>Statistics</h1><p>Question data unavailable</p>'+['Overview','Topics','Exam sittings','Simulations and mocks','Week by week'].map(t=>'<h2>'+t+'</h2><p>unavailable</p>').join('')+'</div>';}
  }
  async function chapter(chapter,evidence){try{const data=await files(),m=model(data);if(!m.ready)return 'record unavailable';const ids=new Set(HazzardEvidence.studyIds(evidence,String(chapter)).map(M().currentId));return count(m.measure(m.questions.filter(q=>q.kind==='past'&&ids.has(q.id))));}catch{return 'record unavailable';}}
  addEventListener('hazzard-saved-change',()=>{const host=document.getElementById('statsViewport');if(!active||!host)return;try{const saved=M().readSaved();for(const b of host.querySelectorAll('[data-revision="topics"]')){const on=!!saved.topics[b.dataset.revisionIds]?.saved;b.textContent=on?'Topic saved':'Save topic';b.setAttribute('aria-pressed',String(on));}}catch{}});
  return {get active(){return active;},open,chapter,files,snapshot,model,week};
})();
