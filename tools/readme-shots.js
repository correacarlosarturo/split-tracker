// Renders the README images from the built app with demo data, framed in a drawn phone.
// Run: python3 src/build.py && node tools/readme-shots.js [outDir]   (default: docs/screenshots)
// Needs Playwright with Chromium. Uses only made-up demo data and never reads real logs.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');

const ROOT=path.join(__dirname,'..');
const OUT=path.resolve(process.argv[2]||path.join(ROOT,'docs','screenshots'));
const TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
const W=390,H=844,STATUS=48;

/* ---------- demo data: the last three weeks of Mon–Fri sessions, deterministic for a given day ---------- */
const z=n=>String(n).padStart(2,'0');
const ds=d=>d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());
function demo(){
  const src=fs.readFileSync(path.join(ROOT,'src','data.js'),'utf8');
  const {DAYS,EX}=new Function(src.replace("if(typeof module!=='undefined')module.exports=","return ")+'')();
  const sessions={},today=new Date();today.setHours(12,0,0,0);
  let n=0;
  for(let back=21;back>=1;back--){
    const d=new Date(today);d.setDate(d.getDate()-back);
    const wd=d.getDay();if(wd===0||wd===6)continue;
    const day=DAYS[wd-1].id,week=Math.floor((21-back)/7),date=ds(d),entries={};
    for(const e of EX.filter(x=>x.d===day)){
      const kg=e.kg+week*e.st;
      entries[e.id]={sets:Array.from({length:e.s},(_,i)=>({kg,reps:Math.max(e.r[0],e.r[1]-i-(week===0?1:0))}))};
    }
    sessions[date]={date,day,bw:Math.round((86.4-n*0.12)*10)/10,savedAt:date+'T18:30:00.000Z',entries,notes:n%4===0?'Slept well, felt strong.':undefined};
    n++;
  }
  const coach={[ds(today)]:{date:ds(today),summary:'Good week. Leg press moved well, so add 10 kg today. Keep 2 reps in reserve on the lateral raises.'}};
  return {sessions,coach};
}

/* ---------- the drawn phone: rounded bezel, side buttons, camera pill, status bar ---------- */
const PHONE_CSS=`
.ph{position:relative;width:var(--w);padding:calc(var(--w)*.032);background:#0b0b0d;border-radius:calc(var(--w)*.15);box-shadow:0 0 0 1.5px #3a3a40,0 30px 60px rgba(20,20,40,.28)}
.ph::before,.ph::after{content:"";position:absolute;background:#2a2a30;border-radius:3px;width:calc(var(--w)*.012)}
.ph::before{left:calc(var(--w)*-.012);top:22%;height:7%;box-shadow:0 calc(var(--w)*.16) 0 #2a2a30}
.ph::after{right:calc(var(--w)*-.012);top:28%;height:11%}
.sc{position:relative;width:100%;aspect-ratio:${W}/${H};border-radius:calc(var(--w)*.12);overflow:hidden;background:#000}
.sc img{display:block;width:100%;height:100%;object-fit:cover}
.sb{position:absolute;inset:0 0 auto;height:${(STATUS/H*100).toFixed(2)}%;display:flex;align-items:center;justify-content:space-between;padding:0 9%;font:600 calc(var(--w)*.04) -apple-system,"Inter",system-ui,sans-serif;color:var(--sbc,#111)}
.cam{position:absolute;top:1.6%;left:50%;transform:translateX(-50%);width:28%;height:3.4%;background:#000;border-radius:99px}
.sig{display:flex;gap:4px;align-items:center}.sig i{display:block;width:calc(var(--w)*.06);height:calc(var(--w)*.03);border:1.5px solid currentColor;border-radius:4px;position:relative}.sig i::after{content:"";position:absolute;inset:1.5px 25% 1.5px 1.5px;background:currentColor;border-radius:1.5px}
.sig b{display:block;width:calc(var(--w)*.045);height:calc(var(--w)*.03);background:linear-gradient(90deg,currentColor 20%,transparent 20% 27%,currentColor 27% 47%,transparent 47% 54%,currentColor 54% 74%,transparent 74% 81%,currentColor 81%);clip-path:polygon(0 100%,100% 0,100% 100%)}
`;
const phone=(img,w,dark)=>`<div class="ph" style="--w:${w}px;${dark?'--sbc:#f3f3f6':''}"><div class="sc"><img src="${img}"><div class="sb"><span>18:30</span><span class="sig"><b></b><i></i></span></div><div class="cam"></div></div></div>`;
const wash=(dark,acc)=>dark
  ?`radial-gradient(80% 70% at 10% 0%,${acc}55,transparent 60%),radial-gradient(70% 60% at 100% 100%,#4664dc40,transparent 60%),#0e0f14`
  :`radial-gradient(80% 70% at 0% 0%,${acc}55,transparent 60%),radial-gradient(70% 60% at 100% 30%,#608cff3a,transparent 60%),radial-gradient(80% 60% at 40% 100%,#ffba784d,transparent 60%),#eceef4`;

async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const server=http.createServer((req,res)=>{
    const p=path.join(ROOT,decodeURIComponent(new URL(req.url,'http://x').pathname));
    if(!p.startsWith(ROOT+path.sep)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/index.html';
  const browser=await chromium.launch();
  const {sessions,coach}=demo();

  /* one app screen, returned as a PNG data URL */
  async function screen({tab,mode='light',accent='clay',scroll}){
    const ctx=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:2,serviceWorkers:'block'});
    await ctx.addInitScript(d=>{localStorage.clear();localStorage.setItem('split-theme-v1',JSON.stringify(d.theme));localStorage.setItem('split-sessions-v2',JSON.stringify(d.sessions));localStorage.setItem('split-coach-v1',JSON.stringify(d.coach));},{theme:{mode,accent,contrast:'normal'},sessions,coach});
    const page=await ctx.newPage();
    await page.goto(base+'#'+tab);
    await page.addStyleTag({content:`header{padding-top:${STATUS+6}px!important}.fx img+img{animation:none!important}#toast{display:none}`});
    await page.waitForSelector('#tab-'+tab+' section');await page.waitForTimeout(400);
    if(scroll)await page.evaluate(sel=>{const el=document.querySelector(sel);if(el)window.scrollTo(0,el.getBoundingClientRect().top+scrollY-110);},scroll);
    await page.waitForTimeout(200);
    const buf=await page.screenshot();await ctx.close();
    return 'data:image/png;base64,'+buf.toString('base64');
  }
  /* compose framed phones onto a wash and save at 2x */
  async function compose(file,w,h,body,dark,acc='#c4573a'){
    const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:2});
    const page=await ctx.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}body{background:${wash(dark,acc)};display:flex;align-items:center;justify-content:center;font-family:-apple-system,"Inter",system-ui,sans-serif}${PHONE_CSS}</style>${body}`);
    await page.waitForTimeout(150);
    await page.screenshot({path:path.join(OUT,file)});await ctx.close();
  }

  const shots={
    stats:await screen({tab:'stats'}),
    log:await screen({tab:'log',scroll:'.card.ex'}),
    coach:await screen({tab:'coach',scroll:'.vgrid'}),
    dark:await screen({tab:'stats',mode:'dark',accent:'ocean'}),
    logTop:await screen({tab:'log'})
  };
  for(const k of ['stats','log','coach'])await compose(k+'.png',450,750,phone(shots[k],316,false),false);
  await compose('dark.png',450,750,phone(shots.dark,316,true),true,'#2a68a8');
  await compose('hero.png',800,450,`
    <div style="display:flex;align-items:center;gap:34px;width:100%;padding:0 46px">
      <div style="flex:1;min-width:0">
        <div style="font:800 54px/1 -apple-system,'Inter',system-ui,sans-serif;letter-spacing:-.03em;color:#121216">Split</div>
        <p style="margin:14px 0 0;font:500 18px/1.4 -apple-system,'Inter',system-ui,sans-serif;color:#3c3c44;max-width:24ch">A five-day split tracker that lives on your phone, works offline and syncs to your own private repo.</p>
      </div>
      <div style="position:relative;width:420px;height:410px">
        <div style="position:absolute;left:0;top:44px">${phone(shots.logTop,150,false)}</div>
        <div style="position:absolute;right:0;top:44px">${phone(shots.dark,150,true)}</div>
        <div style="position:absolute;left:50%;top:6px;transform:translateX(-50%);z-index:2">${phone(shots.stats,180,false)}</div>
      </div>
    </div>`,false);

  await browser.close();server.close();
  console.log('wrote',['hero','stats','log','coach','dark'].map(n=>n+'.png').join(', '),'to',OUT);
}
main().catch(e=>{console.error(e);process.exit(1);});
