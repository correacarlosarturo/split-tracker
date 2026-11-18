(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const pad2=n=>String(n).padStart(2,'0');
const dstr=d=>d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
const todayStr=()=>dstr(new Date());
const dayMs=s=>{const a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2],18,0,0).getTime();};
const addDays=(s,n)=>{const a=s.split('-').map(Number);return dstr(new Date(a[0],a[1]-1,a[2]+n));};
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const wdOf=s=>{const a=s.split('-').map(Number);return WD[new Date(a[0],a[1]-1,a[2]).getDay()];};
const fmtDate=s=>wdOf(s)+' '+s.slice(8)+'/'+s.slice(5,7);
const num=v=>{const x=parseFloat(String(v).replace(',','.'));return isFinite(x)?x:null;};
const fmtKg=x=>(Math.round(x*100)/100).toString();
const exById=id=>EX.find(e=>e.id===id);

const state={sessions:{},real:false,tab:'stats',date:todayStr(),draft:null,dirty:false,wr:'1M',ar:'Week',sel:null,sync:'connecting',confirmDel:false};
let sampleCache=null;
/* ---------- local-first data layer + GitHub sync ---------- */
const LS_CO='split-coach-v1',LS_CS='split-coach-shas-v1';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS_S='split-sessions-v2',LS_SA='split-sessions-at-v1',LS_Q='split-queue-v1',LS_C='split-sync-cfg-v1',LS_H='split-shas-v1',LS_L='split-lastsync-v1';
const BUILD='__BUILD__';
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/,FILE_RE=/^\d{4}-\d{2}-\d{2}\.json$/,REPO_RE=/^[\w.-]+\/[\w.-]+$/;
const dayOf=id=>DAYS.find(x=>x.id===id)||null;
const lsGet=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;}};
/* Every session that enters the app (phone storage, sync, backup import) goes through here.
   Unknown fields are dropped and every value gets the type the renderers expect. */
function cleanSession(date,v){
  if(!DATE_RE.test(date)||!v||typeof v!=='object'||Array.isArray(v)||!dayOf(v.day))return null;
  const src=v.entries;if(!src||typeof src!=='object'||Array.isArray(src))return null;
  const out={date,day:v.day,entries:{}};
  for(const id of Object.keys(src)){
    const ex=exById(id),en=src[id];if(!ex||ex.d!==v.day||!en||typeof en!=='object')continue;
    const sets=(Array.isArray(en.sets)?en.sets:[]).map(s=>s&&typeof s==='object'?{kg:num(s.kg),reps:num(s.reps)}:null).filter(s=>s&&s.kg!==null&&s.kg>=0&&s.reps!==null&&s.reps>0);
    if(!sets.length)continue;
    const e={sets};
    if(typeof en.alt==='string'&&(ALT[ex.k]||[]).some(a=>a.id===en.alt))e.alt=en.alt;
    const r=num(en.rpe);if(r!==null&&r>0)e.rpe=r;
    out.entries[id]=e;
  }
  const bw=num(v.bw);if(bw!==null&&bw>0)out.bw=bw;
  if(typeof v.notes==='string'&&v.notes.trim())out.notes=v.notes.trim();
  if(typeof v.savedAt==='string'&&!isNaN(Date.parse(v.savedAt)))out.savedAt=v.savedAt;
  return out;
}
function cleanSessions(o){const out={};if(o&&typeof o==='object')for(const d of Object.keys(o)){const s=cleanSession(d,o[d]);if(s)out[d]=s;}return out;}
/* the unsaved-draft backup keeps raw input strings, but only in the shape renderLog expects */
function cleanBackup(b){
  if(!b||typeof b!=='object'||!DATE_RE.test(b.date)||!dayOf(b.day)||!b.entries||typeof b.entries!=='object')return null;
  const str=x=>x==null?undefined:String(x),entries={};
  for(const id of Object.keys(b.entries)){
    const ex=exById(id),en=b.entries[id];if(!ex||!en||typeof en!=='object')continue;
    entries[id]={sets:Array.isArray(en.sets)?en.sets.map(s=>s&&typeof s==='object'?{kg:str(s.kg),reps:str(s.reps)}:null):[]};
    if(typeof en.alt==='string')entries[id].alt=en.alt;
    if(en.rpe!=null)entries[id].rpe=String(en.rpe);
  }
  return{date:b.date,day:b.day,bw:str(b.bw)||'',notes:typeof b.notes==='string'?b.notes:'',entries};
}
function idbOpen(){return new Promise((res,rej)=>{try{const r=indexedDB.open('split',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}catch(e){rej(e);}});}
async function idbPut(k,v){try{const d=await idbOpen();await new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error);});return true;}catch(e){return false;}}
async function idbGet(k){try{const d=await idbOpen();return await new Promise((res,rej)=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}catch(e){return undefined;}}
/* Both stores get the same timestamp, so on start the newer copy wins. True only if at least one write landed. */
async function persistSessions(){
  const at=Date.now(),ok=lsSet(LS_S,state.sessions)&&lsSet(LS_SA,at);
  const ok2=await idbPut('sessions',JSON.stringify({at,s:state.sessions}));
  return ok||ok2;
}
const queueGet=()=>lsGet(LS_Q,{});
function queue(date,op){const q=queueGet();q[date]=op;lsSet(LS_Q,q);schedSync(15000);}
const cfg=()=>{const c=lsGet(LS_C,null);return c&&typeof c.repo==='string'&&REPO_RE.test(c.repo)&&typeof c.token==='string'&&c.token?c:null;};
let syncT=null,syncing=false,syncState=cfg()?'pending':'off',syncAt=lsGet(LS_L,null),syncErr='';
const hhmmOf=t=>{const n=new Date(t);return pad2(n.getHours())+':'+pad2(n.getMinutes());};
function refreshStatus(){
  const el=$('#sync');if(!el)return;let t,s;
  if(state.dirty){t='Unsaved changes';s='warn';}
  else{
    const loc=state.lastLocal?'Saved '+state.lastLocal:'Ready',q=Object.keys(queueGet()).length;
    if(syncState==='off'){t=loc+' · this phone only. Tap to set up sync';s='warn';}
    else if(syncState==='error'){t=loc+' · sync problem: '+syncErr;s='error';}
    else if(syncState==='syncing'){t=loc+' · syncing…';s='warn';}
    else if(q||syncState==='pending'||syncState==='offline'){t=loc+' · will sync when online';s='warn';}
    else{t=loc+' · synced'+(syncAt?' '+hhmmOf(syncAt):'');s='synced';}
  }
  el.textContent=t;el.dataset.s=s;
  const st=$('#set-status');if(st)st.textContent=t;
}
function stamp(msg){const el=$('#sync');if(el){el.textContent=msg;el.dataset.s='error';}}
function schedSync(ms){clearTimeout(syncT);if(!cfg()){syncState='off';refreshStatus();return;}if(syncState!=='syncing')syncState='pending';refreshStatus();syncT=setTimeout(runSync,ms===undefined?1500:ms);}
const b64=s=>btoa(unescape(encodeURIComponent(s)));
const unb64=s=>decodeURIComponent(escape(atob(s.replace(/\s/g,''))));
async function gh(path,opt,c){
  c=c||cfg();const o=Object.assign({method:'GET'},opt||{}),ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),20000);
  const h={'Authorization':'Bearer '+c.token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(o.body)h['Content-Type']='application/json';
  try{return await fetch('https://api.github.com/repos/'+c.repo+path,{method:o.method,headers:h,body:o.body,cache:'no-store',signal:ctl.signal});}finally{clearTimeout(tm);}
}
function httpErr(r){const e=new Error('http');e.status=r.status;return e;}
function syncErrOf(kind){const e=new Error(kind);e.kind=kind;return e;}
/* Runs before anything is sent, on setup and on every sync, so a repo made public later stops receiving logs. */
async function checkRepo(c){
  const r=await gh('',null,c);if(!r.ok)throw httpErr(r);
  const j=await r.json();
  if(j.private!==true)throw syncErrOf('public');
  if(!j.permissions||!j.permissions.push)throw syncErrOf('readonly');
  return j;
}
/* Lists a top-level folder with the git trees API, which has no 1000-entry cap (the contents API does). */
async function repoRoot(branch){
  const r=await gh('/git/trees/'+String(branch||'main').split('/').map(encodeURIComponent).join('/'));
  if(r.status===404||r.status===409)return[];/* 409: repo has no commits yet */
  if(!r.ok)throw httpErr(r);
  const j=await r.json();return Array.isArray(j.tree)?j.tree:[];
}
async function listDir(root,name){
  const d=root.find(t=>t.path===name&&t.type==='tree');if(!d)return[];
  const r=await gh('/git/trees/'+d.sha);if(!r.ok)throw httpErr(r);
  const j=await r.json();
  return(Array.isArray(j.tree)?j.tree:[]).filter(t=>t.type==='blob'&&FILE_RE.test(t.path)).map(t=>({name:t.path,sha:t.sha}));
}
function refreshViews(){
  const ae=document.activeElement,typing=ae&&/INPUT|TEXTAREA/.test(ae.tagName);
  if(!typing){if(!state.dirty)initDraft(state.date);renderAll();}else renderStats();
}
async function runSync(){
  if(syncing)return;const c=cfg();
  if(!c){syncState='off';refreshStatus();return;}
  if(navigator.onLine===false){syncState='offline';refreshStatus();return;}
  syncing=true;syncState='syncing';refreshStatus();
  try{
    const repo=await checkRepo(c);
    const shas=lsGet(LS_H,{}),pushed=new Set();
    /* 1. push what is waiting */
    for(const date of Object.keys(queueGet())){
      const op=queueGet()[date];
      if(!op||!DATE_RE.test(date)){const q=queueGet();delete q[date];lsSet(LS_Q,q);continue;}
      const path='/contents/sessions/'+date+'.json',doc=state.sessions[date];
      if(op==='put'&&!doc){const q=queueGet();delete q[date];lsSet(LS_Q,q);continue;}
      const stampAt=doc&&doc.savedAt;let done=false;
      for(let attempt=0;attempt<3&&!done;attempt++){
        let sha=shas[date];
        if(!sha||attempt>0){const g=await gh(path);if(g.status===200)sha=(await g.json()).sha;else if(g.status===404)sha=undefined;else throw httpErr(g);}
        let r;
        if(op==='put')r=await gh(path,{method:'PUT',body:JSON.stringify({message:'log '+date,content:b64(JSON.stringify(doc,null,1)),sha})});
        else if(!sha)r={ok:true,status:200,json:async()=>({})};
        else r=await gh(path,{method:'DELETE',body:JSON.stringify({message:'delete '+date,sha})});
        if(r.ok){
          const j=await r.json();
          if(op==='put'){shas[date]=j.content.sha;pushed.add(date);}else delete shas[date];
          lsSet(LS_H,shas);
          const q=queueGet(),cur=state.sessions[date];
          if(!(op==='put'&&cur&&cur.savedAt!==stampAt)&&q[date]===op){delete q[date];lsSet(LS_Q,q);}
          done=true;
        }else if(r.status===409||r.status===422){delete shas[date];continue;}
        else throw httpErr(r);
      }
      if(!done)throw httpErr({status:409});
    }
    /* 2. pull what changed elsewhere */
    const root=await repoRoot(repo.default_branch),files=await listDir(root,'sessions');let changed=false;
    for(const f of files){
      const date=f.name.slice(0,-5);
      if(shas[date]===f.sha||queueGet()[date])continue;
      const g=await gh('/contents/sessions/'+f.name);if(!g.ok)continue;
      let doc;try{doc=cleanSession(date,JSON.parse(unb64((await g.json()).content)));}catch(e){continue;}
      if(!doc)continue;
      const loc=state.sessions[date];
      if(!loc||(doc.savedAt||'')>(loc.savedAt||'')){state.sessions[date]=doc;changed=true;shas[date]=f.sha;}
      else if((doc.savedAt||'')<(loc.savedAt||'')){shas[date]=f.sha;const q=queueGet();q[date]='put';lsSet(LS_Q,q);}
      else shas[date]=f.sha;
    }
    /* 3. sessions this phone has but the repo does not. If this phone synced it before (it has a sha)
          and has not edited it since, it was deleted elsewhere: delete it here too. Otherwise upload it.
          An empty repo is treated as reset, never as "delete everything". */
    const remote=new Set(files.map(f=>f.name.slice(0,-5))),q2=queueGet();
    for(const d of Object.keys(state.sessions)){
      if(remote.has(d)||q2[d]||pushed.has(d))continue;
      if(shas[d]&&files.length){delete state.sessions[d];changed=true;}
      else q2[d]='put';
    }
    for(const d of Object.keys(shas)){if(!remote.has(d)&&!pushed.has(d))delete shas[d];}
    lsSet(LS_Q,q2);lsSet(LS_H,shas);
    /* 4. coach notes for the last couple of days */
    try{
      const cf=await listDir(root,'coach'),co=lsGet(LS_CO,{}),cs=lsGet(LS_CS,{}),keep=addDays(todayStr(),-2);
      for(const f of cf){
        const date=f.name.slice(0,-5);if(date<keep||cs[date]===f.sha)continue;
        const g=await gh('/contents/coach/'+f.name);if(!g.ok)continue;
        try{const o=JSON.parse(unb64((await g.json()).content));if(o&&typeof o==='object'&&!Array.isArray(o)){co[date]=o;cs[date]=f.sha;changed=true;}}catch(e){}
      }
      for(const k of Object.keys(co)){if(k<keep){delete co[k];delete cs[k];}}
      lsSet(LS_CO,co);lsSet(LS_CS,cs);state.coach=co;
    }catch(e){}
    if(changed){state.real=Object.keys(state.sessions).length>0;await persistSessions();refreshViews();}
    syncAt=new Date().toISOString();lsSet(LS_L,syncAt);syncErr='';
    syncState=Object.keys(queueGet()).length?'pending':'ok';
    syncing=false;refreshStatus();
    if(syncState==='pending')schedSync(500);
  }catch(e){
    syncing=false;
    if(e&&e.kind==='public'){syncState='error';syncErr='repo is public, sync paused';}
    else if(e&&e.kind==='readonly'){syncState='error';syncErr='token cannot write';}
    else if(e&&e.status===401){syncState='error';syncErr='token rejected';}
    else if(e&&e.status===403){syncState='error';syncErr='token has no access';}
    else if(e&&e.status===404){syncState='error';syncErr='repo not found';}
    else if(e&&e.status){syncState='error';syncErr='GitHub error '+e.status;}
    else{syncState='offline';}
    refreshStatus();
    if(syncState==='offline')syncT=setTimeout(runSync,30000);
  }
}
const db={doc:p=>{const date=p.split('/')[1];return{
  set:async d=>{state.sessions[date]=d;state.real=true;if(!(await persistSessions()))throw new Error('storage');queue(date,'put');},
  delete:async()=>{delete state.sessions[date];state.real=Object.keys(state.sessions).length>0;await persistSessions();queue(date,'del');}
};}};
function loadLocal(){const co=lsGet(LS_CO,{});state.coach=co&&typeof co==='object'?co:{};state.sessions=cleanSessions(lsGet(LS_S,{}));state.real=Object.keys(state.sessions).length>0;}
/* IndexedDB is the second copy. Use it when it is newer than localStorage (a localStorage write failed)
   or when localStorage is empty (older builds stored no timestamp). */
async function initDb(){
  const m=await idbGet('sessions');
  if(m){try{
    const o=JSON.parse(m),snap=o&&typeof o.at==='number'&&o.s?o:{at:0,s:o},lsAt=Number(lsGet(LS_SA,0))||0;
    const useIdb=snap.at>lsAt||(!snap.at&&!Object.keys(state.sessions).length);
    const s=useIdb?cleanSessions(snap.s):null;
    if(s&&Object.keys(s).length){state.sessions=s;state.real=true;lsSet(LS_S,s);if(snap.at)lsSet(LS_SA,snap.at);if(!state.dirty)initDraft(state.date);renderAll();}
  }catch(e){}}
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();}catch(e){}
  refreshStatus();schedSync(800);
}
function realList(){return Object.keys(state.sessions).sort().map(k=>state.sessions[k]);}

/* ---------- sample week so the page is complete at rest ---------- */
function sampleSessions(){
  const t=todayStr();if(sampleCache&&sampleCache.t===t)return sampleCache.v;
  const v={};
  [['D1',-4],['D2',-3],['D3',-2],['D4',-1]].forEach(p=>{
    const date=addDays(t,p[1]),entries={};
    EX.filter(e=>e.d===p[0]).forEach(e=>{entries[e.id]={sets:Array.from({length:e.s},()=>({kg:e.kg,reps:e.r[0]+1}))};});
    v[date]={date,day:p[0],entries,sample:true};
  });
  sampleCache={t,v};return v;
}
const activeSessions=()=>state.real?state.sessions:sampleSessions();

/* ---------- calculations ---------- */
function effort(s){
  const o={};
  for(const id in(s.entries||{})){
    const ex=exById(id);if(!ex)continue;
    const n=(s.entries[id].sets||[]).filter(x=>x&&x.reps>0).length;if(!n)continue;
    for(const m in ex.m)o[m]=(o[m]||0)+n*ex.m[m];
  }
  return o;
}
function heat(sessions,now,win){
  const list=Object.keys(sessions).map(k=>({t:Math.min(dayMs(sessions[k].date),now),eff:effort(sessions[k])})).filter(x=>now-x.t<=win*864e5+36e5);
  const out={};
  for(const m in MUSCLES){
    let f=0,sets=0,last=null,rem=0;
    for(const s of list){
      const e=s.eff[m]||0;if(e<=0)continue;
      sets+=e;const dh=Math.max(0,(now-s.t)/36e5),T=REC[m]*clamp(.6+e/10,.6,1.4);
      f+=Math.max(0,1-dh/T);rem=Math.max(rem,T-dh);last=last===null?dh:Math.min(last,dh);
    }
    f=Math.min(1,f);
    const st=sets===0?'idle':f<=0?'ready':f<.34?'almost':f<.67?'recovering':'fatigued';
    out[m]={f,sets,last,rem:Math.max(0,rem),st};
  }
  return out;
}
const entryKey=(ex,en)=>en&&en.alt?ex.k+'~'+en.alt:ex.k;
const altOf=(ex,en)=>en&&en.alt?(ALT[ex.k]||[]).find(a=>a.id===en.alt)||null:null;
function lastEntry(k,beforeDate){
  const keys=Object.keys(state.sessions).sort().reverse();
  for(const d of keys){
    if(beforeDate&&d>=beforeDate)continue;
    const s=state.sessions[d];
    for(const id in s.entries||{}){const ex=exById(id);if(ex&&entryKey(ex,s.entries[id])===k){const sets=(s.entries[id].sets||[]).filter(x=>x&&x.reps>0);if(sets.length)return{date:d,sets,rpe:s.entries[id].rpe};}}
  }
  return null;
}
function suggest(ex,beforeDate,alt){
  const co=!alt&&state.coach&&state.coach[beforeDate],ov=co&&co.overrides&&co.overrides[ex.id];
  if(ov&&num(ov.kg)!==null)return{kg:num(ov.kg),text:'Coach: '+esc(ov.note||'adjusted for today')};
  const l=lastEntry(alt?ex.k+'~'+alt.id:ex.k,beforeDate),start=alt?alt.kg:ex.kg,step=alt?alt.st:ex.st;
  if(!l)return{kg:start,text:start?'First time: start at '+fmtKg(start)+' kg and stop 2 reps before failure.':'No added weight. Aim for the top of the rep range with control.'};
  const top=Math.max.apply(null,l.sets.map(s=>s.kg)),atTop=l.sets.filter(s=>s.kg===top);
  const allHi=atTop.length>=ex.s&&atTop.every(s=>s.reps>=ex.r[1]);
  if(allHi)return step?{kg:top+step,text:'Every set hit '+ex.r[1]+' reps. Add '+fmtKg(step)+' kg.'}:{kg:top,text:'Every set hit '+ex.r[1]+' reps. Slow the lowering down or move to a harder variation.'};
  if(l.sets.some(s=>s.reps<ex.r[0]))return{kg:top,text:'Stay at '+fmtKg(top)+' kg until every set reaches '+ex.r[0]+' reps.'};
  return{kg:top,text:'Stay at '+fmtKg(top)+' kg and add a rep per set until all hit '+ex.r[1]+'.'};
}
const e1rm=(kg,r)=>kg*(1+r/30);
function suggestedDay(){
  const list=realList();if(!list.length)return'D1';
  const last=list[list.length-1].day,i=DAYS.findIndex(d=>d.id===last);
  return DAYS[(i+1)%DAYS.length].id;
}

/* ---------- draft handling ---------- */
function blankDraft(date,day){return{date,day,bw:'',notes:'',entries:{}};}
function initDraft(date){
  state.date=date;state.confirmDel=false;
  const ex=state.sessions[date];
  if(ex){state.draft=JSON.parse(JSON.stringify(ex));state.draft.bw=ex.bw||'';state.draft.notes=ex.notes||'';state.draft.entries=state.draft.entries||{};}
  else state.draft=blankDraft(date,(state.draft&&!state.sessions[state.draft.date]&&state.draft.day)||suggestedDay());
  state.dirty=false;
}
function cleanDraft(){
  const d=state.draft,out={date:d.date,day:d.day,entries:{},savedAt:new Date().toISOString()};
  const bw=num(d.bw);if(bw)out.bw=bw;if(d.notes&&d.notes.trim())out.notes=d.notes.trim();
  for(const id in d.entries){
    const ex=exById(id);if(!ex||ex.d!==d.day)continue;
    const sets=(d.entries[id].sets||[]).map(s=>s?{kg:num(s.kg),reps:num(s.reps)}:null).filter(s=>s&&s.reps>0&&s.kg!==null&&s.kg>=0);
    if(sets.length){out.entries[id]={sets};const al=d.entries[id].alt;if(al&&(ALT[ex.k]||[]).some(x=>x.id===al))out.entries[id].alt=al;const r=num(d.entries[id].rpe);if(r)out.entries[id].rpe=r;}
  }
  return out;
}
let toastT=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),2600);}
const BK='split-draft-v1';
function backupDraft(){try{const d=state.draft;if(d&&state.dirty)localStorage.setItem(BK,JSON.stringify(d));}catch(e){}}
function clearBackup(){try{localStorage.removeItem(BK);}catch(e){}}
const hhmm=()=>hhmmOf(Date.now());
let autoT=null,saving=false;
function scheduleAuto(){backupDraft();clearTimeout(autoT);refreshStatus();autoT=setTimeout(autoSave,500);}
async function autoSave(){
  clearTimeout(autoT);if(!state.dirty||saving)return;
  const d=cleanDraft();
  if(!Object.keys(d.entries).length&&!d.bw&&!d.notes){return;}
  saving=true;
  try{
    await db.doc('sessions/'+d.date).set(d);
    state.dirty=false;clearBackup();state.lastLocal=hhmm();refreshStatus();try{renderStats();}catch(e){}
  }catch(e){stamp('Save failed: phone storage is blocked or full');}
  saving=false;
}
async function saveDraft(){
  const d=cleanDraft();
  if(!Object.keys(d.entries).length&&!d.bw){toast('Enter reps for at least one set first.');return;}
  try{
    await db.doc('sessions/'+d.date).set(d);
    state.dirty=false;state.confirmDel=false;clearBackup();clearTimeout(autoT);state.lastLocal=hhmm();schedSync(300);
    toast('Session saved');renderAll();refreshStatus();
  }catch(e){toast('Save failed ('+(e.code||'error')+'). Try again.');}
}
async function deleteSession(){
  if(!state.sessions[state.date])return;
  if(!state.confirmDel){state.confirmDel=true;renderLog();return;}
  try{
    await db.doc('sessions/'+state.date).delete();
    clearBackup();toast('Session deleted');initDraft(state.date);renderAll();
  }catch(e){toast('Delete failed ('+(e.code||'error')+').');}
}

/* ---------- body map ---------- */
/* Body paths: react-body-highlighter 2.0.5 by GV79, MIT licence (https://github.com/giavinh79/react-body-highlighter) */
const BODY={"ant":[["CHEST",["51.8367347 41.6326531 51.0204082 55.1020408 57.9591837 57.9591837 67.755102 55.5102041 70.6122449 47.3469388 62.0408163 41.6326531","29.7959184 46.5306122 31.4285714 55.5102041 40.8163265 57.9591837 48.1632653 55.1020408 47.755102 42.0408163 37.5510204 42.0408163"]],["OBLIQUES",["68.5714286 63.2653061 67.3469388 57.1428571 58.7755102 59.5918367 60 64.0816327 60.4081633 83.2653061 65.7142857 78.7755102 66.5306122 69.7959184","33.877551 78.3673469 33.0612245 71.8367347 31.0204082 63.2653061 32.244898 57.1428571 40.8163265 59.1836735 39.1836735 63.2653061 39.1836735 83.6734694"]],["ABS",["56.3265306 59.1836735 57.9591837 64.0816327 58.3673469 77.9591837 58.3673469 92.6530612 56.3265306 98.3673469 55.1020408 104.081633 51.4285714 107.755102 51.0204082 84.4897959 50.6122449 67.3469388 51.0204082 57.1428571","43.6734694 58.7755102 48.5714286 57.1428571 48.9795918 67.3469388 48.5714286 84.4897959 48.1632653 107.346939 44.4897959 103.673469 40.8163265 91.4285714 40.8163265 78.3673469 41.2244898 64.4897959"]],["BICEPS",["16.7346939 68.1632653 17.9591837 71.4285714 22.8571429 66.122449 28.9795918 53.877551 27.755102 49.3877551 20.4081633 55.9183673","71.4285714 49.3877551 70.2040816 54.6938776 76.3265306 66.122449 81.6326531 71.8367347 82.8571429 68.9795918 78.7755102 55.5102041"]],["TRICEPS",["69.3877551 55.5102041 69.3877551 61.6326531 75.9183673 72.6530612 77.5510204 70.2040816 75.5102041 67.3469388","22.4489796 69.3877551 29.7959184 55.5102041 29.7959184 60.8163265 22.8571429 73.0612245"]],["NECK",["55.5102041 23.6734694 50.6122449 33.4693878 50.6122449 39.1836735 61.6326531 40 70.6122449 44.8979592 69.3877551 36.7346939 63.2653061 35.1020408 58.3673469 30.6122449","28.9795918 44.8979592 30.2040816 37.1428571 36.3265306 35.1020408 41.2244898 30.2040816 44.4897959 24.4897959 48.9795918 33.877551 48.5714286 39.1836735 37.9591837 39.5918367"]],["FRONT_DELTOIDS",["78.3673469 53.0612245 79.5918367 47.755102 79.1836735 41.2244898 75.9183673 37.9591837 71.0204082 36.3265306 72.244898 42.8571429 71.4285714 47.3469388","28.1632653 47.3469388 21.2244898 53.0612245 20 47.755102 20.4081633 40.8163265 24.4897959 37.1428571 28.5714286 37.1428571 26.9387755 43.2653061"]],["HEAD",["42.4489796 2.85714286 40 11.8367347 42.0408163 19.5918367 46.122449 23.2653061 49.7959184 25.3061224 54.6938776 22.4489796 57.5510204 19.1836735 59.1836735 10.2040816 57.1428571 2.44897959 49.7959184 0"]],["ABDUCTORS",["52.6530612 110.204082 54.2857143 124.897959 60 110.204082 62.0408163 100 64.8979592 94.2857143 60 92.6530612 56.7346939 104.489796","47.755102 110.612245 44.8979592 125.306122 42.0408163 115.918367 40.4081633 113.061224 39.5918367 107.346939 37.9591837 102.44898 34.6938776 93.877551 39.5918367 92.244898 41.6326531 99.1836735 43.6734694 105.306122"]],["QUADRICEPS",["34.6938776 98.7755102 37.1428571 108.163265 37.1428571 127.755102 34.2857143 137.142857 31.0204082 132.653061 29.3877551 120 28.1632653 111.428571 29.3877551 100.816327 32.244898 94.6938776","63.2653061 105.714286 64.4897959 100 66.9387755 94.6938776 70.2040816 101.22449 71.0204082 111.836735 68.1632653 133.061224 65.3061224 137.55102 62.4489796 128.571429 62.0408163 111.428571","38.7755102 129.387755 38.3673469 112.244898 41.2244898 118.367347 44.4897959 129.387755 42.8571429 135.102041 40 146.122449 36.3265306 146.530612 35.5102041 140","59.5918367 145.714286 55.5102041 128.979592 60.8163265 113.877551 61.2244898 130.204082 64.0816327 139.591837 62.8571429 146.530612","32.6530612 138.367347 26.5306122 145.714286 25.7142857 136.734694 25.7142857 127.346939 26.9387755 114.285714 29.3877551 133.469388","71.8367347 113.061224 73.877551 124.081633 73.877551 140.408163 72.6530612 145.714286 66.5306122 138.367347 70.2040816 133.469388"]],["KNEES",["33.877551 140 34.6938776 143.265306 35.5102041 147.346939 36.3265306 151.020408 35.1020408 156.734694 29.7959184 156.734694 27.3469388 152.653061 27.3469388 147.346939 30.2040816 144.081633","65.7142857 140 72.244898 147.755102 72.244898 152.244898 69.7959184 157.142857 64.8979592 156.734694 62.8571429 151.020408"]],["CALVES",["71.4285714 160.408163 73.4693878 153.469388 76.7346939 161.22449 79.5918367 167.755102 78.3673469 187.755102 79.5918367 195.510204 74.6938776 195.510204","24.8979592 194.693878 27.755102 164.897959 28.1632653 160.408163 26.122449 154.285714 24.8979592 157.55102 22.4489796 161.632653 20.8163265 167.755102 22.0408163 188.163265 20.8163265 195.510204","72.6530612 195.102041 69.7959184 159.183673 65.3061224 158.367347 64.0816327 162.44898 64.0816327 165.306122 65.7142857 177.142857","35.5102041 158.367347 35.9183673 162.44898 35.9183673 166.938776 35.1020408 172.244898 35.1020408 176.734694 32.244898 182.040816 30.6122449 187.346939 26.9387755 194.693878 27.3469388 187.755102 28.1632653 180.408163 28.5714286 175.510204 28.9795918 169.795918 29.7959184 164.081633 30.2040816 158.77551"]],["FOREARM",["6.12244898 88.5714286 10.2040816 75.1020408 14.6938776 70.2040816 16.3265306 74.2857143 19.1836735 73.4693878 4.48979592 97.5510204 0 100","84.4897959 69.7959184 83.2653061 73.4693878 80 73.0612245 95.1020408 98.3673469 100 100.408163 93.4693878 89.3877551 89.7959184 76.3265306","77.5510204 72.244898 77.5510204 77.5510204 80.4081633 84.0816327 85.3061224 89.7959184 92.244898 101.22449 94.6938776 99.5918367","6.93877551 101.22449 13.4693878 90.6122449 18.7755102 84.0816327 21.6326531 77.1428571 21.2244898 71.8367347 4.89795918 98.7755102"]]],"post":[["HEAD",["50.6382979 0 45.9574468 0.85106383 40.8510638 5.53191489 40.4255319 12.7659574 45.106383 20 55.7446809 20 59.1489362 13.6170213 59.5744681 4.68085106 55.7446809 1.27659574"]],["TRAPEZIUS",["44.6808511 21.7021277 47.6595745 21.7021277 47.2340426 38.2978723 47.6595745 64.6808511 38.2978723 53.1914894 35.3191489 40.8510638 31.0638298 36.5957447 39.1489362 33.1914894 43.8297872 27.2340426","52.3404255 21.7021277 55.7446809 21.7021277 56.5957447 27.2340426 60.8510638 32.7659574 68.9361702 36.5957447 64.6808511 40.4255319 61.7021277 53.1914894 52.3404255 64.6808511 53.1914894 38.2978723"]],["BACK_DELTOIDS",["29.3617021 37.0212766 22.9787234 39.1489362 17.4468085 44.2553191 18.2978723 53.6170213 24.2553191 49.3617021 27.2340426 46.3829787","71.0638298 37.0212766 78.2978723 39.5744681 82.5531915 44.6808511 81.7021277 53.6170213 74.893617 48.9361702 72.3404255 45.106383"]],["UPPER_BACK",["31.0638298 38.7234043 28.0851064 48.9361702 28.5106383 55.3191489 34.0425532 75.3191489 47.2340426 71.0638298 47.2340426 66.3829787 36.5957447 54.0425532 33.6170213 41.2765957","68.9361702 38.7234043 71.9148936 49.3617021 71.4893617 56.1702128 65.9574468 75.3191489 52.7659574 71.0638298 52.7659574 66.3829787 63.4042553 54.4680851 66.3829787 41.7021277"]],["TRICEPS",["26.8085106 49.787234 17.8723404 55.7446809 14.4680851 72.3404255 16.5957447 81.7021277 21.7021277 63.8297872 26.8085106 55.7446809","73.6170213 50.212766 82.1276596 55.7446809 85.9574468 73.1914894 83.4042553 82.1276596 77.8723404 62.9787234 73.1914894 55.7446809","26.8085106 58.2978723 26.8085106 68.5106383 22.9787234 75.3191489 19.1489362 77.4468085 22.5531915 65.5319149","72.7659574 58.2978723 77.0212766 64.6808511 80.4255319 77.4468085 76.5957447 75.3191489 72.7659574 68.9361702"]],["LOWER_BACK",["47.6595745 72.7659574 34.4680851 77.0212766 35.3191489 83.4042553 49.3617021 102.12766 46.8085106 82.9787234","52.3404255 72.7659574 65.5319149 77.0212766 64.6808511 83.4042553 50.6382979 102.12766 53.1914894 83.8297872"]],["FOREARM",["86.3829787 75.7446809 91.0638298 83.4042553 93.1914894 94.0425532 100 106.382979 96.1702128 104.255319 88.0851064 89.3617021 84.2553191 83.8297872","13.6170213 75.7446809 8.93617021 83.8297872 6.80851064 93.6170213 0 106.382979 3.82978723 104.255319 12.3404255 88.5106383 15.7446809 82.9787234","81.2765957 79.5744681 77.4468085 77.8723404 79.1489362 84.6808511 91.0638298 103.829787 93.1914894 108.93617 94.4680851 104.680851","18.7234043 79.5744681 22.1276596 77.8723404 20.8510638 84.2553191 9.36170213 102.978723 6.80851064 108.510638 5.10638298 104.680851"]],["GLUTEAL",["44.6808511 99.5744681 30.212766 108.510638 29.787234 118.723404 31.4893617 125.957447 47.2340426 121.276596 49.3617021 114.893617","55.3191489 99.1489362 51.0638298 114.468085 52.3404255 120.851064 68.0851064 125.957447 69.787234 119.148936 69.3617021 108.510638"]],["ABDUCTOR",["48.0851064 122.978723 44.6808511 122.978723 41.2765957 125.531915 45.106383 144.255319 48.5106383 135.744681 48.9361702 129.361702","51.9148936 122.553191 55.7446809 123.404255 59.1489362 125.957447 54.893617 144.255319 51.9148936 136.170213 51.0638298 129.361702"]],["HAMSTRING",["28.9361702 122.12766 31.0638298 129.361702 36.5957447 125.957447 35.3191489 135.319149 34.4680851 150.212766 29.3617021 158.297872 28.9361702 146.808511 27.6595745 141.276596 27.2340426 131.489362","71.4893617 121.702128 69.3617021 128.93617 63.8297872 125.957447 65.5319149 136.595745 66.3829787 150.212766 71.0638298 158.297872 71.4893617 147.659574 72.7659574 142.12766 73.6170213 131.914894","38.7234043 125.531915 44.2553191 145.957447 40.4255319 166.808511 36.1702128 152.765957 37.0212766 135.319149","61.7021277 125.531915 63.4042553 136.170213 64.2553191 153.191489 60 166.808511 56.1702128 146.382979"]],["KNEES",["34.4680851 153.191489 31.0638298 159.148936 33.6170213 166.382979 37.4468085 162.553191","66.3829787 153.617021 62.9787234 162.978723 66.8085106 166.382979 69.3617021 159.148936"]],["CALVES",["29.3617021 160.425532 28.5106383 167.234043 24.6808511 179.574468 23.8297872 192.765957 25.5319149 197.021277 28.5106383 193.191489 29.787234 180 31.9148936 171.06383 31.9148936 166.808511","37.4468085 165.106383 35.3191489 167.659574 33.1914894 171.914894 31.0638298 180.425532 30.212766 191.914894 34.0425532 200 38.7234043 190.638298 39.1489362 168.93617","62.9787234 165.106383 61.2765957 168.510638 61.7021277 190.638298 66.3829787 199.574468 70.6382979 191.914894 68.9361702 179.574468 66.8085106 170.212766","70.6382979 160.425532 72.3404255 168.510638 75.7446809 179.148936 76.5957447 192.765957 74.4680851 196.595745 72.3404255 193.617021 70.6382979 179.574468 68.0851064 168.085106"]],["LEFT_SOLEUS",["28.5106383 195.744681 30.212766 195.744681 33.6170213 201.702128 30.6382979 220 28.5106383 213.617021 26.8085106 198.297872"]],["RIGHT_SOLEUS",["69.787234 195.744681 71.9148936 195.744681 73.6170213 198.297872 71.9148936 213.191489 70.212766 219.574468 67.2340426 202.12766"]]]};
const BODYMAP={CHEST:['chest'],OBLIQUES:['abs'],ABS:['abs'],BICEPS:['biceps'],TRICEPS:['triceps'],FRONT_DELTOIDS:['fdelt','sdelt'],BACK_DELTOIDS:['rdelt','sdelt'],ABDUCTORS:['adduct'],ABDUCTOR:['adduct'],QUADRICEPS:['quads'],CALVES:['calves'],LEFT_SOLEUS:['calves'],RIGHT_SOLEUS:['calves'],FOREARM:['forearm'],TRAPEZIUS:['midback'],UPPER_BACK:['lats'],LOWER_BACK:['lowback'],GLUTEAL:['glutes'],HAMSTRING:['hams']};
function bodySvg(side,fillFor,label,H){
  const shapes=BODY[side].map(([g,pts])=>{
    const c=BODYMAP[g];
    if(!c)return`<g class="nm">${pts.map(p=>`<polygon points="${p}"/>`).join('')}</g>`;
    const m=c.length===1?c[0]:c.slice().sort((x,y)=>(H[y].f-H[x].f)||(H[y].sets-H[x].sets))[0];
    return`<g class="mus${state.sel===m?' sel':''}" data-m="${m}" style="fill:${fillFor(m)}">${pts.map(p=>`<polygon points="${p}"/>`).join('')}</g>`;
  }).join('');
  const sil=BODY[side].map(([g,pts])=>pts.map(p=>`<polygon points="${p}"/>`).join('')).join('');
  return`<figure class="body"><svg viewBox="0 0 100 200" role="img" aria-label="${label}"><g class="sil">${sil}</g>${shapes}</svg><figcaption>${label}</figcaption></figure>`;
}

/* ---------- renderers ---------- */
function renderAll(){renderLog();renderPlan();renderStats();renderCoach();}
const figHtml=(ex)=>{const f=FIGIMG.imgs[FIGIMG.map[ex.id]];if(!f)return'';return`<div class="fx" role="img" aria-label="${ex.n}: start and end position"><img src="${f[0]}" alt="" loading="lazy" decoding="async"><img src="${f[1]}" alt="" loading="lazy" decoding="async"></div>`;};
const srcTag=ex=>ex.src==='swap'?'<span class="tag swap">swapped</span>':ex.src==='add'?'<span class="tag add">added</span>':ex.tw?'<span class="tag tw">sets changed</span>':'<span class="tag reel">from reel</span>';

function altsHtml(ex,cur){
  const L=ALT[ex.k]||[];if(!L.length)return'';
  return`<details class="alts"${cur?' open':''}><summary>Gym busy? ${L.length} alternatives</summary><div class="alist">${L.map(a=>{const on=cur&&cur.id===a.id;return`<div class="alt${on?' on':''}"><img src="${ALTIMG[a.rid]}" alt="" loading="lazy" decoding="async"><div class="ai"><b>${a.n}</b> <span class="tag">${a.eq}</span><p>${a.cue}</p><p class="hist">Same ${ex.s} × ${ex.r[0]}–${ex.r[1]} · start ${a.kg?fmtKg(a.kg)+' '+a.u:a.u}</p></div><button class="btn mini${on?'':' primary'}" data-alt="${ex.id}|${on?'':a.id}">${on?'Back to '+ex.n:'Use today'}</button></div>`;}).join('')}</div><p class="sub">Alternatives train the same muscles. Starting weights are estimates, so keep 2 reps in reserve.</p></details>`;
}
function renderLog(){
  const root=$('#tab-log');if(!state.draft)initDraft(state.date);
  const d=state.draft,day=dayOf(d.day)||DAYS[0],exs=EX.filter(e=>e.d===d.day);
  const real=state.sessions,now=Date.now(),H=heat(real,now,7);
  const prim={};exs.forEach(e=>{for(const m in e.m)if(e.m[m]>=.8)prim[m]=1;});
  const ready=Object.keys(prim).map(m=>`<span class="chip st-${H[m].st}"><i></i>${MUSCLES[m]}<b>${H[m].st==='idle'||H[m].st==='ready'?'ready':'~'+Math.ceil(H[m].rem)+' h'}</b></span>`).join('');
  const exists=!!state.sessions[d.date];
  let h=`<section class="card head"><div class="row"><label class="fld"><span>Date</span><input type="date" id="f-date" value="${esc(d.date)}"></label><label class="fld"><span>Body weight, kg</span><input type="text" inputmode="decimal" id="f-bw" value="${esc(d.bw||'')}" placeholder="optional"></label></div>
  <div class="days" role="tablist">${DAYS.map(x=>`<button class="daybtn${x.id===d.day?' on':''}" data-day="${x.id}"><b>${x.id}</b><span>${x.name}</span>${x.id===suggestedDay()&&!exists?'<em>next</em>':''}</button>`).join('')}</div>
  <p class="sub">${day.wd} template. ${day.tag}. About ${dayStats(day.id).sets} sets, ${dayStats(day.id).min} min.</p>
  <div class="ready"><span class="lbl">Muscles for this day if you train now</span>${ready}</div></section>`;
  {const co=state.coach&&state.coach[d.date];if(co&&co.summary)h+=`<section class="card coachnote"><h3 class="sec">Coach · for today</h3><p>${esc(co.summary)}</p></section>`;}
  h+=exs.map(ex=>{
    const en0=d.entries[ex.id]||{},alt=altOf(ex,en0),sg=suggest(ex,d.date,alt),le=lastEntry(alt?ex.k+'~'+alt.id:ex.k,d.date),en=en0.sets||[];
    const last=le?'Last time ('+fmtDate(le.date)+'): '+le.sets.map(s=>fmtKg(s.kg)+'×'+s.reps).join(', '):'No history yet.';
    let rows='';
    for(let i=0;i<ex.s;i++){
      const v=en[i]||{};const kg=v.kg!=null?v.kg:fmtKg(sg.kg);
      rows+=`<div class="set"><span class="n">${i+1}</span><label><input type="text" inputmode="decimal" data-ex="${ex.id}" data-i="${i}" data-f="kg" value="${esc(kg)}" aria-label="${ex.n} set ${i+1} weight"></label><span class="x">kg ×</span><label><input type="text" inputmode="numeric" data-ex="${ex.id}" data-i="${i}" data-f="reps" value="${esc(v.reps)}" placeholder="${ex.r[0]}-${ex.r[1]}" aria-label="${ex.n} set ${i+1} reps"></label></div>`;
    }
    return`<section class="card ex" id="x-${ex.id}"><div class="exhead"><div><h3>${alt?alt.n:ex.n}</h3><div class="meta"><span class="big">${ex.s} × ${ex.r[0]}–${ex.r[1]}</span> ${alt?`<span class="tag swap">instead of ${ex.n}</span>`:srcTag(ex)}</div></div></div>
    <div class="exbody">${alt?`<div class="fx static"><img src="${ALTIMG[alt.rid]}" alt=""></div>`:figHtml(ex)}<div class="info"><p class="cue">${alt?alt.cue:ex.cue}</p><p class="tgt"><b>Next: ${fmtKg(sg.kg)} kg</b> <span>${alt?alt.u:ex.u}</span><br>${sg.text}</p><p class="hist">${last}</p>${!alt&&ex.note?`<p class="note">${ex.note}</p>`:''}${!alt&&ex.tw?`<p class="note">Sets changed from ${ex.rs} to ${ex.s}. ${ex.tw}</p>`:''}</div></div>${altsHtml(ex,alt)}
    <div class="sets">${rows}</div><label class="rpe">Effort (RPE 6–10) <input type="text" inputmode="decimal" data-ex="${ex.id}" data-f="rpe" value="${esc((d.entries[ex.id]||{}).rpe||'')}" placeholder="optional" aria-label="${ex.n} effort"></label></section>`;
  }).join('');
  h+=`<section class="card"><label class="fld"><span>Session notes</span><textarea id="f-notes" rows="2" placeholder="Sleep, how it felt, anything Claude should know">${esc(d.notes||'')}</textarea></label>
  <div class="actions"><button class="btn primary" id="b-save">${exists?'Update session':'Save session'}</button>${exists?`<button class="btn ghost danger" id="b-del">${state.confirmDel?'Tap again to delete':'Delete session'}</button>`:''}</div></section>`;
  const recent=Object.keys(state.sessions).sort().reverse().slice(0,6);
  h+=`<section class="card"><h3 class="sec">Recent sessions</h3>${recent.length?`<div class="recent">${recent.map(k=>`<button class="rbtn" data-load="${k}"><b>${fmtDate(k)}</b><span>${esc(state.sessions[k].day)} ${esc((dayOf(state.sessions[k].day)||{}).name)}</span><em>${Object.keys(state.sessions[k].entries||{}).length} lifts</em></button>`).join('')}</div>`:'<p class="sub">No sessions saved yet. Your first save appears here and feeds the heat map and the coach tab.</p>'}</section>`;
  root.innerHTML=h;
}

function renderPlan(){
  const root=$('#tab-plan');
  const total=EX.reduce((a,e)=>a+e.s,0),reel=EX.reduce((a,e)=>a+e.rs,0)+REMOVED.reduce((a,e)=>a+e.rs,0);
  let h=`<section class="card"><h2>Your 5-day plan</h2><p class="sub">${total} hard sets a week. The reel had ${reel}. Mon to Fri, weekends off with walking. Rest 2 to 3 min after compound lifts and 60 to 90 s after the rest. Before the first lift of each day do two ramp-up sets: about 50% for 8 reps, then 75% for 4.</p>
  <div class="legend2"><span class="tag reel">from reel</span><span class="tag swap">swapped</span><span class="tag add">added</span><span class="tag tw">sets changed</span></div></section>`;
  h+=`<section class="card"><h3 class="sec">What changed from the reel</h3><ul class="chg">${REMOVED.map(r=>`<li><b>${r.n}</b> removed. ${r.why}</li>`).join('')}${EX.filter(e=>e.src==='add').map(e=>`<li><b>${e.n}</b> added. ${e.note.replace('Added by coach. ','')}</li>`).join('')}${EX.filter(e=>e.tw).map(e=>`<li><b>${e.n}</b> ${e.rs} to ${e.s} sets (${e.d}). ${e.tw}</li>`).join('')}</ul></section>`;
  h+=DAYS.map(D=>{
    const st=dayStats(D.id);
    return`<section class="card"><div class="dayhead"><h3>${D.wd} · ${D.id} ${D.name}</h3><span class="pill">${st.sets} sets · ~${st.min} min</span></div><p class="sub">${D.tag}</p><div class="tbl">${EX.filter(e=>e.d===D.id).map(e=>`<div class="tr"><div class="td nm"><b>${e.n}</b>${srcTag(e)}</div><div class="td">${e.s} × ${e.r[0]}–${e.r[1]}</div><div class="td kg">${fmtKg(e.kg)} <small>${e.u}</small></div></div>`).join('')}</div></section>`;
  }).join('');
  h+=`<p class="sub credit"><a href="https://repdb.co" rel="noopener nofollow">Exercise data by RepDB (repdb.co)</a>. Illustrations recoloured.</p>`;
  root.innerHTML=h;
}

const LS_T='split-target-kg-v1';const targetKg=()=>{const v=Number(lsGet(LS_T,null));return v>0?v:null;};
const IC={dumb:'<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',cal:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',flame:'<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9Z"/>',scale:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 9c2-2 6-2 8 0M12 9l2 3"/>'};
const icon=n=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;
const mondayOf=d=>{const t=new Date(d+'T12:00:00'),w=(t.getDay()+6)%7;return addDays(d,-w);};
function sessStats(s){let sets=0,vol=0;for(const id in(s.entries||{})){for(const x of(s.entries[id].sets||[])){if(x&&x.reps>0){sets++;vol+=(Number(x.kg)||0)*Number(x.reps);}}}return{sets,vol};}
function weightPts(){return realList().filter(s=>s.bw!==''&&s.bw!=null&&Number(s.bw)>0).map(s=>({d:s.date,w:Number(s.bw)}));}
function weekStreak(){
  const wk=new Set(realList().map(s=>mondayOf(s.date)));if(!wk.size)return 0;
  let c=mondayOf(todayStr());if(!wk.has(c))c=addDays(c,-7);
  let n=0;while(wk.has(c)){n++;c=addDays(c,-7);}return n;
}
const AR={'Week':1,'Month':5,'Quarter':13,'6M':26,'Year':53};
function activityHtml(){
  const today=todayStr(),isMonth=state.ar==='Month';
  /* Month is the calendar month (1st to last day), the others are rolling windows of whole weeks */
  const monthStart=today.slice(0,8)+'01',monthEnd=addDays(addDays(monthStart,32).slice(0,8)+'01',-1);
  const W=isMonth?Math.ceil((Math.round((dayMs(monthEnd)-dayMs(mondayOf(monthStart)))/864e5)+1)/7):(AR[state.ar]||1);
  const start=isMonth?mondayOf(monthStart):addDays(mondayOf(today),-(W-1)*7),from=isMonth?monthStart:start;
  const tot={};realList().forEach(s=>{const e=effort(s);tot[s.date]=Object.keys(e).reduce((x,m)=>x+e[m],0);});
  const inR=Object.keys(tot).filter(d=>d>=from&&d<=today);
  const period=isMonth?'in '+new Date(monthStart+'T12:00:00').toLocaleString('en',{month:'long'}):state.ar==='Week'?'this week':'in this period';
  const sum=`<p class="sub actsum">${inR.length} workout${inR.length===1?'':'s'} · ${Math.round(inR.reduce((x,d)=>x+tot[d],0))} effective sets ${period}</p>`;
  const lvl=v=>v<=0?0:v<8?1:v<14?2:v<20?3:4;
  const seg=`<div class="seg" role="group" aria-label="Activity period">${Object.keys(AR).map(k=>`<button data-ar="${k}" class="${state.ar===k?'on':''}">${k}</button>`).join('')}</div>`;
  const legend='<div class="scale"><span>Less</span><i class="cell l0"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i><span>More</span></div>';
  if(isMonth||state.ar==='Week'){
    let c='<div class="cal">'+['Mo','Tu','We','Th','Fr','Sa','Su'].map(x=>`<b>${x}</b>`).join('');
    for(let r=0;r<W;r++)for(let k=0;k<7;k++){
      const d=addDays(start,r*7+k);
      if(isMonth&&d.slice(0,7)!==monthStart.slice(0,7)){c+='<i class="cd fut"></i>';continue;}
      if(d>today){c+=`<i class="cd fut">${isMonth?Number(d.slice(8)):''}</i>`;continue;}
      const v=tot[d]||0;
      c+=`<i class="cd l${lvl(v)}${d===today?' today':''}" title="${d}${v?' · '+v.toFixed(0)+' sets':''}">${Number(d.slice(8))}${v?`<small>${Math.round(v)}</small>`:''}</i>`;
    }
    return seg+c+'</div>'+sum+legend;
  }
  let cells='',lab='',prev='',last=-9;
  for(let c=0;c<W;c++){
    const first=addDays(start,c*7),mo=new Date(first+'T12:00:00').toLocaleString('en',{month:'short'});
    if(mo!==prev){if(c-last>=3||c===0){lab+=`<span style="grid-column:${c+1}">${mo}</span>`;last=c;}prev=mo;}
    for(let r=0;r<7;r++){
      const d=addDays(first,r);
      if(d>today){cells+='<i class="cell fut"></i>';continue;}
      const v=tot[d]||0;
      cells+=`<i class="cell l${lvl(v)}${d===today?' today':''}" title="${d}${v?' · '+v.toFixed(0)+' sets':''}"></i>`;
    }
  }
  return seg+`<div class="actlab" style="--w:${W}">${lab}</div><div class="heatgrid" style="--w:${W}">${cells}</div>`+sum+legend;
}
function weightHtml(){
  const TK=targetKg();
  const R={'1M':30,'3M':90,'1Y':365,'All':null},days=R[state.wr];
  let pts=weightPts();if(days)pts=pts.filter(p=>p.d>=addDays(todayStr(),-days));
  const seg=`<div class="seg" role="group" aria-label="Range">${Object.keys(R).map(k=>`<button data-wr="${k}" class="${state.wr===k?'on':''}">${k}</button>`).join('')}</div>`;
  const head=`<div class="wh"><h3 class="sec">Body weight</h3><span class="tgt">${TK?'Target '+fmtKg(TK)+' kg':'No target set'}</span><button class="lnk" data-logbw="1">+ Log</button></div>`;
  if(pts.length<1)return head+seg+`<p class="sub">No weigh-ins in this range. Enter body weight in the Log tab when you save a session and the line appears here.</p>`;
  const W=320,H=150,L=34,Rr=10,T=10,B=22;
  const t0=dayMs(pts[0].d),t1=Math.max(dayMs(pts[pts.length-1].d),t0+864e5);
  const ws=pts.map(p=>p.w).concat(TK?[TK]:[]),lo=Math.floor((Math.min.apply(null,ws)-3)/5)*5,hi=Math.ceil((Math.max.apply(null,ws)+3)/5)*5;
  const X=t=>L+(W-L-Rr)*(t-t0)/(t1-t0),Y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  const line=pts.map((p,i)=>(i?'L':'M')+X(dayMs(p.d)).toFixed(1)+' '+Y(p.w).toFixed(1)).join('');
  const ticks=[lo,Math.round((lo+hi)/2/5)*5,hi].map(v=>`<line class="gl" x1="${L}" x2="${W-Rr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-5}" y="${Y(v)+4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const last=pts[pts.length-1];
  return head+seg+`<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight over time, latest ${fmtKg(last.w)} kg${TK?', target '+fmtKg(TK)+' kg':''}">${ticks}${TK?`<line class="tl" x1="${L}" x2="${W-Rr}" y1="${Y(TK)}" y2="${Y(TK)}"/><text class="tt" x="${W-Rr}" y="${Y(TK)-4}" text-anchor="end">${fmtKg(TK)}</text>`:''}<path class="wl" d="${line}"/>${pts.map(p=>`<circle class="wd" cx="${X(dayMs(p.d)).toFixed(1)}" cy="${Y(p.w).toFixed(1)}" r="3"/>`).join('')}<text x="${L}" y="${H-5}">${fmtDate(pts[0].d)}</text><text x="${W-Rr}" y="${H-5}" text-anchor="end">${fmtDate(last.d)}</text></svg><p class="sub">Latest ${fmtKg(last.w)} kg${TK?' · '+fmtKg(Math.abs(last.w-TK))+' kg '+(last.w>TK?'above':'below')+' target.':'. Set a target weight in Settings to see the goal line.'}</p>`;
}
function progressHtml(){
  const by={};
  realList().forEach(s=>{for(const id in(s.entries||{})){const ex=exById(id);if(!ex||s.entries[id].alt)continue;const sets=(s.entries[id].sets||[]).filter(x=>x&&x.reps>0&&Number(x.kg)>0);if(!sets.length)continue;
    const best=Math.max.apply(null,sets.map(x=>e1rm(Number(x.kg),Number(x.reps))));(by[ex.k]=by[ex.k]||{n:ex.n,p:[]}).p.push({d:s.date,v:best});}});
  const rows=Object.keys(by).map(k=>by[k]).filter(x=>x.p.length>=2).map(x=>{const a=x.p[0].v,b=x.p[x.p.length-1].v;return{n:x.n,p:x.p,a,b,pc:(b-a)/a*100};}).sort((x,y)=>y.pc-x.pc).slice(0,5);
  if(!rows.length)return`<h3 class="sec">Exercise progress</h3><p class="sub">${realList().length?'Log the same lift in two sessions to see its curve.':'Finish your first workout to see progress curves here.'}</p>`;
  return`<h3 class="sec">Exercise progress</h3><div class="xprog">${rows.map(r=>{
    const lo=Math.min.apply(null,r.p.map(q=>q.v)),hi=Math.max.apply(null,r.p.map(q=>q.v)),sp=hi-lo||1;
    const d=r.p.map((q,i)=>(i?'L':'M')+(i/(r.p.length-1)*60).toFixed(1)+' '+(16-(q.v-lo)/sp*14).toFixed(1)).join('');
    return`<div class="prow"><b>${r.n}</b><svg viewBox="0 0 60 18" aria-hidden="true"><path d="${d}"/></svg><em class="${r.pc>=0?'up':'dn'}">${r.pc>=0?'+':''}${r.pc.toFixed(0)}%</em></div>`;}).join('')}</div><p class="sub">Estimated 1-rep max, first vs latest session.</p>`;
}
/* the first lift of the next session, with its start/end animation */
function nextLiftHtml(){
  const day=suggestedDay(),ex=EX.find(e=>e.d===day);if(!ex)return'';
  const sg=suggest(ex,todayStr(),null);
  return`<section class="card nextlift"><h3 class="sec">First lift · ${esc(day)}</h3><div class="nlb">${figHtml(ex)}<div class="nli"><b>${esc(ex.n)}</b><p class="sub">${ex.s} × ${ex.r[0]}–${ex.r[1]} · ${esc(ex.u)}</p><p class="tgt"><b>Next: ${fmtKg(sg.kg)} kg</b></p><p class="cue">${esc(ex.cue)}</p></div></div></section>`;
}
function renderStats(){
  const root=$('#tab-stats'),sess=activeSessions(),now=Date.now(),win=7;
  const H=heat(sess,now,win),list=realList(),mo=todayStr().slice(0,7);
  const wp=weightPts().filter(p=>p.d>=addDays(todayStr(),-30)),wd=wp.length>=2?wp[wp.length-1].w-wp[0].w:null;
  const fillFor=m=>{
    const a=H[m].sets<=0?0:clamp(.18+.82*H[m].sets/Math.max(BAND[m][1],6),.18,1);
    return a===0?'var(--idle)':`color-mix(in srgb,var(--clay) ${Math.round(a*100)}%,var(--idle))`;
  };
  let h=`<section class="hd"><h2>Stats</h2><p class="sub">Progress &amp; history</p><div class="next"><div><span>Next up</span><b>${(()=>{const d=DAYS.find(x=>x.id===suggestedDay());return d.id+' · '+d.name;})()}</b></div><button class="cta" data-tab="log">Start session</button></div></section>${nextLiftHtml()}
  <div class="tiles"><div class="tile"><span>${icon('dumb')}Workouts</span><b>${list.length}</b></div><div class="tile"><span>${icon('cal')}This month</span><b>${list.filter(s=>s.date.slice(0,7)===mo).length}</b></div><div class="tile"><span>${icon('flame')}Week streak</span><b>${weekStreak()}</b></div><div class="tile"><span>${icon('scale')}Weight 30d</span><b>${wd===null?'–':(wd>0?'+':'')+wd.toFixed(1)+' kg'}</b></div></div>
  <section class="card"><h3 class="sec">Sets trained · last 7 days</h3>
  ${state.real?'':'<p class="banner">Sample week shown on the body map. Save your first session in the Log tab and this switches to your own data.</p>'}
  <div class="bodies">${bodySvg('ant',fillFor,'Front',H)}${bodySvg('post',fillFor,'Back',H)}</div>
  <div class="scale"><span>fewer sets</span><i class="grad vol"></i><span>more sets</span></div>
  ${(()=>{const nt=Object.keys(MUSCLES).filter(m=>H[m].sets<=0);return nt.length?`<h3 class="sec">Not trained in the last 7 days</h3><div class="chips">${nt.map(m=>`<button class="mchip" data-m="${m}">${MUSCLES[m]}</button>`).join('')}</div>`:'<p class="sub">Every muscle group got work in the last 7 days.</p>';})()}</section>`;
  const sel=state.sel&&MUSCLES[state.sel]?state.sel:null;
  if(sel){const x=H[sel];h+=`<section class="card detail"><h3>${MUSCLES[sel]}</h3><p>${x.sets?`${x.sets.toFixed(1)} effective sets in the last 7 days. Last worked ${x.last<24?'today':Math.round(x.last/24*10)/10+' days ago'}. Target is ${BAND[sel][0]} to ${BAND[sel][1]} a week.`:'Nothing logged in the last 7 days.'}</p></section>`;}
  h+=`<section class="card"><h3 class="sec">Activity</h3>${activityHtml()}</section><section class="card">${weightHtml()}</section><section class="card">${progressHtml()}</section>`;
  const rec=list.slice(-5).reverse();
  h+=`<section class="card"><h3 class="sec">Recent workouts</h3>${rec.length?`<div class="recent">${rec.map(s=>{const q=sessStats(s),dn=dayOf(s.day);return`<button class="rbtn" data-open="${esc(s.date)}"><b>${fmtDate(s.date)}</b><span>${esc(s.day)} ${dn?esc(dn.name):''}</span><em>${q.sets} sets · ${Math.round(q.vol).toLocaleString('en')} kg</em></button>`;}).join('')}</div>`:'<p class="sub">No sessions saved yet.</p>'}</section>`;
  const order=Object.keys(MUSCLES).sort((a,b)=>H[b].sets-H[a].sets);
  h+=`<details class="card dd"><summary>Muscle by muscle</summary><div class="mlist">${order.map(m=>`<button class="mrow${sel===m?' on':''}" data-m="${m}"><i style="background:${fillFor(m)}"></i><b>${MUSCLES[m]}</b><span>${H[m].sets?(H[m].last<24?'Today':Math.round(H[m].last/24)+' d ago'):'Not trained'}</span><em>${H[m].sets?H[m].sets.toFixed(1)+' sets':''}</em></button>`).join('')}</div></details>`;
  const nd=Math.min(win,14),days=[];for(let i=nd-1;i>=0;i--)days.push(addDays(todayStr(),-i));
  const eff={};days.forEach(dd=>{eff[dd]=sess[dd]?effort(sess[dd]):null;});
  h+=`<details class="card dd"><summary>Day by day · last ${nd} days</summary><div class="mx" style="--cols:${days.length}"><div class="mh"></div>${days.map(dd=>`<div class="mh">${wdOf(dd).slice(0,2)}<small>${dd.slice(8)}</small></div>`).join('')}
  <div class="mh lab">Session</div>${days.map(dd=>`<div class="mc ses${sess[dd]?' on':''}">${sess[dd]?esc(sess[dd].day):'rest'}</div>`).join('')}
  ${Object.keys(MUSCLES).map(m=>`<div class="mh lab">${MUSCLES[m]}</div>${days.map(dd=>{const v=eff[dd]?(eff[dd][m]||0):0;return`<div class="mc" style="${v?`background:color-mix(in srgb,var(--accent) ${Math.round(clamp(.2+v/8,.2,1)*100)}%,transparent)`:''}" title="${v?v.toFixed(1)+' sets':''}">${v>=.5?Math.round(v):(v?'·':'')}</div>`;}).join('')}`).join('')}</div>
  <p class="sub">Numbers are effective hard sets that day. Recovery times assume 36 to 72 hours depending on the muscle and how many sets you did.</p></details>`;
  root.innerHTML=h;
}

function renderCoach(){
  const root=$('#tab-coach');
  const pv=weeklyVolume(),rv=reelVolume(),maxS=22;
  const sess=activeSessions(),now=Date.now();
  const last7={};Object.keys(sess).forEach(k=>{if(now-dayMs(k)<=7*864e5+36e5){const e=effort(sess[k]);for(const m in e)last7[m]=(last7[m]||0)+e[m];}});
  const bars=Object.keys(MUSCLES).map(m=>{
    const b=BAND[m],st=pv[m]<b[0]?'low':pv[m]>b[1]+.05?'high':'ok';
    return`<div class="vr"><span class="vl">${MUSCLES[m]}</span><div class="vb"><i class="band" style="left:${b[0]/maxS*100}%;width:${(b[1]-b[0])/maxS*100}%"></i><i class="fill ${st}" style="width:${pv[m]/maxS*100}%"></i><i class="reel" style="left:${rv[m]/maxS*100}%" title="Reel: ${rv[m].toFixed(1)}"></i>${state.real&&last7[m]?`<i class="act" style="left:${last7[m]/maxS*100}%" title="Logged: ${last7[m].toFixed(1)}"></i>`:''}</div><span class="vn ${st}">${pv[m].toFixed(1)}</span></div>`;
  }).join('');
  const acc=EX.filter(e=>!e.c).reduce((a,e)=>a+Math.min(e.s,2),0),comp=EX.filter(e=>e.c).reduce((a,e)=>a+e.s,0);
  const list=realList();
  const since=addDays(todayStr(),-13),recent=list.filter(s=>s.date>=since);
  const lifts={};
  Object.keys(state.sessions).sort().forEach(d=>{const s=state.sessions[d];for(const id in s.entries||{}){const ex=exById(id);if(!ex)continue;(s.entries[id].sets||[]).forEach(x=>{if(!x||!(x.reps>0))return;const v=e1rm(x.kg,x.reps);const L=lifts[ex.k]||(lifts[ex.k]={n:ex.n,pts:{}});if(!L.pts[d]||v>L.pts[d].v)L.pts[d]={v,kg:x.kg,r:x.reps};});}});
  const prog=Object.keys(lifts).map(k=>{const L=lifts[k],ds=Object.keys(L.pts).sort(),f=L.pts[ds[0]],l=L.pts[ds[ds.length-1]];return{n:L.n,f,l,n2:ds.length,ch:ds.length>1?(l.v/f.v-1)*100:null};});
  const sug=EX.filter(e=>e.d===suggestedDay());
  let h=`<section class="card"><h2>Coach evaluation</h2><p class="sub">The plan numbers below are computed from the exercise list. The log numbers come from your saved sessions, which Claude can read to review them with you.</p></section>`;
  h+=`<section class="card"><h3 class="sec">Weekly hard sets per muscle</h3><div class="vkey"><span><i class="k band"></i>target range</span><span><i class="k fill ok"></i>this plan</span><span><i class="k reel"></i>reel as posted</span>${state.real?'<span><i class="k act"></i>logged, last 7 days</span>':''}</div><div class="vgrid">${bars}</div><p class="sub">Indirect work counts fractionally: a bench press gives the triceps half a set. Ranges are the usual 8 to 16 hard sets per muscle per week for building or keeping muscle.</p></section>`;
  h+=`<section class="card verdict"><h3 class="sec">Verdicts</h3>
  <details open><summary>Does it make sense long term?</summary><p>As an 8 to 12 week block, yes. Every muscle except legs is trained twice a week, volume is in the productive range, and the lifts are simple to progress. It is built for muscle gain, so on a calorie deficit its job is to keep your muscle while the fat comes off. After 8 weeks, review the log together and rebuild around what actually progressed. As a permanent plan it is too heavy on arms and light on legs.</p></details>
  <details open><summary>Is it too loaded?</summary><p>The sessions are fine: 16 to 21 sets, about 45 to 55 minutes plus warm-up. The week is the risk. Five gym days plus daily walking leave little spare recovery. Weeks 1 and 2: do 2 sets on every accessory and all sets on compounds (about ${comp+acc} sets a week). Weeks 3 to 4: full sets. Week 5: deload, cut every lift to 60% of the sets and keep the weights. Day 4 is the lowest-value day, so drop it first when time or energy runs short.</p></details>
  <details open><summary>Is one leg day enough?</summary><p>To start, yes. To optimize, no. Quads (${pv.quads.toFixed(1)}) and calves (${pv.calves.toFixed(1)}) sit under their minimums and the lower body is only hit once. With squats and lunges out, leg press and extension carry the quads. After three consistent weeks, move hamstring curl, hip thrust and calf raise to Day 5 as a short second lower session and trim Day 5 chest to two exercises. Legs then train twice a week with no extra day.</p></details>
  <details open><summary>Are the weights right?</summary><p>They are conservative starting estimates, except lat pulldown at 55 kg, which comes from your own log. Treat weeks 1 and 2 as calibration: choose the weight that leaves 2 reps in reserve on the last set. The Log tab then applies double progression: when every set reaches the top of the rep range, it adds the step shown for that lift. Leg press is set low on purpose. Machine stacks differ between gyms, so those starting numbers matter least.</p></details>
  <details open><summary>What was missing, and what changed</summary><p>The reel has no direct abs, no glute work once Bulgarian split squats are cut, no warm-up sets and no deload. I added cable crunch and hip thrust, rebalanced the arms (they were at ${rv.biceps.toFixed(0)} to ${rv.triceps.toFixed(0)} weekly sets against ${rv.quads.toFixed(0)} for quads) and swapped four movements for joint-friendlier alternatives. Still optional later: calf work twice a week, shrugs or face pulls for the upper back, and a flat press on Day 5 in place of the repeat incline DB press.</p></details>
  <details open><summary>Recovery rules for the heat map</summary><p>Do not train a muscle that shows red. Orange is workable for small muscles but not for a heavy compound. A muscle at green plus a session day is a go. Sleep and protein are the recovery levers you control.</p></details></section>`;
  h+=`<section class="card"><h3 class="sec">From your log</h3>`;
  if(!list.length)h+='<p class="sub">Nothing logged yet. After your first sessions this shows attendance and strength trends.</p>';
  else{
    const wk=list.filter(s=>s.date>=addDays(todayStr(),-6)).length;
    h+=`<div class="kpis"><div><b>${wk}/5</b><span>sessions, last 7 days</span></div><div><b>${recent.length}</b><span>sessions, last 14 days</span></div><div><b>${esc(list[list.length-1].bw||'—')}</b><span>last body weight, kg</span></div></div>`;
    h+=prog.length?`<div class="tbl prog"><div class="tr th"><div class="td nm">Lift</div><div class="td">First</div><div class="td">Best now</div><div class="td">Trend</div></div>${prog.map(p=>`<div class="tr"><div class="td nm"><b>${p.n}</b></div><div class="td">${fmtKg(p.f.kg)}×${p.f.r}</div><div class="td">${fmtKg(p.l.kg)}×${p.l.r}</div><div class="td">${p.ch===null?'one entry':(p.ch>=0?'+':'')+p.ch.toFixed(1)+'%'}</div></div>`).join('')}</div><p class="sub">Trend compares estimated one-rep max (Epley) between your first and latest session for each lift.</p>`:'';
  }
  h+=`</section><section class="card"><h3 class="sec">Next session</h3><p class="sub">${DAYS.find(x=>x.id===suggestedDay()).id} ${DAYS.find(x=>x.id===suggestedDay()).name}. Targets for each lift come from your last entries.</p><div class="tbl">${sug.map(e=>{const s=suggest(e,null);return`<div class="tr"><div class="td nm"><b>${e.n}</b></div><div class="td">${e.s} × ${e.r[0]}–${e.r[1]}</div><div class="td kg">${fmtKg(s.kg)} <small>kg</small></div></div>`;}).join('')}</div></section>`;
  h+=`<section class="card"><h3 class="sec">Share with Claude</h3><p class="sub">Claude reads your saved sessions directly from this page. If that ever fails, copy this summary and paste it into the chat.</p><div class="actions"><button class="btn ghost" id="b-copy">Copy last 14 days</button></div><textarea id="copybox" class="copybox" rows="5" readonly hidden></textarea></section>`;
  root.innerHTML=h;
}

function summaryText(){
  const since=addDays(todayStr(),-13),out=[];
  realList().filter(s=>s.date>=since).forEach(s=>{
    out.push(s.date+' '+s.day+(s.bw?' bw '+s.bw+'kg':'')+(s.notes?' | '+s.notes:''));
    for(const id in s.entries){const ex=exById(id);if(ex){const al=altOf(ex,s.entries[id]);out.push('  '+(al?al.n+' (alternative to '+ex.n+')':ex.n)+': '+s.entries[id].sets.map(x=>x.kg+'x'+x.reps).join(', ')+(s.entries[id].rpe?' RPE '+s.entries[id].rpe:''));}}
  });
  return out.join('\n')||'No sessions saved in the last 14 days.';
}

/* ---------- animation loop ---------- */
const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- events ---------- */
function setTab(t){
  state.tab=t;$$('.tab').forEach(x=>x.hidden=x.id!=='tab-'+t);
  $$('.nav button').forEach(b=>{b.classList.toggle('on',b.dataset.tab===t);b.setAttribute('aria-selected',b.dataset.tab===t);});
  try{history.replaceState(null,'','#'+t);}catch(e){}
  window.scrollTo(0,0);
}
document.addEventListener('click',e=>{
  const t=e.target.closest('button,.mus');if(!t)return;
  if(t.dataset.tab)return setTab(t.dataset.tab);
  if(t.id==='b-save')return saveDraft();
  if(t.id==='b-del')return deleteSession();
  if(t.id==='b-copy'){const txt=summaryText(),box=$('#copybox');box.value=txt;box.hidden=false;try{navigator.clipboard.writeText(txt).then(()=>toast('Copied'),()=>{box.select();toast('Select and copy the text below');});}catch(x){box.select();}return;}
  if(t.dataset.alt!==undefined){const p=t.dataset.alt.split('|'),en=state.draft.entries[p[0]]||(state.draft.entries[p[0]]={});if(p[1])en.alt=p[1];else delete en.alt;en.sets=[];delete en.rpe;state.dirty=true;scheduleAuto();const y=window.scrollY;renderLog();window.scrollTo(0,y);return;}
  if(t.dataset.day){const ex=state.sessions[state.date];if(ex&&ex.day===t.dataset.day){initDraft(state.date);}else{const bw=state.draft.bw;state.draft=blankDraft(state.date,t.dataset.day);state.draft.bw=bw;state.dirty=false;}renderLog();return;}
  if(t.dataset.load){initDraft(t.dataset.load);renderLog();return window.scrollTo(0,0);}
  if(t.dataset.ar){state.ar=t.dataset.ar;return renderStats();}
  if(t.dataset.wr){state.wr=t.dataset.wr;return renderStats();}
  if(t.dataset.open){initDraft(t.dataset.open);renderLog();return setTab('log');}
  if(t.dataset.logbw){setTab('log');const i=$('#f-bw');if(i)i.focus();return;}
  if(t.dataset.m){state.sel=state.sel===t.dataset.m?null:t.dataset.m;return renderStats();}
});
document.addEventListener('click',e=>{const f=e.target.closest('.fx');if(f&&reduce)f.classList.toggle('end');});
document.addEventListener('input',e=>{
  const t=e.target,d=state.draft;if(!d)return;
  if(t.id==='f-bw'){d.bw=t.value;state.dirty=true;scheduleAuto();}
  else if(t.id==='f-notes'){d.notes=t.value;state.dirty=true;scheduleAuto();}
  else if(t.dataset.ex){
    const en=d.entries[t.dataset.ex]||(d.entries[t.dataset.ex]={sets:[]});
    if(t.dataset.f==='rpe')en.rpe=t.value;
    else{const i=Number(t.dataset.i);en.sets[i]=en.sets[i]||{};en.sets[i][t.dataset.f]=t.value;if(t.dataset.f==='reps'&&(en.sets[i].kg===undefined||en.sets[i].kg==='')){const k=document.querySelector('input[data-ex="'+t.dataset.ex+'"][data-i="'+i+'"][data-f="kg"]');if(k&&k.value!=='')en.sets[i].kg=k.value;}}
    state.dirty=true;scheduleAuto();
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='f-date'&&e.target.value){
    state.draft=null;initDraft(e.target.value);renderLog();
  }
});

/* ---------- start ---------- */
const hash=(location.hash||'').slice(1);
if(hash==='heat')state.tab='stats';else if(['stats','log','plan','coach'].indexOf(hash)>=0)state.tab=hash;
loadLocal();
try{const b=cleanBackup(JSON.parse(localStorage.getItem(BK)||'null'));if(b&&Object.keys(b.entries).length){state.date=b.date;state.draft=b;state.dirty=true;}}catch(e){}
if(!state.dirty)initDraft(state.date);renderAll();setTab(state.tab);
initDb();
if(state.dirty)setTimeout(autoSave,800);
function rollover(){if(!state.dirty&&state.date!==todayStr()&&!(document.activeElement&&/INPUT|TEXTAREA/.test(document.activeElement.tagName))){state.date=todayStr();state.draft=null;initDraft(state.date);renderAll();}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(state.dirty)autoSave();}else rollover();});
window.addEventListener('pagehide',()=>{if(state.dirty)autoSave();});
window.addEventListener('focus',rollover);
window.addEventListener('online',()=>schedSync(500));
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(Object.keys(queueGet()).length)schedSync(0);}else schedSync(500);});
/* ---------- themes ---------- */
const LS_TH='split-theme-v1';
const themeGet=()=>Object.assign({mode:'auto',accent:'clay',contrast:'normal'},lsGet(LS_TH,{}));
function applyTheme(){
  const T=themeGet(),d=document.documentElement,mq=matchMedia('(prefers-color-scheme: dark)');
  d.dataset.scheme=T.mode==='auto'?(mq.matches?'dark':'light'):T.mode;d.dataset.accent=T.accent;d.dataset.contrast=T.contrast;
  const tc=$('#tc');if(tc)tc.content=getComputedStyle(d).getPropertyValue('--bg').trim()||'#faf9f5';
  document.querySelectorAll('#th-mode button').forEach(b=>b.classList.toggle('on',b.dataset.mode===T.mode));
  document.querySelectorAll('#th-acc button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.acc===T.accent?'true':'false'));
  const hc=$('#th-hc');if(hc)hc.checked=T.contrast==='high';
}
function setTheme(p){lsSet(LS_TH,Object.assign(themeGet(),p));applyTheme();}
$('#th-mode').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setTheme({mode:b.dataset.mode});});
$('#th-acc').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setTheme({accent:b.dataset.acc});});
$('#th-hc').addEventListener('change',e=>setTheme({contrast:e.target.checked?'high':'normal'}));
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(themeGet().mode==='auto')applyTheme();});}catch(e){}
applyTheme();
/* ---------- settings sheet ---------- */
const dlg=$('#settings');
function openSettings(){const c=cfg();$('#set-repo').value=c?c.repo:'';$('#set-token').value='';$('#set-target').value=targetKg()||'';$('#set-token').placeholder=c?'Token saved. Leave empty to keep it':'github_pat_…';$('#set-build').textContent='App version '+BUILD;$('#set-msg').textContent='';refreshStatus();if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','');}
$('#sync').addEventListener('click',openSettings);
$('#gear').addEventListener('click',openSettings);
$('#set-close').addEventListener('click',()=>dlg.close());
$('#set-target').addEventListener('change',e=>{const v=Number(String(e.target.value).replace(',','.'));if(v>0)lsSet(LS_T,v);else localStorage.removeItem(LS_T);try{renderStats();}catch(x){}});
$('#set-save').addEventListener('click',async()=>{
  const repo=$('#set-repo').value.trim().replace(/^https?:\/\/github\.com\//,'').replace(/\.git$/,''),old=cfg(),token=$('#set-token').value.trim()||(old&&old.token)||'',m=$('#set-msg');
  if(!REPO_RE.test(repo)||!token){m.textContent='Enter the repo as owner/name and paste the token.';return;}
  const c={repo,token};m.textContent='Testing…';
  /* test first, save after: nothing is stored (so nothing can sync) until the repo is confirmed private */
  try{await checkRepo(c);}
  catch(e){
    if(e.kind==='public'){m.textContent='Stopped: that repo is public. Use a private repo for your logs.';return;}
    if(e.kind==='readonly'){m.textContent='The token can read but not write. Give it Contents: read and write.';return;}
    if(e.status===401){m.textContent='GitHub rejected the token.';return;}
    if(e.status===404){m.textContent='Repo not found, or the token cannot see it.';return;}
    if(e.status){m.textContent='GitHub error '+e.status;return;}
    /* offline: safe to keep, because every sync re-checks that the repo is private before sending anything */
    saveCfg(c,old);m.textContent='No connection right now. Settings saved; sync checks the repo and retries when online.';schedSync(100);return;
  }
  saveCfg(c,old);m.textContent='Connected. Syncing…';syncState='pending';schedSync(100);setTimeout(()=>{refreshStatus();m.textContent='Connected.';},2500);
});
/* sync bookkeeping belongs to one repo: switching repos starts it fresh so nothing is mistaken for a remote delete */
function saveCfg(c,old){if(!old||old.repo.toLowerCase()!==c.repo.toLowerCase()){[LS_H,LS_CS,LS_CO].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});state.coach={};}lsSet(LS_C,c);}
$('#set-now').addEventListener('click',()=>{$('#set-msg').textContent='';schedSync(0);});
$('#set-off').addEventListener('click',()=>{localStorage.removeItem(LS_C);syncState='off';refreshStatus();$('#set-msg').textContent='Sync turned off. Logs stay on this phone.';});
$('#set-export').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({app:'split',exported:new Date().toISOString(),sessions:state.sessions},null,1)],{type:'application/json'}),name='split-backup-'+todayStr()+'.json';
  try{const f=new File([blob],name,{type:'application/json'});if(navigator.canShare&&navigator.canShare({files:[f]})){navigator.share({files:[f]}).catch(()=>{});return;}}catch(e){}
  const u=document.createElement('a');u.href=URL.createObjectURL(blob);u.download=name;document.body.appendChild(u);u.click();u.remove();
});
$('#set-import').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0];if(!f)return;
  try{const j=JSON.parse(await f.text()),s=j&&typeof j==='object'?(j.sessions||j):null;if(!s||typeof s!=='object')throw new Error('format');let n=0;
    for(const d of Object.keys(s)){const v=cleanSession(d,s[d]);if(!v)continue;const loc=state.sessions[d];if(!loc||(v.savedAt||'')>(loc.savedAt||'')){state.sessions[d]=v;queue(d,'put');n++;}}
    await persistSessions();state.real=Object.keys(state.sessions).length>0;if(!state.dirty)initDraft(state.date);renderAll();$('#set-msg').textContent='Imported '+n+' workout'+(n===1?'':'s')+'.';
  }catch(x){$('#set-msg').textContent='That file is not a valid backup.';}
  e.target.value='';
});
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){navigator.serviceWorker.register('sw.js').catch(()=>{});}
})();
