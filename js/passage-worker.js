// Each occurrence encodes the passage and word position. Phrase matching
// intersects adjacent positions, including the intervening punctuation.
const cache = new Map();
const shardRoot = '../search/' + new URL(self.location.href).searchParams.get('corpus') + '/';
async function shard(name) {
  if (!cache.has(name)) {
    const promise = fetch(shardRoot + name + '.bin').then(async response => {
      if (!response.ok) throw Error('Search incomplete');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    }).catch(error => { cache.delete(name); throw error; });
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    cache.set(name, promise);
  }
  return cache.get(name);
}
async function bucket(key) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return new DataView(hash).getUint16(0) % 1024;
}
function unpack(encoded) {
  const bytes = atob(encoded || ''), values = [];
  let previous=0, delta=0, shift=1;
  for(let i=0;i<bytes.length;i++){
    const b=bytes.charCodeAt(i);
    delta+=(b&127)*shift;
    if(b<128){previous+=delta;values.push(previous);delta=0;shift=1;}else shift*=128;
  }
  return values;
}
const common=new Set(['of','the','a','in','to','and','with','for','on','or']);
async function candidates(term, prefix, positional, previous) {
  if(previous&&common.has(previous.trim())){
    const key=previous+'|'+[...term].slice(0,3).join('');
    const entries=(await shard('pair-'+await bucket(key)))[key]||{};
    return Object.entries(entries).filter(([word])=>prefix?word.startsWith(term):word===term).flatMap(([,v])=>unpack(v));
  }
  const short = [...term].length < 3;
  const data = await shard((positional ? short && prefix ? 'short-' : 'pos-' : 'docs-') + await bucket([...term].slice(0, 3).join('')));
  if (short && prefix) return unpack(data['\0' + term] || []);
  if (!prefix) return unpack(data[term] || []);
  return Object.entries(data).filter(([key]) => key.startsWith(term)).flatMap(([, values]) => unpack(values));
}
let active = 0;
let hits = [], hitsFor = '', visible = [], visibleOrder = '';
self.onmessage = async ({data}) => {
  const {ticket, query, offset = 0} = data;
  active = ticket;
  try {
    if (query!==hitsFor) {
      const lower=query.toLowerCase(), lead=lower.match(/^[^\p{L}\p{N}\p{M}_]+/u)?.[0] || '';
      const words = lower.slice(lead.length).match(/[\p{L}\p{N}\p{M}_]+[^\p{L}\p{N}\p{M}_]*/gu) || [];
      const leadingMatches=lead ? shard('symbol-'+(await bucket([...lead][0]))%64).then(group=>
        new Set(Object.entries(group).filter(([mark])=>words.length?mark===lead:mark.startsWith(lead)).flatMap(([,v])=>unpack(v)))
      ) : Promise.resolve(null);
      let ids;
      if(!words.length) ids=[...(await leadingMatches||[])].map(n=>Math.floor(n/65536));
      else if (words.length === 1 && !lead) ids = await candidates(words[0], true, false);
      else {
        // One posting for a common connector and its successor replaces two large lists.
        const probes = [];
        for(let i=0;i<words.length;i++){
          const previous=i>0?words[i-1]:null;
          if(i+1<words.length && common.has(words[i].trim()) && !(previous&&common.has(previous.trim())))continue;
          probes.push({offset:i, list:candidates(words[i],i===words.length-1,true,previous)});
        }
        const [leading,lists]=await Promise.all([leadingMatches,Promise.all(probes.map(p=>p.list))]);
        const tail=lists.slice(1).map(list=>new Set(list));
        ids=lists[0].filter(start=>(!leading||leading.has(start-probes[0].offset))&&tail.every((set,i)=>set.has(start+probes[i+1].offset-probes[0].offset))).map(n=>Math.floor(n/65536));

      }
      if (ticket !== active) return;
      hits = [...new Set(ids)].sort((a,b) => a-b);hitsFor=query;visibleOrder='';
    }
    // Keep the reader's chapter order and three passages per page. Count
    // the complete hit set before fetching any text.
    const orderKey=data.order.join(',');
    if(visibleOrder!==orderKey){
      visible=[];
      const firstAtOrAfter=n=>{let lo=0,hi=hits.length;while(lo<hi){const mid=(lo+hi)>>>1;if(hits[mid]<n)lo=mid+1;else hi=mid;}return lo;};
      for(const chapter of data.order){
        const bounds=data.bounds[chapter];if(!bounds)continue;
        const i=firstAtOrAfter(bounds[0]);
        for(let j=i;j<i+3&&j<hits.length&&hits[j]<bounds[1];j++)visible.push(hits[j]);
      }
      visibleOrder=orderKey;
    }
    const page=visible.slice(offset, offset+(offset?16:4));
    const rows=await Promise.all(page.map(async id=>(await shard('text-'+Math.floor(id/8)))[id%8]));
    if(ticket===active)postMessage({ticket,total:hits.length,rows,offset,next:offset+rows.length<visible.length?offset+rows.length:null});
  } catch (error) { if (ticket === active) postMessage({ticket, error:error.message}); }
};
