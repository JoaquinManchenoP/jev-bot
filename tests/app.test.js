import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
async function workspace(run){
  const dom=new JSDOM(html,{url:'http://localhost:3210',runScripts:'outside-only'}),w=dom.window,calls=[];
  const state={configured:true,helperConfigured:false,token:'test',browsers:[{id:'b1',name:'Chrome',version:3,tabs:[]}],runs:run?[run]:[]};
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.setInterval=()=>0;
  w.fetch=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return {ok:true,json:async()=>url==='/api/state'?state:{id:'new-run'}};};
  w.eval(script);await flush();
  return {dom,w,state,calls,$:selector=>w.document.querySelector(selector)};
}
function run(status='completed'){return {id:'r1',browserId:'b1',goal:'Give me the first 3 headlines',messages:['Give me the first 3 headlines'],status,released:true,ownedTabs:[1],tabId:1,step:2,maxSteps:100,history:[{operation:'EXTRACT'}],events:[{time:1,message:'Task complete',color:'green'}],plan:{steps:[],index:0},url:'https://example.com',results:[{title:'News',url:'https://example.com',text:'Saved page',headings:[{text:'One'},{text:'Two'},{text:'Three'},{text:'Four'}],links:[],tables:[]}],downloads:[],previewVersion:2,previewLabel:'After EXTRACT',visualFrames:[{id:1,label:'Before EXTRACT'},{id:2,label:'After EXTRACT'}]};}
test('chat shows grounded results, preserves selected action views, and returns to live preview',async()=>{
  const t=await workspace(run());try{
    assert.equal(t.$('#conversation').querySelectorAll('li').length,3);
    assert.match(t.$('#conversation').textContent,/One/);
    t.$('.frame-button').click();assert.match(t.$('#page-preview').src,/frame=1/);
    t.state.runs[0].previewVersion=3;t.state.runs[0].visualFrames.push({id:3,label:'New view'});
    await t.w.eval('refresh()');assert.match(t.$('#page-preview').src,/frame=1/);
    t.$('#return-live').click();assert.match(t.$('#page-preview').src,/v=3/);
    t.$('#history').value='new';t.$('#history').dispatchEvent(new t.w.Event('change'));
    await t.w.eval('refresh()');assert.equal(t.$('#activity-running').hidden,true);assert.match(t.$('#conversation').textContent,/What would you like/);
    t.$('#history').value='r1';t.$('#history').dispatchEvent(new t.w.Event('change'));assert.match(t.$('#results').textContent,/Saved page/);
  }finally{t.dom.window.close();}
});
test('a chat reply resumes a paused task; errors and user text remain plain text',async()=>{
  const paused=run('paused');paused.events=[{time:1,message:'<img src=x onerror=alert(1)>',color:'red'}];
  const t=await workspace(paused);try{
    assert.equal(t.$('#conversation').querySelector('img'),null);
    assert.equal(t.$('#run-button').textContent,'Reply & resume ↑');
    t.$('#goal').value='Extract the table';
    t.$('#task-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await flush();
    assert.deepEqual(t.calls.find(call=>call.url==='/api/resume').body,{id:'r1',goal:'Extract the table'});
    assert.equal(t.$('#goal').value,'');
    t.$('#takeover').click();await flush();assert.ok(t.calls.some(call=>call.url==='/api/takeover'));
  }finally{t.dom.window.close();}
});
test('offline or unpaired browsers disable sending; examples provide a working starting page',async()=>{
  const t=await workspace();try{
    t.state.browsers=[];await t.w.eval('refresh()');assert.equal(t.$('#run-button').disabled,true);
    t.$('[data-example="form"]').click();assert.equal(t.$('#url').value,'http://localhost:3210/fixture');
    t.$('#options-toggle').click();assert.equal(t.$('#task-options').open,true);
    t.$('#setup-nav').click();assert.equal(t.$('#setup').hidden,false);
    t.state.browsers=[{id:'b1',name:'Chrome',version:3,tabs:[]}];await t.w.eval('refresh()');assert.equal(t.$('#run-button').disabled,false);
    t.w.fetch=async()=>{throw Error('Offline');};await t.w.eval('refresh()');assert.equal(t.$('#run-button').disabled,true);
  }finally{t.dom.window.close();}
});
