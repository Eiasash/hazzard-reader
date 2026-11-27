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
    let serial=0,restoring=false;
    function remember(){if(!restoring&&history.state?.hazzardQuestionSearch)history.replaceState({...history.state,hazzardQuestionSearch:{query:input.value,all:all.checked,scroll:results.scrollTop}},'');}
    async function render(scroll=0){
      const turn=++serial,query=normalize(input.value);results.replaceChildren();status.textContent=query?'Searching…':'Enter words to search.';
      if(!query)return;
      try{
        const items=await getItems(allowAll&&all.checked);if(turn!==serial||screen.hidden)return;
        const words=query.split(' '),matches=items.filter(q=>{const text=normalize(q.text);return words.every(word=>text.includes(word));});
        status.textContent=matches.length+' matching questions';
        for(const q of matches){
          const button=document.createElement('button'),label=document.createElement('strong'),preview=document.createElement('span');button.type='button';
          label.textContent=q.label;preview.textContent=q.stem;preview.dir='auto';button.append(label,preview);if(q.note){const note=document.createElement('span');note.textContent=q.note;button.append(note);}
          button.onclick=()=>{remember();input.blur();openQuestion(q.id,()=>{history.pushState({...history.state,hazzardQuestionSearch:null},'');hide();});};results.append(button);
        }
        results.scrollTop=scroll;
      }catch(error){if(turn===serial)status.textContent=error.message||'Question search unavailable. Try again.';}
    }
    function hide(){if(screen.hidden)return;screen.hidden=true;host.hidden=false;}
    function restore(){
      const state=history.state?.hazzardQuestionSearch;
      if(!state){serial++;if(!screen.hidden)hide();return;}
      restoring=true;input.value=state.query||'';all.checked=allowAll&&!!state.all;
      host.hidden=true;screen.hidden=false;render(state.scroll||0).finally(()=>{restoring=false;});
    }
    function close(){if(history.state?.hazzardQuestionSearch)history.back();else hide();}
    input.addEventListener('input',()=>{remember();render();});all.addEventListener('change',()=>{remember();render();});results.addEventListener('scroll',remember,{passive:true});
    screen.querySelector('button').onclick=close;screen.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
    addEventListener('popstate',restore);addEventListener('pageshow',restore);
    return {restore,open(){if(!screen.hidden){close();return;}history.pushState({...history.state,hazzardQuestionSearch:{query:input.value,all:all.checked,scroll:0}},'');restore();input.focus({preventScroll:true});}};
  }
  return {mount,normalize};
})();
