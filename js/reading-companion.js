/* Keep the desktop study pane on the chapter the reader is actually reading. */
window.HazzardReadingCompanion = (() => {
  const owner = window.frameElement;
  const embedded = owner?.hasAttribute('data-reading-companion') === true;
  if (embedded) {
    document.documentElement.dataset.readingCompanion = 'frame';
    if (owner.dataset.study === owner.dataset.chapter) document.documentElement.dataset.questionsOnly = 'true';
  }
  const desktop = matchMedia('(min-width: 1200px)');
  let pane, frame, primary, scroller, chapter, study, land, focusQuestion = false;
  let layoutPane, selectedMode = 'read', pendingMode = false;
  function showMode(mode, remember=true){
    if(!layoutPane ||study===chapter|| !['read','study','questions'].includes(mode))return false;
    const url=chapterURL(mode==='read'?chapter:study);
    if(mode==='questions')url.searchParams.set('view','questions');
    if(remember&&url.href!==location.href)history.pushState({...history.state,hazzardView:'reader',hazzardPane:null,chapterMode:mode},'',url);
    selectedMode=mode;pendingMode=mode!=='read';
    layoutPane();syncMode();
    if(pendingMode&&frame?.contentWindow.HazzardChapterMode){
      frame.contentWindow.HazzardChapterMode(mode);
      pendingMode=false;
    }
    return true;
  }
  function modeURL(){if(!chapter)return null;const url=chapterURL(selectedMode==='read'?chapter:study);if(selectedMode==='questions')url.searchParams.set('view','questions');return url;}
  let readingSource = false, noteOffset = null;

  function chapterURL(id) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('chapter', id);
    return url;
  }

  function readerURL(url) {
    const path = pathname => pathname.replace(/\/index\.html$/, '/');
    return url.origin === location.origin && path(url.pathname) === path(location.pathname);
  }

  function focusAt(element) {
    if (!element.hasAttribute('tabindex') && !element.matches('a[href],button,input,select,textarea,summary')) {
      element.tabIndex = -1;
      element.addEventListener('blur', () => element.removeAttribute('tabindex'), {once: true});
    }
    element.focus({preventScroll: true});
  }

  function syncMode(){
    const id=new URL(location.href).searchParams.get('chapter')||chapter;
    for(const button of document.querySelectorAll('#chapterHeader .chapter-switch > button[data-chapter]')){
      if(selectedMode!=='questions'&&button.dataset.chapter===id)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    const q=document.querySelector('#chapterHeader [data-chapter-questions]');
    if(q){if(selectedMode==='questions')q.setAttribute('aria-current','page');else q.removeAttribute('aria-current');}
  }

  function sourceAt(url) {
    let id;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch { return false; }
    const target = id ? document.getElementById(id) : primary.querySelector('h1');
    if (!target || !primary.contains(target)) return false;
    const next = chapterURL(chapter);
    next.hash = url.hash;
    if (!next.hash) next.searchParams.set('chapterTop', '1');
    if (next.href !== location.href) {
      history.replaceState({...history.state, hazzardReaderY: scroller.scrollTop}, '');
      history.pushState({...history.state, companionSource: true}, '', next);
    }
    readingSource = true;selectedMode='read';layoutPane?.();
    syncMode();land(target);
    focusAt(target);
    return true;
  }

  function openQuestions(url) {
    const session = url.searchParams.get('session') || url.searchParams.get('q');
    if (!session || !session.split(',').every(id => /^mcq-[a-f0-9]{24}$/.test(id))) return false;
    const next = chapterURL(study);
    next.searchParams.set('view', 'questions');
    next.searchParams.set('session', session);
    const notes = frame.contentDocument?.getElementById('readerScroll');
    if (notes) noteOffset = notes.scrollTop;
    focusQuestion = true;
    frame.contentWindow.location.replace(next.href);
    return true;
  }

  function route(url, fromPane) {
    if (!pane || pane.hidden || !readerURL(url)) return false;
    const id = url.searchParams.get('chapter');
    if (id === 'bank') return openQuestions(url);
    return fromPane && id === chapter && sourceAt(url);
  }

  function onLink(event) {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const url = new URL(link.href);
    if (!embedded) {
      if (!primary?.contains(link) || !route(url, false)) return;
    } else {
      if (link.getAttribute('href').startsWith('#')) return;
      if(readerURL(url)&&!parent.matchMedia('(min-width:1200px)').matches&&
         url.searchParams.get('chapter')!==owner.dataset.chapter&&url.searchParams.get('chapter')!==owner.dataset.study){
        event.preventDefault();parent.location.assign(url.href);return;
      }
      if (!parent.HazzardReadingCompanion.route(url, true)) {
        link.target = '_blank';
        link.relList.add('noopener');
        return;
      }

    }
    event.preventDefault();
    event.stopPropagation();
  }

  function resetQuestions() {
    const next = chapterURL(study);
    next.searchParams.set('view', 'questions');
    focusQuestion = true;
    frame.contentWindow.location.replace(next.href);
  }

  function syncStudyInset(){
    if(!pane?.hasAttribute('data-structured-study'))return;
    frame.contentDocument?.documentElement.style.setProperty('--study-host-header',(document.getElementById('chapterHeader').offsetHeight||50)+'px');
  }
  function frameReady() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    const slot=doc.querySelector('#bottomSlot');
    doc.documentElement.toggleAttribute('data-single-study',document.body.classList.contains('single-study-pane'));
    if(slot&&!slot.dataset.mirrored){
      slot.dataset.mirrored='true';
      const sync=()=>pane.classList.toggle('child-editor',!!doc.querySelector('#markBar:not([hidden]),#undoToast:not([hidden])'));
      new MutationObserver(sync).observe(slot,{subtree:true,attributes:true,attributeFilter:['hidden']});
      sync();
    }
    if(pendingMode&&frame.contentWindow.HazzardChapterMode){
      frame.contentWindow.HazzardChapterMode(selectedMode);
      pendingMode=false;
    }
    if (noteOffset !== null) {
      const notes = doc.getElementById('readerScroll');
      if (notes) notes.scrollTop = noteOffset;
    }
    if (!focusQuestion || pane.hidden) return;
    focusQuestion = false;
    const host = doc.getElementById('mcqViewport');
    if (!host) return;
    // A linked question may still be hydrating its published options.
    const focus = () => {
      if (host.hidden || pane.hidden) return true;
      const question = host.querySelector('.mcq-stem') || host.querySelector('[role="alert"],.mcq-question > p:only-child:not([role="status"])');
      if (!question) return false;
      focusAt(question);
      return true;
    };
    if (!focus()) {
      const observer = new MutationObserver(() => { if (focus() || pane.hidden) observer.disconnect(); });
      observer.observe(host, {childList: true, subtree: true});
    }
  }

  function mount({id, studyId, copy, scroll, landOnSource, preserveLayout, studyURL}) {
    if (embedded) {
      document.addEventListener('click', onLink, true);
      if (new URL(location.href).searchParams.has('session')) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'companion-all';
        reset.textContent = 'All questions';
        reset.title = 'Open all questions for this chapter';
        reset.onclick = () => parent.HazzardReadingCompanion.resetQuestions();
        document.getElementById('chapterHeader').append(reset);
      }
      return;
    }
    if (!/^(?:\d+|law)$/.test(id) || copy.dataset.notLoaded) return;
    chapter = id;
    study = studyId || id;
    selectedMode=studyURL?(studyURL.searchParams.get('view')==='questions'?'questions':'study'):'read';
    primary = copy;
    scroller = scroll;
    land = landOnSource;
    const reader = document.getElementById('reader');
    const panel = document.getElementById('panel');
    pane = document.createElement('aside');
    pane.id = 'readingCompanion';
    pane.setAttribute('aria-label', 'Chapter study pane');
    pane.hidden = true;
    document.querySelector('main').append(pane);
    const prefKey='hazzard-study-pane-open';
    let preference=null;
    try { preference=localStorage.getItem(prefKey); } catch {}
    const toggle=document.createElement('button');
    toggle.id='toggleCompanion';toggle.type='button';
    toggle.setAttribute('aria-controls',pane.id);
    document.querySelector('[data-pane="tools"]').append(toggle);
    function setOpen(open){
      preference=String(open);
      try { localStorage.setItem(prefKey,preference); } catch {}
      preserveLayout(layout);
    }
    toggle.onclick=()=>{setOpen(pane.hidden);if(panel.open)document.getElementById('closePanel').click();};
    let warm=false;
    function layout() {
      const params = new URLSearchParams(location.search);
      const available = !reader.hidden && !scroll.inert &&
        params.get('home') !== '1' && params.get('stats') !== '1' &&
        !document.body.classList.contains('statistics-open');
      const split=desktop.matches&&preference!=='false';
      const singleStudy=available&&!split&&selectedMode!=='read'&&!panel.open;
      const show=available&&(split||singleStudy);
      document.body.classList.toggle('single-study-pane',singleStudy);
      primary.inert=singleStudy;
      frame?.contentDocument?.documentElement.toggleAttribute('data-single-study',singleStudy);
      toggle.hidden=!available||!desktop.matches;
      toggle.textContent=show?'Hide study notes and exam questions':'Show study notes and exam questions';
      toggle.setAttribute('aria-expanded',String(show));
      document.body.classList.toggle('with-reading-companion', show&&split);
      document.body.classList.toggle('full-reading-pane', available&&!show);
      if (!show && !pane.hidden && document.activeElement === frame) focusAt(scroll);
      pane.hidden = !show;
      pane.inert = panel.open;
      if ((!show&&!warm)||frame) return;
      frame = document.createElement('iframe');
      frame.id = 'readingCompanionFrame';
      frame.dataset.readingCompanion = '';
      frame.dataset.chapter = chapter;
      frame.dataset.study = study;
      frame.title = 'Chapter ' + chapter + ' study notes and exam questions';
      const url = studyURL||chapterURL(study);
      if(selectedMode==='questions')url.searchParams.set('view','questions');
      if (study === chapter) url.searchParams.set('view', 'questions');
      frame.src = url.href;
      pane.append(frame);
    }
    // The active Study document owns its sections and editor. The parent keeps
    // the common header and navigation outside the single-pane reading area.
    document.addEventListener('click',event=>{
      if(!document.body.classList.contains('single-study-pane'))return;
      const control=event.target.closest('#chapterHeader [data-panel="contents"],#chapterHeader #findToggle');
      if(!control)return;
      const peer=frame?.contentDocument?.querySelector(control.id==='findToggle'?'#findToggle':'.companion-sections');
      if(peer){event.preventDefault();event.stopImmediatePropagation();peer.click();}
    },true);
    new ResizeObserver(syncStudyInset).observe(document.getElementById('chapterHeader'));
    layoutPane=layout;
    if(study!==chapter){
      const preload=()=>{warm=true;layout();};
      if('requestIdleCallback' in window)requestIdleCallback(preload,{timeout:500});
      else setTimeout(preload,100);
    }
    const observer = new MutationObserver(layout);
    observer.observe(reader, {attributes: true, attributeFilter: ['hidden']});
    observer.observe(scroll, {attributes: true, attributeFilter: ['inert']});
    observer.observe(panel, {attributes: true, attributeFilter: ['open']});
    desktop.addEventListener('change', layout);
    document.addEventListener('click', onLink, true);
    addEventListener('popstate', event => {
      const wasSource = readingSource;
      readingSource = !!event.state?.companionSource;
      const route=new URL(location.href);
      if([study,chapter].includes(route.searchParams.get('chapter'))){
        showMode(route.searchParams.get('chapter')===chapter?'read':route.searchParams.get('view')==='questions'?'questions':'study',false);
      }else layout();
      if (pane.hidden) return;
      if (readingSource) {
        const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : primary.querySelector('h1');
        if (target && primary.contains(target)) land(target);
      } else if (wasSource && Number.isFinite(event.state?.hazzardReaderY)) {
        scroll.scrollTop = event.state.hazzardReaderY;
      }
    });
    layout();
  }

  function unexpectedRoute() {
    if (!embedded || new URL(location.href).searchParams.get('chapter') === owner.dataset.study) return false;
    const url = new URL(location.href);
    if (parent.HazzardReadingCompanion.route(url, true)) {
      if (url.searchParams.get('chapter') !== 'bank') parent.HazzardReadingCompanion.resetQuestions();
      return true;
    }
    // Script-driven destinations outside this chapter are full-reader pages.
    const entry = document.createElement('main'), link = document.createElement('a'), back = document.createElement('button');
    entry.className = 'companion-destination';
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open this reader page in a new tab';
    back.type = 'button';
    back.textContent = 'Return to chapter questions';
    back.onclick = () => parent.HazzardReadingCompanion.resetQuestions();
    entry.append(link, back);
    document.querySelector('main').hidden = true;
    document.body.prepend(entry);
    return true;
  }

  function showError(message) {
    const notice = document.createElement('section'), retry = document.createElement('button');
    notice.className = 'companion-load-error';
    retry.type = 'button';
    retry.textContent = 'Reload study pane';
    retry.onclick = () => location.reload();
    notice.append(message, retry);
    document.body.append(notice);
  }

  async function prepareUpdate() {
    if (!embedded && frame?.contentWindow.HazzardPrepareUpdate) await frame.contentWindow.HazzardPrepareUpdate();
  }

  return {embedded, mount, route, showMode, modeURL, resetQuestions, frameReady, prepareUpdate, unexpectedRoute, showError};
})();
