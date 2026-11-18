const V='split-2026-11-18.133807';
const SHELL=['./','index.html','split.js','theme.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
/* Network first with a 3.5 s timeout, cache as fallback. Only good responses are cached, so a 404 or 500 never replaces a working copy. */
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  const net=fetch(e.request),to=new Promise((_,rej)=>setTimeout(rej,3500));
  e.respondWith(Promise.race([net,to]).then(r=>{
    if(!r.ok)throw new Error('bad response');
    const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(m=>m||(e.request.mode==='navigate'?caches.match('index.html'):net))));
});
