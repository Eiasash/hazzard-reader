/* Keep the published text nodes in document order. Visual groups may join
   non-adjacent passages without changing the character index used by marks. */
window.HazzardStudyPage = (() => {
  const groups = new WeakMap();
  const repeats = new WeakMap();
  const sourceTitles = new WeakSet();
  const inlineParts = new WeakMap();
  const labels = {
    summary: 'Summary',
    exams: 'Past exam questions',
    traps: 'Exam traps',
    recall: 'Recall',
    israel: 'Israeli context'
  };
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const generated = '[data-reader-metadata]';
  function sourceText(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(text) {
        return text.parentElement.closest(generated) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let text = '', part;
    while ((part = walker.nextNode())) text += part.data;
    return normalize(text);
  }

  function family(text) {
    if (/^(?:what (?:the )?exams? asked|(?:\d{4} )?exam questions?|past[- ](?:paper|exam) questions?)\b/i.test(text)) return 'exams';
    if (/^exam traps?\b/i.test(text)) return 'traps';
    if (/^(?:recall|(?:chapter |self[- ])?drill|\u05ea\u05e8\u05d2\u05d5\u05dc)(?:\s|$|[:—–-])/i.test(text)) return 'recall';
    if (/^(?:israeli? context|in israel)\b/i.test(text)) return 'israel';
    if (/^(?:summary|\u05e1\u05d9\u05db\u05d5\u05dd)$/i.test(text)) return 'summary';
    return null;
  }

  function setOpen(group, open) {
    group.open = open;
    for (const part of group.parts) {
      if (part.open !== open) part.open = open;
      if (part.dataset.studyContinuation !== undefined) part.hidden = !open;
    }
  }

  function makeFragment(copy, first, key, families) {
    const group = families.get(key) || {parts: [], open: false};
    families.set(key, group);
    const details = document.createElement('details');
    details.className = 'study-group';
    details.dataset.studyGroup = key;
    details.style.order = String(10 + Object.keys(labels).indexOf(key));
    const summary = document.createElement('summary');
    summary.dataset.readerMetadata = 'study-heading';
    summary.textContent = labels[key];
    if (group.parts.length) {
      details.dataset.studyContinuation = '';
      details.hidden = true;
      summary.hidden = true;
      summary.tabIndex = -1;
    }
    details.append(summary);
    copy.insertBefore(details, first);
    groups.set(details, group);
    group.parts.push(details);
    details.addEventListener('toggle', () => {
      if (group.open !== details.open) setOpen(group, details.open);
    });
    return details;
  }

  // Preserve the original number, its enclosing mark unit and the drill store
  // key. Only the visible prefix changes when the bank has gaps.
  function numberRecall(copy) {
    let number = 0;
    for (const drill of copy.querySelectorAll('.drill-q')) {
      const prompt = drill.querySelector(':scope > p');
      if (!prompt) continue;
      const walker = document.createTreeWalker(prompt, NodeFilter.SHOW_TEXT);
      let part;
      do { part = walker.nextNode(); } while (part && !part.data.trim());
      const match = part?.data.match(/^\s*(\d+)[.)]/);
      if (!match) continue;
      number++;
      drill.dataset.studyRecall = String(number);
      if (Number(match[1]) === number) continue;
      part.splitText(match[0].length);
      const old = document.createElement('span');
      old.hidden = true;
      part.before(old); old.append(part);
      const displayed = document.createElement('span');
      displayed.className = 'study-recall-number';
      displayed.dataset.readerMetadata = 'study-number';
      displayed.textContent = number + '.';
      prompt.prepend(displayed);
    }
  }

  // Some older notes place the printed rule and the labelled update in one
  // list item, occasionally split by the user's highlight markup. Keep every
  // fragment in its original mark unit, including the first piece of text.
  function foldInline(paragraph, label, ordinal) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest(generated) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    let text = '', node;
    while ((node = walker.nextNode())) {
      nodes.push({node, start:text.length});
      text += node.data;
    }
    const start = text.search(label);
    if (start < 0 || !text.slice(0, start).trim()) return;
    const hit = nodes.find(part => part.start + part.node.length > start);
    let edge = hit.node;
    if (start > hit.start) edge = edge.splitText(start - hit.start);
    const button = document.createElement('button'), parts = [];
    button.type = 'button'; button.className = 'study-practice-reference study-inline-toggle';
    button.dataset.readerMetadata = 'study-disclosure'; button.textContent = 'Current practice';
    edge.before(button);
    for (let first = edge; first && paragraph.contains(first);) {
      const parent = first.parentNode;
      for (let item = first; item;) {
        const next = item.nextSibling;
        if (!(item.nodeType === Node.ELEMENT_NODE && (item.matches(generated) || item.hidden))) {
          const part = document.createElement('span');
          part.id = 'study-extra-' + ordinal + '-' + parts.length;
          part.className = 'study-inline-body';
          item.before(part); part.append(item); parts.push(part);
        }
        item = next;
      }
      if (parent === paragraph) break;
      let ancestor = parent;
      while (!ancestor.nextSibling && ancestor !== paragraph) ancestor = ancestor.parentNode;
      first = ancestor === paragraph ? null : ancestor.nextSibling;
    }
    function show(open) {
      button.setAttribute('aria-expanded', String(open));
      for (const part of parts) part.hidden = !open;
    }
    for (const part of parts) inlineParts.set(part, show);
    button.setAttribute('aria-controls', parts.map(part => part.id).join(' '));
    button.addEventListener('click', () => show(button.getAttribute('aria-expanded') !== 'true'));
    show(false);
  }

  function foldPractice(copy) {
    const labelled = /(?:current practice\s*\(not the book\)|current guidance\s*\(separate from the book\)|current clinical distinction)\s*[:.]/i;
    let ordinal = 0;
    for (const paragraph of copy.querySelectorAll('p,li')) {
      if (paragraph.closest(generated + ',summary,.study-current-practice,.study-inline-body') || paragraph.querySelector('p,li')) continue;
      const at = sourceText(paragraph).search(labelled);
      if (at < 0) continue;
      if (at > 0) { foldInline(paragraph, labelled, ++ordinal); continue; }
      const note = paragraph.parentElement.matches('.note,blockquote') && paragraph.parentElement.childElementCount === 1 ? paragraph.parentElement : paragraph;
      const details = document.createElement('details'), summary = document.createElement('summary');
      details.className = 'study-current-practice';
      summary.dataset.readerMetadata = 'study-heading';
      summary.textContent = 'Current practice';
      details.append(summary);
      if (note.tagName === 'LI') {
        details.append(...note.childNodes);
        note.append(details);
      } else {
        note.before(details);
        details.append(note);
      }
    }
  }

  function signature(node) {
    // Never conflate similar doses, different printed pages or distinct answer
    // keys. Source destinations and image URLs are part of the identity.
    const links = [...node.querySelectorAll('a[href],img')].filter(n => !n.closest(generated))
      .map(n => n.getAttribute('href') ?? n.dataset.src ?? n.getAttribute('src'));
    return JSON.stringify([sourceText(node), links]);
  }

  function mergeRepeats(copy) {
    const seen = new Map();
    for (const node of copy.querySelectorAll('.study-current-practice, .study-group p, .study-group li')) {
      if (node.hidden || !node.closest('.study-group') || node.closest(generated)) continue;
      const practice = node.matches('.study-current-practice');
      if (!practice && (node.closest('.study-current-practice,.drill-q,table') || node.querySelector('p,li,details,button,input'))) continue;
      const text = sourceText(node);
      if (text.length < 32 && !node.querySelector('a[href]')) continue;
      const kind = practice ? 'current' : node.closest('.study-group').dataset.studyGroup;
      const key = kind + ':' + signature(node);
      const first = seen.get(key);
      if (!first) { seen.set(key, node); continue; }
      const set = repeats.get(first) || {shown:first, items:[first]};
      set.items.push(node); repeats.set(first, set); repeats.set(node, set);
      // A preexisting saved mark takes precedence over an unmarked twin.
      if (node.querySelector('[data-marked]') && !set.shown.querySelector('[data-marked]')) {
        set.shown.hidden = true; set.shown = node;
      } else node.hidden = true;
      if (practice) {
        const link = document.createElement('button');
        link.type = 'button'; link.className = 'study-practice-reference';
        link.dataset.readerMetadata = 'study-reference'; link.textContent = 'Current practice';
        node.before(link);
        link.hidden = !node.hidden;
        link.addEventListener('click', () => {
          reveal(node);
          node.open = true;
          node.querySelector('summary').focus({preventScroll:true});
        });
      }
    }
  }

  function reveal(target) {
    const raw = target instanceof Range ? target.startContainer : target;
    const el = raw?.nodeType === Node.TEXT_NODE ? raw.parentElement : raw;
    if (!el?.closest?.('.study-page')) return target;
    // A saved range can start exactly at the boundary of an existing mark
    // span that encloses a hidden inline suffix.
    if (el.matches('[data-mark-key],[data-range],[data-marked]')) {
      for (const part of el.querySelectorAll('.study-inline-body')) inlineParts.get(part)?.(true);
    }
    for (let node = el; node && !node.matches('.study-page'); node = node.parentElement) {
      inlineParts.get(node)?.(true);
      if (sourceTitles.has(node)) node.hidden = false;
      const repeat = repeats.get(node);
      if (repeat && repeat.shown !== node) {
        for (const twin of repeat.items) {
          twin.hidden = twin !== node;
          const link = twin.previousElementSibling;
          if (link?.matches('.study-practice-reference')) link.hidden = !twin.hidden;
        }
        repeat.shown = node;
      }
      const group = groups.get(node);
      if (group) setOpen(group, true);
      else if (node.tagName === 'DETAILS') node.open = true;
    }
    return target;
  }

  function mount(copy, chapter) {
    if (!copy || !/^(?:\d+s|laws)$/.test(String(chapter)) || copy.dataset.notLoaded || copy.classList.contains('study-page')) return;
    const families = new Map();
    let major = 'summary', current = major, key = null, fragment = null;
    copy.classList.add('study-page');
    numberRecall(copy);
    for (const node of [...copy.childNodes]) {
      if (node.nodeType !== Node.ELEMENT_NODE) { if (fragment) fragment.append(node); continue; }
      if (node.matches('h1,.eyebrow,.study-flashcards,.law-cards,.memory-aids,.article-cards')) {
        fragment = null; key = null;
        continue;
      }
      let title = null, next = current;
      const text = sourceText(node);
      if (node.matches('h2,h3,h4,h5,h6')) {
        title = family(text);
        if (node.tagName === 'H2') major = title || 'summary';
        current = title || major; next = current;
      } else if (node.tagName === 'P' && text.length < 115 && node.querySelector('strong,b') && family(text)) {
        title = family(text); current = title; next = current;
      } else if (node.matches('.drill-q,.drill-score,[data-reader-metadata="practice-actions"]')) next = 'recall';
      else if (/^exam traps?\s*:/i.test(text)) next = 'traps';
      if (key !== next || !fragment) fragment = makeFragment(copy, node, next, families);
      key = next;
      fragment.append(node);
      // Pure headings are represented by the group label. Year, topic or
      // Hebrew subtitles remain inside the group and retain their destinations.
      if (title && /^(?:summary|\u05e1\u05d9\u05db\u05d5\u05dd|recall|what (?:the )?exams? asked|exam questions?|israeli context|exam traps?(?:\s*\/\s*book (?:notes|emphases|nuances|contradictions|against itself))?)$/i.test(text)) {
        node.hidden = true;
        sourceTitles.add(node);
      }
    }
    if(families.has('summary'))setOpen(families.get('summary'),true);
    foldPractice(copy);
    mergeRepeats(copy);
    copy.addEventListener('click', event => {
      const href = event.target.closest?.('a[href]')?.getAttribute('href');
      if (!href?.startsWith('#')) return;
      let id;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      reveal(document.getElementById(id));
    });
  }
  return {mount, reveal};
})();
