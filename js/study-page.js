/* Keep the published text nodes in document order. Visual groups may join
   non-adjacent passages without changing the character index used by marks. */
window.HazzardStudyPage = (() => {
  const groups = new WeakMap();
  const repeats = new WeakMap();
  const sourceTitles = new WeakSet();
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

      part.splitText(match[0].length);
      const old = document.createElement('span');
      old.hidden = true;
      part.before(old); old.append(part);
      const displayed = document.createElement('strong');
      displayed.className = 'study-recall-number';
      displayed.dataset.readerMetadata = 'study-number';
      displayed.textContent = number + '.';
      prompt.prepend(displayed);
    }
  }

  // Some older notes place the printed rule and the labelled update in one
  // list item, occasionally split by the user's highlight markup. Keep every
  // fragment in its original mark unit, including the first piece of text.
  function practiceDisclosure(){
    const details=document.createElement('details'), summary=document.createElement('summary');
    details.className='study-current-practice';
    summary.dataset.readerMetadata='study-heading';
    summary.textContent='Current practice';
    details.append(summary);
    return details;
  }
  function foldInline(paragraph,label,register){
    const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);
    const start=paragraph.textContent.search(label);
    let offset=0,node;
    while(node=walker.nextNode()){
      if(offset+node.length<=start){offset+=node.length;continue;}
      const range=document.createRange();
      range.setStart(node,start-offset);range.setEnd(paragraph,paragraph.childNodes.length);
      const suffix=range.extractContents(),details=practiceDisclosure();
      details.append(suffix);paragraph.append(details);
      // extractContents clones an inline ancestor only when the cut divides it.
      // Both halves continue to belong to the same saved sentence.
      for(const part of details.querySelectorAll('span[data-unit]'))register(part);
      return;
    }
  }

  function foldPractice(copy,register) {
    const labelled = /(?:current practice\s*\(not the book\)|current guidance\s*\(separate from the book\)|current clinical distinction)\s*[:.]/i;
    for (const paragraph of copy.querySelectorAll('p,li')) {
      if (paragraph.closest(generated + ',summary,.study-current-practice,.study-inline-body') || paragraph.querySelector('p,li')) continue;
      const at = sourceText(paragraph).search(labelled);
      if (at < 0) continue;
      if (at > 0) { foldInline(paragraph, labelled, register); continue; }
      const note = paragraph.parentElement.matches('.note,blockquote') && paragraph.parentElement.childElementCount === 1 ? paragraph.parentElement : paragraph;
      const details = practiceDisclosure();
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
    for (const node of copy.querySelectorAll('.study-group p, .study-group li')) {
      if (node.hidden || !node.closest('.study-group') || node.closest(generated)) continue;
      if (node.closest('.study-current-practice,.drill-q,table') || node.querySelector('p,li,details,button,input')) continue;
      const text = sourceText(node);
      if (text.length < 32 && !node.querySelector('a[href]')) continue;
      const kind = node.closest('.study-group').dataset.studyGroup;
      const key = kind + ':' + signature(node);
      const first = seen.get(key);
      if (!first) { seen.set(key, node); continue; }
      const set = repeats.get(first) || {shown:first, items:[first]};
      set.items.push(node); repeats.set(first, set); repeats.set(node, set);
      // A preexisting saved mark takes precedence over an unmarked twin.
      if (node.querySelector('[data-marked]') && !set.shown.querySelector('[data-marked]')) {
        set.shown.hidden = true; set.shown = node;
      } else node.hidden = true;

    }
  }

  function reveal(target) {
    const raw = target instanceof Range ? target.startContainer : target;
    const el = raw?.nodeType === Node.TEXT_NODE ? raw.parentElement : raw;
    if (!el?.closest?.('.study-page')) return target;
    for (let node = el; node && !node.matches('.study-page'); node = node.parentElement) {
      if (sourceTitles.has(node)) node.hidden = false;
      const repeat = repeats.get(node);
      if (repeat && repeat.shown !== node) {
        for (const twin of repeat.items) {
          twin.hidden = twin !== node;
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
    mergeRepeats(copy);
    copy.addEventListener('click', event => {
      const href = event.target.closest?.('a[href]')?.getAttribute('href');
      if (!href?.startsWith('#')) return;
      let id;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      reveal(document.getElementById(id));
    });
  }
  return {mount, reveal, foldPractice};
})();
