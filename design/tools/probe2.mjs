import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const CHROME='C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const port=9471, profile=join(process.env.TEMP??'.','shi-probe2-'+Date.now());
const proc=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+profile,'--remote-debugging-port='+port,'--window-size=393,851','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let id=0;
const rpc=(ws,m,p={})=>new Promise((res,rej)=>{const mid=++id;const on=ev=>{let d;try{d=JSON.parse(ev.data)}catch{return}if(d.id!==mid)return;ws.removeEventListener('message',on);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result)};ws.addEventListener('message',on);ws.send(JSON.stringify({id:mid,method:m,params:p}))});
const ev2=async(ws,e)=>{const r=await rpc(ws,'Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'e');return r.result.value};
(async()=>{
  let u;for(let i=0;i<80;i++){try{const l=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const p=l.find(t=>t.type==='page');if(p?.webSocketDebuggerUrl){u=p.webSocketDebuggerUrl;break}}catch{}await sleep(250)}
  const ws=new WebSocket(u);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});
  await rpc(ws,'Page.enable');await rpc(ws,'Runtime.enable');
  await rpc(ws,'Emulation.setDeviceMetricsOverride',{width:393,height:851,deviceScaleFactor:2,mobile:true});
  await rpc(ws,'Page.navigate',{url:'http://127.0.0.1:5173/'});
  await sleep(12000);
  console.log(await ev2(ws,(() => {
    const out = {};
    const info = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return { h: Math.round(b.height), minH: cs.minHeight, flex: cs.flex, disp: cs.display, top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    out.task = info('.shi-task');
    out.tasks = info('.shi-tasks');
    out.dijiao = info('.shi-dijiao');
    out.cta = info('.shi-btn--primary');
    out.heroGrid = info('.shi-hero-grid');
    out.tabbar = info('.shi-tabbar');
    out.app = info('.shi-app');
    return JSON.stringify(out, null, 1);
  })()));
  ws.close(); proc.kill();
})();