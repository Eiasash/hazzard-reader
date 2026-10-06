/* Release status is transient UI only; it never writes notebook data. */
(() => {
  const VERSION = 'v121', RELEASED = '06.10.2026';
  window.HazzardRelease = Object.freeze({version:VERSION});
  function start() {
    const chip = document.getElementById('readerStatusChip'), button = chip.closest('button');
    const updateButton = document.createElement('button');
    updateButton.id = 'readerUpdateButton'; updateButton.type = 'button'; updateButton.hidden = true;
    document.body.append(updateButton);
    const detail = document.getElementById('releaseStatus'), legacy = document.getElementById('offlineReady');
    const sw = navigator.serviceWorker;
    let registration, complete = false, progress = null, newerController = false, applying = false, saveError = '', pauseTimer;
    const waiting = () => registration?.waiting || newerController;
    function render() {
      let state, text;
      if (applying) { state = 'waiting'; text = 'Saving before update…'; }
      else if (!navigator.onLine) { state = complete ? 'offline' : 'incomplete'; text = complete ? 'Offline - ' + VERSION + ' ready' : 'Offline copy incomplete'; }
      else if (waiting()) { state = 'waiting'; text = saveError ? 'Save failed - tap to retry' : 'Update ready - tap to reload'; }
      else if (registration?.installing) { state = 'downloading'; text = progress === null ? 'Downloading offline copy' : 'Updating... ' + progress + '%'; }
      else { state = complete ? 'ready' : 'downloading'; text = VERSION + (complete ? ' - offline ready' : ' - offline copy incomplete'); }
      const cloud = window.HazzardCloud;

      // One deadline refresh; sync scheduling and update-on-tap stay independent.
      clearTimeout(pauseTimer);
      const delay = cloud?.pauseAt - Date.now();
      if (navigator.onLine && delay >= 0) pauseTimer = setTimeout(render, Math.min(delay + 1, 2147483647));
      chip.dataset.readiness = waiting() || applying || registration?.installing ? 'pending' : complete ? 'ready' : 'incomplete';
      chip.dataset.status = cloud?.paused ? 'cloud-paused' : state;
      const chipText = (state === 'waiting' ? VERSION + ' - update available' : text) + (cloud?.paused ? ' - Cloud paused' : '');
      button.querySelector('span:not(#readerStatusChip)').textContent = cloud?.paused ? 'Cloud paused' : 'Text';
      chip.textContent = '';chip.setAttribute('aria-label',chipText);
      button.title = 'Text & appearance — ' + chipText;
      button.setAttribute('aria-label', button.title);
      updateButton.hidden = state !== 'waiting';
      updateButton.textContent = text;
      updateButton.disabled = applying;
      const chapterUpdate = document.querySelector('[data-chapter-update]');
      if (chapterUpdate) { chapterUpdate.hidden = !waiting(); chapterUpdate.disabled = applying || !navigator.onLine; chapterUpdate.onclick = applyUpdate; }
      const at = window.HazzardStorage?.status.snapshotAt;
      const time = at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at) : 'none yet';
      detail.textContent = 'Version ' + VERSION + ' (released ' + RELEASED + ') - ' + (navigator.onLine ? 'Online' : 'Offline') + ' - Offline copy: ' + (complete ? 'complete' : 'incomplete') + ' - Last snapshot: ' + time;
      const storage = window.HazzardStorage?.status;
      const protection = storage?.persisted === true ? 'protected' : storage?.persisted === false ? 'not protected' : 'protection checking';
      const summary = document.getElementById('appearanceSummary');
      summary.textContent = VERSION + ' - ' + (navigator.onLine ? 'online' : 'offline') + ' - ' + (complete ? 'offline ready' : 'offline incomplete') + ' - ' + protection + ' - ' + (storage?.error ? 'snapshot error' : 'snapshot ' + time);
      summary.textContent+=' - '+(window.HazzardCloud?.label()||'Cloud: not signed in');
      summary.title = summary.textContent + ' — tap for details';
      // Home already observes this element; keep one status source for both views.
      if (legacy.textContent !== text) legacy.textContent = text;
      legacy.hidden = false;
    }
    function requestStatus() { sw?.controller?.postMessage({ type: 'HAZZARD_OFFLINE_STATUS' }); render(); }
    function watch(worker) {
      if (!worker) return;
      progress = null;
      worker.addEventListener('statechange', () => { render(); requestStatus(); });
      render();
    }
    async function applyUpdate(event) {
      if (!waiting() || !navigator.onLine) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (applying) return;
      window.HazzardStorage?.requestPersistence();
      applying = true; saveError = ''; render();
      // Freeze interactions only during the requested save/activation, so a new
      // answer cannot race the snapshot we are about to await.
      const surfaces = [...document.querySelectorAll('main,#appTabs,#chapterHeader,#panel,#markBar')];
      const previous = surfaces.map(element => element.inert);
      surfaces.forEach(element => { element.inert = true; });
      try {
        await window.HazzardPrepareUpdate();
        const worker = registration?.waiting;
        if (worker) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { sw.removeEventListener('controllerchange', changed); reject(Error('Update did not activate. Tap to try again.')); }, 15000);
            function changed() { clearTimeout(timeout); sw.removeEventListener('controllerchange', changed); resolve(); }
            sw.addEventListener('controllerchange', changed);
            worker.postMessage({ type: 'HAZZARD_APPLY_UPDATE' });
          });
        }
        location.reload();
      } catch (error) {
        applying = false; saveError = error.message || 'Could not save before update.';
        surfaces.forEach((element, i) => { element.inert = previous[i]; });
        render();
        detail.textContent += ' - ' + saveError;
      }
    }
    updateButton.addEventListener('click', applyUpdate, true);
    addEventListener('online', requestStatus);
    addEventListener('offline', requestStatus);
    addEventListener('hazzard-storage-status', render);
    addEventListener('hazzard-cloud-status', render);
    document.addEventListener('visibilitychange', () => {
      if(document.hidden||applying)return;
      // Lock synchronously on return, before a tap can reach an old release.
      const root=document.documentElement,wasInert=root.inert;root.inert=true;
      const controller=sw?.controller;
      if(!controller){root.inert=wasInert;return;}
      const channel=new MessageChannel();
      const finish=()=>{clearTimeout(timeout);channel.port1.close();root.inert=wasInert;};
      const timeout=setTimeout(finish,5000);
      channel.port1.onmessage=event=>{
        if(!document.hidden&&parseInt(event.data?.version?.slice(1),10)>parseInt(VERSION.slice(1),10)){
          clearTimeout(timeout);channel.port1.close();location.reload();return;
        }
        finish();requestStatus();
      };
      controller.postMessage({type:'HAZZARD_VERSION'},[channel.port2]);
    });
    if (sw) {
      sw.addEventListener('message', event => {
        const data = event.data;
        if (data?.type !== 'HAZZARD_OFFLINE_STATUS') return;
        if (event.source === registration?.installing && Number.isFinite(data.progress)) progress = data.progress;
        if (event.source === sw.controller) {
          complete = data.version === VERSION && data.complete === true;
          newerController = data.version !== VERSION && data.complete === true;
        }
        render();
      });
      sw.addEventListener('controllerchange', () => { complete = false; requestStatus(); });
      sw.register('sw.js').then(reg => {
        registration = reg;
        reg.addEventListener('updatefound', () => watch(reg.installing));
        watch(reg.installing); requestStatus();
      }).catch(() => { complete = false; render(); });
      sw.ready.then(requestStatus).catch(() => {});
    }
    render();
  }
  if (window.HazzardPrepareUpdate) start();
  else addEventListener('hazzard-reader-ready', start, { once: true });
})();
