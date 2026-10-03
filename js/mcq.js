/* MCQs use only their own store. Existing notebook, drill and progress formats
   are unchanged. Content-derived IDs prevent answers moving to another item. */
window.HazzardMCQ = (() => {
  const KEY = 'hazzard-mcq-v1';
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function validStore(value) {
    return record(value) && value.version === 1 && record(value.answers) && Object.entries(value.answers).every(([id,a]) =>
      /^mcq-[a-f0-9]{24}$/.test(id) && record(a) && (a.selected === null || Number.isInteger(a.selected) && a.selected >= 0 && a.selected <= 4) &&
      typeof a.checked === 'boolean' && (!a.checked || a.selected !== null) && Number.isFinite(a.at) && a.at >= 0);
  }
  function readStore() {
    const raw = localStorage.getItem(KEY), value = raw === null ? {version:1,answers:{}} : JSON.parse(raw);
    if (!validStore(value)) throw new Error('Unreadable MCQ answers');
    return value;
  }
  function mergeStore(current, incoming) {
    const answers = {...incoming.answers};
    for (const [id,a] of Object.entries(current.answers)) if (!answers[id] || a.at >= answers[id].at) answers[id] = a;
    return {version:1,answers};
  }
  let catalogPromise;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Question file unavailable');
    return response.json();
  }
  function loadIndex() {
    return catalogPromise ||= json('data/mcq/index.json').catch(error => { catalogPromise = null; throw error; });
  }
  function sourceLabel(q) {
    if (q.kind === 'practice') return 'Practice question · Hazzard-based';
    const match = /^(\d{4})(?:-([A-Za-z]+))?(?:-(Subspec|Basic))?$/.exec(q.t);
    if (!match) return 'Shlav A';
    return 'Shlav A ' + match[1] + (match[2] ? ' (' + match[2] + ')' : '') + (match[3] === 'Subspec' ? ' · Subspecialty' : '');
  }
  function rich(value) {
    const box = document.createElement('div');
    const decoder = document.createElement('textarea');
    const text = String(value).replace(/\\n/g, '\n').replace(/&(?:#\d+|#x[a-f0-9]+|[a-z]+);/gi, entity => { decoder.innerHTML=entity; return decoder.value; });
    // Escape source HTML before interpreting the bank's Markdown. Links and
    // Markdown images are text only; exam images come from the copied manifest.
    box.innerHTML = marked.parse(escape(text));
    for (const node of box.querySelectorAll('a,img')) node.replaceWith(document.createTextNode(node.textContent || node.getAttribute('alt') || ''));
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.data.split(/(\([^()]*\))/g);
      if (parts.length < 2) continue;
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (/^\(\s*[A-Za-z]/.test(part)) {
          const bdi = document.createElement('bdi'); bdi.dir = 'ltr'; bdi.textContent = part; fragment.append(bdi);
        } else fragment.append(document.createTextNode(part));
      }
      node.replaceWith(fragment);
    }
    return box.innerHTML;
  }
  function mount({chapter, viewport, readerScroll, onShow, onNotes, openImage}) {
    const host = document.createElement('section'); host.id = 'mcqViewport'; host.hidden = true; host.setAttribute('aria-label', 'Exam questions'); viewport.append(host);
    let items = [], filter = 'all', position = 0, loaded = false, busy = false;
    const answers = new Map(), pending = new Map(); let storageError = '';
    function sync() {
      try { const saved = readStore(); answers.clear(); for(const [id,a] of Object.entries(saved.answers))answers.set(id,a);storageError=''; }
      catch { storageError='Saved MCQ answers could not be read. Existing data has not been overwritten.'; }
      for(const [id,a] of pending)answers.set(id,a);
      if(loaded)render();
    }
    function save() {
      try { const saved=mergeStore(readStore(),{version:1,answers:Object.fromEntries(pending)});localStorage.setItem(KEY,JSON.stringify(saved));for(const id of pending.keys())answers.set(id,saved.answers[id]);pending.clear();storageError=''; }
      catch { storageError='MCQ answers could not be saved. Keep this page open and try again.'; }
    }
    const controller = {
      active: false,
      get hasUnsaved() { return pending.size > 0; },
      sync,
      show() {
        controller.active = true; host.hidden = false; readerScroll.style.visibility = 'hidden'; readerScroll.inert = true; onShow();
        if (!loaded) load();
      },
      notes() {
        controller.active = false; host.hidden = true; readerScroll.style.visibility = ''; readerScroll.inert = false; onNotes();
      }
    };
    const visible = () => items.filter(q => filter === 'all' || q.kind === filter);
    function render() {
      const list = visible(), q = list[position], state = q && (answers.get(q.id) || {selected:null, checked:false});
      host.innerHTML = '<div class="mcq-page"><div class="mcq-heading"><div><p class="eyebrow">CHAPTER '+chapter+' · STUDY</p><h1>Exam questions</h1></div><button data-mcq="notes" class="quiet">Study notes</button></div><nav class="mcq-filters" aria-label="Question type">'+[['all','All'],['past','Past exams'],['practice','Practice']].map(([id,label])=>'<button data-filter="'+id+'" aria-pressed="'+(filter===id)+'">'+label+'</button>').join('')+'</nav><p class="meta mcq-count">'+(q?(position+1)+' of '+list.length:'0 questions')+' · '+(filter==='all'?items.filter(x=>x.kind==='past').length+' past · '+items.filter(x=>x.kind==='practice').length+' practice':filter==='past'?'Past exams':'Practice')+'</p>'+(storageError?'<p role="alert">'+escape(storageError)+'</p><button data-mcq="save">Save again</button>':'')+'<div class="mcq-question"></div></div>';
      const content = host.querySelector('.mcq-question');
      if (!q) { content.innerHTML = '<p>No '+(filter==='all'?'bank':filter==='past'?'past-exam':'practice')+' questions are mapped to this chapter.</p><button data-mcq="notes">Open study notes</button>'; return; }
      const accepted = q.accepted || [q.c], correct = accepted.includes(state.selected), letters = ['א','ב','ג','ד','ה'];
      content.dataset.bankId = q.id;
      content.innerHTML = '<span class="'+(q.kind==='past'?'exam-badge':'mcq-practice-tag')+'">'+(q.kind==='past'?'Past exam · '+escape(q.t):'Practice · Hazzard-based')+'</span><div class="mcq-stem mcq-mixed" dir="auto" lang="he">'+rich(q.q)+'</div>'+
        (q.images||[]).map((url,i)=>'<button class="mcq-image" data-image="'+i+'" aria-label="Enlarge question image '+(i+1)+'"><img src="'+escape(url)+'" alt="Question image '+(i+1)+'" loading="lazy"></button>').join('')+
        '<div class="mcq-options" role="group" aria-label="Answer options" dir="rtl">'+q.o.map((option,i)=>'<button class="mcq-option '+(state.selected===i?'selected ':'')+(state.checked&&accepted.includes(i)?'correct ':'')+(state.checked&&state.selected===i&&!correct?'wrong':'')+'" data-option="'+i+'" aria-pressed="'+(state.selected===i)+'" '+(state.checked?'disabled':'')+'><span class="mcq-letter">'+(state.checked&&accepted.includes(i)?'✓':state.checked&&state.selected===i?'✕':letters[i]||String(i+1))+'</span><span class="mcq-mixed" dir="auto" lang="he">'+rich(option)+'</span></button>').join('')+'</div>'+
        '<div class="mcq-actions"><button class="mcq-pill mcq-check" data-mcq="check" '+(state.selected===null||state.checked?'disabled':'')+'>Check</button><button class="mcq-pill" data-mcq="retry" '+(state.selected===null?'hidden':'')+'>Try again</button><button class="mcq-pill" data-mcq="next" '+(position>=list.length-1?'disabled':'')+'>Next</button><span class="meta">'+(state.checked?'Answered':position===list.length-1?'Last question':'Choose one')+'</span></div>'+
        (state.checked?'<p class="mcq-result '+(correct?'correct':'wrong')+'" dir="rtl" role="status">'+(correct?'✓ תשובה נכונה':'✕ תשובה שגויה · '+(accepted.length>1?'תשובות מתקבלות: ':'התשובה הנכונה: ')+accepted.map(i=>letters[i]||String(i+1)).join(', '))+'</p><section class="mcq-explanation" dir="auto" lang="he"><h3 dir="rtl">הסבר</h3><div class="mcq-mixed" dir="auto">'+(q.explanation?rich(q.explanation):'<p>אין הסבר במאגר לשאלה זו.</p>')+'</div></section>':'')+
        '<p class="mcq-source" dir="ltr">'+escape(sourceLabel(q))+'</p>';
      for (const image of content.querySelectorAll('img')) image.onerror = () => {
        content.innerHTML = '<p role="alert">This question’s image is unavailable. Reconnect to finish downloading the reader, or skip this question.</p><button data-mcq="next" '+(position>=list.length-1?'disabled':'')+'>Next</button>';
      };
    }
    async function load() {
      if (busy) return; busy = true;
      host.innerHTML = '<div class="mcq-page"><p role="status">Loading exam questions…</p><button data-mcq="notes">Study notes</button></div>';
      try { items = await json('data/mcq/'+chapter+'.json'); loaded = true; render(); }
      catch { host.innerHTML = '<div class="mcq-page"><p role="alert">Questions could not be loaded. Reconnect and try again.</p><button data-mcq="load">Try again</button> <button data-mcq="notes">Study notes</button></div>'; }
      finally { busy = false; }
    }
    host.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || !host.contains(button) || button.disabled) return;
      if (button.dataset.mcq==='notes') { controller.notes(); return; }
      if (button.dataset.mcq==='load') { load(); return; }
      if (button.dataset.mcq==='save') { save();render();return; }
      if (button.dataset.filter) { filter=button.dataset.filter;position=0;render();host.scrollTop=0;return; }
      const list=visible(),q=list[position]; if(!q)return;
      if(button.dataset.image!==undefined){openImage(button.querySelector('img'));return;}
      const state=answers.get(q.id)||{selected:null,checked:false};
      if(button.dataset.option!==undefined&&!state.checked)state.selected=Number(button.dataset.option);
      else if(button.dataset.mcq==='check'&&state.selected!==null)state.checked=true;
      else if(button.dataset.mcq==='retry'){state.selected=null;state.checked=false;}
      else if(button.dataset.mcq==='next'&&position<list.length-1){position++;render();host.scrollTop=0;return;}
      state.at=Date.now();answers.set(q.id,state);pending.set(q.id,state);save();const y=host.scrollTop;render();host.scrollTop=y;
      const target=button.dataset.option!==undefined?'[data-option="'+state.selected+'"]':button.dataset.mcq==='check'?'[data-mcq="retry"]':'[data-option="0"]';host.querySelector(target)?.focus({preventScroll:true});
    });
    sync();addEventListener('storage',event=>{if(event.key===KEY||event.key===null)sync()});addEventListener('pageshow',event=>{if(event.persisted)sync()});
    return controller;
  }
  return {KEY,validStore,mergeStore,loadIndex,mount};
})();
