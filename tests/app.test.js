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
  const dirs=()=>{const d={};for(const p of Object.keys(files)){if(!p.includes('/'))continue;const [dir,name]=p.split('/');(d[dir]=d[dir]||[]).push({path:name,type:'blob',sha:sha1(files[p])});}return d;};
  const rootBlobs=()=>Object.keys(files).filter(p=>!p.includes('/')).map(p=>({path:p,type:'blob',sha:sha1(files[p])}));
  async function handler(route){
    const req=route.request(),u=new URL(req.url()),m=req.method(),p=u.pathname.replace('/repos/me/data','');
    calls.push(m+' '+p);
    const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(p===''&&m==='GET')return json(200,repo);
    if(p==='/git/trees/main'){const d=dirs();return json(200,{tree:Object.keys(d).map(k=>({path:k,type:'tree',sha:'tree-'+k})).concat(rootBlobs())});}
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

async function openApp({ls={},gh,hash='log',ctxOpts={},before}={}){
  const ctx=await browser.newContext(Object.assign({serviceWorkers:'block'},ctxOpts));
  if(before)await before(ctx);
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

test('setup refuses repo names with dot segments, so the token never goes to another API path',async()=>{
  const {ctx,page}=await openApp({gh:fakeGitHub({})});
  await page.click('#gear');
  for(const bad of ['me/..','../data','me/.','./data']){
    await page.fill('#set-repo',bad);await page.fill('#set-token','tok');await page.click('#set-save');
    assert.match(await page.textContent('#set-msg'),/owner\/name/);
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('split-sync-cfg-v1')),null);
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

/* ---------- Liquid Glass ---------- */
// Resolve any CSS colour (including color-mix and custom properties) to [r,g,b,a] in 0..1 inside the page.
async function tokenColors(page,names){
  return page.evaluate(names=>{
    const out={},el=document.createElement('i');document.body.appendChild(el);
    for(const n of names){
      el.style.color='';el.style.color='var('+n+')';
      const c=getComputedStyle(el).color;let m;
      if((m=c.match(/^rgba?\(([^)]+)\)/))){const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);out[n]=[p[0]/255,p[1]/255,p[2]/255,p.length>3?p[3]:1];}
      else if((m=c.match(/^color\(srgb ([^)]+)\)/))){const p=m[1].split(/[ /]+/).filter(Boolean).map(Number);out[n]=[p[0],p[1],p[2],p.length>3?p[3]:1];}
      else out[n]=null;
    }
    el.remove();return out;
  },names);
}
const over=(top,bot)=>{const a=top[3]+bot[3]*(1-top[3]);return [0,1,2].map(i=>(top[i]*top[3]+bot[i]*bot[3]*(1-top[3]))/a).concat([a]);};
const lum=c=>{const f=v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const theme=(mode,extra={})=>({'split-theme-v1':Object.assign({mode,accent:'clay',contrast:'normal'},extra)});

test('glass: wash sits behind the page, the tab bar blurs, cards and header do not',async()=>{
  const {ctx,page}=await openApp({hash:'stats',ls:theme('light')});
  const r=await page.evaluate(()=>{const bf=e=>{const s=getComputedStyle(e);return s.backdropFilter||s.webkitBackdropFilter||'none';};
    return {wash:getComputedStyle(document.body,'::before').position,header:bf(document.querySelector('header')),nav:bf(document.querySelector('.nav')),card:bf(document.querySelector('.card')),radius:getComputedStyle(document.querySelector('.card')).borderRadius};});
  assert.equal(r.wash,'fixed');
  assert.match(r.nav,/blur/);
  assert.equal(r.header,'none');assert.equal(r.card,'none');
  assert.equal(r.radius,'22px');
  await ctx.close();
});

test('the header scrolls away with the page and sits on the background',async()=>{
  const {ctx,page}=await openApp({hash:'plan',ctxOpts:{viewport:{width:390,height:700}}});
  const r=await page.evaluate(()=>{const h=document.querySelector('header'),cs=getComputedStyle(h);window.scrollTo(0,600);
    return {pos:cs.position,bg:cs.backgroundColor,bottom:h.getBoundingClientRect().bottom};});
  assert.equal(r.pos,'static');
  assert.match(r.bg,/rgba\(0, 0, 0, 0\)|transparent/);
  assert.ok(r.bottom<0,'header scrolled out of view: '+r.bottom);
  await ctx.close();
});

test('glass: text contrast holds in light, dark and black',{timeout:120000},async()=>{
  for(const mode of ['light','dark','black'])for(const accent of ['clay','ocean','forest','violet','graphite']){
    const {ctx,page}=await openApp({hash:'stats',ls:theme(mode,{accent})});
    const c=await tokenColors(page,['--bg','--ink','--muted','--accent','--warn','--glass','--wash-1','--wash-2','--wash-3']);
    for(const k in c)assert.ok(c[k],mode+' '+k+' resolves to a colour');
    for(const w of [null,c['--wash-1'],c['--wash-2'],c['--wash-3']]){
      const ground=w?over(w,c['--bg']):c['--bg'],surf=over(c['--glass'],ground);
      for(const ink of ['--ink','--muted','--accent','--warn']){
        const r=contrast(c[ink],surf);
        assert.ok(r>=4.5,`${mode}/${accent}: ${ink} on glass over ${w?'wash':'bg'} is ${r.toFixed(2)}:1`);
      }
    }
    await ctx.close();
  }
});

test('glass: the background gradient follows the accent in every mode',async()=>{
  for(const mode of ['light','dark','black']){
    const got={};
    for(const accent of ['clay','ocean']){
      const {ctx,page}=await openApp({hash:'stats',ls:theme(mode,{accent})});
      got[accent]=await tokenColors(page,['--wash-1','--wash-2','--wash-3']);
      await ctx.close();
    }
    for(const w of ['--wash-1','--wash-2','--wash-3']){
      assert.notDeepEqual(got.clay[w].slice(0,3).map(v=>v.toFixed(2)),got.ocean[w].slice(0,3).map(v=>v.toFixed(2)),mode+' '+w+' changes with the accent');
      assert.ok(got.clay[w][3]>=(mode==='black'?.3:.2),mode+' '+w+' is visible (alpha '+got.clay[w][3]+')');
    }
  }
});

test('glass: high contrast is solid',async()=>{
  for(const mode of ['light','dark']){
    const {ctx,page}=await openApp({hash:'stats',ls:theme(mode,{contrast:'high'})});
    const r=await page.evaluate(()=>{const bf=e=>{const s=getComputedStyle(e);return s.backdropFilter||s.webkitBackdropFilter||'none';};return [bf(document.querySelector('header')),bf(document.querySelector('.nav'))];});
    assert.deepEqual(r,['none','none'],mode);
    const c=await tokenColors(page,['--glass','--glass-bar']);
    assert.equal(c['--glass'][3],1,mode+' --glass opaque');assert.equal(c['--glass-bar'][3],1,mode+' --glass-bar opaque');
    await ctx.close();
  }
});

test('glass: falls back when backdrop-filter is unsupported',async()=>{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const m=html.match(/@supports not \(\(backdrop-filter:\s*blur\(1px\)\) or \(-webkit-backdrop-filter:\s*blur\(1px\)\)\)\s*\{([\s\S]*?)\}\s*\}/);
  assert.ok(m,'fallback block present');
  const a=m[1].match(/--glass-bar:\s*rgba\([^)]*,\s*([\d.]+)\)/);
  assert.ok(a&&Number(a[1])>=.92,'--glass-bar alpha >= .92');
});

test('readme renders exist and are framed phones',{timeout:180000},async()=>{
  const {spawnSync}=require('node:child_process'),os=require('node:os');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'shots-'));
  const r=spawnSync(process.execPath,[path.join(ROOT,'tools','readme-shots.js'),out],{encoding:'utf8',timeout:170000});
  assert.equal(r.status,0,r.stderr||r.stdout);
  const size=f=>{const b=fs.readFileSync(path.join(out,f));assert.equal(b.toString('ascii',1,4),'PNG',f);return [b.readUInt32BE(16),b.readUInt32BE(20)];};
  assert.deepEqual(size('hero.png'),[1600,900]);
  for(const f of ['stats.png','log.png','coach.png','dark.png'])assert.deepEqual(size(f),[900,1500],f);
  fs.rmSync(out,{recursive:true,force:true});
});

test('glass: the no-blur fallback makes bars near-opaque in every mode',async()=>{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const m=html.match(/@supports not \(\(backdrop-filter:\s*blur\(1px\)\) or \(-webkit-backdrop-filter:\s*blur\(1px\)\)\)\s*\{([\s\S]*?\})\s*\}/);
  assert.ok(m,'fallback block present');
  for(const mode of ['light','dark','black']){
    const {ctx,page}=await openApp({hash:'stats',ls:theme(mode)});
    await page.addStyleTag({content:m[1]}); // apply the fallback as an unsupporting browser would
    const c=await tokenColors(page,['--glass-bar']);
    assert.ok(c['--glass-bar'][3]>=.92,mode+' --glass-bar alpha '+c['--glass-bar'][3]);
    if(mode==='black')assert.ok(c['--glass-bar'].slice(0,3).every(v=>v<.05),'black fallback stays black');
    await ctx.close();
  }
});

test('stats no longer shows a first-lift card',async()=>{
  const {ctx,page}=await openApp({hash:'stats'});
  assert.equal(await page.$$eval('.nextlift',n=>n.length),0);
  assert.doesNotMatch(await page.textContent('#tab-stats'),/First lift/i);
  await ctx.close();
});

test('settings has a close button in the top right corner',async()=>{
  const {ctx,page}=await openApp({hash:'stats'});
  await page.click('#gear');
  const r=await page.evaluate(()=>{const d=document.querySelector('#settings').getBoundingClientRect(),x=document.querySelector('#set-x');const b=x.getBoundingClientRect();return {label:x.getAttribute('aria-label'),right:d.right-b.right,top:b.top-d.top,w:b.width,h:b.height};});
  assert.equal(r.label,'Close settings');
  assert.ok(r.right<40&&r.top<40,'top right: '+JSON.stringify(r));
  assert.ok(r.w>=44&&r.h>=44,'44px touch target');
  await page.click('#set-x');
  assert.equal(await page.$eval('#settings',d=>d.open),false);
  await ctx.close();
});

test('a focused input is never left under the tab bar',async()=>{
  const {ctx,page}=await openApp({hash:'log',ctxOpts:{viewport:{width:390,height:700}}});
  const sel='input[data-ex][data-i="0"][data-f="reps"]';
  // put the input partly behind the floating tab bar
  await page.evaluate(sel=>{const n=document.querySelector('.nav').getBoundingClientRect().top,i=document.querySelector(sel).getBoundingClientRect().bottom;window.scrollBy(0,i-n-10);},sel);
  await page.focus(sel);await page.waitForTimeout(400);
  const r=await page.evaluate(sel=>({nav:document.querySelector('.nav').getBoundingClientRect().top,input:document.querySelector(sel).getBoundingClientRect().bottom}),sel);
  assert.ok(r.input<=r.nav,`input bottom ${r.input} vs tab bar top ${r.nav}`);
  await ctx.close();
});

test('date and body weight fields never overlap on a narrow phone',async()=>{
  const {ctx,page}=await openApp({hash:'log',ctxOpts:{viewport:{width:320,height:640}}});
  const r=await page.evaluate(()=>{const d=document.querySelector('#f-date'),b=document.querySelector('#f-bw'),cs=getComputedStyle(d);
    const R=e=>e.getBoundingClientRect(),dr=R(d),br=R(b),dl=R(d.closest('.fld')),bl=R(b.closest('.fld'));
    const overlap=!(dr.right<=br.left||br.right<=dr.left||dr.bottom<=br.top||br.bottom<=dr.top);
    return {overlap,dateInside:dr.right<=dl.right+0.5,bwInside:br.right<=bl.right+0.5,appearance:cs.appearance||cs.webkitAppearance,minW:cs.minWidth,fldMinW:getComputedStyle(d.closest('.fld')).minWidth};});
  assert.equal(r.overlap,false);assert.ok(r.dateInside&&r.bwInside,JSON.stringify(r));
  // guards for iOS Safari, whose native date control will not shrink to its column otherwise
  assert.equal(r.appearance,'none');assert.equal(r.minW,'0px');assert.equal(r.fldMinW,'0px');
  await ctx.close();
});

test('header shows the app icon and "Split", with the gear at the far end',async()=>{
  const {ctx,page}=await openApp({hash:'stats',ls:theme('light')});
  const r=await page.evaluate(()=>{const h=document.querySelector('header .in').getBoundingClientRect(),i=document.querySelector('header .brand svg').getBoundingClientRect(),g=document.querySelector('#gear').getBoundingClientRect();
    return {title:document.querySelector('header h1').textContent.trim(),iconLeft:i.left-h.left,gearRight:h.right-g.right,order:i.right<=g.left};});
  assert.equal(r.title,'Split');
  assert.ok(r.iconLeft<4&&r.gearRight<4&&r.order,JSON.stringify(r));
  assert.doesNotMatch(await page.textContent('header'),/Five-Day/);
  await ctx.close();
});

test('the header icon takes the accent colour',async()=>{
  const fills={};
  for(const accent of ['clay','ocean']){
    const {ctx,page}=await openApp({hash:'stats',ls:theme('light',{accent})});
    fills[accent]=await page.evaluate(()=>{const f=getComputedStyle(document.querySelector('header .brand .tile-bg')).fill,el=document.createElement('i');el.style.color='var(--accent)';document.body.appendChild(el);const a=getComputedStyle(el).color;el.remove();return {f,a};});
    assert.equal(fills[accent].f,fills[accent].a,accent+' icon uses --accent');
    await ctx.close();
  }
  assert.notEqual(fills.clay.f,fills.ocean.f);
});

test('sync status shows as a dot on the gear and in its label',async()=>{
  const {ctx,page,errors}=await openApp({hash:'stats'});
  await page.waitForFunction(()=>/this phone only/.test(document.querySelector('#gear').getAttribute('aria-label')||''));
  assert.ok(await page.$('#gear #sync[data-s]'));
  await page.click('#gear');
  assert.equal(await page.$eval('#settings',d=>d.open),true);
  assert.match(await page.textContent('#set-status'),/this phone only/);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('the glass slider sets how clear the bars are, and is remembered',async()=>{
  const alpha=page=>page.evaluate(()=>{const m=getComputedStyle(document.querySelector('.nav')).backgroundColor.match(/[\d.]+/g).map(Number);return m.length>3?m[3]:1;});
  const {ctx,page}=await openApp({hash:'stats',ls:theme('light')});
  await page.click('#gear');
  for(const [v,lo,hi] of [[0,0,.25],[100,.85,1]]){
    await page.$eval('#th-glass',(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},v);
    const a=await alpha(page);assert.ok(a>=lo&&a<=hi,`glass ${v}: nav alpha ${a}`);
  }
  await page.$eval('#th-glass',el=>{el.value=10;el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.reload();await page.waitForSelector('#tab-stats section');
  const a=await alpha(page);assert.ok(a<.35,'remembered after reload: '+a);
  assert.equal(await page.$eval('#th-glass',el=>el.value),'10');
  await ctx.close();
});

test('iOS draws its own status bar above the page',async()=>{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  assert.match(html,/<meta name="apple-mobile-web-app-status-bar-style" content="default">/);
  assert.doesNotMatch(html,/sb-band/);
});

test('nothing in the header is drawn with filters or blur',async()=>{
  const {ctx,page}=await openApp({hash:'stats',ls:theme('dark')});
  const r=await page.evaluate(()=>{const fx=[...document.querySelectorAll('header, header *')].map(e=>{const s=getComputedStyle(e);return [s.filter,s.backdropFilter||s.webkitBackdropFilter||'none',s.willChange,s.transform];}).filter(v=>v[0]!=='none'||v[1]!=='none'||v[2]!=='auto'||v[3]!=='none');
    return {fx,pad:parseFloat(getComputedStyle(document.querySelector('header')).paddingTop)};});
  assert.deepEqual(r.fx,[],'no filter/backdrop/will-change/transform in the header');
  assert.ok(r.pad>=26&&r.pad<=32,'header top padding '+r.pad+' (iOS blurs ~21px below the status bar)');
  await ctx.close();
});

test('the release workflow reads the same version the app shows in Settings',async()=>{
  const wf=fs.readFileSync(path.join(ROOT,'.github','workflows','release.yml'),'utf8');
  assert.match(wf,/branches:\s*\[main\]/);
  assert.match(wf,/contents:\s*write/);
  const pat=wf.match(/grep -oP "([^"]+)" split\.js/);
  assert.ok(pat,'workflow greps split.js for the version');
  const {execFileSync}=require('node:child_process');
  const v=execFileSync('grep',['-oP',pat[1],path.join(ROOT,'split.js')],{encoding:'utf8'}).trim();
  const shown=fs.readFileSync(path.join(ROOT,'split.js'),'utf8').match(/const BUILD='([^']+)'/)[1];
  assert.equal(v,shown);
  assert.match(v,/^\d{4}-\d{2}-\d{2}\.\d{6}$/);
});

test('theme and target weight are saved to the data repo',async()=>{
  const gh=fakeGitHub({});
  const {ctx,page}=await openApp({gh,hash:'stats',ls:{'split-sync-cfg-v1':CFG}});
  await waitSync(page);
  await page.click('#gear');
  await page.click('#th-mode button[data-mode="dark"]');
  await page.click('#th-acc button[data-acc="forest"]');
  await page.fill('#set-target','82.5');await page.dispatchEvent('#set-target','change');
  await page.waitForFunction(()=>true);
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){const f=gh.files['settings.json'];if(f&&JSON.parse(f).targetKg===82.5&&JSON.parse(f).theme.accent==='forest')break;await page.waitForTimeout(250);}
  const saved=JSON.parse(gh.files['settings.json']);
  assert.equal(saved.theme.mode,'dark');assert.equal(saved.theme.accent,'forest');assert.equal(saved.targetKg,82.5);
  assert.ok(!isNaN(Date.parse(saved.updatedAt)));
  await ctx.close();
});

test('a fresh install gets its theme and target weight back from the repo',async()=>{
  const gh=fakeGitHub({'settings.json':JSON.stringify({updatedAt:'2026-01-01T00:00:00.000Z',theme:{mode:'black',accent:'ocean',contrast:'normal',glass:30},targetKg:80})});
  const {ctx,page}=await openApp({gh,hash:'stats',ls:{'split-sync-cfg-v1':CFG}});
  await waitSync(page);
  await page.waitForFunction(()=>document.documentElement.dataset.scheme==='black',null,{timeout:10000});
  const r=await page.evaluate(()=>({accent:document.documentElement.dataset.accent,target:localStorage.getItem('split-target-kg-v1'),glass:document.documentElement.style.getPropertyValue('--tint')}));
  assert.deepEqual(r,{accent:'ocean',target:'80',glass:'0.3'});
  assert.ok(!gh.calls.some(c=>c==='PUT /contents/settings.json'),'restoring does not write the file back');
  await ctx.close();
});

test('malformed settings in the repo are ignored',async()=>{
  const gh=fakeGitHub({'settings.json':JSON.stringify({updatedAt:'2030-01-01T00:00:00.000Z',theme:{mode:'"><img src=x onerror=alert(1)>',accent:'nope',contrast:9,glass:'lots'},targetKg:'heavy'})});
  const {ctx,page,errors}=await openApp({gh,hash:'stats',ls:Object.assign({'split-sync-cfg-v1':CFG},theme('light'))});
  await waitSync(page);await page.waitForTimeout(300);
  const r=await page.evaluate(()=>({scheme:document.documentElement.dataset.scheme,accent:document.documentElement.dataset.accent,target:localStorage.getItem('split-target-kg-v1')}));
  assert.deepEqual(r,{scheme:'light',accent:'clay',target:null});
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('the settings sheet opens below the band iOS blurs, and the ruler is gone',async()=>{
  const {ctx,page}=await openApp({hash:'stats'});
  await page.click('#gear');
  const r=await page.$eval('#settings',d=>({top:d.getBoundingClientRect().top,mt:parseFloat(getComputedStyle(d).marginTop),bottom:d.getBoundingClientRect().bottom,vh:innerHeight}));
  assert.ok(r.mt>=32,'sheet top margin '+r.mt);
  assert.ok(Math.abs(r.top-r.mt)<1,'sheet starts at its top margin, not centred: '+JSON.stringify(r));
  assert.ok(r.bottom<=r.vh,'sheet fits on screen');
  assert.equal(await page.$('#set-ruler'),null);assert.equal(await page.$('#ruler'),null);
  await ctx.close();
});

/* ---------- skipping a lift for one day ---------- */
const lat3=(date,kg=60)=>({date,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg,reps:11},{kg,reps:11},{kg,reps:11}]}}});
const savedSessions=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('split-sessions-v2')||'{}'));

test('every lift on the Log tab has a Skip today button',async()=>{
  const {ctx,page}=await openApp({hash:'log'});
  const r=await page.evaluate(()=>({cards:document.querySelectorAll('.card.ex').length,skips:[...document.querySelectorAll('.card.ex [data-skip]')].map(b=>[b.textContent.trim(),b.getAttribute('aria-label')])}));
  assert.ok(r.cards>=5);assert.equal(r.skips.length,r.cards);
  for(const [t,a] of r.skips){assert.equal(t,'Skip today');assert.match(a,/^Skip .+ today$/);}
  await ctx.close();
});

test('skipping collapses the lift, saves it as skipped, and Undo brings it back',async()=>{
  const d=today();
  const {ctx,page,errors}=await openApp({hash:'log',ls:{'split-sessions-v2':{[daysAgo(2)]:lat3(daysAgo(2))}}});
  await page.click('.daybtn[data-day="D1"]');
  await page.click('[data-skip="d1-lat"]');
  assert.ok(await page.$('#x-d1-lat.skipped'));
  assert.match(await page.textContent('#x-d1-lat'),/Skipped today/);
  assert.equal(await page.$$eval('#x-d1-lat input',n=>n.length),0,'no inputs on a skipped lift');
  assert.ok(await page.$$eval('#x-d1-row input',n=>n.length)>0,'other lifts are untouched');
  await page.waitForFunction(k=>{const s=JSON.parse(localStorage.getItem('split-sessions-v2')||'{}')[k];return !!(s&&s.entries['d1-lat']&&s.entries['d1-lat'].skipped===true);},d,{timeout:8000});
  const e=(await savedSessions(page))[d].entries['d1-lat'];
  assert.deepEqual(e,{sets:[],skipped:true});
  await page.click('[data-unskip="d1-lat"]');
  assert.equal(await page.$('#x-d1-lat.skipped'),null);
  assert.ok(await page.$$eval('#x-d1-lat input',n=>n.length)>0,'inputs are back');
  assert.match(await page.textContent('#x-d1-lat'),/Next: 60 kg/);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('a skip is for that day only: the plan, other days and weight suggestions are unchanged',async()=>{
  const d=today(),tomorrow=daysAgo(-1);
  const {ctx,page}=await openApp({hash:'log',ls:{'split-sessions-v2':{[daysAgo(2)]:lat3(daysAgo(2))}}});
  await page.click('.daybtn[data-day="D1"]');
  await page.click('[data-skip="d1-lat"]');
  await page.waitForFunction(k=>{const s=JSON.parse(localStorage.getItem('split-sessions-v2')||'{}')[k];return !!(s&&s.entries['d1-lat']);},d,{timeout:8000});
  // another date: the lift is back, and its history and suggestion skip over the skipped day
  await page.$eval('#f-date',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},tomorrow);
  await page.click('.daybtn[data-day="D1"]');
  assert.equal(await page.$('#x-d1-lat.skipped'),null);
  const t=await page.textContent('#x-d1-lat');
  assert.match(t,new RegExp('Last time \\('+fmtDateRe(daysAgo(2))+'\\)'));assert.match(t,/Next: 60 kg/);
  // the plan still lists it
  await page.click('nav button[data-tab="plan"]');
  assert.match(await page.textContent('#tab-plan'),/Lat pulldown/);
  await ctx.close();
});
const fmtDateRe=s=>{const a=s.split('-').map(Number),W=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return W[new Date(a[0],a[1]-1,a[2]).getDay()]+' '+s.slice(8)+'/'+s.slice(5,7);};

test('a skipped lift stays skipped after a reload',async()=>{
  const d=today();
  const {ctx,page}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D1"]');
  await page.click('[data-skip="d1-row"]');
  await page.waitForFunction(k=>{const s=JSON.parse(localStorage.getItem('split-sessions-v2')||'{}')[k];return !!(s&&s.entries['d1-row']);},d,{timeout:8000});
  await page.reload();await page.waitForSelector('#tab-log section');
  assert.ok(await page.$('#x-d1-row.skipped'));
  await ctx.close();
});

test('skipped lifts count as no sets and no lifts, and the summary says skipped',async()=>{
  const d=today();
  const s={date:d,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg:50,reps:10}]},'d1-row':{sets:[],skipped:true}}};
  const {ctx,page,errors}=await openApp({hash:'log',ls:{'split-sessions-v2':{[d]:s}}});
  assert.match(await page.textContent('.recent .rbtn'),/1 lifts?/);
  await page.click('nav button[data-tab="coach"]');await page.click('#b-copy');
  const box=await page.$eval('#copybox',t=>t.value);
  assert.match(box,/Seated cable row: skipped/);assert.match(box,/Lat pulldown: 50x10/);
  await page.click('nav button[data-tab="stats"]');
  assert.match(await page.textContent('#tab-stats .rbtn[data-open]'),/1 sets/);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('skipped lifts sync and import, and a malformed skip flag is ignored',async()=>{
  const d=daysAgo(1);
  const doc={date:d,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[{kg:50,reps:10}]},'d1-row':{sets:[],skipped:true},'d1-bbrow':{sets:[],skipped:'yes'}}};
  // sync: pushed to the repo with the flag, and pulled back cleaned
  const gh=fakeGitHub({});
  const a=await openApp({gh,hash:'log',ls:{'split-sync-cfg-v1':CFG,'split-sessions-v2':{[d]:doc},'split-queue-v1':{[d]:'put'}}});
  await waitSync(a.page);
  const up=JSON.parse(gh.files['sessions/'+d+'.json']);
  assert.deepEqual(up.entries['d1-row'],{sets:[],skipped:true});
  assert.equal(up.entries['d1-bbrow'],undefined,'skipped:"yes" is not a skip');
  await a.ctx.close();
  // backup import
  const b=await openApp({hash:'log'});
  await b.page.click('#gear');
  await b.page.setInputFiles('#set-import',{name:'b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({sessions:{[d]:doc}}))});
  await b.page.waitForFunction(()=>/Imported 1/.test(document.querySelector('#set-msg').textContent));
  const got=(await savedSessions(b.page))[d].entries;
  assert.deepEqual(got['d1-row'],{sets:[],skipped:true});assert.equal(got['d1-bbrow'],undefined);
  await b.ctx.close();
});

test('a day with only skips is not a workout, and undoing the only skip leaves no empty session',async()=>{
  const d=today();
  const only={date:d,day:'D1',savedAt:new Date().toISOString(),entries:{'d1-lat':{sets:[],skipped:true}}};
  const {ctx,page,errors}=await openApp({hash:'stats',ls:{'split-sessions-v2':{[d]:only}}});
  assert.match(await page.textContent('.tiles .tile'),/Workouts\s*0/);
  assert.match(await page.textContent('.next'),/D1/,'Next up has not moved on from D1');
  // undo the only skip: the saved session disappears
  await page.click('nav button[data-tab="log"]');
  await page.click('[data-load="'+d+'"]');
  await page.click('[data-unskip="d1-lat"]');
  await page.waitForFunction(k=>!JSON.parse(localStorage.getItem('split-sessions-v2')||'{}')[k],d,{timeout:8000});
  assert.deepEqual(errors,[]);
  await ctx.close();
});

/* ---------- train at home ---------- */
const homeOn=page=>page.$eval('#b-home',b=>b.getAttribute('aria-checked'));
const titles=page=>page.$$eval('.card.ex h3',n=>n.map(x=>x.textContent));
async function waitSaved(page,d,ok){for(let i=0;i<80;i++){if(ok((await savedSessions(page))[d]))return;await page.waitForTimeout(100);}throw new Error('not saved');}

test('every lift on every day has a home version that uses only the equipment at home',async()=>{
  const {ctx,page}=await openApp({hash:'log'});
  const r=await page.evaluate(()=>EX.map(e=>({id:e.id,h:HOME[e.k]||null})));
  const owned=[0,5,6,8,12];
  for(const {id,h} of r){
    assert.ok(h,id+' has a home version');
    assert.ok(['dumbbell','kettlebell','bodyweight'].includes(h.eq),id+' uses home equipment');
    assert.ok(h.w.every(x=>owned.includes(x))&&h.w.includes(h.kg),id+' only suggests weights you own');
    assert.doesNotMatch(h.n+' '+h.cue,/bench|squat|lunge|cable|machine/i,id+' needs no bench and stays off squats and lunges');
  }
  for(const d of ['D1','D2','D3','D4','D5']){await page.click('.daybtn[data-day="'+d+'"]');assert.equal(await homeOn(page),'false');}
  await ctx.close();
});

test('Train at home swaps every lift for that day, and turning it off restores the gym lifts',async()=>{
  const d=today();
  const {ctx,page,errors}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D4"]');
  const gym=await titles(page);
  await page.click('#b-home');
  assert.equal(await homeOn(page),'true');
  const home=await titles(page);
  assert.deepEqual(home,['Dumbbell curl','Dumbbell hammer curl','One-arm overhead dumbbell extension','Seated kettlebell tricep extension','One-arm kettlebell press','Dumbbell reverse fly','Reverse crunch']);
  assert.match(await page.textContent('#x-d4-pd'),/at home, instead of Rope pushdown/);
  assert.match(await page.textContent('#x-d4-pd'),/Next: 12 kg/);
  assert.match(await page.textContent('#x-d4-sp'),/Next: 8 kg/);
  await waitSaved(page,d,s=>!!(s&&s.home===true));
  // a reload keeps it on
  await page.reload();await page.waitForSelector('#tab-log section');
  assert.equal(await homeOn(page),'true');assert.deepEqual(await titles(page),home);
  // another date is a gym day again
  await page.$eval('#f-date',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},daysAgo(-1));
  await page.click('.daybtn[data-day="D4"]');
  assert.equal(await homeOn(page),'false');assert.deepEqual(await titles(page),gym);
  // back to today, switch off: gym lifts return and the empty day is removed
  await page.$eval('#f-date',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},d);
  await page.click('#b-home');
  assert.equal(await homeOn(page),'false');assert.deepEqual(await titles(page),gym);
  await page.waitForFunction(k=>!JSON.parse(localStorage.getItem('split-sessions-v2')||'{}')[k],d,{timeout:8000});
  // the plan is untouched
  await page.click('nav button[data-tab="plan"]');
  assert.match(await page.textContent('#tab-plan'),/Rope pushdown/);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('home sets save with their own history, and lifts already logged keep what they are',async()=>{
  const d=today();
  const {ctx,page,errors}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D4"]');
  await page.fill('input[data-ex="d4-cc"][data-i="0"][data-f="reps"]','12');
  await page.click('#b-home');
  assert.match(await page.textContent('#x-d4-cc h3'),/^Cable curl$/,'a lift with sets typed stays as it is');
  assert.match(await page.textContent('#x-d4-pd h3'),/Seated kettlebell tricep extension/);
  for(const i of [0,1])await page.fill(`input[data-ex="d4-pd"][data-i="${i}"][data-f="reps"]`,'15');
  await waitSaved(page,d,s=>!!(s&&s.home&&s.entries['d4-pd']&&s.entries['d4-pd'].sets.length===2));
  const s=(await savedSessions(page))[d];
  assert.deepEqual(s.entries['d4-pd'],{sets:[{kg:12,reps:15},{kg:12,reps:15}],alt:'home'});
  assert.equal(s.entries['d4-cc'].alt,undefined);
  // switching off keeps the home lift that has sets
  await page.click('#b-home');
  assert.match(await page.textContent('#x-d4-pd h3'),/Seated kettlebell tricep extension/);
  assert.match(await page.textContent('#x-d4-sp h3'),/Shoulder press \(machine\)/);
  // next time at home: 12 kg is the heaviest bell, so it asks for slower lowering; the gym pushdown keeps its own history
  await page.$eval('#f-date',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},daysAgo(-7));
  await page.click('.daybtn[data-day="D4"]');
  assert.match(await page.textContent('#x-d4-pd'),/No history yet/);
  await page.click('#b-home');
  assert.match(await page.textContent('#x-d4-pd'),/heaviest you have, so lower for 3 seconds/);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('a kettlebell lift moves up to the next bell you own',async()=>{
  const d0=daysAgo(3);
  const s={date:d0,day:'D4',home:true,savedAt:new Date().toISOString(),entries:{'d4-sp':{sets:[{kg:8,reps:12},{kg:8,reps:12}],alt:'home'}}};
  const {ctx,page}=await openApp({hash:'log',ls:{'split-sessions-v2':{[d0]:s}}});
  await page.click('.daybtn[data-day="D4"]');
  await page.click('#b-home');
  assert.match(await page.textContent('#x-d4-sp'),/Next: 12 kg/);assert.match(await page.textContent('#x-d4-sp'),/Move up to 12 kg/);
  assert.match(await page.textContent('.recent'),/at home/);
  await ctx.close();
});

test('with Train at home on, the Gym busy alternatives and Back to the gym lift still work',async()=>{
  const {ctx,page,errors}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D4"]');
  await page.click('#b-home');
  await page.click('#x-d4-cr summary');
  assert.match(await page.textContent('#x-d4-cr summary'),/Gym busy\? 2 alternatives/);
  await page.click('#x-d4-cr [data-alt="d4-cr|msc"]');
  assert.match(await page.textContent('#x-d4-cr h3'),/Machine seated crunch/);
  await page.click('#x-d4-sp .backgym');
  assert.match(await page.textContent('#x-d4-sp h3'),/Shoulder press \(machine\)/);
  assert.equal(await homeOn(page),'true');
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('home lifts animate whenever a matching animation exists, and use a still otherwise',async()=>{
  const {ctx,page,errors}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D4"]');await page.click('#b-home');
  const fx=id=>page.$$eval('#x-'+id+' .fx',n=>n.map(x=>({anim:!x.classList.contains('static'),imgs:x.querySelectorAll('img').length})));
  for(const id of ['d4-cc','d4-hc','d4-rd'])assert.deepEqual(await fx(id),[{anim:true,imgs:2}],id+' is animated');
  assert.deepEqual(await fx('d4-sp'),[{anim:false,imgs:1}],'a move with no matching animation shows a still');
  await page.click('.daybtn[data-day="D2"]');
  assert.deepEqual(await fx('d2-lr'),[{anim:true,imgs:2}]);
  await page.click('.daybtn[data-day="D3"]');
  assert.deepEqual(await fx('d3-rdl'),[{anim:true,imgs:2}]);
  assert.deepEqual(errors,[]);
  await ctx.close();
});

/* ---------- a logged workout is never lost, and home is for one day ---------- */
const nextDay=page=>page.$eval('.daybtn em',e=>e.parentElement.dataset.day);
const sessionOf=(date,day,entries,extra={})=>Object.assign({date,day,savedAt:new Date().toISOString(),entries},extra);
const setsOf=(kg,reps,n=2)=>Array.from({length:n},()=>({kg,reps}));

test("Charlie's steps: log a home workout with a comment, look at D5, switch home off: nothing is lost",async()=>{
  const d=today();
  const {ctx,page,errors}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D4"]');await page.click('#b-home');
  await page.fill('#f-bw','115');
  for(const i of [0,1]){await page.fill(`input[data-ex="d4-pd"][data-i="${i}"][data-f="reps"]`,'12');await page.fill(`input[data-ex="d4-cc"][data-i="${i}"][data-f="reps"]`,'15');}
  await page.fill('#f-notes','Felt very light on the biceps');
  await waitSaved(page,d,s=>!!(s&&s.notes&&s.entries['d4-pd']&&s.entries['d4-pd'].sets.length===2&&s.entries['d4-cc']));
  const before=(await savedSessions(page))[d];
  await page.click('.daybtn[data-day="D5"]');
  assert.equal(await homeOn(page),'false','home does not follow you to another day');
  await page.click('#b-home');await page.waitForTimeout(900);
  await page.click('#b-home');await page.waitForTimeout(900);
  await page.fill('#f-bw','114');await page.waitForTimeout(900);
  const after=(await savedSessions(page))[d];
  assert.deepEqual(after,before,'the saved D4 workout is untouched');
  assert.match(await page.textContent('#sync'),/Not saved: .* already has a D4 workout/);
  // back on D4: everything is still there, and switching home off keeps the lifts that have sets
  await page.click('.daybtn[data-day="D4"]');
  assert.equal(await homeOn(page),'true');
  assert.equal(await page.inputValue('#f-notes'),'Felt very light on the biceps');
  await page.click('#b-home');
  await page.waitForTimeout(900);
  const kept=(await savedSessions(page))[d];
  assert.equal(kept.entries['d4-pd'].sets.length,2);assert.equal(kept.entries['d4-cc'].sets.length,2);assert.equal(kept.notes,'Felt very light on the biceps');
  assert.deepEqual(errors,[]);
  await ctx.close();
});

test('the manual Save button cannot replace another day either',async()=>{
  const d=today();
  const s=sessionOf(d,'D4',{'d4-hc':{sets:setsOf(10,12)}});
  const {ctx,page}=await openApp({hash:'log',ls:{'split-sessions-v2':{[d]:s}}});
  await page.click('.daybtn[data-day="D5"]');
  await page.fill('input[data-ex="d5-mcp"][data-i="0"][data-f="reps"]','10');
  await page.click('#b-save');
  assert.match(await page.textContent('#toast'),/Not saved/);
  assert.equal((await savedSessions(page))[d].day,'D4');
  await ctx.close();
});

test('the home switch is for the day you are on: other days stay at the gym',async()=>{
  const {ctx,page}=await openApp({hash:'log'});
  await page.click('.daybtn[data-day="D4"]');await page.click('#b-home');
  for(const day of ['D1','D2','D3','D5']){
    await page.click('.daybtn[data-day="'+day+'"]');
    assert.equal(await homeOn(page),'false',day+' is not at home');
    assert.equal(await page.$$eval('.tag.home',n=>n.length),0);
  }
  await ctx.close();
});

test('a day with only body weight, the home switch or notes is not a workout and does not move the plan',async()=>{
  const wed=daysAgo(2),stub=today();
  const ls={'split-sessions-v2':{
    [wed]:sessionOf(wed,'D3',{'d3-lp':{sets:setsOf(80,12)}}),
    [stub]:sessionOf(stub,'D5',{},{bw:115,home:true,notes:'x'})}};
  const {ctx,page}=await openApp({hash:'log',ls});
  await page.$eval('#f-date',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},daysAgo(-1));
  assert.equal(await nextDay(page),'D4','the plan carries on from the last real workout, not from the stub');
  await page.click('nav button[data-tab="stats"]');
  const t=await page.textContent('#tab-stats');
  assert.match(t,/1 workout ·/);assert.doesNotMatch(t,/D5 Chest/);
  assert.match(t,/Latest 115 kg/,'the body weight still counts');
  await ctx.close();
});

test('skipping a day: doing D4 on Friday after Wednesday D3 moves the plan to D5',async()=>{
  const wed=daysAgo(2),d=today();
  const ls={'split-sessions-v2':{[wed]:sessionOf(wed,'D3',{'d3-lp':{sets:setsOf(80,12)}})}};
  const {ctx,page}=await openApp({hash:'log',ls});
  assert.equal(await nextDay(page),'D4');
  await page.click('.daybtn[data-day="D4"]');
  await page.fill('input[data-ex="d4-hc"][data-i="0"][data-f="reps"]','12');
  await waitSaved(page,d,s=>!!(s&&s.day==='D4'&&s.entries['d4-hc']));
  await page.$eval('#f-date',(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));},daysAgo(-1));
  assert.equal(await nextDay(page),'D5','after D4 the plan moves on to D5, whatever day of the week it is');
  await ctx.close();
});

test('a finished workout, at home or at the gym, marks its day as done and counts',async()=>{
  const t=today();
  for(const home of [true,false]){
    const e=home?{'d4-cc':{sets:setsOf(5,15),alt:'home'},'d4-pd':{sets:setsOf(12,12),alt:'home'}}:{'d4-cc':{sets:setsOf(20,12)},'d4-pd':{sets:setsOf(25,12)}};
    const {ctx,page}=await openApp({hash:'stats',ls:{'split-sessions-v2':{[t]:sessionOf(t,'D4',e,home?{home:true}:{})}}});
    const cell=await page.$eval('.cal .cd.today',c=>({cls:c.className,sets:c.title}));
    assert.doesNotMatch(cell.cls,/\bl0\b/,(home?'home':'gym')+' day is filled in');
    assert.match(await page.textContent('#tab-stats'),/1 workout ·/);
    await ctx.close();
  }
});
