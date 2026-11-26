/* Card text is bundled offline. Only an explicit grade writes to the notebook. */
window.HazzardFlashcards = (() => {
  const KEY = 'hazzard-flashcards-v1';
  const empty = () => ({version: 1, cards: {}});
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const valid = v => isObject(v) && v.version === 1 && isObject(v.cards) &&
    Object.entries(v.cards).every(([id, item]) => /^ch\d+-[a-z0-9-]+$/.test(id) &&
      isObject(item) && ['know', 'again'].includes(item.grade) && Number.isSafeInteger(item.at) && item.at >= 0);

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

  const isShowing = () => pane && !pane.hidden && pane.closest('dialog')?.open;
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
    element('flashcardOrder').value = session.order;
    element('flashcardError').hidden = true;
    if (card) {
      article.dataset.cardId = card.id;
      const saved = records[card.id]?.grade;
      const grade = saved === 'again' ? ' · Again' : saved === 'know' ? ' · Know' : '';
      const rank = session.missed?.[card.id];
      const priority = session.order === 'missed' && rank != null ? [' · Missed question', ' · Missed topic', ' · Missed chapter'][rank] || '' : '';
      element('flashcardCount').textContent = 'Chapter ' + card.chapter + ' · ' + (session.position + 1) + ' of ' + session.ids.length + priority + grade;
      question.textContent = card.front;
      element('flashcardBack').textContent = card.back;
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
      const deck = cards.filter(card => next.scope === 'all' || card.chapter === next.scope);
      const inDeck = new Set(deck.map(card => card.id));
      const grades = progress().cards;
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
        HazzardStorage.setItem(KEY, JSON.stringify(merge(saved, {cards: {[id]: {grade: value, at}}})));
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
    pane.innerHTML = '<label class="flashcard-order">Order <select id="flashcardOrder"><option value="all">All cards</option><option value="missed">Missed topics first</option></select></label>' +
      '<p id="flashcardCount" class="meta" role="status"></p>' +
      '<article id="flashcardArticle" hidden><h3 id="flashcardFront" tabindex="-1"></h3><details id="flashcardAnswer"><summary>Show answer</summary>' +
      '<p id="flashcardBack"></p><div class="flashcard-sources"><a id="flashcardSource"></a><a id="flashcardContext" hidden></a></div><div class="flashcard-actions"><button type="button" data-flash-grade="again">Again</button>' +
      '<button type="button" class="primary" data-flash-grade="know">Know</button></div></details></article>' +
      '<div id="flashcardCompletion" hidden><h3 id="flashcardDone" tabindex="-1">Deck complete</h3><p id="flashcardTotals"></p>' +
      '<div class="flashcard-actions"><button type="button" id="flashcardReviewAgain">Review Again cards</button><button type="button" id="flashcardRestart">Restart deck</button></div></div>' +
      '<p role="alert" id="flashcardError" hidden></p>';
    document.getElementById('panel').append(pane);
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
    const row = document.createElement('li');
    row.append(buttonFor('all'));
    document.querySelector('[data-pane="practice"] .rows li')?.after(row);
    if (chapter.endsWith('s') && HazzardEvidence.isRebuilt(chapter.slice(0, -1))) {
      const entry = buttonFor(chapter.slice(0, -1));
      entry.dataset.readerMetadata = 'flashcards';
      entry.className = 'study-flashcards';
      copy.querySelector('h1')?.after(entry);
    }
    element('flashcardOrder').addEventListener('change', event => restart(event.target.value));
    element('flashcardRestart').addEventListener('click', () => restart(session.order));
    element('flashcardReviewAgain').addEventListener('click', () => {
      const grades = progress().cards;
      restart(session.order, session.ids.filter(id => grades[id]?.grade === 'again'));
    });
    element('flashcardAnswer').addEventListener('toggle', event => {
      if (!session || !isShowing()) return;
      session.revealed = event.currentTarget.open;
      saveSession();
      if (session.revealed) expand?.();
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

  return {KEY, empty, valid, merge, install, show, flush: () => pendingGrade};
})();
