/* Append only after existing highlight units and drill identities are allocated. */
window.HazzardMemoryAids = (() => {
  let pending;
  function load() {
    return pending ||= fetch('data/memory-aids.json').then(response => {
      if (!response.ok) throw Error('Memory aids unavailable. Reconnect and retry.');
      return response.json();
    }).catch(error => { pending = null; throw error; });
  }
  async function decorate(copy, chapter) {
    if (!/^\d+s$/.test(chapter) || copy.querySelector('.memory-aids')) return;
    const panel = document.createElement('details');
    panel.className = 'memory-aids'; panel.id = 'memory-aids'; panel.dataset.readerMetadata = 'memory-aids';
    const summary = document.createElement('summary'); summary.textContent = 'Memory aids';
    const body = document.createElement('div'); body.className = 'memory-aids-body';
    panel.append(summary, body); copy.append(panel);
    const contents = document.querySelector('[data-pane="contents"] .rows');
    if (contents) {
      const row = document.createElement('li'), jump = document.createElement('button');
      jump.dataset.jump = panel.id; jump.textContent = 'Memory aids';
      // Open before the reader's existing delegated Contents navigation runs.
      jump.addEventListener('click', () => { panel.open = true; });
      row.append(jump); contents.insertBefore(row, contents.lastElementChild);
    }
    async function render() {
      body.textContent = 'Loading memory aids…';
      try {
        const data = await load(), aids = data.chapters[chapter];
        if (!Array.isArray(aids) || !aids.length) throw Error('No memory aids available for this chapter.');
        const fragment = document.createDocumentFragment();
        for (const aid of aids) {
          const section = document.createElement('section'); section.className = 'memory-aid';
          const heading = document.createElement('h3'); heading.textContent = aid.title;
          const cue = document.createElement('p'); cue.className = 'memory-aid-cue';
          const label = document.createElement('strong'); label.textContent = 'Memory aid (not from the book)';
          cue.append(label, document.createElement('br'), document.createTextNode(aid.mnemonic));
          section.append(heading, cue);
          for (const group of aid.groups) {
            if (group.title) {
              const name = document.createElement('p'); name.className = 'memory-aid-group';
              name.textContent = group.title; section.append(name);
            }
            const list = document.createElement('ul');
            for (const text of group.items) {
              const item = document.createElement('li'); item.textContent = text; list.append(item);
            }
            section.append(list);
          }
          const citation = document.createElement('p'); citation.className = 'memory-aid-source';
          citation.textContent = 'Hazzard 8e · printed p' + aid.page;
          section.append(citation);
          if (aid.note) {
            const note = document.createElement('p'); note.className = 'memory-aid-note';
            note.textContent = aid.note; section.append(note);
          }
          fragment.append(section);
        }
        summary.textContent = 'Memory aids · ' + aids.length;
        body.replaceChildren(fragment);
      } catch (error) {
        const message = document.createElement('p'); message.setAttribute('role', 'alert');
        message.textContent = error.message || 'Memory aids could not be loaded.';
        const retry = document.createElement('button'); retry.textContent = 'Retry memory aids';
        retry.onclick = render; body.replaceChildren(message, retry);
      }
    }
    await render();
  }
  return {decorate};
})();
