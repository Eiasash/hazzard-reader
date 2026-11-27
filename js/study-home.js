window.HazzardHomeSummary ||= 'data/home-question-summary.json';
/* Home measures the same official questions and first-try results as Statistics. */
window.HazzardStudyHome = (() => {
  const element = id => document.getElementById(id);
  const minimumChapterAnswers = 5;
  let generation = 0, dayTimer;

  function meter(id, count, total) {
    const bar = element(id);
    const known = Number.isInteger(count) && total > 0;
    bar.hidden = !known;
    element(id + 'Count').textContent = known ? count + ' / ' + total : 'Unavailable';
    if (known) {
      bar.max = total;
      bar.value = count;
      bar.setAttribute('aria-valuetext', count + ' of ' + total);
    }
  }

  function notebook(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    HazzardStorage.validate(key, value);
    return value;
  }

  function completedChapters(keys) {
    let finished;
    try {
      const progress = notebook(keys.reading, null);
      const done = new Set(Object.entries(progress?.chapters || {}).filter(([, p]) => p.read).map(([id]) => id));
      // Older notebooks kept a completed page as a saved position or bookmark.
      for (const key of [keys.place, keys.bookmarks]) {
        try {
          const value = notebook(key, null);
          const saved = Array.isArray(value) ? value : [...Object.values(value?.chapters || {}), value?.last];
          for (const place of saved) if (place?.ratio >= 0.9999) done.add(place.chapter);
        } catch (error) { if (!progress) throw error; }
      }
      finished = done;
    } catch { /* An unreadable notebook is different from an empty one. */ }
    return finished;
  }

  function startReading(order, keys) {
    if (!order.length) return null;
    const finished = completedChapters(keys);
    if (!finished) return null;
    const unread = order.find(id => !finished.has(id));
    return {chapter: unread || order[0], reread: !unread};
  }

  function readingCoverage(chapters, keys) {
    const finished = completedChapters(keys);
    for (const [id, kind, pattern] of [
      ['homeRead', 'chapter', /^(?:\d+|law)$/], ['homeStudied', 'study', /^(?:\d+s|laws)$/]
    ]) {
      const entries = chapters.filter(c => c.kind === kind && pattern.test(c.number));
      meter(id, finished && entries.filter(c => finished.has(String(c.number))).length, entries.length);
    }
  }

  function recommend(chapters, evidence, records) {
    const studyIds = new Set(chapters.filter(c => c.kind === 'study').map(c => String(c.number)));
    const book = chapters.filter(c => (c.kind === 'chapter' || c.studyOnly) && /^(?:\d+s?|laws?)$/.test(c.number));
    const rows = book.map(c => {
      const id = String(c.number).replace(/s$/, '');
      const lawIds=id==='law'?records.lawIds:null;
      const yieldCount = lawIds?.length ?? HazzardEvidence.counts(evidence, id).reduce((sum, [, n]) => sum + n, 0);
      const ids = new Set((lawIds||HazzardEvidence.studyIds(evidence, id)).map(HazzardMCQ.currentId));
      const list = [...ids].map(q => records.byId.get(q)).filter(Boolean);
      return {id, title:c.title.replace(/ — Study$/, ''), yieldCount,
        available:[...ids].some(q => records.available.has(q)), ...records.model.measure(list)};
    });
    if (!rows.length) return false;
    const yields = rows.map(r => r.yieldCount).sort((a, b) => a - b);
    const middle = Math.floor(yields.length / 2);
    const median = (yields[middle] + yields[Math.floor((yields.length - 1) / 2)]) / 2;
    const high = rows.filter(r => r.yieldCount > 0 && r.yieldCount >= median && r.available);
    if (!high.length) return false;
    const byYield = (a, b) => b.yieldCount - a.yieldCount || Number(a.id) - Number(b.id);
    const tested = high.filter(r => r.answered >= minimumChapterAnswers).sort((a, b) =>
      a.rate - b.rate || b.answered - a.answered || byYield(a, b));
    const chosen = tested[0] || high.sort(byYield)[0];
    const name = chosen.id==='law'?chosen.title:'Ch. ' + chosen.id + ' · ' + chosen.title;
    const examCount = chosen.yieldCount + ' past exam question' + (chosen.yieldCount === 1 ? '' : 's');
    const detail = element('homeWeakDetail');
    if (tested.length) {
      element('homeWeakName').textContent = name;
      detail.textContent = chosen.clean + ' of ' + chosen.answered + ' answered correctly on the first try (' +
        Math.round(100 * chosen.rate) + '%) · ' + examCount;
    } else {
      element('homeWeakName').textContent = 'Not enough answers yet.';
      detail.textContent = 'Answer ' + minimumChapterAnswers + ' questions in a high-yield chapter. Suggested: ' + name + '.';
    }
    const target = studyIds.has(chosen.id + 's') ? chosen.id + 's' : chosen.id;
    const practice = element('homeWeakPractice'), study = element('homeWeakStudy');
    practice.href = '?chapter=' + target + '&view=questions&source=past';
    practice.setAttribute('aria-label', practice.textContent+' for ' + name);
    study.href = '?chapter=' + target;
    study.textContent = target.endsWith('s') ? 'Study notes' : 'Read chapter';
    study.setAttribute('aria-label', study.textContent + ' for ' + name);
    element('homeWeakActions').hidden = false;
    return true;
  }

  function watchDay(today, chapters, keys) {
    clearTimeout(dayTimer);
    // Jerusalem changes day on a UTC hour boundary, including across DST.
    dayTimer = setTimeout(() => {
      if (element('desk').hidden || document.hidden) return;
      if (HazzardReview.day() !== today) refresh(chapters, keys);
      else watchDay(today, chapters, keys);
    }, 3600000 - Date.now() % 3600000 + 100);
  }

  let homeSummary;
  function summary(){
    return homeSummary ||= (window.HazzardEarlyFetch?.get(window.HazzardHomeSummary)||fetch(window.HazzardHomeSummary)).then(async response=>{
      if(!response.ok)throw Error('Home data unavailable');
      const data=await response.json();
      const catalog=data.questions.map(([id,past,accepted,flags])=>({id,kind:past?'past':'practice',accepted,retired:!!(flags&1),content_changed:!!(flags&2)}));
      if(data.statsRows)for(const [i,[topic,topics,t,chapter,sourceIndex,c,law,source,mockEligible,sourceChecked]] of data.statsRows.entries()){
        const item=catalog[i];
        Object.assign(item,{topic,t,chapter,sourceIndex,c,law});
        if(topics)item.topics=topics;
        if(source)item.source=source;
        if(mockEligible!=null)item.mockEligible=mockEligible;
        if(sourceChecked)item.sourceChecked=sourceChecked;
      }
      for(const [i,t,examNumber] of data.officialSlots||[])Object.assign(catalog[i],{t,examNumber});
      const ids=indexes=>indexes.map(i=>catalog[i].id);
      const currentChapters=Object.fromEntries(Object.entries(data.chapters).map(([key,indexes])=>[key,ids(indexes)]));
      const questions=Object.fromEntries(Object.entries(data.sittings).map(([i,sitting])=>[catalog[i].id,{sitting,number:catalog[i].examNumber}]));
      const changes=data.changes.map(([id,date])=>({id:typeof id==='number'?catalog[id].id:id,changedAt:data.changeDates[date]}));
      const review={catalog,toc:{chapters:data.toc},topics:data.topics,collections:{israeliLawEthics:{ids:ids(data.law)},suppliedArticles:{enabled:data.articleFilterEnabled,ids:ids(data.articles||[])},topicFallbacks:data.topicFallbacks||{}},
        evidence:{questions:{},study:Object.fromEntries((data.studyIds||[]).map(ch=>[ch,true]))}};
      return {catalog,review,changes:[...changes,...HazzardChanged.legacy()],evidence:{currentChapters,study:{},questions},law:ids(data.law)};
    }).catch(error=>{window.HazzardEarlyFetch?.delete(window.HazzardHomeSummary);homeSummary=null;throw error;});
  }
  function catalog(){return window.HazzardHomeSummary?summary().then(x=>x.catalog):HazzardQuestionData.catalog();}
  async function libraryStats(){
    if(window.HazzardHomeSummary){
      const home=await summary();
      return {stats:{all:home.catalog,changes:home.changes},evidence:home.evidence,law:home.law};
    }
    const [stats,evidence,meta]=await Promise.all([HazzardStats.files(),HazzardEvidence.load(),HazzardMCQ.preload()]);
    return {stats,evidence,law:meta[3].israeliLawEthics.ids};
  }
  async function refresh(chapters, keys) {
    const ticket = ++generation;
    readingCoverage(chapters, keys);
    HazzardFlashcards.refreshDue();
    const [catalog, changes, evidence, aliases, metadata] = await Promise.allSettled([
      window.HazzardStudyHome.catalog(), window.HazzardHomeSummary?summary().then(x=>x.changes):HazzardChanged.load(),
      window.HazzardHomeSummary?summary().then(x=>x.evidence):HazzardEvidence.load(), HazzardMCQ.loadAliases(),
      window.HazzardHomeSummary?summary().then(x=>[null,null,null,{israeliLawEthics:{ids:x.law}}]):HazzardMCQ.preload()
    ]);
    if (ticket !== generation || element('desk').hidden) return;
    const stores = HazzardStats.snapshot(), now = Date.now(), today = HazzardReview.day(now);
    const hasCatalog = catalog.status === 'fulfilled' && aliases.status === 'fulfilled';
    let official,due, recommended = false, answered = null, total = 0;
    if (hasCatalog && stores.review.ok && stores.bad.ok && stores.settings.ok) {
      try { due = HazzardReview.catalogDue(catalog.value, now).length;official=HazzardReview.officialDue(catalog.value).length; } catch { /* Legacy answers may be unreadable. */ }
    }
    const shortcut=element('officialDue');
    element('officialCount').textContent=official==null?'Queue unavailable':official?' '+official+' due':'None due today';
    if(official>0)shortcut.href='?chapter=bank&review=1&queue=official';else shortcut.removeAttribute('href');
    element('homeReviewCount').textContent = due == null ? 'Queue unavailable' :
      due + (due === 1 ? ' question due' : ' questions due');
    if (hasCatalog && changes.status === 'fulfilled' && stores.answers.ok && stores.bad.ok) {
      const model = HazzardStats.model({all:catalog.value, changes:changes.value}, stores);
      const official = q => q.kind === 'past' && !HazzardMCQ.excluded(q.id);
      // An answer made before a correction needs another attempt. The question
      // remains in the denominator. A shared citation is still one question.
      const available = model.all.filter(q => official(q) && model.eligible(q));
      const byId = new Map(model.questions.filter(official).map(q => [q.id, q]));
      answered = [...byId.values()].filter(model.answered).length;
      total = available.length;
      if (model.ready && stores.log.ok && evidence.status === 'fulfilled' && metadata.status === 'fulfilled') {
        const lawIds=metadata.value[3].israeliLawEthics.ids.filter(id=>byId.has(id));
        recommended = recommend(chapters, evidence.value, {model, byId, lawIds, available:new Set(available.map(q => q.id))});
      }
    }
    meter('homeAnswered', answered, total);
    if (!recommended) {
      element('homeWeakName').textContent = 'Chapter recommendation unavailable.';
      element('homeWeakDetail').textContent = '';
      element('homeWeakActions').hidden = true;
    }
    element('homeRetry').hidden = recommended && due != null && answered != null && !element('homeRead').hidden;
    watchDay(today, chapters, keys);
  }

  return {refresh, startReading, catalog, libraryStats,statsData:()=>summary().then(x=>({all:x.catalog,topics:x.review.topics,collections:x.review.collections,changes:x.changes})),reviewContext:()=>summary().then(x=>x.review)};
})();
