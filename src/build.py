# Rebuild the app: python3 src/build.py  (run from anywhere).
# Writes index.html, split.js, theme.js, sw.js and manifest.webmanifest at the repo root.
# Scripts are separate files (not inline) so the content security policy can forbid inline script.
import time,json,os
H=os.path.dirname(os.path.abspath(__file__));R=os.path.dirname(H)
rd=lambda n:open(os.path.join(H,n),encoding='utf-8').read()
def wr(n,t):
    with open(os.path.join(R,n),'w',encoding='utf-8') as f:f.write(t)
b=time.strftime('%Y-%m-%d.%H%M%S',time.gmtime())
d=rd('data.js').replace("if(typeof module!=='undefined')module.exports","if(false)module.exports")
js='\n'.join([d,rd('alts.js'),rd('home.js'),rd('altimg.js'),rd('figimg.js'),rd('app.js').replace('__BUILD__',b)])
t=rd('template.html').replace('__BUILD__',b)
wr('index.html',t)
wr('split.js',js)
wr('theme.js',rd('theme.js'))
wr('sw.js',rd('sw.js').replace('__BUILD__',b))
with open(os.path.join(R,'manifest.webmanifest'),'w',encoding='utf-8') as f:
    json.dump({"name":"Split","short_name":"Split","description":"Five-day split workout tracker","start_url":"./","scope":"./","display":"standalone","orientation":"portrait","background_color":"#faf9f5","theme_color":"#faf9f5","icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"icon-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]},f)
print('built',b,len(t)+len(js))
