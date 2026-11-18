# Rebuild the app: python3 src/build.py  (run from anywhere). Writes index.html, sw.js, manifest.webmanifest at the repo root.
import time,json,os
H=os.path.dirname(os.path.abspath(__file__));R=os.path.dirname(H)
rd=lambda n:open(os.path.join(H,n),encoding='utf-8').read()
b=time.strftime('%Y-%m-%d.%H%M',time.gmtime())
d=rd('data.js').replace("if(typeof module!=='undefined')module.exports","if(false)module.exports")
t=rd('template.html').replace('/*DATA*/',d+'\n'+rd('alts.js')+'\n'+rd('altimg.js')).replace('/*ANIM*/',rd('figimg.js')).replace('/*APP*/',rd('app.js').replace('__BUILD__',b))
open(os.path.join(R,'index.html'),'w',encoding='utf-8').write(t)
open(os.path.join(R,'sw.js'),'w',encoding='utf-8').write(rd('sw.js').replace('__BUILD__',b))
json.dump({"name":"Split","short_name":"Split","description":"Five-day split workout tracker","start_url":"./","scope":"./","display":"standalone","orientation":"portrait","background_color":"#faf9f5","theme_color":"#faf9f5","icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]},open(os.path.join(R,'manifest.webmanifest'),'w'))
print('built',b,len(t))
