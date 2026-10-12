/* Runtime data only. Canonical questions and all saved values stay unchanged. */
window.HazzardQuestionData = (() => {
  let catalogPromise, byId;
  const chunks=new Map(), complete=new Set();
  async function json(path){const r=await fetch(path);if(!r.ok)throw Error('Question data unavailable. Reconnect and try again.');return r.json();}
  function catalog(){return catalogPromise ||= json('data/mcq/catalog.json').then(items=>{byId=new Map(items.map(q=>[q.id,q]));return items;}).catch(e=>{catalogPromise=null;throw e;});}
  function ready(q){return complete.has(q.id);}
  async function hydrate(items){
    await catalog();
    await Promise.all([...new Set(items.filter(q=>!ready(q)).map(q=>q.id.slice(4,6)))].map(key=>{
      if(!chunks.has(key))chunks.set(key,json('data/mcq/chunks/'+key+'.json').then(rows=>{
        for(const q of rows){const item=byId.get(q.id);if(item){Object.assign(item,q);complete.add(q.id);}}
      }).catch(e=>{chunks.delete(key);throw e;}));
      return chunks.get(key);
    }));
    for(const q of items){const canonical=byId.get(q.id);if(canonical&&q!==canonical)Object.assign(q,canonical);if(!ready(q))throw Error('Question body unavailable. Reconnect and try again.');}
    return items;
  }
  async function full(){return hydrate(await catalog());}
  return {catalog,hydrate,ready,full};
})();
