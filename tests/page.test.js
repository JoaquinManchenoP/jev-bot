import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {pageCommand,pageFocusGuard} from '../extension/page.js';
function setup(){
  const dom=new JSDOM('<html><body><h1>Contact</h1><label for="email">Email</label><input id="email"><input type="password" id="secret" value="never-export"><select id="dept"><option value="general">General</option><option value="sales">Sales</option></select><button id="submit">Submit</button><table><tr><td>Starter</td><td>10</td></tr></table><a target="_blank" href="https://example.com">Pricing</a></body></html>',{url:'https://example.com/contact',runScripts:'outside-only'});
  const w=dom.window;let focused=false,takeovers=0;
  w.document.hasFocus=()=>focused;
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;},configurable:true});
  w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:20,top:20,left:20,right:120,bottom:40});
  w.document.elementFromPoint=()=>w.document.querySelector('#email');
  w.chrome={runtime:{sendMessage:async()=>{takeovers++;}}};
  w.eval('window.runPageCommand = '+pageCommand.toString());
  return {dom,w,command:(...args)=>{const result=w.runPageCommand(...args);if(result?.__jevError)throw Error(result.__jevError);return result;},focus:()=>focused=true,takeovers:()=>takeovers};
}
test('observes labels, excludes passwords, returns native target coordinates, and extracts tables',()=>{
  const t=setup();try{
    t.command('start');const page=t.command('observe');const email=page.elements.find(e=>e.name==='Email');assert.equal(email.kind,'type');assert.ok(!page.elements.some(e=>e.value==='never-export'));
    const point=t.command('inspect',{action:{operation:'TYPE',target:email.id}});
    assert.equal(point.x,70);assert.equal(point.y,30);assert.equal(t.w.document.querySelector('#email').value,'');
    // JSDOM has no layout-backed innerText; supply it for the extraction fixture.
    Object.defineProperty(t.w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
    const result=t.command('extract');assert.equal(result.tables[0][0][0],'Starter');assert.ok(!result.text.includes('never-export'));
  }finally{t.dom.window.close();}
});
test('blocks stale controls, focused tabs, and actions after release',()=>{
  const t=setup();try{
    t.command('start');let page=t.command('observe');const email=page.elements.find(e=>e.name==='Email');
    t.w.document.querySelector('#email').value='user changed this';
    assert.throws(()=>t.command('act',{action:{operation:'TYPE',target:email.id,text:'wrong'}}),/changed/);
    page=t.command('observe');t.focus();assert.throws(()=>t.command('act',{action:{operation:'CLICK',target:page.elements[0].id}}),/in use/);
    t.command('release');assert.throws(()=>t.command('observe'),/Paused/);
    assert.equal(t.w.document.querySelector('#jev-companion-indicator'),null);
  }finally{t.dom.window.close();}
});
test('selects a native option and rejects covered targets',()=>{
  const t=setup();try{
    t.command('start');const page=t.command('observe'),option=page.elements.find(e=>e.name.includes('Sales'));
    assert.throws(()=>t.command('act',{action:{operation:'SELECT',target:option.id}}),/covered/);
    t.w.document.elementFromPoint=()=>t.w.document.querySelector('#dept');
    t.command('act',{action:{operation:'SELECT',target:option.id}});
    assert.equal(t.w.document.querySelector('#dept').value,'sales');
  }finally{t.dom.window.close();}
});
test('prevents popup and window focus calls while assigned and restores them on release',()=>{
  const t=setup();try{
    const originalOpen=t.w.open,originalFocus=t.w.focus;
    t.w.eval('window.guardPage = '+pageFocusGuard.toString());
    t.w.guardPage('start');assert.equal(t.w.open('https://example.com'),null);assert.notEqual(t.w.focus,originalFocus);
    t.w.guardPage('release');assert.equal(t.w.open,originalOpen);assert.equal(t.w.focus,originalFocus);
  }finally{t.dom.window.close();}
});

test('finds shadow DOM controls, offscreen targets, and allows scroll-to before native action',()=>{
  const t=setup();try{
    const host=t.w.document.createElement('div');t.w.document.body.append(host);const root=host.attachShadow({mode:'open'});root.innerHTML='<button aria-label="Shadow action">Do it</button>';
    const button=root.querySelector('button');button.getBoundingClientRect=()=>({left:10,top:2000,width:100,height:20,right:110,bottom:2020});button.scrollIntoView=()=>{button.getBoundingClientRect=()=>({left:10,top:20,width:100,height:20,right:110,bottom:40});};
    t.command('start');const page=t.command('observe'),target=page.elements.find(e=>e.name==='Shadow action');assert.ok(target);assert.equal(target.inViewport,false);
    t.command('act',{action:{operation:'SCROLL_TO',target:target.id}});assert.equal(button.getBoundingClientRect().top,20);
  }finally{t.dom.window.close();}
});
test('registers backend nodes from a closed shadow root and blocks password registration',()=>{
  const t=setup();try{
    const host=t.w.document.createElement('div');t.w.document.body.append(host);const root=host.attachShadow({mode:'closed'});const button=t.w.document.createElement('button');button.textContent='Closed action';root.append(button);
    t.command('start');t.command('observe');const registered=t.command('register',{node:button,id:'ax_12'});assert.equal(registered.name,'Closed action');assert.equal(registered.kind,'click');assert.equal(t.command('register',{node:t.w.document.querySelector('#secret'),id:'ax_secret'}),null);
  }finally{t.dom.window.close();}
});
test('visual targets are bounded and invalidated by viewport changes',()=>{
  const t=setup();try{t.command('start');const page=t.command('observe');assert.deepEqual(JSON.parse(JSON.stringify(t.command('visual',{epoch:page.epoch,x:20,y:30}))),{x:20,y:30});assert.throws(()=>t.command('visual',{epoch:page.epoch,x:-1,y:30}),/outside/);t.w.innerWidth+=10;assert.throws(()=>t.command('visual',{epoch:page.epoch,x:20,y:30}),/stale/);}finally{t.dom.window.close();}
});
test('hidden file inputs remain available without opening a native picker',()=>{
  const t=setup();try{const input=t.w.document.createElement('input');input.type='file';input.name='Document';input.style.display='none';input.getBoundingClientRect=()=>({left:0,top:0,width:0,height:0,right:0,bottom:0});t.w.document.body.append(input);t.command('start');const page=t.command('observe'),upload=page.elements.find(e=>e.kind==='upload');assert.ok(upload);assert.equal(t.command('inspect',{action:{operation:'UPLOAD',target:upload.id}}).kind,'file');assert.equal(t.command('node',{action:{operation:'UPLOAD',target:upload.id}}),input);}finally{t.dom.window.close();}
});
test('task-local copy reads field selection without reading the OS clipboard',()=>{
  const t=setup();try{const input=t.w.document.querySelector('#email');input.value='alex@example.com';input.setSelectionRange(0,4);t.command('start');const page=t.command('observe'),field=page.elements.find(e=>e.name==='Email');assert.equal(t.command('selection',{target:field.id}).text,'alex');}finally{t.dom.window.close();}
});

test('native renderer focus is allowed only when the browser adapter explicitly marks the command',()=>{const t=setup();try{t.command('start');t.focus();assert.throws(()=>t.command('observe'),/in use/);assert.ok(t.command('observe',{nativeInput:true}).elements.length);}finally{t.dom.window.close();}});
