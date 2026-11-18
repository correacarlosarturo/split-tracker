// Browser tests for the built app with an in-memory fake of the GitHub API.
// Run: python3 src/build.py && node --test tests/app.test.js
// Needs Playwright with Chromium (npm i --no-save playwright && npx playwright install chromium).
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');

const ROOT=path.join(__dirname,'..');
const TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
let server,base,browser;

before(async()=>{
  server=http.createServer((req,res)=>{
    const p=path.join(ROOT,decodeURIComponent(new URL(req.url,'http://x').pathname));
    if(!p.startsWith(ROOT)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base='http://127.0.0.1:'+server.address().port+'/index.html';
  browser=await chromium.launch();
});
after(async()=>{await browser.close();server.close();});

const today=()=>{const t=new Date(),z=n=>String(n).padStart(2,'0');return t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate());};
const daysAgo=n=>{const t=new Date();t.setDate(t.getDate()-n);const z=x=>String(x).padStart(2,'0');return t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate());};
const sha1=s=>crypto.createHash('sha1').update(s).digest('hex');
const CFG={repo:'me/data',token:'github_pat_SECRET'};
const XSS='</textarea><img src=x onerror="document.title=\'PWNED\'">"><svg onload="document.title=\'PWNED\'">';

/* Minimal fake of the endpoints the app uses. files: {'sessions/2026-01-01.json': jsonString} */
function fakeGitHub(files,opts={}){
  const repo={private:opts.private!==false,permissions:{push:true},default_branch:'main'};
  const calls=[];
  const dirs=()=>{const d={};for(const p of Object.keys(files)){const [dir,name]=p.split('/');(d[dir]=d[dir]||[]).push({path:name,type:'blob',sha:sha1(files[p])});}return d;};
  async function handler(route){
    const req=route.request(),u=new URL(req.url()),m=req.method(),p=u.pathname.replace('/repos/me/data','');
    calls.push(m+' '+p);
    const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(p===''&&m==='GET')return json(200,repo);
    if(p==='/git/trees/main'){const d=dirs();return json(200,{tree:Object.keys(d).map(k=>({path:k,type:'tree',sha:'tree-'+k}))});}
    if(p.startsWith('/git/trees/tree-')){const d=dirs()[p.slice('/git/trees/tree-'.length)]||[];return json(200,{tree:d});}
    if(p.startsWith('/contents/')){
      const f=p.slice('/contents/'.length);
      if(m==='GET')return files[f]===undefined?json(404,{}):json(200,{sha:sha1(files[f]),content:Buffer.from(files[f]).toString('base64')});
      if(m==='PUT'){const b=JSON.parse(req.postData());files[f]=Buffer.from(b.content,'base64').toString();return json(200,{content:{sha:sha1(files[f])}});}
      if(m==='DELETE'){delete files[f];return json(200,{});}
    }
    return json(404,{});
  }
  return {files,repo,calls,handler};
}

async function openApp({ls={},gh,hash='log'}={}){
  const ctx=await browser.newContext({serviceWorkers:'block'});
  const errors=[];
  if(gh)await ctx.route('https://api.github.com/**',gh.handler);
  await ctx.addInitScript(entries=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');for(const k in entries)localStorage.setItem(k,entries[k]);}},Object.fromEntries(Object.entries(ls).map(([k,v])=>[k,JSON.stringify(v)])));
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'#'+hash);
  await page.waitForSelector('#tab-'+hash+' section');
  return {ctx,page,errors};
}
const waitSync=page=>page.waitForFunction(()=>/synced|sync problem/.test(document.querySelector('#sync').textContent),null,{timeout:10000});

test('CSP forbids inline script and the page has none',async()=>{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const csp=html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp,/script-src 'self';/);
  assert.doesNotMatch(csp,/script-src[^;]*unsafe-inline/);
  assert.equal((html.match(/<script>/g)||[]).length,0);
});

test('hostile session text renders as text, never as markup',async()=>{
  const d=today();
  const {ctx,page,errors}=await openApp({ls:{'split-sessions-v2':{[d]:{date:d,day:'D1',savedAt:new Date().toISOString(),notes:XSS,bw:'"><img src=x onerror=alert(1)>',entries:{'d1-lat':{sets:[{kg:'"><b>x',reps:10},{kg:50,reps:10}]}}}}}});
  await page.waitForTimeout(300);
  assert.notEqual(await page.title(),'PWNED');
  assert.equal(await page.$eval('#f-notes',t=>t.value),XSS.trim());
  assert.equal(await page.$$eval('#tab-log img[src="x"], #tab-log svg[onload]',n=>n.length),0);
  // non-numeric weight and body weight were dropped on load, the valid set kept
  assert.equal(await page.$eval('#f-bw',i=>i.value),'');
  assert.equal(await page.$eval('input[data-ex="d1-lat"][data-i="0"][data-f="kg"]',i=>i.value),'50');
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('a session with an unknown day is ignored instead of crashing the app',async()=>{
  const d=today();
  const {ctx,page,errors}=await openApp({ls:{'split-sessions-v2':{[d]:{date:d,day:'D9',entries:{}},[daysAgo(1)]:{date:daysAgo(1),day:'D2',entries:{'d2-lr':{}}}}}});
  assert.deepEqual(errors,[]);
  assert.ok(await page.$('#b-save'));
  await ctx.close();
});

test('setup refuses a public repo and stores nothing',async()=>{
  const gh=fakeGitHub({},{private:false});
  const {ctx,page}=await openApp({gh});
  await page.click('#gear');
  await page.fill('#set-repo','me/data');await page.fill('#set-token','tok');
  await page.click('#set-save');
  await page.waitForFunction(()=>/public/.test(document.querySelector('#set-msg').textContent));
  assert.equal(await page.evaluate(()=>localStorage.getItem('split-sync-cfg-v1')),null);
  assert.ok(!gh.calls.some(c=>c.startsWith('PUT')));
  await ctx.close();
});

test('sync stops sending if the repo became public after setup',async()=>{
  const d=today();
  const gh=fakeGitHub({},{private:false});
  const {ctx,page}=await openApp({gh,ls:{'split-sync-cfg-v1':CFG,'split-queue-v1':{[d]:'put'},'split-sessions-v2':{[d]:{date:d,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg:50,reps:10}]}}}}}});
  await waitSync(page);
  assert.match(await page.textContent('#sync'),/repo is public/);
  assert.deepEqual(gh.calls,['GET ']);
  await ctx.close();
});

test('sync uploads new sessions, pulls remote ones safely and propagates remote deletes',async()=>{
  const mine=daysAgo(1),gone=daysAgo(2),theirs=daysAgo(3),at=new Date().toISOString();
  const s=(date,day,id)=>({date,day,savedAt:at,entries:{[id]:{sets:[{kg:50,reps:10}]}}});
  const goneDoc=JSON.stringify(s(gone,'D2','d2-lr'),null,1);
  // "gone" was synced earlier (this phone holds its sha) and has since been deleted on GitHub.
  const gh=fakeGitHub({['sessions/'+theirs+'.json']:JSON.stringify(Object.assign(s(theirs,'D3','d3-lp'),{notes:XSS}))});
  const {ctx,page,errors}=await openApp({gh,ls:{'split-sync-cfg-v1':CFG,'split-shas-v1':{[gone]:sha1(goneDoc)},'split-sessions-v2':{[mine]:s(mine,'D1','d1-lat'),[gone]:s(gone,'D2','d2-lr')}}});
  await waitSync(page);await page.waitForFunction(()=>/ synced/.test(document.querySelector('#sync').textContent),null,{timeout:10000});
  const local=await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('split-sessions-v2'))).sort());
  assert.deepEqual(local,[theirs,mine].sort(),'remote delete removed "gone", remote session pulled');
  assert.ok(gh.files['sessions/'+mine+'.json'],'never-synced session uploaded');
  assert.ok(!gh.files['sessions/'+gone+'.json'],'deleted session not re-uploaded');
  assert.notEqual(await page.title(),'PWNED');
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('switching to a new repo uploads everything instead of deleting',async()=>{
  const d=daysAgo(1),doc={date:d,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg:50,reps:10}]}}};
  const gh=fakeGitHub({'sessions/2020-01-01.json':JSON.stringify({date:'2020-01-01',day:'D1',entries:{}})});
  // shas from a previous repo would look like "deleted remotely"; saving a new repo must clear them
  const {ctx,page}=await openApp({gh,ls:{'split-sync-cfg-v1':{repo:'me/old',token:'t'},'split-shas-v1':{[d]:'abc'},'split-sessions-v2':{[d]:doc}}});
  await page.click('#gear');await page.fill('#set-repo','me/data');await page.click('#set-save');
  await page.waitForFunction(()=>/Connected/.test(document.querySelector('#set-msg').textContent));
  await page.waitForFunction(()=>/ synced/.test(document.querySelector('#sync').textContent),null,{timeout:10000});
  assert.ok(gh.files['sessions/'+d+'.json']);
  await ctx.close();
});

test('backup import keeps valid sessions and drops malformed ones',async()=>{
  const {ctx,page,errors}=await openApp({});
  const backup={sessions:{[daysAgo(1)]:{date:daysAgo(1),day:'D1',entries:{'d1-lat':{sets:[{kg:50,reps:10}]}}},[daysAgo(2)]:{day:'nope',entries:{}},'../x':{day:'D1',entries:{}},[daysAgo(3)]:{day:'D2',entries:{'d2-lr':{sets:'bad'}},notes:XSS}}};
  await page.click('#gear');
  await page.setInputFiles('#set-import',{name:'b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>/Imported/.test(document.querySelector('#set-msg').textContent));
  assert.equal(await page.textContent('#set-msg'),'Imported 2 workouts.');
  const local=await page.evaluate(()=>JSON.parse(localStorage.getItem('split-sessions-v2')));
  assert.deepEqual(Object.keys(local).sort(),[daysAgo(3),daysAgo(1)].sort());
  assert.deepEqual(local[daysAgo(3)].entries,{});
  assert.notEqual(await page.title(),'PWNED');
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('IndexedDB copy wins when it is newer than localStorage',async()=>{
  const d=daysAgo(1),doc={date:d,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg:60,reps:10}]}}};
  const {ctx,page}=await openApp({ls:{'split-sessions-at-v1':1}});
  await page.evaluate(async v=>{await new Promise((res,rej)=>{const r=indexedDB.open('split',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>{const t=r.result.transaction('kv','readwrite');t.objectStore('kv').put(JSON.stringify({at:Date.now(),s:v}),'sessions');t.oncomplete=res;t.onerror=rej;};});},{[d]:doc});
  await page.reload();
  await page.waitForFunction(k=>{const s=JSON.parse(localStorage.getItem('split-sessions-v2')||'{}');return !!s[k];},d);
  await ctx.close();
});

test('stats default to this week for activity and 1M for body weight',async()=>{
  const {ctx,page}=await openApp({hash:'stats'});
  assert.equal(await page.textContent('[data-ar].on'),'Week');
  assert.equal(await page.textContent('[data-wr].on'),'1M');
  assert.match(await page.textContent('.actsum'),/this week/);
  await ctx.close();
});

test('Month activity is the calendar month, not the last 30 days',async()=>{
  const t=today(),first=t.slice(0,8)+'01';
  const prev=new Date(first+'T12:00:00');prev.setDate(0);const z=n=>String(n).padStart(2,'0');
  const lastOfPrev=prev.getFullYear()+'-'+z(prev.getMonth()+1)+'-'+z(prev.getDate());
  const s=(date)=>({date,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg:50,reps:10}]}}});
  const {ctx,page,errors}=await openApp({hash:'stats',ls:{'split-sessions-v2':{[first]:s(first),[lastOfPrev]:s(lastOfPrev)}}});
  await page.click('[data-ar="Month"]');
  const monthName=new Date(first+'T12:00:00').toLocaleString('en',{month:'long'});
  assert.match(await page.textContent('.actsum'),new RegExp('^1 workout · .* in '+monthName+'$'));
  // every day of the month is shown, days from other months are blank
  const nums=await page.$$eval('.cal .cd',els=>els.map(e=>e.childNodes[0]&&e.childNodes[0].nodeType===3?Number(e.childNodes[0].textContent):null).filter(n=>n));
  const daysInMonth=new Date(Number(first.slice(0,4)),Number(first.slice(5,7)),0).getDate();
  assert.deepEqual(nums,Array.from({length:daysInMonth},(_,i)=>i+1));
  assert.deepEqual(errors,[]);
  await ctx.close();
});
