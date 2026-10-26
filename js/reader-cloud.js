/* Optional cloud copies use the same portable notebook as the download. */
window.HazzardCloud = (() => {
  const URL='https://krmlzwwelqvlfslwltol.supabase.co/rest/v1/rpc/';
  const APIKEY='sb_publishable_tUuqQQ8RKMvLDwTz5cKkOg_o_y-rHtw';
  const SESSION='hazzard-cloud-session-v1',STATE='hazzard-cloud-state-v1',INTERVAL=120000;
  const read=key=>{try{return JSON.parse(localStorage.getItem(key))||{};}catch{return {};}};
  let session=read(SESSION),state=read(STATE),bridge,timer,busy=false,checking=false,restoring=false,merging=false,epoch=0;
  let current=null,previous=null,known=false,error='',notice='',expired=false,tick=false;
  let authMode='login',authBusy=false,passwordOpen=false,passwordBusy=false;
  const USERNAME_RULE='Use 3-32 lowercase letters, digits, _ or -, starting with a letter or digit.';
  const PASSWORD_RULE='Password must be 6-200 characters.';
  const $=id=>document.getElementById(id);
  const signed=()=>typeof session.session_token==='string'&&!!session.session_token&&typeof session.username==='string';
  const decided=()=>signed()&&state.username===session.username&&state.decided===true;
  // UI-only health: offline alone is never a paused cloud connection.
  const pauseAt=()=>state.dirty&&state.syncedAt?new Date(state.syncedAt).getTime()+86400000:NaN;
  const recoveryPaused=()=>window.HazzardStorage?.blockedKeys().length>0;
  const paused=()=>recoveryPaused()||navigator.onLine&&!!(session.username||state.username)&&(expired||!signed()||Date.now()>pauseAt());
  function saveState(){localStorage.setItem(STATE,JSON.stringify(state));}
  const time=(at,date=false)=>{
    if(!at||!Number.isFinite(new Date(at).getTime()))return '';
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
    const part=name=>parts.find(p=>p.type===name).value;
    return (date?part('day')+'.'+part('month')+' ':'')+part('hour')+':'+part('minute');
  };
  function label(){
    if(recoveryPaused())return (signed()?'Cloud: '+session.username+' - ':'Cloud ')+'paused - a saved store could not be read';
    if(paused())return 'Cloud paused - '+(!signed()||expired?'sign in again':'last sync '+time(state.syncedAt,true));
    if(expired)return 'Cloud: sign in again';
    if(!signed())return 'Cloud: not signed in';
    const prefix='Cloud: '+session.username;
    if(time(state.restoredAt)&&(!time(state.syncedAt)||new Date(state.restoredAt)>new Date(state.syncedAt)))
      return prefix+' - restored '+time(state.restoredAt,true)+(time(state.restoredCopyAt)?' (cloud copy from '+time(state.restoredCopyAt,true)+')':'');
    return prefix+(time(state.syncedAt)?' - last synced '+time(state.syncedAt):' - not synced yet');
  }
  function render(){
    if(!bridge)return;
    $('cloudStatus').textContent=label();
    $('cloudError').textContent=error||notice;
    const loggedIn=signed();
    $('cloudAuthChoices').hidden=loggedIn;
    $('cloudLogin').hidden=loggedIn||authMode!=='login';
    $('cloudRegister').hidden=loggedIn||authMode!=='register';
    $('cloudActions').hidden=!loggedIn;
    $('cloudPasswordChange').hidden=!loggedIn||!passwordOpen;
    $('cloudShowLogin').setAttribute('aria-pressed',String(authMode==='login'));
    $('cloudShowRegister').setAttribute('aria-pressed',String(authMode==='register'));
    $('cloudChangePassword').setAttribute('aria-expanded',String(passwordOpen));
    for(const id of ['cloudShowLogin','cloudShowRegister','cloudSignIn','cloudCreateAccount'])$(id).disabled=authBusy;
    $('cloudSavePassword').disabled=passwordBusy;
    const entry=loggedIn?session.username+' - '+(time(state.syncedAt)?'last synced '+time(state.syncedAt,true):'not synced yet'):'Sign in to sync';
    for(const id of ['cloudSettingsEntry','cloudNotebookEntry'])$(id).textContent=entry;
    $('cloudDecision').hidden=!signed()||decided()||!known;
    $('cloudDecisionText').textContent=current?.exists?'Choose which notebook to use on this phone.':'No cloud copy yet. Choose Start fresh to enable uploads.';
    $('cloudUseLocal').hidden=!bridge.hasData()||!current?.exists;
    $('cloudStartFresh').hidden=bridge.hasData()&&!!current?.exists;
    $('cloudRestore').disabled=busy||checking||!known||!current?.exists;
    $('cloudPrevious').disabled=busy||checking||!known||!previous?.exists;
    $('cloudRestore').textContent='Restore from cloud'+(current?.exists?' (saved '+time(current.updated_at,true)+')':'');
    $('cloudPrevious').textContent='Restore previous cloud copy'+(previous?.exists?' (saved '+time(previous.updated_at,true)+')':'');
    $('cloudSync').disabled=busy||checking||!decided()||recoveryPaused();
    $('cloudUseLocal').disabled=busy||checking;$('cloudStartFresh').disabled=busy||checking;
    dispatchEvent(new Event('hazzard-cloud-status'));
  }
  function expire(){
    epoch++;session={};expired=true;tick=false;clearTimeout(timer);
    try{localStorage.removeItem(SESSION);}catch{}
    error='';render();
  }
  async function rpc(name,args,keepalive=false,token=session.session_token){
    const response=await fetch(URL+name,{method:'POST',headers:{apikey:APIKEY,'Content-Type':'application/json'},body:JSON.stringify(args),keepalive,signal:AbortSignal.timeout(20000)});
    const result=await response.json();
    if(result?.error==='not_signed_in'&&token===session.session_token){expire();throw Error('Cloud: sign in again');}
    if(!response.ok||result?.ok!==true){
      const messages={
        locked:'Account locked. Try again later.',
        username_taken:'That username is already taken.',
        invalid_username:'Invalid username. '+USERNAME_RULE,
        weak_password:PASSWORD_RULE,
        invalid_password:PASSWORD_RULE,
        invalid_credentials:name==='auth_change_password'?'Current password is incorrect.':'Incorrect username or password.'
      };
      throw Error(messages[result?.error]||'Cloud unavailable. Will retry later.');
    }
    return result;
  }
  function schedule(){
    clearTimeout(timer);
    if(!signed()||!decided()||restoring||recoveryPaused())return;
    timer=setTimeout(()=>push(),Math.max(2000,INTERVAL-(Date.now()-(state.attemptAt||0))));
  }
  async function inspect(){
    if(!signed()||checking||busy||recoveryPaused())return;
    if(!navigator.onLine){schedule();return;}
    checking=true;const generation=epoch,token=session.session_token;render();
    try{
      const a=await rpc('hazzard_cloud_get',{p_token:token,p_which:'current'},false,token);
      if(generation!==epoch||recoveryPaused())return;
      const b=await rpc('hazzard_cloud_get',{p_token:token,p_which:'prev'},false,token);
      if(generation!==epoch||recoveryPaused())return;
      current=a;previous=b;known=true;error='';
      if(!decided()&&bridge.hasData()&&!a.exists){state={username:session.username,decided:true,dirty:true};saveState();}
      if(decided())await push({manual:true,incoming:a});
    }catch(e){if(generation===epoch)error=e.message;}
    finally{checking=false;render();if(signed()&&!known&&!recoveryPaused()){clearTimeout(timer);timer=setTimeout(inspect,INTERVAL);}}
  }
  async function push({manual=false,keepalive=false,incoming=null}={}){
    if(!signed()||!decided()||busy||checking&&!incoming||restoring||recoveryPaused())return;
    if(!navigator.onLine){schedule();return;}
    if(!manual&&Date.now()-(state.attemptAt||0)<INTERVAL){schedule();return;}
    busy=true;clearTimeout(timer);const generation=epoch,token=session.session_token;
    const beforeState=JSON.stringify(state);
    try{
      state.attemptAt=Date.now();render();
      const cloud=incoming||await rpc('hazzard_cloud_get',{p_token:token,p_which:'current'},keepalive,token);
      if(generation!==epoch||recoveryPaused())return;
      // The backup bridge uses the current device as current and cloud as incoming.
      // Re-capture after asynchronous work so edits made during the fetch survive.
      merging=true;
      let payload;
      try{payload=await bridge.merge(cloud.exists?cloud.data:null,()=>generation===epoch&&!recoveryPaused());}
      finally{merging=false;}
      if(generation!==epoch||recoveryPaused())return;
      const differs=!cloud.exists||!bridge.equal(payload.storage,cloud.data.storage);
      if(differs){
        const result=await rpc('hazzard_cloud_set',{p_token:token,p_data:payload,p_app_version:window.HazzardRelease.version,p_device:navigator.userAgent},keepalive,token);
        if(generation!==epoch)return;
        state.syncedAt=result.updated_at||new Date().toISOString();state.seenAt=result.updated_at||null;
        previous=cloud.exists?cloud:previous;
        current={exists:true,updated_at:state.syncedAt,data:payload};
      }else{current=cloud;state.seenAt=cloud.updated_at||null;}
      known=true;
      state.dirty=!bridge.equal(bridge.capture().storage,payload.storage);
      // attemptAt is a scheduling clock, not a reason to write unchanged storage.
      const persisted={...state};delete persisted.attemptAt;
      const prior=JSON.parse(beforeState);delete prior.attemptAt;
      if(JSON.stringify(persisted)!==JSON.stringify(prior))saveState();
      tick=true;error='';notice='';
    }catch(e){if(generation===epoch){tick=false;error=expired?'':e.message;}}
    finally{busy=false;render();if(signed())schedule();}
  }

  function changed(){
    if(restoring||merging||!decided())return;
    state.dirty=true;tick=false;
    try{saveState();}catch{error='Cloud settings could not be saved.';}
    render();schedule();
  }
  function choose(){
    try{state={username:session.username,decided:true,dirty:true};saveState();error='';render();push({manual:true});}
    catch{error='Cloud settings could not be saved.';render();}
  }
  async function restore(which){
    if(busy||restoring||!signed())return;
    busy=true;const generation=epoch,token=session.session_token;render();
    try{
      // Fetch at the tap: another device may have updated either copy.
      const copy=await rpc('hazzard_cloud_get',{p_token:token,p_which:which},false,token);
      if(generation!==epoch)return;
      if(!copy.exists)throw Error('No cloud copy is available.');
      if(!confirm('Restore '+(which==='prev'?'previous cloud copy':'from cloud')+' (saved '+time(copy.updated_at,true)+')? This replaces this phone’s notebook. A local snapshot is saved first.'))return;
      restoring=true;clearTimeout(timer);
      const summary=await bridge.restore(copy.data);
      if(generation!==epoch)return;
      state={username:session.username,decided:true,dirty:false,restoredAt:new Date().toISOString(),restoredCopyAt:copy.updated_at};saveState();
      tick=false;error='';notice='Cloud copy restored. Local snapshot kept.'+(summary||'');
      // Do not immediately re-upload a restore: retain the server's previous copy.
    }catch(e){if(generation===epoch)error=e.message||'Restore failed.';}
    finally{restoring=false;busy=false;render();}
  }
  function clearPasswords(){
    for(const field of document.querySelectorAll('#cloudControls input[type="password"]'))field.value='';
  }
  function setAuthMode(mode){
    if(authBusy)return;
    authMode=mode;clearPasswords();error='';notice='';render();
    $(mode==='register'?'cloudRegisterUsername':'cloudUsername').focus();
  }
  async function authenticate(event,register=false){
    event.preventDefault();
    const username=$(register?'cloudRegisterUsername':'cloudUsername').value.trim();
    const password=$(register?'cloudRegisterPassword':'cloudPassword').value;
    const again=register?$('cloudRegisterAgain').value:'';
    const displayName=register?$('cloudDisplayName').value.trim():'';
    clearPasswords();
    if(authBusy)return;
    authBusy=true;error='';notice='';render();const generation=++epoch;
    try{
      if(register){
        if(!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username))throw Error('Invalid username. '+USERNAME_RULE);
        if([...password].length<6||[...password].length>200)throw Error(PASSWORD_RULE);
        if(password!==again)throw Error('Passwords do not match.');
      }
      const result=await rpc(register?'auth_register_user':'auth_login_user',register?
        {p_username:username,p_password:password,p_display_name:displayName||null}:{p_username:username,p_password:password});
      if(generation!==epoch)return;
      if(typeof result.session_token!=='string'||!result.session_token||typeof result.username!=='string')throw Error('Sign-in response was incomplete.');
      const next={session_token:result.session_token,username:result.username};
      localStorage.setItem(SESSION,JSON.stringify(next));session=next;expired=false;tick=false;known=false;
      current=null;previous=null;passwordOpen=false;authMode='login';
      // Explicit sign-in enables the existing merge-based sync on this device.
      if(!decided()){
        state=state.username===session.username?{...state,decided:true,dirty:true}:{username:session.username,decided:true,dirty:true};
        saveState();
      }
      await inspect();
    }catch(e){if(generation===epoch)error=e.message;}
    finally{clearPasswords();authBusy=false;render();}
  }
  async function changePassword(event){
    event.preventDefault();
    const oldPassword=$('cloudCurrentPassword').value,newPassword=$('cloudNewPassword').value,again=$('cloudNewAgain').value;
    clearPasswords();
    if(passwordBusy||!signed())return;
    passwordBusy=true;error='';notice='';render();
    const generation=epoch,username=session.username,token=session.session_token;
    try{
      if([...newPassword].length<6||[...newPassword].length>200)throw Error(PASSWORD_RULE);
      if(newPassword!==again)throw Error('New passwords do not match.');
      await rpc('auth_change_password',{p_username:username,p_old_password:oldPassword,p_new_password:newPassword},false,token);
      if(generation!==epoch)return;
      passwordOpen=false;notice='Password changed.';
    }catch(e){if(generation===epoch)error=e.message;}
    finally{clearPasswords();passwordBusy=false;render();}
  }
  function start(api){
    bridge=api;
    // Normalize only in memory; an unchanged reload must not rewrite storage.
    if(!signed())state=state.username?{username:state.username}:{};
    if(signed()&&state.username!==session.username)state={username:session.username};
    $('cloudLogin').addEventListener('invalid',clearPasswords,true);
    $('cloudLogin').addEventListener('submit',event=>authenticate(event));
    $('cloudRegister').addEventListener('submit',event=>authenticate(event,true));
    $('cloudPasswordChange').addEventListener('submit',changePassword);
    $('cloudShowLogin').onclick=()=>setAuthMode('login');
    $('cloudShowRegister').onclick=()=>setAuthMode('register');
    $('cloudChangePassword').onclick=()=>{
      passwordOpen=!passwordOpen;clearPasswords();error='';notice='';render();
      if(passwordOpen)$('cloudCurrentPassword').focus();
    };
    $('cloudCancelPassword').onclick=()=>{passwordOpen=false;clearPasswords();error='';notice='';render();};
    for(const id of ['cloudSettingsEntry','cloudNotebookEntry'])$(id).addEventListener('click',event=>{
      // The existing delegated tools button toggles an already-open panel.
      if($('panel').dataset.currentPane==='tools')event.stopPropagation();
      if(!signed())authMode='login';render();
      requestAnimationFrame(()=>{
        $('appearanceStatus').open=true;
        requestAnimationFrame(()=>{
          $('cloudControls').scrollIntoView({block:'start'});
          $(signed()?'cloudSync':'cloudUsername').focus({preventScroll:true});
        });
      });
    });
    $('cloudUsername').value=session.username||state.username||'';
    $('cloudSignOut').onclick=()=>{
      clearPasswords();
      try{localStorage.removeItem(SESSION);epoch++;session={};expired=false;tick=false;known=false;current=null;previous=null;passwordOpen=false;authMode='login';clearTimeout(timer);error='';notice='';}
      catch{error='Sign out could not be saved.';}
      render();
    };
    $('cloudUseLocal').onclick=choose;$('cloudStartFresh').onclick=choose;
    $('cloudSync').onclick=()=>push({manual:true});
    $('cloudRestore').onclick=()=>restore('current');$('cloudPrevious').onclick=()=>restore('prev');
    addEventListener('hazzard-snapshot-saved',changed);
    addEventListener('hazzard-storage-status',render);
    addEventListener('online',()=>{if(!known)inspect();else schedule();});
    // Lifecycle sync uses the same interval and never dirties unchanged storage.
    const leave=()=>{if(decided()&&!restoring)push({keepalive:true});};
    addEventListener('pagehide',leave);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)leave();else if(!known)inspect();});
    addEventListener('storage',event=>{if(event.key===SESSION||event.key===STATE){epoch++;session=read(SESSION);state=read(STATE);known=false;tick=false;render();if(signed())inspect();}});
    render();if(signed())inspect();
  }
  return {start,label,get signedIn(){return signed();},get tick(){return tick;},get paused(){return paused();},get pauseAt(){return pauseAt();}};
})();
