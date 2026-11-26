/* Card text is bundled offline. Only an explicit grade writes to the notebook. */
window.HazzardFlashcards = (() => {
  const KEY = 'hazzard-flashcards-v1';
  const empty = () => ({version: 1, cards: {}});
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const valid = v => isObject(v) && v.version === 1 && isObject(v.cards) &&
    Object.entries(v.cards).every(([id, item]) => /^ch\d+-[a-z0-9-]+$/.test(id) &&
      isObject(item) && ['know', 'again'].includes(item.grade) && Number.isSafeInteger(item.at) && item.at >= 0);

  function dueDay(record){
    return record.due||HazzardReview.plus(HazzardReview.day(record.at),HazzardReview.STEPS[0]);
  }
  async function refreshDue(){
    const button=document.getElementById('homeFlashDue');if(!button)return;
    const today=HazzardReview.day();
    let count=0;
    try{
      if(Object.keys(progress().cards).length){
        const cards=await loadCards(),records=progress().cards;
        count=cards.filter(card=>records[card.id]&&dueDay(records[card.id])<=today).length;
      }
    }catch{button.textContent='Flashcards due · unavailable';button.disabled=true;return;}
    button.textContent='Flashcards due · '+count;button.disabled=count===0;
  }
  function merge(local, incoming) {
    const cards = {...local?.cards};
    for (const [id, next] of Object.entries(incoming?.cards || {})) {
      const before = cards[id];
      // At the same instant, both devices keep the card marked for another look.
      if (!before || next.at > before.at || (next.at === before.at && next.grade === 'again')) cards[id] = next;
    }
    return {version: 1, cards};
  }

  function progress() {
    return HazzardStorage.readProtected(KEY, empty);
  }

  let dataset, bank, pane, session, requested, catalog, lookup, onResize;
  let currentRequest = 0, saving = false, pendingGrade = Promise.resolve();
  function loadCards() {
    return dataset ||= fetch('data/flashcards.json').then(async response => {
      if (!response.ok) throw Error('Flashcards could not load. Reconnect or update the offline copy.');
      return response.json();
    }).catch(error => {dataset = null; throw error;});
  }

  function loadBank() {
    return bank ||= Promise.all([HazzardQuestionData.catalog(), HazzardMCQ.loadAliases()])
      .then(([rows]) => new Map(rows.filter(q =>
        !q.retired && !HazzardMCQ.retired(q.id) && !HazzardMCQ.excluded(q.id)
      ).map(q => [q.id, q])))
      .catch(error => {bank = null; throw error;});
  }

  function missedRanks(cards, questions) {
    const missed = new Set(), topics = new Set(), chaptersWithMisses = new Set();
    const answers = HazzardMCQ.readStore().answers;
    for (const [id, answer] of Object.entries(answers)) {
      const q = questions.get(id);
      if (!q || !answer.checked || !Number.isInteger(answer.selected) || q.accepted.includes(answer.selected)) continue;
      missed.add(id);
      HazzardMCQ.membership(q).forEach(topic => {if (Number.isInteger(topic)) topics.add(topic);});
      if (q.chapter != null) chaptersWithMisses.add(String(q.chapter));
    }
    const ranks = new Map();
    for (const card of cards) {
      const linked = card.questionIds.map(id => questions.get(id)).filter(Boolean);
      const rank = linked.some(q => missed.has(q.id)) ? 0 :
        linked.some(q => HazzardMCQ.membership(q).some(topic => topics.has(topic))) ? 1 :
        chaptersWithMisses.has(card.chapter) ? 2 : 3;
      ranks.set(card.id, rank);
    }
    return ranks;
  }

  const isShowing = () => pane && !pane.hidden && document.body.classList.contains('flashcards-open');
  const element = id => pane.querySelector('#' + id);
  function saveSession() {
    history.replaceState({...history.state, hazzardFlashcards: session}, '');
  }

  function showError(message) {
    const alert = element('flashcardError');
    alert.textContent = message;
    alert.hidden = false;
    onResize();
  }

  function render(focus = false) {
    if (!session || !catalog) return;
    const card = lookup.get(session.ids[session.position]), records = progress().cards;
    const question = element('flashcardFront'), answer = element('flashcardAnswer');
    const article = element('flashcardArticle'), completion = element('flashcardCompletion');
    article.hidden = !card;
    completion.hidden = !!card;
    for(const button of element('flashcardOrder').children)button.setAttribute('aria-pressed',String(button.dataset.order===session.order));
    element('flashcardError').hidden = true;
    if (card) {
      article.dataset.cardId = card.id;
      const saved = records[card.id]?.grade;
      const grade = saved === 'again' ? ' · Again' : saved === 'know' ? ' · Know' : '';
      const rank = session.missed?.[card.id];
      const priority = session.order === 'missed' && rank != null ? [' · Missed question', ' · Missed topic', ' · Missed chapter'][rank] || '' : '';
      element('flashcardCount').textContent = 'Chapter ' + card.chapter + ' · ' + (session.position + 1) + ' of ' + session.ids.length + priority + grade;
      question.textContent = card.front;
      const [printed,...practice]=card.back.split(/\n(?:>\s*)?Current practice \(not the book\):\s*/);
      const back=element('flashcardBack');back.replaceChildren(document.createTextNode(printed));
      for(const text of practice){const note=document.createElement('details'),label=document.createElement('summary');label.textContent='Current practice';note.className='study-current-practice';note.append(label,document.createTextNode(text));back.append(note);}
      const source = element('flashcardSource'), sourceChapter = card.readChapter || card.chapter;
      const sourceURL = new URL(location.href);
      sourceURL.search = new URLSearchParams({chapter: sourceChapter, cardSource: card.id});
      sourceURL.hash = card.anchor;
      source.href = sourceURL.href;
      source.textContent = card.sourceLabel || 'Read the passage · Ch. ' + sourceChapter + ', p. ' + card.page;
      const context = element('flashcardContext');
      context.hidden = !card.studyReference;
      if (card.studyReference) {
        const studyURL = new URL(sourceURL);
        studyURL.searchParams.set('chapter', card.chapter + 's');
        studyURL.hash = card.studyReference.anchor;
        context.href = studyURL.href;
        context.textContent = 'Study reference · ' + card.studyReference.label;
      } else context.removeAttribute('href');
      answer.open = !!session.revealed;
      for(const button of pane.querySelectorAll('[data-flash-grade]'))button.disabled=!answer.open;
      if (focus) question.focus();
    } else {
      const again = session.ids.filter(id => records[id]?.grade === 'again').length;
      const know = session.ids.filter(id => records[id]?.grade === 'know').length;
      element('flashcardCount').textContent = session.scope === 'all' ? 'All rebuilt chapters' : 'Chapter ' + session.scope;
      element('flashcardTotals').textContent = know + ' Know · ' + again + ' Again';
      element('flashcardReviewAgain').hidden = again === 0;
      if (focus) element('flashcardDone').focus();
    }
    onResize();
  }

  async function show() {
    const request = ++currentRequest;
    const next = requested || history.state?.hazzardFlashcards || {scope: 'all', order: 'all'};
    requested = null;
    session = null;
    element('flashcardCount').textContent = 'Opening flashcards…';
    element('flashcardArticle').hidden = element('flashcardCompletion').hidden = true;
    element('flashcardError').hidden = true;
    try {
      const [cards, questions] = await Promise.all([loadCards(), next.order === 'missed' ? loadBank() : null, HazzardStorage.ready]);
      if (request !== currentRequest || !isShowing()) return;
      catalog = cards;
      lookup = new Map(cards.map(card => [card.id, card]));
      const grades=progress().cards,today=HazzardReview.day();
      const deck=cards.filter(card=>(next.scope==='all'||card.chapter===next.scope)&&(next.order!=='due'||(grades[card.id]&&dueDay(grades[card.id])<=today)||next.ids?.includes(card.id)));
      const inDeck = new Set(deck.map(card => card.id));
      const ranks = questions ? missedRanks(deck, questions) : new Map();
      const gradeRank = id => grades[id]?.grade === 'again' ? 0 : grades[id]?.grade === 'know' ? 2 : 1;
      const ids = next.ids ? next.ids.filter(id => inDeck.has(id)) : deck
        .sort((a, b) => (ranks.get(a.id) || 0) - (ranks.get(b.id) || 0) || gradeRank(a.id) - gradeRank(b.id)).map(card => card.id);
      session = {scope: next.scope, order: next.order, ids, missed: Object.fromEntries(ranks),
        position: Math.min(next.position || 0, ids.length), revealed: !!next.revealed};
      saveSession();
      render(true);
    } catch (error) {
      if (request !== currentRequest || !isShowing()) return;
      element('flashcardCount').textContent = '';
      showError(error.message || 'Flashcards could not load. Reopen the deck to retry.');
    }
  }

  function restart(order, ids) {
    requested = {scope: session?.scope || history.state?.hazzardFlashcards?.scope || 'all', order, ids};
    show();
  }

  async function grade(value) {
    const active = session, id = active?.ids[active.position];
    if (!id || saving || !element('flashcardAnswer').open) return;
    saving = true;
    const buttons = [...pane.querySelectorAll('[data-flash-grade]')];
    buttons.forEach(button => {button.disabled = true;});
    try {
      // The lock serializes two grading tabs. Read the latest complete record inside it.
      const write = () => {
        if (HazzardStorage.blockedKeys().includes(KEY)) throw Error('Flashcard progress is unreadable. Restore it in the notebook before grading.');
        const saved = progress();
        const at = Math.max(Date.now(), (saved.cards[id]?.at || 0) + 1);
        const old=saved.cards[id],step=value==='again'?0:Math.min(HazzardReview.STEPS.length-1,(old?.grade==='know'?(old.step??0)+1:0));
        const due=HazzardReview.plus(HazzardReview.day(at),HazzardReview.STEPS[step]);
        HazzardStorage.setItem(KEY,JSON.stringify(merge(saved,{cards:{[id]:{grade:value,at,step,due}}})));refreshDue();
      };
      if (navigator.locks?.request) await navigator.locks.request(KEY, write);
      else write();
      if (active !== session || !isShowing()) return;
      active.position++;
      active.revealed = false;
      saveSession();
      render(true);
    } catch (error) {
      showError(error.message || 'The grade could not be saved. Free some storage and try again.');
    } finally {
      saving = false;
      buttons.forEach(button => {button.disabled = false;});
    }
  }

  function install(copy, chapter, open, resize, expand) {
    onResize = resize;
    pane = document.createElement('section');
    pane.hidden = true;
    pane.dataset.pane = 'flashcards';
    pane.dataset.title = 'Flashcards';
    pane.dataset.readerMetadata = 'flashcards';
    pane.id='flashcardView';pane.setAttribute('aria-label','Flashcards');
    pane.innerHTML = '<div id="flashcardOrder" class="choice-chips" role="group" aria-label="Card order"><button type="button" data-order="all">All</button><button type="button" data-order="due">Due</button><button type="button" data-order="missed">Missed first</button></div>' +
      '<p id="flashcardCount" class="meta" role="status"></p>' +
      '<article id="flashcardArticle" hidden><h3 id="flashcardFront" tabindex="-1"></h3><details id="flashcardAnswer"><summary>Show answer</summary>' +
      '<div id="flashcardBack"></div><div class="flashcard-sources"><a id="flashcardSource"></a><a id="flashcardContext" hidden></a></div></details><div class="flashcard-actions"><button type="button" data-flash-grade="again" disabled>Again</button>' +
      '<button type="button" class="primary" data-flash-grade="know" disabled>Know</button></div></article>' +
      '<div id="flashcardCompletion" hidden><h3 id="flashcardDone" tabindex="-1">Deck complete</h3><p id="flashcardTotals"></p>' +
      '<div class="flashcard-actions"><button type="button" id="flashcardReviewAgain">Review Again cards</button><button type="button" id="flashcardRestart">Restart deck</button></div></div>' +
      '<p role="alert" id="flashcardError" hidden></p>';
    document.querySelector('main').append(pane);
    function buttonFor(scope) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Flashcards';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'panel');
      button.addEventListener('click', () => {
        requested = {scope, order: 'all'};
        open(button);
      });
      return button;
    }
    const dueButton=document.getElementById('homeFlashDue');
    dueButton.onclick=()=>{requested={scope:'all',order:'due'};open(dueButton);};
    refreshDue();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDue();});
    addEventListener('hazzard-flashcards-change',refreshDue);
    addEventListener('storage',e=>{if(!e.key||e.key===KEY)refreshDue();});
    document.addEventListener('keydown',e=>{
      if(!isShowing()||!(matchMedia('(min-width:1200px)').matches||window.HazzardReadingCompanion?.embedded&&parent.matchMedia('(min-width:1200px)').matches)||e.repeat||e.altKey||e.metaKey||e.ctrlKey||e.target.closest('input,select,textarea,[contenteditable=true]'))return;
      const answer=element('flashcardAnswer');
      if(e.key===' '&&!e.target.closest('button,summary,a')){e.preventDefault();answer.open=!answer.open;}
      if(answer.open&&['1','2'].includes(e.key)){e.preventDefault();pane.querySelector('[data-flash-grade="'+(e.key==='1'?'again':'know')+'"]').click();}
    });
    const row = document.createElement('li');
    row.append(buttonFor('all'));
    document.querySelector('[data-pane="practice"] .rows li')?.after(row);
    if (chapter.endsWith('s') && HazzardEvidence.isRebuilt(chapter.slice(0, -1))) {
      const entry = buttonFor(chapter.slice(0, -1));
      entry.dataset.readerMetadata = 'flashcards';
      entry.className = 'study-flashcards';
      copy.querySelector('h1')?.after(entry);
    }
    element('flashcardOrder').onclick=event=>{const choice=event.target.closest('[data-order]');if(choice&&choice.dataset.order!==session?.order)restart(choice.dataset.order);};
    element('flashcardRestart').addEventListener('click', () => restart(session.order));
    element('flashcardReviewAgain').addEventListener('click', () => {
      const grades = progress().cards;
      restart(session.order, session.ids.filter(id => grades[id]?.grade === 'again'));
    });
    element('flashcardAnswer').addEventListener('toggle', event => {
      if (!session || !isShowing()) return;
      session.revealed = event.currentTarget.open;
      saveSession();
      for(const button of pane.querySelectorAll('[data-flash-grade]'))button.disabled=!session.revealed;
      onResize();
    });
    for (const button of pane.querySelectorAll('[data-flash-grade]')) button.addEventListener('click', () => {
      if (!saving) pendingGrade = grade(button.dataset.flashGrade);
    });
    pane.querySelector('.flashcard-sources').addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (link.pathname !== location.pathname || link.search !== location.search) return;
      // A same-document fragment would leave the flashcard sheet over the passage.
      // Give Read its own entry so Back can still return to this card and answer.
      event.preventDefault();
      history.pushState(null, '', link.href);
      location.reload();
    });
    addEventListener('storage', event => {if ((event.key === KEY || event.key === null) && isShowing()) render();});
    addEventListener('pageshow', event => {if (event.persisted && isShowing()) render();});
    addEventListener('hazzard-flashcards-change', () => {if (isShowing()) render();});
  }

  return {KEY, empty, valid, merge, install, show, refreshDue, flush: () => pendingGrade};
})();
