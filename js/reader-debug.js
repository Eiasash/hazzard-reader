/* Local diagnostics only. Loaded before the application; no network operations. */
(() => {
  'use strict';
  const KEY = 'hazzard-debug-log-v1', MARKER = 'hazzardDebugOverlayV1';
  const LIMIT = 100, MAX_BYTES = 128 * 1024;
  const encoder = new TextEncoder();
  let entries = [], persistTimer, lastPersist = 0, dialog, prepared = '', restoreFocus;
  let closing = false, taps = 0, lastTap = 0, uiTimer;
  const workers = new Map();
  const version = () => window.HazzardRelease?.version || 'startup (version not loaded)';
  // Preserve canonical reader IDs, not arbitrary strings with a familiar prefix.
  const readerID = value => /^(?:mcq-[a-f0-9]{24,64}|ima-2026-\d{2}|ima-article-(?:iwg-2024|vascog-2-wso-2025|aa-2024|dementia-prevention-treatment-2024)|(?:chapter-)?\d{1,3}s?)$/i.test(value) || !!document.getElementById(value)?.matches('.reading-copy [id]');
  function scrub(value) {
    if (typeof value !== 'string') return '[non-text]';
    if (value.length > 16000) return '[oversized text omitted]';
    return value
      .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, raw => {
        try { const url = new URL(raw); return url.protocol + '//' + url.host + url.pathname; } catch { return '[URL redacted]'; }
      })
      .replace(/(?:["']?(?:authorization|token|password|secret|api[-_ ]?key|username)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[labelled secret redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
      .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[email redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT redacted]')
      .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[UUID redacted]')
      .replace(/\b[A-Za-z0-9_+\/-]{32,}={0,2}/g, token => readerID(token) ? token : '[token redacted]')
      .slice(0, 1000);
  }
  function safePart(value) {
    if (typeof value === 'string') return value;
    if (value === null || ['number', 'boolean', 'undefined', 'bigint'].includes(typeof value)) return String(value);
    // Never JSON.stringify caller objects or invoke their getters/toString.
    try {
      if (value instanceof Error) {
        const fields = Object.getOwnPropertyDescriptors(value);
        return ['message', 'stack'].map(k => typeof fields[k]?.value === 'string' ? fields[k].value : '').join(' ');
      }
    } catch {}
    return '[object omitted]';
  }
  function trim() {
    if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
    while (entries.length && encoder.encode(JSON.stringify(entries)).length > MAX_BYTES) entries.shift();
  }
  function persist() {
    clearTimeout(persistTimer); persistTimer = null; lastPersist = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify({schema:1, entries:entries.slice(-50)})); } catch {}
  }
  function schedulePersist() {
    if (!persistTimer) persistTimer = setTimeout(persist, Math.max(0, 2000 - (Date.now() - lastPersist)));
  }
  function record(level, parts, location = '') {
    try {
      const message = scrub(parts.slice(0, 12).map(safePart).map(s => s.length > 16000 ? '[oversized text omitted]' : s).join(' '));
      const at = new Date().toISOString(), where = scrub(location), previous = entries.at(-1);
      if (previous && previous.level === level && previous.message === message && previous.location === where && previous.version === version()) {
        previous.repeat = Math.min(previous.repeat + 1, 1000000); previous.lastAt = at;
      } else entries.push({at, level, version:version(), message, location:where, repeat:1});
      trim(); schedulePersist(); scheduleRender();
    } catch {} // Diagnostics must never break the reader or recursively log itself.
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && raw.length <= MAX_BYTES) {
      const saved = JSON.parse(raw);
      if (saved.schema === 1 && Array.isArray(saved.entries)) entries = saved.entries.slice(-50).filter(e => e && typeof e.message === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.at) && ['warn','error','rejection'].includes(e.level)).map(e => ({at:e.at, level:e.level, version:scrub(e.version), message:scrub(e.message), location:scrub(e.location || ''), repeat:Number.isInteger(e.repeat) ? Math.max(1, Math.min(e.repeat, 1000000)) : 1}));
      trim();
    }
  } catch {}
  for (const level of ['warn','error']) {
    const original = console[level];
    console[level] = function (...args) { record(level, args); return Reflect.apply(original, console, args); };
  }
  addEventListener('error', event => record('error', [event.message || 'Resource failed to load'], (event.filename || '') + (event.lineno ? ':' + event.lineno + ':' + event.colno : '')), true);
  addEventListener('unhandledrejection', event => record('rejection', [event.reason]));
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  function route() {
    const url = new URL(location.href), query = {};
    for (const key of ['chapter','q','lawCard','review','simulation']) {
      const value = url.searchParams.get(key);
      if (value !== null) query[key] = /^(?:bank|mock|laws?|drugs|[01])$/.test(value) || readerID(value) ? value : '[redacted]';
    }
    return {path:scrub(url.pathname), query, hash:scrub(url.hash)};
  }
  function workerInfo(worker) { return worker ? {state:worker.state, version:workers.get(worker)?.version || 'unknown', offlineComplete:workers.get(worker)?.complete ?? null} : null; }
  let registration;
  function diagnostics() {
    const storage = [];
    let storageAvailable = true;
    try {
      const extra = new Set([KEY,'hazzard-whats-new-seen-v1','hazzard-cloud-session-v1','hazzard-cloud-state-v1']);
      for (const key of Object.keys(localStorage).sort()) {
        if (!extra.has(key) && !window.HazzardStorage?.owns(key)) continue;
        storage.push({key:scrub(key), bytes:encoder.encode(localStorage.getItem(key) || '').length});
      }
    } catch { storageAvailable = false; }
    return {schema:1, capturedAt:new Date().toISOString(), pageVersion:version(), serviceWorker:{supported:'serviceWorker' in navigator, controlling:workerInfo(navigator.serviceWorker?.controller), waiting:workerInfo(registration?.waiting), installing:workerInfo(registration?.installing)}, online:navigator.onLine, userAgent:scrub(navigator.userAgent), viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}, route:route(), cloudSignedIn:window.HazzardCloud?.signedIn === true, storageAvailable, storageByteConvention:'UTF-8 value bytes; names and sizes only', storage, log:entries.map(e => ({...e})), limits:{memoryEntries:100,persistedEntries:50,messageCharacters:1000,serializedLogBytes:MAX_BYTES}, note:'Local page warnings/errors only. Service-worker-internal errors and some browser warnings are not captured.'};
  }
  function render() {
    if (!dialog?.open) return;
    prepared = JSON.stringify(diagnostics(), null, 2);
    dialog.querySelector('pre').textContent = prepared;
    dialog.querySelector('textarea').value = prepared;
  }
  function scheduleRender() { if (dialog?.open && !uiTimer) uiTimer = setTimeout(() => { uiTimer = null; render(); }, 200); }
  function refreshWorkers() {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    sw.getRegistration().then(reg => {
      registration = reg;
      for (const worker of [sw.controller, reg?.waiting, reg?.installing]) {
        try { worker?.postMessage({type:'HAZZARD_OFFLINE_STATUS'}); } catch {}
      }
      render();
    }).catch(() => {});
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'HAZZARD_OFFLINE_STATUS' || !event.source) return;
    workers.set(event.source, {version:scrub(event.data.version), complete:event.data.complete === true}); scheduleRender();
  });
  function finishClose() {
    if (!dialog?.open) return;
    dialog.close(); closing = false; taps = 0;
    restoreFocus?.focus?.({preventScroll:true});
  }
  function close() {
    if (closing || !dialog?.open) return;
    if (history.state?.[MARKER]) { closing = true; history.back(); }
    else finishClose();
  }
  function open(push = true) {
    if (!dialog || dialog.open) return;
    restoreFocus = document.activeElement;
    if (push && !history.state?.[MARKER]) history.pushState({...history.state, [MARKER]:true}, '');
    closing = false; dialog.showModal(); render(); refreshWorkers();
    dialog.querySelector('[data-debug="close"]').focus({preventScroll:true});
  }
  // Capture before reader popstate/Escape handlers: the overlay owns exactly one entry.
  addEventListener('popstate', event => {
    if (history.state?.[MARKER]) { event.stopImmediatePropagation(); open(false); }
    else if (dialog?.open) { event.stopImmediatePropagation(); finishClose(); }
  }, true);
  document.addEventListener('keydown', event => {
    if (dialog?.open && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }, true);
  function start() {
    dialog = document.createElement('dialog'); dialog.id = 'readerDebug'; dialog.setAttribute('aria-labelledby','readerDebugTitle');
    dialog.innerHTML = '<h2 id="readerDebugTitle">Reader debug</h2><div class="debug-actions"><button data-debug="copy">Copy</button><button data-debug="save">Save as file</button><button data-debug="clear">Clear log</button><button data-debug="close">Close</button></div><p role="status" id="readerDebugStatus">Diagnostics stay on this device.</p><textarea aria-label="Select diagnostics to copy" readonly hidden></textarea><pre></pre>';
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      const action = event.target.closest('[data-debug]')?.dataset.debug;
      const status = dialog.querySelector('[role="status"]');
      if (action === 'close') close();
      if (action === 'clear') {
        clearTimeout(persistTimer); persistTimer = null; entries = [];
        try { localStorage.removeItem(KEY); } catch {}
        render(); status.textContent = 'Log cleared.';
      }
      if (action === 'copy') {
        const fallback = () => { const area = dialog.querySelector('textarea'); area.hidden = false; area.focus({preventScroll:true}); area.select(); status.textContent = 'Copy unavailable. Select and copy the text below.'; };
        try {
          if (!navigator.clipboard?.writeText) return fallback();
          navigator.clipboard.writeText(prepared).then(() => { status.textContent = 'Copied.'; }, fallback);
        } catch { fallback(); }
      }
      if (action === 'save') {
        try {
          const url = URL.createObjectURL(new Blob([prepared], {type:'application/json'})), link = document.createElement('a');
          link.href = url; link.download = 'hazzard-debug-' + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
          dialog.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
          status.textContent = 'Debug download started.';
        } catch { status.textContent = 'Download could not be started. Use Copy instead.'; }
      }
    });
    const panel = document.getElementById('panel');
    document.getElementById('panelTitle')?.addEventListener('click', () => {
      if (!panel?.open || panel.dataset.currentPane !== 'tools') { taps = 0; return; }
      const now = performance.now(); taps = now - lastTap > 1000 ? 1 : taps + 1; lastTap = now;
      if (taps >= 7) { taps = 0; open(); }
    });
    if (panel) new MutationObserver(() => { if (!panel.open || panel.dataset.currentPane !== 'tools') taps = 0; }).observe(panel, {attributes:true,attributeFilter:['open','data-current-pane']});
    if (new URL(location.href).searchParams.get('debug') === '1' || history.state?.[MARKER]) open();
  }
  addEventListener('online', scheduleRender); addEventListener('offline', scheduleRender); addEventListener('resize', scheduleRender);
  addEventListener('hazzard-cloud-status', scheduleRender);
  addEventListener('pageshow', () => { if (history.state?.[MARKER]) open(false); if (dialog?.open) { render(); refreshWorkers(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
