import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('companion prepares, shows native actions, extracts evidence, releases, and activates only on takeover',async()=>{
  const original={chrome:globalThis.chrome,WebSocket:globalThis.WebSocket,setInterval:globalThis.setInterval};
  const dom=new JSDOM('<label for="email">Email</label><input id="email"><h2>First story</h2><table><tr><td>Starter</td><td>10</td></tr></table>',{url:'http://localhost:3210/fixture',runScripts:'outside-only'});
  const w=dom.window;
  w.document.hasFocus=()=>false;
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:20,top:20,right:120,bottom:40,width:100,height:20});
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
  w.document.elementFromPoint=()=>w.document.querySelector('#email');
  const event=()=>({addListener(){},removeListener(){}});
  const sent=[],calls=[];let ws,attachFails=false,tab={id:7,windowId:1,url:'http://localhost:3210/fixture',title:'Fixture',status:'complete',active:false},win={focused:false};
  class Socket{
    static OPEN=1;
    constructor(){ws=this;this.readyState=1;}
    send(raw){sent.push(JSON.parse(raw));}
    close(){this.readyState=3;}
  }
  globalThis.WebSocket=Socket;globalThis.setInterval=()=>0;
  globalThis.chrome={
    storage:{local:{get:async()=>({token:'test',name:'Fixture',browserId:'11111111-1111-1111-1111-111111111111'}),set:async()=>{}}},
    tabs:{query:async()=>[tab],create:async params=>{calls.push({method:'tabs.create',params});return tab;},get:async()=>tab,update:async(id,params)=>{calls.push({method:'tabs.update',params});Object.assign(tab,params);return tab;},onActivated:event(),onUpdated:event(),onRemoved:event()},
    windows:{get:async()=>win,update:async(id,params)=>{calls.push({method:'windows.update',params});Object.assign(win,params);return win;},onFocusChanged:event()},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    debugger:{onEvent:event(),onDetach:event(),attach:async()=>{if(attachFails)throw Error('Debugger unavailable');},detach:async()=>{},sendCommand:async(source,method,params)=>{
      calls.push({method,params});
      if(method==='Page.addScriptToEvaluateOnNewDocument')return {identifier:'script'};
      if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'root',url:tab.url}}};
      if(method==='Page.createIsolatedWorld')return {executionContextId:1};
      if(method==='Accessibility.getFullAXTree')return {nodes:[]};
      if(method==='Runtime.evaluate')return {result:{value:w.eval(params.expression)}};
      if(method==='Page.captureScreenshot')return {data:Buffer.from('jpeg').toString('base64')};
      if(method==='Input.insertText')w.document.querySelector('#email').value=params.text;
      return {};
    }},
    runtime:{onMessage:event(),onStartup:event(),onInstalled:event()},
    alarms:{create(){},onAlarm:event()},downloads:{onCreated:event(),onChanged:event()}
  };
  let next=0;
  async function rpc(method,params={}){
    const id='rpc'+(++next);ws.onmessage({data:JSON.stringify({id,method,params})});
    for(let i=0;i<1000;i++){const result=sent.find(message=>message.id===id);if(result){if(result.error)throw Error(result.error);return result.result;}await tick();}
    throw Error('Fixture RPC timeout: '+method);
  }
  try{
    await import('../extension/background.js');ws.onopen();await tick();
    assert.equal(sent.find(m=>m.type==='hello').version,3);
    const prepared=await rpc('prepare',{mode:'new-tab',url:tab.url,livePreview:true});assert.equal(prepared.tabId,7);
    assert.ok(sent.some(m=>m.message==='Attaching browser control'));assert.ok(sent.some(m=>m.message==='Waiting for the page to load'));
    const page=await rpc('observe'),target=page.elements.find(e=>e.name==='Email').id;
    const preview=await rpc('preview-action',{action:{operation:'TYPE',target}});
    assert.match(preview.dataUrl,/data:image\/jpeg;base64,/);
    assert.equal(calls.filter(c=>c.method.startsWith('Input.')).length,0,'Preview must not emit native input');
    await rpc('act',{action:{operation:'TYPE',target,text:'alex@example.com'}});
    assert.equal(w.document.querySelector('#email').value,'alex@example.com');
    assert.ok(sent.some(m=>m.type==='preview'),'Movement should publish a visual view');
    assert.ok(!calls.some(c=>c.method==='tabs.update'),'Agent input must not activate the tab');
    const result=await rpc('extract');assert.equal(result.headings[0].text,'First story');assert.equal(result.tables[0][0][0],'Starter');
    await rpc('release');await assert.rejects(rpc('act',{action:{operation:'CLICK',target}}),/paused/);
    await rpc('takeover',{tabId:7});assert.equal(tab.active,true);assert.equal(win.focused,true);
    await assert.rejects(rpc('prepare',{mode:'existing',tabId:7}),/in use/);
    tab.active=false;win.focused=false;attachFails=true;
    await assert.rejects(rpc('prepare',{mode:'existing',tabId:7}),/Cannot attach browser control: Debugger unavailable/);
    attachFails=false;assert.equal((await rpc('prepare',{mode:'existing',tabId:7})).tabId,7,'A failed prepare must not block the next task');
    await rpc('release');
  }finally{dom.window.close();Object.assign(globalThis,original);}
});
