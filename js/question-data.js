/* Runtime data only. Canonical questions and all saved values stay unchanged. */
window.HazzardQuestionData = (() => {
  let catalogPromise, byId, assignmentPromise;
  const chunks=new Map(), bodies=new Map();
  async function json(path){const r=await fetch(path);if(!r.ok)throw Error('Question data unavailable. Reconnect and try again.');return r.json();}
  // Official records keep their imported metadata. Reader chapter placement is a separate bibliography-derived index.
  function readerRows(path){
    assignmentPromise ||= json('data/mcq/reader-chapters.json').catch(error=>{assignmentPromise=null;throw error});
    return Promise.all([json(path),assignmentPromise]).then(([rows,assignments])=>rows.map(q=>{
      const assignment=assignments[q.id];
      return assignment?{...q,chapter:assignment[0],chapterTitle:assignment[1]}:q;
    }));
  }
  function catalog(){return catalogPromise ||= readerRows('data/mcq/catalog.json').then(items=>{byId=new Map(items.map(q=>[q.id,q]));for(const [id,q] of bodies)if(byId.has(id))Object.assign(byId.get(id),q);return items;}).catch(e=>{catalogPromise=null;throw e;});}
  function ready(q){return bodies.has(q.id)&&Array.isArray(q.o)&&Object.hasOwn(q,'explanation');}
  async function hydrate(items){
    await Promise.all([...new Set(items.filter(q=>!bodies.has(q.id)).map(q=>q.id.slice(4,6)))].map(key=>{
      if(!chunks.has(key))chunks.set(key,readerRows('data/mcq/chunks/'+key+'.json').then(rows=>{
        for(const q of rows){bodies.set(q.id,q);const item=byId?.get(q.id);if(item)Object.assign(item,q);}
      }).catch(e=>{chunks.delete(key);throw e;}));
      return chunks.get(key);
    }));
    // Import metadata in the canonical question can be a plain citation string.
    // The bibliography supplies the structured sitting, chapter and page links.
    const official=items.some(q=>q.kind==='past') ? (await HazzardEvidence.preload()).questions : {};
    for(const q of items){
      const canonical=bodies.get(q.id);
      if(canonical && official[q.id])canonical.officialReference=official[q.id];
      if(canonical && q!==canonical)Object.assign(q,canonical);
      if(!ready(q))throw Error('Question body unavailable. Reconnect and try again.');
    }
    return items;
  }
  async function full(){return hydrate(await catalog());}
  return {catalog,hydrate,ready,full};
})();
