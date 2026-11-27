/* Release status is transient UI only; it never writes notebook data. */
(() => {
  const VERSION = 'v336', RELEASED = '27.11.2026';
  window.HazzardRelease = Object.freeze({version:VERSION});
  function start() {
    const updateButton = document.createElement('button');
    updateButton.id = 'readerUpdateButton'; updateButton.type = 'button'; updateButton.hidden = true;
    document.body.append(updateButton);
    const detail = document.getElementById('releaseStatus'), legacy = document.getElementById('offlineReady');
    const sw = navigator.serviceWorker;
    let registration, complete = false, progress = null, progressVersion = VERSION, newerController = false, applying = false, saveError = '', pauseTimer;
    let starting = null, preparing = false, prepareError = '';
    const waiting = () => registration?.waiting || newerController;
    function render() {
      let state, text;
      if (applying) { state = 'waiting'; text = 'Saving before update…'; }
      else if (!navigator.onLine) { state = complete ? 'offline' : 'incomplete'; text = complete ? 'Offline - ' + VERSION + ' ready' : 'Offline copy incomplete'; }
      else if (waiting()) { state = 'waiting'; text = saveError ? 'Save failed - tap to retry' : 'Update ready - tap to reload'; }
      else if (prepareError) { state='incomplete';text='Offline download interrupted'; }
      else if (preparing || registration?.installing) { state = 'downloading'; text = progress === null ? 'Downloading offline copy' : 'Updating... ' + progress + '%'; }
      else { state = complete ? 'ready' : 'downloading'; text = VERSION + (complete ? ' - offline ready' : ' - offline copy incomplete'); }
      const downloading = !waiting() && progress !== null && navigator.onLine;
      const progressText = progressVersion + ' - downloading ' + progress + '%';
      const cloud = window.HazzardCloud;

      // One deadline refresh; sync scheduling and update-on-tap stay independent.
      clearTimeout(pauseTimer);
      const delay = cloud?.pauseAt - Date.now();
      if (navigator.onLine && delay >= 0) pauseTimer = setTimeout(render, Math.min(delay + 1, 2147483647));
      detail.dataset.readiness = waiting() || applying || preparing || registration?.installing ? 'pending' : complete ? 'ready' : 'incomplete';
      detail.dataset.status = state;
      const notebook=document.querySelector('#appTabs [data-tab="notebook"]');
      notebook.toggleAttribute('data-sync-paused',!!cloud?.paused);
      notebook.setAttribute('aria-label',cloud?.paused?'Notebook · Cloud paused':'Notebook');
      updateButton.hidden = state !== 'waiting';
      updateButton.textContent = text;
      updateButton.disabled = applying;
      const chapterUpdate = document.querySelector('[data-chapter-update]');
      if (chapterUpdate) { chapterUpdate.hidden = !waiting(); chapterUpdate.disabled = applying || !navigator.onLine; chapterUpdate.onclick = applyUpdate; }
      const at = window.HazzardStorage?.status.snapshotAt;
      const time = at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at) : 'none yet';
      detail.textContent = 'Version ' + VERSION + ' (released ' + RELEASED + ') - ' + (navigator.onLine ? 'Online' : 'Offline') + ' - Offline copy: ' + (downloading ? progressText : complete ? 'complete' : 'incomplete') + ' - Last snapshot: ' + time;
      const download=document.getElementById('downloadOffline');
      if(download){
        const why=complete?'The offline copy is already saved.':!sw?'This browser does not support offline storage.':
          !navigator.onLine?'Reconnect to download the offline copy.':waiting()?'Use the update control to activate the saved copy.':'The live reader downloads its offline copy automatically.';
        const retry = !!prepareError && navigator.onLine && !starting;
        download.textContent = retry ? 'Retry offline download' : 'Download for offline';
        setButtonUnavailable(download,retry ? '' : why);
        download.hidden=download.disabled;
        const status=document.getElementById('settingsOfflineStatus');
        if(status){status.hidden=!download.disabled;status.textContent=complete?'Available offline':!sw?'Offline storage unavailable':!navigator.onLine?'Offline copy incomplete':downloading?progressText:'Preparing offline copy';}
      }
      const summary = document.getElementById('appearanceSummary');
      summary.textContent = downloading ? progressText : VERSION + ' · ' + (complete ? 'Offline ready' : 'Offline incomplete');
      summary.title = summary.textContent + ' — tap for details';
      // Home already observes this element; keep one status source for both views.
      if (legacy.textContent !== text) legacy.textContent = text;
      legacy.hidden = false;
    }
    function requestStatus() { sw?.controller?.postMessage({ type: 'HAZZARD_OFFLINE_STATUS' }); render(); }
    function prepareCold() {
      return new Promise((resolve,reject) => {
        const loader=new Worker(new URL('sw.js?prepare='+encodeURIComponent(VERSION),location.href));
        const fail=error=>{loader.terminate();reject(error);};
        loader.onerror=()=>fail(Error('Offline download interrupted'));
        loader.onmessage=event=>{
          const data=event.data;
          if(data.error){fail(Error(data.error));return;}
          if(data.prepared){loader.terminate();resolve();return;}
          if(Number.isFinite(data.progress)){progress=data.progress;progressVersion=VERSION;render();}
        };
        loader.postMessage({type:'HAZZARD_PREPARE_COLD',version:VERSION});
      });
    }
    function registerReader(){
      if(starting||!sw)return starting;
      prepareError='';
      starting=(async()=>{
        const prior=await sw.getRegistration();
        if(!sw.controller&&!prior?.active){
          preparing=true;progress=0;render();
          await prepareCold();
        }
        const reg=await sw.register('sw.js');
        registration=reg;
        reg.addEventListener('updatefound',()=>watch(reg.installing));
        watch(reg.installing);requestStatus();
      })().catch(error=>{prepareError=error.message||'Offline download interrupted';progress=null;complete=false;})
        .finally(()=>{preparing=false;starting=null;render();});
      return starting;
    }
    function watch(worker) {
      if (!worker) return;
      progress = null;
      worker.addEventListener('statechange', () => { if(worker.state==='redundant')progress=null;render(); requestStatus(); });
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
    addEventListener('online', () => { requestStatus(); if (prepareError) registerReader(); });
    addEventListener('offline', requestStatus);
    addEventListener('hazzard-storage-status', render);
    addEventListener('hazzard-cloud-status', render);
    document.addEventListener('visibilitychange', () => {
      if(document.hidden||applying)return;
      requestStatus();
      if(navigator.onLine)registration?.update().catch(()=>{});
    });
    if (sw) {
      sw.addEventListener('message', async event => {
        const data = event.data;
        if (data?.type !== 'HAZZARD_OFFLINE_STATUS') return;
        const source=event.source;
        if(!source?.scriptURL||new URL(source.scriptURL).origin!==location.origin||new URL(source.scriptURL).pathname!==new URL('sw.js',location.href).pathname)return;
        if(Number.isFinite(data.progress)){
          const reg=registration||await sw.getRegistration();
          const current=data.version===VERSION;
          const update=/^v\d+$/.test(data.version)&&Number(data.version.slice(1))>Number(VERSION.slice(1))&&(source===reg?.installing||source===reg?.waiting);
          if(!current&&!update)return;
          progress=Math.max(0,Math.min(100,Math.floor(data.progress)));progressVersion=data.version;
        }
        if (event.source === sw.controller) {
          complete = data.version === VERSION && data.complete === true;
          if(complete&&!registration?.installing)progress=null;
          newerController = data.version !== VERSION && data.complete === true;
        }
        render();
      });
      sw.addEventListener('controllerchange', () => { complete = false; requestStatus(); });
      document.getElementById('downloadOffline')?.addEventListener('click',registerReader);
      registerReader();
      sw.ready.then(requestStatus).catch(() => {});
    }
    render();
  }
  if (window.HazzardPrepareUpdate) start();
  else addEventListener('hazzard-reader-ready', start, { once: true });
})();
