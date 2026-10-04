/* Source-cited study metadata; deliberately outside saved highlight/drill units. */
window.HazzardLawCards = (() => {
  async function decorate(copy) {
    if (copy.dataset.chapterId !== 'laws' || copy.querySelector('.law-cards')) return;
    const panel = document.createElement('details');
    panel.className = 'law-cards'; panel.dataset.readerMetadata = 'law-cards';
    const summary = document.createElement('summary'); summary.textContent = 'Law cards';
    const body = document.createElement('div'); body.className = 'law-cards-body';
    panel.append(summary, body); copy.prepend(panel);
    async function load() {
      body.textContent = 'Loading law cards…';
      try {
        const response = await fetch('data/law-cards.json');
        if (!response.ok) throw Error('Law cards unavailable. Reconnect and retry.');
        const data = await response.json();
        const fragment = document.createDocumentFragment();
        for (const card of data.cards) {
          const section = document.createElement('section'); section.className = 'law-card';
          section.id = 'law-card-' + card.id;
          const heading = document.createElement('h2'); heading.textContent = card.title;
          const list = document.createElement('ul');
          for (const text of card.bullets) {
            const line = document.createElement('li'); line.textContent = text; list.append(line);
          }
          section.append(heading, list);
          for (const source of card.sources) {
            const line = document.createElement('p'); line.className = 'law-card-source';
            line.textContent = 'Source: ' + source.document + ' — ' + source.locator;
            section.append(line);
          }
          const links = document.createElement('div'); links.className = 'exam-evidence';
          for (const question of card.questions) {
            const link = document.createElement('a');
            link.href = HazzardEvidence.questionURL(question.id);
            link.textContent = 'Examined: ' + HazzardEvidence.label(question);
            link.title = question.reference;
            links.append(link);
          }
          if (card.questions.length) section.append(links);
          else {
            const note = document.createElement('p'); note.className = 'law-card-source';
            note.textContent = 'No matching official question identified for this circular.';
            section.append(note);
          }
          fragment.append(section);
        }
        body.replaceChildren(fragment);
      } catch (error) {
        const message = document.createElement('p'); message.setAttribute('role', 'alert');
        message.textContent = error.message || 'Law cards could not be loaded.';
        const retry = document.createElement('button'); retry.textContent = 'Retry law cards';
        retry.onclick = load; body.replaceChildren(message, retry);
      }
    }
    await load();
  }
  return {decorate};
})();
