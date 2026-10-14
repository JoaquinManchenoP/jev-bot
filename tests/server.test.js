import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('local bridge runs typed actions, extracts results, and rejects cross-origin requests',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'jev-integration-'));
  const port=33219,base=`http://localhost:${port}`;
  const server=spawn(process.execPath,['--import','./tests/mock-provider.js','server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),TYPESAFE_API_KEY:'test-key',JEV_DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
  let ws;
  try{
    await Promise.race([once(server.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Server start timeout')),5000))]);
    assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://evil.example'}})).status,403);
    const hostileStatus=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/state',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(hostileStatus,403);
    const state=await(await fetch(base+'/api/state')).json();
    ws=new WebSocket(`ws://localhost:${port}/bridge?token=${state.token}`,{origin:'chrome-extension://test-extension'});
    await once(ws,'open');ws.send(JSON.stringify({type:'hello',name:'Test browser',version:3,tabs:[{id:1,title:'Test',url:base+'/fixture'}]}));
    let typed=false, released=false,currentUrl=base+'/fixture',preparedUrl;
    ws.on('message',raw=>{const msg=JSON.parse(raw);let result;
      if(msg.method==='prepare'||msg.method==='resume'){if(msg.params.url){preparedUrl=msg.params.url;currentUrl=preparedUrl;}result={tabId:1,title:'Fixture'};}
      if(msg.method==='prepare')ws.send(JSON.stringify({type:'activity',message:'Attaching browser control'}));
      if(msg.method==='screenshot'||msg.method==='preview-action')result={dataUrl:'data:image/jpeg;base64,'+Buffer.from('image').toString('base64')};
      if(msg.method==='observe')result={url:currentUrl,title:'Fixture',text:typed?'Filled':'Not filled',elements:typed?[]:[{id:'e1',kind:'type',name:'Name'}],links:currentUrl.includes('google.com/search')?[{url:'https://www.nytimes.com/',text:'The New York Times — official website'}]:[]};
      if(msg.method==='act'){if(msg.params.action.operation==='NAVIGATE')currentUrl=msg.params.action.url;else{assert.equal(msg.params.action.text,'Alex');typed=true;}result={ok:true};}
      if(msg.method==='extract')result={url:base+'/fixture',title:'Fixture',text:'Filled',links:[],tables:[[['Name'],['Alex']]]};
      if(msg.method==='release'){released=true;result={ok:true};}
      ws.send(JSON.stringify({id:msg.id,result}));
    });
    await wait(50);
    const connected=await(await fetch(base+'/api/state')).json();assert.equal(connected.browsers[0].name,'Test browser');
    const response=await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({browserId:connected.browsers[0].id,mode:'new-tab',url:base+'/fixture',goal:'Enter "Alex" in Name and extract the table.',livePreview:true})});
    assert.equal(response.status,201);
    let run;
    for(let i=0;i<80;i++){run=(await(await fetch(base+'/api/state')).json()).runs[0];if(run.released)break;await wait(50);}
    assert.equal(run.status,'completed',JSON.stringify(run.events));assert.equal(run.results[0].tables[0][1][0],'Alex');assert.ok(typed&&released);
    assert.equal(run.plan.steps.length,2);assert.ok(run.plan.steps.every(s=>s.status==='completed'));
    assert.ok(run.events.some(e=>e.message==='Attaching browser control'));
    assert.ok(run.visualFrames.some(f=>f.label==='Before TYPE'));assert.ok(run.visualFrames.some(f=>f.label==='After TYPE'));
    assert.ok(run.visualFrames.every(f=>!f.dataUrl));
    const image=await fetch(base+'/api/preview/'+run.id+'?frame='+run.visualFrames[0].id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(await image.text(),'image');
    assert.equal((await fetch(base+'/api/preview/'+run.id+'?frame=999')).status,404);
    const takeover=await fetch(base+'/api/takeover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:run.id})});assert.equal(takeover.status,200);
    const named=await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({browserId:connected.browsers[0].id,mode:'new-tab',goal:'Go to the New York Times website'})});assert.equal(named.status,201);const namedId=(await named.json()).id;
    let namedRun;for(let i=0;i<80;i++){namedRun=(await(await fetch(base+'/api/state')).json()).runs.find(r=>r.id===namedId);if(namedRun.released)break;await wait(50);}
    assert.equal(new URL(preparedUrl).searchParams.get('q'),'New York Times official website');assert.equal(namedRun.status,'completed');assert.equal(currentUrl,'https://www.nytimes.com/');
    const second=await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({browserId:connected.browsers[0].id,mode:'existing',tabId:1,goal:'Enter "Alex"'})});
    const secondRun=await second.json();assert.equal(second.status,201);ws.send(JSON.stringify({type:'pause',reason:'User takeover'}));
    await wait(100);const paused=(await(await fetch(base+'/api/state')).json()).runs.find(r=>r.id===secondRun.id);assert.equal(paused.status,'paused');
    const resume=await fetch(base+'/api/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:secondRun.id,goal:'Extract the table'})});assert.equal(resume.status,200);
    const attachment=await fetch(base+'/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'hello.txt',type:'text/plain',data:Buffer.from('Hello').toString('base64')})});assert.equal(attachment.status,201);const file=await attachment.json();assert.equal(file.name,'hello.txt');assert.ok(!file.path);
    const removal=await fetch(base+'/api/files/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:file.id})});assert.equal(removal.status,200);
  }finally{ws?.close();server.kill();if(server.exitCode===null)await once(server,'exit');await rm(dataDir,{recursive:true,force:true});}
});
