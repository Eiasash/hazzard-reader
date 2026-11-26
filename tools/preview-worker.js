/* Built for the isolated preview origin. Only the reader shell gates activation. */
const RELEASE = __RELEASE__;
const BUILD = __BUILD__;
const CACHE = 'reader-preview-' + BUILD;
const SHELL = __SHELL__;
const LIST = './asset-list.json';
const READY = './.offline-ready';
const TAKEOVER = './.replace-preview';
let warming = null;
let progress = 0;
let interrupted = false;

async function download(file, priority) {
  const url = new URL(file.url, self.registration.scope);
  if (url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) throw Error('Invalid preview asset');
  const response = await fetch(url, {cache:'no-store', priority});
  if (!response.ok) throw Error('Could not load ' + file.url);
  const bytes = await response.clone().arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
  if (hash !== file.sha256) throw Error('Preview asset changed during download');
  return response;
}

async function eachFile(files, concurrency, visit) {
  let next = 0;
  const run = async () => {
    while (next < files.length) await visit(files[next++]);
  };
  const done = await Promise.allSettled(Array.from({length:concurrency},run));
  const failure = done.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await eachFile(SHELL, 4, async file => {
    await cache.put(file.url, await download(file,'high'));
  });
  if (self.registration.active) await cache.put(TAKEOVER,new Response(BUILD));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const replacing = !!await cache.match(TAKEOVER);
  for (const name of await caches.keys()) {
    if (name !== CACHE && /^(?:reader-preview-|hazzard-)/.test(name)) await caches.delete(name);
  }
  await self.clients.claim();
  if (!replacing) return;
  await cache.delete(TAKEOVER);
  const pages = await self.clients.matchAll({type:'window'});
  for (const page of pages) {
    // Do not await this navigation inside activate: its fetch is released
    // after the activation event completes. Old preview pages have no reload listener.
    if (page.url.startsWith(self.registration.scope)) page.navigate(page.url).catch(()=>{});
  }
})()));

async function status(target) {
  const cache = await caches.open(CACHE);
  const complete = !!await cache.match(READY);
  target?.postMessage({type:'HAZZARD_OFFLINE_STATUS',version:RELEASE,build:BUILD,complete,downloading:!!warming,interrupted,progress:complete?100:progress});
  return complete;
}

async function warmOffline() {
  const cache = await caches.open(CACHE);
  if (await cache.match(READY)) return;
  const list = await (await cache.match(LIST)).json();
  if (list.version !== RELEASE || !list.files.length) throw Error('Invalid offline manifest');
  let count = 0, lastNotice = 0;
  await eachFile(list.files, 3, async file => {
    if (!await cache.match(file.url)) await cache.put(file.url, await download(file,'low'));
    progress = Math.floor(100 * ++count / list.files.length);
    if (Date.now()-lastNotice > 1500) {
      lastNotice = Date.now();
      for (const page of await self.clients.matchAll()) await status(page);
    }
  });
  await cache.put(READY,new Response(BUILD));
  for (const page of await self.clients.matchAll()) await status(page);
}

self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'HAZZARD_VERSION') {
    event.ports[0]?.postMessage({version:RELEASE,build:BUILD});return;
  }
  if (type === 'HAZZARD_OFFLINE_STATUS' || event.data === 'status') {
    event.waitUntil(status(event.source));return;
  }
  if (type === 'PREVIEW_BACKGROUND') {
    if (!warming) {
      interrupted=false;
      warming=warmOffline().catch(()=>{interrupted=true;}).finally(async()=>{
        warming=null;
        for(const page of await self.clients.matchAll())await status(page);
      });
    }
    event.waitUntil(status(event.source));
    event.waitUntil(warming);
  }
});

self.addEventListener('fetch', event => {
  const req=event.request;
  const lookup=new URL(req.url);
  if(lookup.pathname===new URL('manifest.json',self.registration.scope).pathname&&lookup.searchParams.get('check-newer')==='1')return;
  if (req.method!=='GET' || !req.url.startsWith(self.registration.scope)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const hit=await cache.match(req.mode==='navigate'?'./index.html':req,{ignoreSearch:true});
    return hit || fetch(req);
  })());
});
