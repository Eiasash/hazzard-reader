/* Question search owns only transient browser-history state, never answer stores. */
window.HazzardQuestionSearch = (() => {
  const normalize = value => String(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
  let instance=0;
  function mount({host,getItems,openQuestion,allowAll=true}) {
    const screen=document.createElement('section');screen.hidden=true;screen.className='question-search';screen.setAttribute('aria-labelledby','questionSearchTitle');
    screen.innerHTML='<div class="question-search-heading"><h2 id="questionSearchTitle">Find questions</h2><button type="button" aria-label="Close question search">Back</button></div><input type="search" aria-label="Search question text" placeholder="Search question text" autocomplete="off" dir="auto"><label class="question-search-scope"><input type="checkbox"> All questions</label><p class="meta question-search-help"></p><p role="status"></p><div class="question-search-results"></div>';
    const titleId='questionSearchTitle-'+(++instance);screen.querySelector('h2').id=titleId;screen.setAttribute('aria-labelledby',titleId);
    host.after(screen);
    const input=screen.querySelector('input[type=search]'),all=screen.querySelector('input[type=checkbox]'),results=screen.querySelector('.question-search-results'),status=screen.querySelector('[role=status]');
    screen.querySelector('label').hidden=!allowAll;
    screen.querySelector('.question-search-help').textContent=allowAll?'Stem, options and explanation · current filters unless All questions is selected.':'Current paper only · stems and options. No explanations or answer keys.';
    const indexed=new Map();
    const batchSize=30,more=document.createElement('button');more.type='button';more.textContent='Show more results';
    let serial=0,restoring=false,timer,matches=[],shown=0;
    function remember(){if(!restoring&&history.state?.hazzardQuestionSearch)history.replaceState({...history.state,hazzardQuestionSearch:{query:input.value,all:all.checked,scroll:results.scrollTop,shown}},'');}
    function appendResults(limit){
      const frag=document.createDocumentFragment(),start=shown;
      for(const q of matches.slice(start,limit)){
        const button=document.createElement('button'),label=document.createElement('strong'),preview=document.createElement('span');button.type='button';
        label.textContent=q.label;preview.textContent=q.stem;preview.dir='auto';button.append(label,preview);if(q.note){const note=document.createElement('span');note.textContent=q.note;button.append(note);}
        button.onclick=()=>{remember();input.blur();openQuestion(q.id,()=>{history.pushState({...history.state,hazzardQuestionSearch:null},'');hide();});};frag.append(button);
      }
      const first=frag.firstElementChild;shown=start+frag.childElementCount;
      more.remove();results.append(frag);if(shown<matches.length)results.append(more);
      return first;
    }
    more.onclick=()=>{const first=appendResults(shown+batchSize);first?.focus({preventScroll:true});remember();};
    async function render(scroll=0,limit=batchSize){
      clearTimeout(timer);
      const turn=++serial,query=HazzardSearchTerms.compile(input.value);matches=[];shown=0;results.replaceChildren();status.textContent=query.text?'Searching…':'Enter words to search.';
      if(!query.text)return;
      try{
        const items=await getItems(allowAll&&all.checked,query.chapter);if(turn!==serial||screen.hidden)return;
        if(query.chapter)matches=items;
        else{
          const ranked=[];
          for(const q of items){
            let cached=indexed.get(q.id);
            if(!cached||cached.original!==q.text){cached={original:q.text,compiled:HazzardSearchTerms.prepare(q.text)};indexed.set(q.id,cached);}
            const rank=query.rank(cached.compiled);if(Number.isFinite(rank))ranked.push({q,rank});
          }
          const literal=ranked.some(row=>row.rank<3);
          matches=ranked.filter(row=>!literal||row.rank<3).sort((a,b)=>a.rank-b.rank).map(row=>row.q);
        }
        status.textContent=matches.length+' matching questions';
        appendResults(Math.max(batchSize,limit));
        // A visit saved before paging has a scroll offset but no displayed count.
        while(shown<matches.length&&results.scrollHeight-results.clientHeight<scroll)appendResults(shown+batchSize);
        results.scrollTop=scroll;
      }catch(error){if(turn===serial)status.textContent=error.message||'Question search unavailable. Try again.';}
    }
    function hide(){clearTimeout(timer);serial++;if(screen.hidden)return;screen.hidden=true;host.hidden=false;}
    function restore(){
      const state=history.state?.hazzardQuestionSearch;
      if(!state){serial++;if(!screen.hidden)hide();return;}
      restoring=true;input.value=state.query||'';all.checked=allowAll&&!!state.all;
      host.hidden=true;screen.hidden=false;const pending=render(state.scroll||0,state.shown||batchSize),turn=serial;pending.finally(()=>{if(turn===serial)restoring=false;});
    }
    function close(){if(history.state?.hazzardQuestionSearch)history.back();else hide();}
    input.addEventListener('input',()=>{clearTimeout(timer);serial++;restoring=false;shown=0;results.replaceChildren();remember();status.textContent=input.value.trim()?'Searching…':'Enter words to search.';timer=setTimeout(render,150);});all.addEventListener('change',()=>{restoring=false;shown=0;results.scrollTop=0;remember();render();});results.addEventListener('scroll',remember,{passive:true});
    screen.querySelector('button').onclick=close;screen.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
    addEventListener('popstate',restore);addEventListener('pageshow',restore);
    return {restore,dispose(){clearTimeout(timer);serial++;removeEventListener('popstate',restore);removeEventListener('pageshow',restore);screen.remove();},open(){if(!screen.hidden){close();return;}history.pushState({...history.state,hazzardQuestionSearch:{query:input.value,all:all.checked,scroll:0}},'');restore();input.focus({preventScroll:true});}};
  }
  return {mount,normalize};
})();
