/* A sitting is a frozen, ordered attempt. Normal answers change only on submit. */
window.HazzardSimulation = (() => {
  const KEY='hazzard-exam-simulation-v1';
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const stamp=n=>Number.isFinite(n)&&n>=0;
  const idOK=id=>/^mcq-[a-f0-9]{24}$/.test(id);
  const sittingOK=s=>/^(2020|2021-Dec|2022-Jun|2023-Jun|2024-May|2024-Sep|2025-Jun|2026-Jun)-Subspec$/.test(s);
  const runOK=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id);
  const empty=()=>({version:1,at:0,session:null,history:{}});
  const scored=q=>q.mockEligible!==false&&!q.o.every((_,i)=>q.accepted.includes(i));
  const label=s=>s.replace('-Subspec','').replace('-', ' ')+' · Subspecialty';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const elapsed=ms=>{const n=Math.ceil(ms/1000);return Math.floor(n/3600)+':'+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  const date=at=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(at).replaceAll('/','.');
  function validResult(r){return record(r)&&sittingOK(r.sitting)&&stamp(r.at)&&Number.isInteger(r.correct)&&Number.isInteger(r.total)&&r.total>0&&r.total<=100&&r.correct>=0&&r.correct<=r.total&&stamp(r.timeMs)&&typeof r.automatic==='boolean';}
  function valid(v){
    if(!record(v)||v.version!==1||!stamp(v.at)||!record(v.history)||!Object.entries(v.history).every(([id,r])=>runOK(id)&&validResult(r)))return false;
    const s=v.session;if(s===null)return true;
    if(!record(s)||!runOK(s.id)||!sittingOK(s.sitting)||!['running','submitting','submitted'].includes(s.status)||!stamp(s.at)||!stamp(s.startedAt)||!stamp(s.deadline)||s.deadline<=s.startedAt||s.deadline-s.startedAt>86400000||!Number.isInteger(s.position)||s.position<0||s.position>=100||!Array.isArray(s.ids)||s.ids.length!==100||new Set(s.ids).size!==100||!s.ids.every(idOK)||!record(s.answers)||!Object.entries(s.answers).every(([id,n])=>s.ids.includes(id)&&Number.isInteger(n)&&n>=0&&n<=4)||!Array.isArray(s.flags)||new Set(s.flags).size!==s.flags.length||!s.flags.every(id=>s.ids.includes(id)))return false;
    if(s.status==='running')return s.commit===null;
    return validResult(v.history[s.id])&&record(s.commit)&&HazzardMCQ.validStore({version:1,answers:s.commit.answers})&&Object.keys(s.commit.answers).length===100&&Object.keys(s.commit.answers).every(id=>s.ids.includes(id))&&HazzardReview.valid(s.commit.review);
  }
  function read(){const v=HazzardStorage.readProtected(KEY,empty);if(!valid(v))throw Error('Saved exam simulation is unreadable. Existing data has been kept.');return v;}
  function merge(a,b){
    if(!a)return b;
    const history={...b.history};for(const[id,r]of Object.entries(a.history))if(!history[id]||r.at>=history[id].at)history[id]=r;
    let session=(a.at>=b.at?a:b).session;
    if(a.session&&b.session&&a.session.id===b.session.id){const rank={running:0,submitting:1,submitted:2};session=rank[a.session.status]===rank[b.session.status]?(a.session.at>=b.session.at?a.session:b.session):rank[a.session.status]>rank[b.session.status]?a.session:b.session;}
    return {version:1,at:Math.max(a.at,b.at),session,history};
  }
  function write(v){if(!valid(v))throw Error('Exam simulation could not be saved.');HazzardStorage.setItem(KEY,JSON.stringify(v));dispatchEvent(new Event('hazzard-simulation-change'));return v;}
  let bankPromise,checking=false,backgroundError='';
  function bank(){return bankPromise ||= fetch('data/mcq/all.json').then(r=>{if(!r.ok)throw Error('Exam questions unavailable. Reconnect and try again.');return r.json();}).catch(e=>{bankPromise=null;throw e;});}
  function questions(s,all){const byId=new Map(all.map(q=>[q.id,q]));const list=s.ids.map(id=>byId.get(HazzardMCQ.currentId(id)));if(list.some((q,i)=>!q||q.t!==s.sitting||q.examNumber!==i+1))throw Error('This sitting is incomplete. The saved attempt has been kept.');return list;}
  function finish(v){
    const s=v.session;if(s?.status!=='submitting')return v;
    // The journal is durable before either legacy store changes. Timestamp merges
    // make replay safe after a failed write, reload, restore or another tab.
    const incoming=HazzardMCQ.migrateValue(HazzardMCQ.KEY,{version:1,answers:s.commit.answers});
    HazzardStorage.setItem(HazzardMCQ.KEY,JSON.stringify(HazzardMCQ.mergeStore(HazzardMCQ.readStore(false),incoming)));
    HazzardReview.write(HazzardReview.merge(HazzardReview.read(),s.commit.review));
    s.status='submitted';s.at=Math.max(Date.now(),s.at+1);v.at=s.at;return write(v);
  }
  async function submit(automatic=false){
    const all=await bank();let v=read(),s=v.session;if(!s)return v;
    if(s.status!=='running')return finish(v);
    const list=questions(s,all),now=Date.now(),ended=Math.min(now,s.deadline),normal=HazzardMCQ.readStore(),review=HazzardReview.read(),answerUpdates={};
    // Store only changed review records; preserve the user's daily batch/settings.
    const reviewUpdates={...review,items:{}};
    let correct=0,total=0;
    list.forEach((q,i)=>{
      const id=s.ids[i],selected=s.answers[id]??null,at=Math.max(ended,(normal.answers[q.id]?.at||0)+1,(review.items[q.id]?.at||0)+1);
      answerUpdates[id]={selected,checked:selected!==null,at};
      if(!scored(q))return;
      total++;const right=selected!==null&&q.accepted.includes(selected);if(right)correct++;
      const previous=review.items[q.id];
      if(!right||previous)reviewUpdates.items[q.id]=HazzardReview.result(previous,{correct:right,unsure:previous?.unsure||false},at);
    });
    const result={sitting:s.sitting,at:ended,correct,total,timeMs:Math.max(0,ended-s.startedAt),automatic:automatic||now>=s.deadline};
    s.status='submitting';s.commit={answers:answerUpdates,review:reviewUpdates};s.at=Math.max(now,s.at+1);v.at=s.at;v.history[s.id]=result;
    write(v);return finish(v);
  }
  async function check(){
    if(checking)return;checking=true;
    try{const s=read().session;if(s?.status==='submitting'||s?.status==='running'&&Date.now()>=s.deadline)await submit(true);backgroundError='';}
    catch(e){backgroundError=e.message;dispatchEvent(new Event('hazzard-simulation-error'));}
    finally{checking=false;}
  }
  function startClock(){check();setInterval(check,1000);addEventListener('pageshow',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});addEventListener('storage',e=>{if(e.key===KEY||e.key===null)check();});}
  function mount({viewport,readerScroll,onShow,openImage}){
    const host=document.createElement('section');host.id='mcqViewport';host.hidden=true;host.setAttribute('aria-label','Exam simulation');viewport.append(host);
    let all=[],loaded=false,busy=false,error='',setup=false,reviewing=!!history.state?.hazzardSimulationSearch,gridOpen=false,confirmSubmit=false,selectedSitting='',duration='240',custom='240';
    const controller={active:false,search(){search.open();},get hasUnsaved(){try{return read().session?.status==='submitting';}catch{return true;}},save(){check();},remember(){},sync(){if(loaded)render();},show(){controller.active=true;host.hidden=false;readerScroll.style.visibility='hidden';readerScroll.inert=true;onShow();if(!loaded)load();else render();}};
    async function load(){host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page">Loading exam simulation…</div>';try{await HazzardMCQ.loadAliases();all=await bank();loaded=true;await check();render();search.restore();}catch(e){error=e.message;host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page"><p role="alert">'+esc(error)+'</p><button data-sim="load">Try again</button></div>';}}
    const search=HazzardQuestionSearch.mount({allowAll:false,
      getItems:async()=>{const s=read().session;if(!loaded||!s)throw Error('Start or resume a simulation to search its paper.');const byId=new Map(all.map(q=>[q.id,q]));return s.ids.map(id=>byId.get(id)).filter(Boolean).map(q=>({id:q.id,label:label(s.sitting)+' · Q'+q.examNumber,stem:q.q,text:[q.q,...q.o].join(' ')}));},
      openQuestion:(id,leave)=>{const s=read().session,index=s?.ids.indexOf(id);if(index===undefined||index<0)return;edit(v=>{v.position=index;},true);setup=false;reviewing=s.status==='submitted';gridOpen=false;leave();history.replaceState({...history.state,hazzardSimulationSearch:true},'');render();host.scrollTop=0;}
    });
    function sittings(){const answers=HazzardMCQ.readStore().answers;return [...new Set(all.filter(q=>q.kind==='past'&&sittingOK(q.t)).map(q=>q.t))].map(sitting=>({sitting,count:all.filter(q=>q.t===sitting&&answers[q.id]?.checked).length})).sort((a,b)=>a.count-b.count||b.sitting.localeCompare(a.sitting));}
    function historyHTML(v){const entries=Object.entries(v.history).sort((a,b)=>b[1].at-a[1].at);return entries.length?'<details class="sim-history"><summary>Result history ('+entries.length+')</summary><ul>'+entries.map(([,r])=>'<li><strong>'+esc(label(r.sitting))+'</strong><br>'+esc(date(r.at))+' · '+r.correct+'/'+r.total+' · '+elapsed(r.timeMs)+'</li>').join('')+'</ul></details>':'';}
    function setupHTML(v){
      const choices=sittings();if(!choices.some(s=>s.sitting===selectedSitting))selectedSitting=choices[0]?.sitting||'';
      return '<h1>Exam simulation</h1><p>One official sitting · all 100 questions in order. Answers stay private to this attempt until you submit.</p>'+(v.session?'<button data-sim="resume">'+(v.session.status==='running'?'Resume current simulation':'View latest result')+'</button>':'')+
        '<form data-sim-start><fieldset><legend>Choose one sitting</legend>'+choices.map((s,i)=>'<label class="sim-sitting"><input type="radio" name="sitting" value="'+s.sitting+'" '+(s.sitting===selectedSitting?'checked':'')+'><span>'+esc(label(s.sitting))+'<small>'+s.count+' / 100 already answered'+(i===0?' · Suggested: least answered':'')+'</small></span></label>').join('')+'</fieldset>'+
        '<label class="sim-duration">official: 4 hours (IMA exam format page)<select name="duration"><option value="240" '+(duration==='240'?'selected':'')+'>4:00</option><option value="120" '+(duration==='120'?'selected':'')+'>2:00</option><option value="150" '+(duration==='150'?'selected':'')+'>2:30</option><option value="180" '+(duration==='180'?'selected':'')+'>3:00</option><option value="custom" '+(duration==='custom'?'selected':'')+'>Custom</option></select></label><label class="sim-custom" '+(duration!=='custom'?'hidden':'')+'>Custom duration (minutes)<input name="custom" type="number" min="1" max="1440" step="1" value="'+esc(custom)+'" '+(duration==='custom'?'required':'disabled')+'></label><p class="meta">The timer continues when you leave or close the app. At zero, the attempt is submitted; if the app is closed, submission is processed on reopening. Warning at 5 minutes remaining.</p><button type="submit" class="primary" '+(v.session&&v.session.status!=='submitted'?'disabled':'')+'>Start simulation</button>'+(v.session&&v.session.status!=='submitted'?'<p>Submit the current attempt before starting another.</p>':'')+'</form>'+historyHTML(v);
    }
    function resultHTML(v){const r=v.history[v.session.id];return '<h1>Simulation submitted</h1><p>'+esc(label(r.sitting))+'</p><p class="mcq-score-value">'+r.correct+' / '+r.total+'</p><p>'+Math.round(r.correct/r.total*100)+'% · scored questions only</p><p>Time used: '+elapsed(r.timeMs)+(r.automatic?' · Time expired; auto-submitted':'')+'</p><p>Wrong and unanswered scored questions are in your review queue.</p><button data-sim="review">Review all 100 questions</button> <button data-sim="setup">Choose another sitting</button>'+historyHTML(v);}
    function render(){
      if(!loaded)return;
      try{
        const v=read(),s=v.session;let html='';
        if(!s||setup)html=setupHTML(v);
        else if(s.status==='submitting')html='<h1>Saving submission…</h1><p>Your submitted answers are locked. Retrying the answer and review saves.</p><button data-sim="retry">Retry save</button>';
        else if(s.status==='submitted'&&!reviewing)html=resultHTML(v);
        else{
          const list=questions(s,all),q=list[s.position],id=s.ids[s.position],choice=s.answers[id],done=s.status==='submitted',feedback=done&&!history.state?.hazzardSimulationSearch,isScored=scored(q),count=Object.keys(s.answers).length;
          html='<div class="sim-bar"><strong>'+esc(label(s.sitting))+'</strong>'+(done?'<button data-sim="result">Result</button>':'<span data-sim-clock role="timer" aria-label="Time remaining"></span>')+'</div><p data-sim-warning role="alert" hidden></p><div class="sim-tools"><span>Q'+(s.position+1)+' / 100 · '+count+' answered</span><button data-sim="grid" aria-expanded="'+gridOpen+'">Navigator</button></div>'+
            (gridOpen?'<section class="sim-navigator" aria-label="Question navigator"><p>● Answered · ○ Unanswered · ⚑ Flagged for later</p><div class="sim-grid">'+s.ids.map((qid,i)=>'<button data-slot="'+i+'" aria-current="'+(i===s.position?'step':'false')+'" aria-label="Question '+(i+1)+', '+(s.answers[qid]!==undefined?'answered':'unanswered')+(s.flags.includes(qid)?', flagged for later':'')+'" class="'+(s.answers[qid]!==undefined?'sim-answered':'')+'">'+(i+1)+'<small>'+(s.answers[qid]!==undefined?'●':'○')+(s.flags.includes(qid)?' ⚑':'')+'</small></button>').join('')+'</div></section>':'')+
            '<div class="mcq-question" data-bank-id="'+q.id+'"><p class="meta">'+(isScored?'Scored question':'Not scored')+(feedback&&q.label?' · '+esc(q.label):'')+'</p>'+
            (!done?'<button data-sim="flag" aria-pressed="'+s.flags.includes(id)+'">'+(s.flags.includes(id)?'⚑ Flagged for later':'Flag for later')+'</button>':'')+
            '<div class="mcq-stem mcq-mixed" dir="auto" lang="he">'+HazzardMCQ.stemHTML(q)+'</div>'+(q.images||[]).map((url,i)=>'<button class="mcq-image" data-image="'+i+'" aria-label="Enlarge question image '+(i+1)+'"><img src="'+esc(url)+'" alt="Question image '+(i+1)+'"></button>').join('')+
            '<div class="mcq-options" dir="rtl" role="group" aria-label="Answer options">'+q.o.map((option,i)=>'<button data-choice="'+i+'" class="mcq-option '+(choice===i?'selected ':'')+(feedback&&q.accepted.includes(i)?'correct ':feedback&&choice===i?'wrong':'')+'" aria-pressed="'+(choice===i)+'" '+(done?'disabled':'')+'><span class="mcq-letter">'+['א','ב','ג','ד','ה'][i]+'</span><span class="mcq-mixed" dir="auto" lang="he">'+HazzardMCQ.rich(option)+'</span></button>').join('')+'</div>'+
            (feedback?'<p class="mcq-result">'+(!isScored?'Not scored':choice===undefined?'Unanswered':q.accepted.includes(choice)?'Correct':'Incorrect')+' · Key: '+q.accepted.map(i=>['א','ב','ג','ד','ה'][i]).join(', ')+'</p><section class="mcq-explanation" dir="auto" lang="he">'+(q.explanation?HazzardMCQ.rich(q.explanation):'<p>No explanation in the bank.</p>')+(q.explanationReviewNote||q.explanationIncomplete?'<p class="mcq-source-note" role="note" dir="ltr" lang="en">'+esc(q.explanationReviewNote||'Explanation incomplete in source.')+'</p>':'')+'</section><p class="mcq-source" dir="auto">'+esc(q.ref||'')+'<br>'+esc(q.keySource||'')+'</p>':'')+
            '<div class="sim-actions"><button data-sim="prev" '+(s.position===0?'disabled':'')+'>Prev</button><button data-sim="next" '+(s.position===99?'disabled':'')+'>Next</button>'+(!done?'<button data-sim="submit">Submit exam</button>':'')+'</div>'+
            (confirmSubmit&&!done?'<section class="sim-confirm" role="region" aria-label="Confirm submission"><p>Submit now? '+(100-count)+' unanswered. Answers will be locked.</p><button data-sim="confirm">Submit and show score</button> <button data-sim="cancel">Keep working</button></section>':'')+'</div>';
        }
        host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page sim-page">'+(error||backgroundError?'<p role="alert">'+esc(error||backgroundError)+'</p>':'')+html+'</div>';
        for(const img of host.querySelectorAll('img'))img.onerror=()=>{img.replaceWith(Object.assign(document.createElement('p'),{textContent:'Question image unavailable. Reconnect to download it.'}));};
        tick();
      }catch(e){host.innerHTML=HazzardStorage.recoveryHTML()+'<div class="mcq-page"><p role="alert">'+esc(e.message)+'</p></div>';}
    }
    function tick(){
      if(!controller.active)return;
      try{const s=read().session;if(s?.status!=='running')return;const left=Math.max(0,s.deadline-Date.now()),clock=host.querySelector('[data-sim-clock]'),warning=host.querySelector('[data-sim-warning]');if(clock)clock.textContent=elapsed(left);if(warning){warning.hidden=left>300000;warning.textContent=left?'5 minutes or less remaining. The exam will submit automatically.':'Time expired. Submitting…';}}catch{}
    }
    // Re-read before each edit so a stale tab cannot unlock a submitted attempt.
    function edit(change,allowSubmitted=false){const v=read(),s=v.session;if(!s)return;if(s.status==='running'&&Date.now()>=s.deadline){check();return;}if(s.status!=='running'&&!(allowSubmitted&&s.status==='submitted'))return;change(s);s.at=Math.max(Date.now(),s.at+1);v.at=s.at;write(v);}
    host.addEventListener('change',e=>{if(e.target.name==='duration'){duration=e.target.value;const field=host.querySelector('.sim-custom');field.hidden=duration!=='custom';field.querySelector('input').disabled=duration!=='custom';field.querySelector('input').required=duration==='custom';}if(e.target.name==='sitting')selectedSitting=e.target.value;if(e.target.name==='custom')custom=e.target.value;});
    host.addEventListener('submit',async e=>{
      if(!e.target.matches('[data-sim-start]'))return;e.preventDefault();if(busy)return;busy=true;
      try{const data=new FormData(e.target),minutes=Number(data.get('duration')==='custom'?data.get('custom'):data.get('duration')),sitting=data.get('sitting');if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('Choose 1–1440 whole minutes.');const list=all.filter(q=>q.kind==='past'&&q.t===sitting).sort((a,b)=>a.examNumber-b.examNumber);if(list.length!==100||list.some((q,i)=>q.examNumber!==i+1))throw Error('This sitting does not have all 100 official slots.');const v=read();if(v.session&&v.session.status!=='submitted')throw Error('Resume and submit your current simulation first.');const now=Date.now();v.session={id:crypto.randomUUID(),sitting,status:'running',startedAt:now,deadline:now+minutes*60000,ids:list.map(q=>q.id),answers:{},flags:[],position:0,at:now,commit:null};v.at=now;write(v);setup=reviewing=false;error='';host.scrollTop=0;}catch(e){error=e.message;}finally{busy=false;render();}
    });
    host.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b||b.disabled||busy)return;const action=b.dataset.sim,y=host.scrollTop;
      if(!action&&b.dataset.choice===undefined&&b.dataset.slot===undefined&&b.dataset.image===undefined)return;
      try{
        error='';if(['result','review','setup','resume'].includes(action))history.replaceState({...history.state,hazzardSimulationSearch:false},'');if(action==='load'){await load();return;}
        if(b.dataset.image!==undefined){openImage(b.querySelector('img'));return;}
        if(action==='confirm'||action==='retry'){busy=true;await submit();confirmSubmit=false;reviewing=false;}
        else if(action==='setup'){setup=true;selectedSitting='';}
        else if(action==='resume'){setup=false;reviewing=false;await check();}
        else if(action==='review'){reviewing=true;edit(s=>{s.position=0;},true);}
        else if(action==='result')reviewing=false;
        else if(action==='grid')gridOpen=!gridOpen;
        else if(action==='submit')confirmSubmit=true;
        else if(action==='cancel')confirmSubmit=false;
        else if(action==='flag')edit(s=>{const id=s.ids[s.position];s.flags=s.flags.includes(id)?s.flags.filter(x=>x!==id):[...s.flags,id];});
        else if(b.dataset.choice!==undefined)edit(s=>{s.answers[s.ids[s.position]]=Number(b.dataset.choice);});
        else if(b.dataset.slot!==undefined){edit(s=>{s.position=Number(b.dataset.slot);},true);gridOpen=false;}
        else if(action==='next'||action==='prev')edit(s=>{s.position=Math.max(0,Math.min(99,s.position+(action==='next'?1:-1)));},true);
        render();host.scrollTop=b.dataset.choice!==undefined||['flag','grid','submit','cancel'].includes(action)?y:0;
        if(action==='submit')host.querySelector('.sim-confirm')?.scrollIntoView({block:'nearest'});
      }catch(e){error=e.message;render();}finally{busy=false;}
    });
    setInterval(tick,1000);
    addEventListener('hazzard-simulation-change',()=>{if(loaded&&!busy){const y=host.scrollTop;render();host.scrollTop=y;}});
    addEventListener('hazzard-simulation-error',()=>{if(loaded)render();});
    addEventListener('storage',e=>{if(loaded&&(e.key===KEY||e.key===HazzardMCQ.KEY||e.key===null))render();});
    return controller;
  }
  return {KEY,valid,read,merge,scored,submit,startClock,mount};
})();
