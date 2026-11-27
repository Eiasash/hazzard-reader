const CACHE_VERSION = 'v338'; // On-demand reading and question data.
// Release caches activate only after the reader's update tap.
const SHELL_CACHE = 'hazzard-shell-' + CACHE_VERSION + '-sources';
const SHELL_URL = './index.html';
const LIST_URL = './asset-list.json';
const READY_URL = './.offline-ready';

async function verifyCachedAssets(cache, urls) {
  for (let start = 0; start < urls.length; start += 64) {
    const batch = urls.slice(start, start + 64);
    const matches = await Promise.all(batch.map(url => cache.match(url)));
    for (let i = 0; i < batch.length; i++) {
      if (!matches[i]?.ok) throw new Error('Missing offline file: ' + batch[i]);
    }
  }
}
async function fingerprint(response) {
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function download(url, hash, priority = 'auto') {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', priority });
      if (!response.ok) throw new Error('Download failed: ' + url);
      if (hash && await fingerprint(response.clone()) !== hash) throw new Error('File changed during update: ' + url);
      return response;
    } catch (error) { failure = error; }
  }
  throw failure;
}
// On first use a tab-owned worker stages the full book, so a slow connection
// cannot exhaust the service worker's install-event lifetime. An upgrade in an
// older reader uses the same hash checks and never replaces its active cache early.
async function prepareRelease(scope, notify, background = false) {
  const prepare = async () => {
    const listResponse = await download(LIST_URL);
    const list = await listResponse.clone().json();
    if (list.version !== CACHE_VERSION || !list.files?.length) throw new Error('Wrong offline file list');
    const cache = await caches.open(SHELL_CACHE);
    const savedList = await cache.match(LIST_URL);
    const assets = [LIST_URL, ...list.files.map(file => file.url)];
    if (savedList?.ok && await fingerprint(savedList) === await fingerprint(listResponse.clone())) {
      try {
        const saved=await cache.match(READY_URL), receipt=saved?.ok&&await saved.json();
        if(receipt.complete&&receipt.version===CACHE_VERSION&&receipt.assets?.length===assets.length&&assets.every((url,i)=>url===receipt.assets[i])){
          await verifyCachedAssets(cache,assets);await notify(100);return;
        }
      } catch { /* A missing or unreadable entry will be checked and repaired below. */ }
    }
    await cache.delete(READY_URL);
    const staged = new Set((await cache.keys()).map(request => request.url));
    const previous = [];
    for (const name of await caches.keys()) {
      if (name === SHELL_CACHE || !name.startsWith('hazzard-shell-')) continue;
      const old = await caches.open(name);
      const [receipt, manifest] = await Promise.all([old.match(READY_URL), old.match(LIST_URL)]);
      if (!receipt?.ok || !manifest?.ok) continue;
      try {
        const verified = await receipt.json(), source = await manifest.json();
        if (verified.complete && verified.version === source.version && Array.isArray(source.files)) {
          previous.push({cache: old, hashes: new Map(source.files.map(file => [file.url, file.sha256]))});
        }
      } catch { /* Fetch from the network if an earlier cache is incomplete. */ }
    }
    let next = 0, completed = 0, lastNotice = 0;
    let failure = null;
    async function stage(file) {
      const {url, sha256} = file;
      const absolute = new URL(url, scope);
      if (!absolute.href.startsWith(scope) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid offline file');
      if (staged.has(absolute.href)) {
        const stored = await cache.match(absolute.href);
        if (stored?.ok && await fingerprint(stored) === sha256) return;
      }
      for (const old of previous) {
        if (old.hashes.get(url) !== sha256) continue;
        const copy = await old.cache.match(absolute.href);
        if (copy?.ok) { await cache.put(absolute.href, copy); return; }
      }
      await cache.put(absolute.href, await download(absolute.href, sha256, background ? 'low' : 'auto'));
    }
    async function fill() {
      try {
        while (!failure && next < list.files.length) {
          await stage(list.files[next++]);
          completed++;
          if (Date.now() - lastNotice >= 500 || completed === list.files.length) {
            lastNotice = Date.now();
            await notify(Math.floor(100 * completed / list.files.length));
          }
        }
      } catch (error) { failure = error; }
    }
    await Promise.all(Array.from({length: background ? 2 : 6}, fill));
    if (failure) throw failure;
    await cache.put(LIST_URL, listResponse);
    await verifyCachedAssets(cache, assets);
    await cache.put(READY_URL, new Response(JSON.stringify({version: CACHE_VERSION, complete: true, assets}),
      {headers: {'Content-Type':'application/json'}}));
  };
  if (navigator.locks?.request) return navigator.locks.request(SHELL_CACHE + '@' + scope, prepare);
  return prepare();
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    await prepareRelease(scope, async progress => {
      const clients = await self.clients.matchAll({includeUncontrolled:true});
      for (const client of clients) if (client.url.startsWith(scope)) {
        client.postMessage({type:'HAZZARD_OFFLINE_STATUS', version:CACHE_VERSION, complete:false, progress});
      }
    });
    // Workers before v50 had no explicit update button.
    if ((await caches.keys()).includes('hazzard-shell-v49-r1')) await self.skipWaiting();
  })());
});
async function offlineStatus() {
  const cache = await caches.open(SHELL_CACHE);
  const ready = await cache.match(READY_URL);
  const status = ready && await ready.json();
  if (status?.version !== CACHE_VERSION || status.complete !== true || !status.assets?.length) throw new Error('Update incomplete');
  await verifyCachedAssets(cache, status.assets);
  return cache;
}
self.addEventListener('message', event => {
  if (!self.registration) {
    if (event.data?.type !== 'HAZZARD_PREPARE_COLD') return;
    const scope = new URL('./', self.location.href).href;
    if (event.data.version !== CACHE_VERSION) { self.postMessage({error:'Release changed. Reload the reader.'}); return; }
    const shared=typeof BroadcastChannel==='function'?new BroadcastChannel(SHELL_CACHE+'@'+scope):null;
    if(shared)shared.onmessage=e=>{if(Number.isFinite(e.data))self.postMessage({progress:e.data});};
    prepareRelease(scope, progress => {self.postMessage({progress});shared?.postMessage(progress);}, true).then(
      () => self.postMessage({prepared:true}), error => self.postMessage({error:error.message})).finally(()=>shared?.close());
    return;
  }
  if(event.data?.type==='HAZZARD_VERSION'){event.ports[0]?.postMessage({version:CACHE_VERSION});return;}
  if (event.data?.type === 'HAZZARD_APPLY_UPDATE') {
    event.waitUntil(offlineStatus().then(() => self.skipWaiting()));
    return;
  }
  if (event.data?.type !== 'HAZZARD_OFFLINE_STATUS') return;
  event.waitUntil((async () => {
    let complete = false;
    try { await offlineStatus(); complete = true; } catch {}
    event.source?.postMessage({ type: 'HAZZARD_OFFLINE_STATUS', version: CACHE_VERSION, complete });
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await offlineStatus();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hazzard-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const lookup=new URL(req.url);
  if(lookup.pathname===new URL('manifest.json',self.registration.scope).pathname&&lookup.searchParams.get('check-newer')==='1')return;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const appPath=new URL(self.registration.scope).pathname;
  if(req.mode==='navigate'&&lookup.pathname!==appPath&&lookup.pathname!==appPath+'index.html')return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Serve one complete release, online as well as offline. Network-first
    // navigation could otherwise mix a new shell with an interrupted update.
    const cached = await cache.match(req.mode === 'navigate' ? SHELL_URL : req, { ignoreSearch: true });
    return cached || fetch(req);
  })());
});
