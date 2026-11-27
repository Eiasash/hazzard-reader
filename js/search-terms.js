/* Shared matching for reader search fields. A chapter request is resolved against
   the actual chapter ID by each screen, independently of numbers in its prose. */
window.HazzardSearchTerms = (() => {
  function normalize(value) {
    return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  }
  function prepare(value) {
    const text=normalize(value);
    return {text,words:text?text.split(' '):[]};
  }
  function oneEdit(a,b) {
    if(Math.abs(a.length-b.length)>1)return false;
    let i=0;
    while(i<a.length&&i<b.length&&a[i]===b[i])i++;
    if(a.length===b.length){
      if(a.slice(i+1)===b.slice(i+1))return true;
      return i+1<a.length&&a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);
    }
    return a.length>b.length?a.slice(i+1)===b.slice(i):a.slice(i)===b.slice(i+1);
  }
  function compile(value) {
    const query=prepare(value);
    const chapter=query.text.match(/^(?:ch(?:apter)?|\u05e4\u05e8\u05e7)\s*(\d{1,3})$/u)?.[1]??null;
    function rank(value){
      const source=typeof value==='string'?prepare(value):value;
      if(!query.text)return 0;
      if(!source?.text)return Infinity;
      if(source.text===query.text)return 0;
      if(source.text.includes(query.text))return 1;
      let fuzzy=false;
      for(const word of query.words){
        if(source.text.includes(word))continue;
        if(word.length<5||/\d/u.test(word)||!source.words.some(candidate=>oneEdit(word,candidate)))return Infinity;
        fuzzy=true;
      }
      return fuzzy?3:2;
    }
    return {...query,chapter:chapter?String(Number(chapter)):null,rank,test:source=>Number.isFinite(rank(source))};
  }
  return {normalize,prepare,compile};
})();
