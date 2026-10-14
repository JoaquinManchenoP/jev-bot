import {pageCommand, pageFocusGuard} from './page.js';
import {withTimeout} from './timeout.js';
export function isWebTab(tab){return /^https?:/.test(tab.url||'')||(tab.status==='loading'&&/^https?:/.test(tab.pendingUrl||''));}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const KEY_MAP = {
  Enter: {key:'Enter',code:'Enter',windowsVirtualKeyCode:13}, Tab:{key:'Tab',code:'Tab',windowsVirtualKeyCode:9}, Escape:{key:'Escape',code:'Escape',windowsVirtualKeyCode:27},
  Backspace:{key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8}, Delete:{key:'Delete',code:'Delete',windowsVirtualKeyCode:46},
  ArrowDown:{key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40}, ArrowUp:{key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38}, ArrowLeft:{key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37}, ArrowRight:{key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},
  Home:{key:'Home',code:'Home',windowsVirtualKeyCode:36}, End:{key:'End',code:'End',windowsVirtualKeyCode:35}, PageDown:{key:'PageDown',code:'PageDown',windowsVirtualKeyCode:34}, PageUp:{key:'PageUp',code:'PageUp',windowsVirtualKeyCode:33}, Space:{key:' ',code:'Space',windowsVirtualKeyCode:32},
  SELECT_ALL:{key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2}, SHIFT_TAB:{key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8}
};
export function keyEvents(name, mac = false) {
  const key = KEY_MAP[name]; if (!key) throw Error('Unsupported keyboard key');
  const params = {...key}; if (name === 'SELECT_ALL' && mac) params.modifiers = 4;
  return [{type:'rawKeyDown',...params},{type:'keyUp',...params}];
}
export function safeCoordinate(point, viewport) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) throw Error('Coordinate outside viewport');
  return {x:point.x,y:point.y};
}

// All methods target one explicitly owned tab. BrowserDriver never activates a tab.
export class BrowserDriver {
  constructor(api, tabId, ensureBackground, onTakeover, onDialog = () => {}, onVisual = null) {
    this.api=api; this.tabId=tabId; this.ensureBackground=ensureBackground; this.onTakeover=onTakeover; this.onDialog=onDialog;
    this.worlds=new Map(); this.sources=new Map([['',{tabId}]]); this.contexts=new Map(); this.routes=new Map(); this.targets=new Map(); this.initializing=new Set(); this.scripts=new Map(); this.closed=false;
    this.listener=(source,method,params)=>this.event(source,method,params);
    this.onVisual=onVisual;this.lastVisual=0;
  }
  async send(source, method, params={}) {
    if (this.closed) throw Error('Browser ownership was released.');
    if (method.startsWith('Input.') || method === 'DOM.setFileInputFiles' || method === 'Page.navigate' || method === 'Page.handleJavaScriptDialog') await this.ensureBackground(this.tabId);
    return withTimeout(this.api.debugger.sendCommand(source,method,params), 'Browser protocol: ' + method);
  }
  async attach() {
    await this.ensureBackground(this.tabId);
    this.api.debugger.onEvent.addListener(this.listener);
    let cancelled=false;
    const attaching=this.api.debugger.attach({tabId:this.tabId},'1.3');
    attaching.then(()=>{if(cancelled)void this.api.debugger.detach({tabId:this.tabId}).catch(()=>{});},()=>{});
    try {await withTimeout(attaching,'Attaching browser control'); await this.ensureBackground(this.tabId); await this.initialize({tabId:this.tabId});}
    catch(error){cancelled=true;this.api.debugger.onEvent.removeListener(this.listener); await withTimeout(this.api.debugger.detach({tabId:this.tabId}),'Detaching browser control',1500).catch(()=>{}); throw Error('Cannot attach browser control: '+error.message);}
  }
  async initialize(source) {
    await this.send(source,'Runtime.enable'); await this.send(source,'Page.enable');
    await this.send(source,'Page.setInterceptFileChooserDialog',{enabled:true});
    await this.send(source,'Runtime.addBinding',{name:'__jev_takeover'});
    await this.send(source,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'iframe',exclude:false}]});
    const script=await this.send(source,'Page.addScriptToEvaluateOnNewDocument',{source:`(${pageFocusGuard.toString()})('start')`,runImmediately:true});
    this.scripts.set(source.sessionId||'',script.identifier);
  }
  event(source,method,params) {
    if (source.tabId!==this.tabId || this.closed) return;
    if (method==='Target.attachedToTarget' && params.targetInfo?.type==='iframe') {
      const child={tabId:this.tabId,sessionId:params.sessionId}; this.sources.set(params.sessionId,child);
      const task=this.initialize(child).catch(()=>{}).finally(()=>this.initializing.delete(task)); this.initializing.add(task);
    }
    if (method==='Target.detachedFromTarget') this.sources.delete(params.sessionId);
    if (method==='Runtime.executionContextCreated') {const context=params.context; if(context.auxData?.isDefault)this.contexts.set((source.sessionId||'')+':'+context.auxData.frameId,context.id);}
    if (method==='Runtime.executionContextsCleared') {const prefix=(source.sessionId||'')+':';for(const key of this.contexts.keys())if(key.startsWith(prefix))this.contexts.delete(key);for(const key of this.worlds.keys())if(key.startsWith(prefix))this.worlds.delete(key);}
    if (method==='Runtime.executionContextDestroyed') {for(const [key,id]of this.contexts)if(id===params.executionContextId&&key.startsWith((source.sessionId||'')+':')){this.contexts.delete(key);this.worlds.delete(key);}}
    if (method==='Page.frameNavigated')this.worlds.delete((source.sessionId||'')+':'+params.frame?.id);
    if (method==='Runtime.bindingCalled' && params.name==='__jev_takeover'){let kind='physical input';try{kind=JSON.parse(params.payload).type||kind;}catch{}this.onTakeover('Paused: '+kind+' detected outside an agent input window.');}
    if (method==='Page.javascriptDialogOpening') {this.dialog={...params,source}; this.onDialog(params);}
    if (method==='Page.javascriptDialogClosed') this.dialog=null;
    if(method==='Page.fileChooserOpened')this.onDialog({type:'file-picker',message:'File picker intercepted. The agent can use task attachments only.'});
  }
  async frames() {
    await Promise.allSettled([...this.initializing]);
    const candidates=[],parents=new Map();
    for(const source of this.sources.values()) {
      try {const {frameTree}=await this.send(source,'Page.getFrameTree');
        const walk=(tree,parent)=>{const frame=tree.frame; if(parent||frame.parentId)parents.set(frame.id,parent||frame.parentId); candidates.push({frameId:frame.id,url:frame.url,source,isRoot:!parent}); for(const child of tree.childFrames||[])walk(child,frame.id);}; walk(frameTree,null);
      }catch{/* Detached frames are omitted and recorded as unavailable by observe. */}
    }
    const routes=new Map();
    for(const route of candidates){const old=routes.get(route.frameId); if(!old || route.source.sessionId && route.isRoot)routes.set(route.frameId,route);}
    this.rootFrame=[...routes.values()].find(r=>!r.source.sessionId&&r.isRoot)?.frameId;
    for(const route of routes.values()) {
      route.parentId=parents.get(route.frameId); route.mainContext=this.contexts.get((route.source.sessionId||'')+':'+route.frameId);
      try {const key=(route.source.sessionId||'')+':'+route.frameId,cached=this.worlds.get(key);if(cached&&cached.mainContext===route.mainContext)route.contextId=cached.contextId;else{const {executionContextId}=await this.send(route.source,'Page.createIsolatedWorld',{frameId:route.frameId,worldName:'jev-browser-agent'});route.contextId=executionContextId;this.worlds.set(key,{contextId:executionContextId,mainContext:route.mainContext});}}catch{route.unavailable=true;}
    }
    this.routes=routes; return [...routes.values()];
  }
  async evaluate(route,expression,returnByValue=true) {
    const response=await this.send(route.source,'Runtime.evaluate',{expression,contextId:route.contextId,returnByValue,awaitPromise:true,timeout:2500});
    if(response.exceptionDetails)throw Error('STALE: Frame script failed: '+(response.exceptionDetails.exception?.description||response.exceptionDetails.text));
    const value=response.result?.value;
    if(value?.__jevError)throw Error(value.__jevError);
    return returnByValue?value:response.result;
  }
  async command(route,command,payload={}) {if(!['release','disarm'].includes(command))await this.ensureBackground(this.tabId);payload={...payload,nativeInput:true};return this.evaluate(route,`(${pageCommand.toString()})(${JSON.stringify(command)},${JSON.stringify(payload)})`);}
  async observe() {
    await this.ensureBackground(this.tabId);
    if(this.dialog){const tab=await this.api.tabs.get(this.tabId);return {...(this.lastSnapshot||{url:tab.url,title:tab.title,text:'',elements:[],links:[],viewport:{width:1,height:1}}),dialog:{type:this.dialog.type,message:this.dialog.message,defaultPrompt:this.dialog.defaultPrompt}};}
    const routes=await this.frames(); this.targets.clear();
    const pages=[],warnings=[];
    for(const route of routes) {
      if(route.unavailable){warnings.push('Unable to inspect frame '+route.url);continue;}
      try {await this.command(route,'start'); const page=await this.command(route,'observe');
        // AX backend nodes let us reach semantic controls inside closed shadow roots.
        try {const tree=await this.send(route.source,'Accessibility.getFullAXTree',{frameId:route.frameId});
          for(const ax of tree.nodes||[]){if(page.elements.length>=240)break;if(ax.ignored||!ax.backendDOMNodeId||!['button','link','textbox','combobox','checkbox','radio','tab','menuitem','slider','spinbutton'].includes(ax.role?.value))continue;
            const remote=await this.send(route.source,'DOM.resolveNode',{backendNodeId:ax.backendDOMNodeId,executionContextId:route.contextId});
            try {const result=await this.send(route.source,'Runtime.callFunctionOn',{objectId:remote.object.objectId,functionDeclaration:`function(){return (${pageCommand.toString()})('register',{nativeInput:true,node:this,id:${JSON.stringify('ax_')}+${JSON.stringify(ax.backendDOMNodeId)}});}`,returnByValue:true});if(result.result?.value?.id)page.elements.push(result.result.value);}finally{await this.send(route.source,'Runtime.releaseObject',{objectId:remote.object.objectId}).catch(()=>{});}
          }
        }catch(error){warnings.push('Some accessibility controls are unavailable in '+route.url);}
        if(route.parentId)try{await this.globalPoint(route,{x:1,y:1});}catch{for(const element of page.elements)element.inViewport=false;}
        for(const element of page.elements) {const localId=element.id; element.id=route.frameId+'::'+localId; element.frameId=route.frameId; this.targets.set(element.id,{route,localId,element});}
        for(const link of page.links||[])link.id=route.frameId+'::'+link.id;
        pages.push({route,page});
      }catch(error){if(/Paused/.test(error.message))throw error;warnings.push('Frame '+route.url+': '+error.message);}
    }
    const main=pages.find(p=>p.route.frameId===this.rootFrame)?.page;
    if(!main){this.worlds.clear();throw Error('Main page is unavailable. '+warnings.slice(0,2).join('; '));}
    return this.lastSnapshot={...main,elements:pages.flatMap(p=>p.page.elements).slice(0,240),links:pages.flatMap(p=>p.page.links||[]).slice(0,240),text:pages.map(p=>`[Frame ${p.route.frameId} ${p.page.url}]\n${p.page.text}`).join('\n').slice(0,36000),frames:pages.map(p=>({id:p.route.frameId,url:p.page.url})),warnings,dialog:this.dialog?{type:this.dialog.type,message:this.dialog.message,defaultPrompt:this.dialog.defaultPrompt}:null};
  }
  async resolve(target,operation) {
    const saved=this.targets.get(target); if(!saved)throw Error('STALE: Unknown page control');
    const info=await this.command(saved.route,'inspect',{action:{operation,target:saved.localId}});
    return {...saved,info,point:operation==='UPLOAD'?undefined:await this.globalPoint(saved.route,info)};
  }
  async globalPoint(route,point) {
    let x=point.x,y=point.y,current=route;
    while(current.parentId) {
      const parent=this.routes.get(current.parentId);if(!parent)throw Error('STALE: Parent frame unavailable.');
      const owner=await this.send(parent.source,'DOM.getFrameOwner',{frameId:current.frameId});
      const remote=await this.send(parent.source,'DOM.resolveNode',{backendNodeId:owner.backendNodeId});
      const response=await this.send(parent.source,'Runtime.callFunctionOn',{objectId:remote.object.objectId,returnByValue:true,functionDeclaration:`function(x,y){const r=this.getBoundingClientRect(); const style=getComputedStyle(this);const m=new DOMMatrix(style.transform==='none'?undefined:style.transform);if(m.b!==0||m.c!==0)return {error:'Rotated frames require manual takeover'};const sx=r.width/this.offsetWidth,sy=r.height/this.offsetHeight;const px=r.left+(this.clientLeft+x)*sx,py=r.top+(this.clientTop+y)*sy;let hit=document.elementFromPoint(px,py);while(hit?.shadowRoot){const next=hit.shadowRoot.elementFromPoint(px,py);if(!next||next===hit)break;hit=next;}if(hit!==this)return {error:'Frame is covered or offscreen'};return {x:px,y:py};}`,arguments:[{value:x},{value:y}]});
      await this.send(parent.source,'Runtime.releaseObject',{objectId:remote.object.objectId}).catch(()=>{});
      const value=response.result?.value;if(response.exceptionDetails||value?.error||!value)throw Error('STALE: '+(value?.error||'Cannot locate frame'));
      x=value.x;y=value.y;current=parent;
    }
    const root=this.routes.get(this.rootFrame);const viewport=await this.evaluate(root,'({width:innerWidth,height:innerHeight})');return safeCoordinate({x,y},viewport);
  }
  async input(method,params){
    if(this.onVisual&&method==='Input.dispatchMouseEvent'&&params.type==='mouseMoved'){
      const root=this.routes.get(this.rootFrame);if(root)await this.command(root,'pointer',{point:{x:params.x,y:params.y}});
      if(Date.now()-this.lastVisual>250){this.lastVisual=Date.now();await this.onVisual().catch(()=>{});}
    }
    return this.send({tabId:this.tabId},method,params);
  }
  async previewAction(action){
    const root=this.routes.get(this.rootFrame);if(!root||this.dialog)return;
    let point,target;
    if(action.target&&!['UPLOAD','SCROLL_TO','SCROLL_DOWN','SCROLL_UP','COPY_SELECTION'].includes(action.operation)){const resolved=await this.resolve(action.target,action.operation);point=resolved.point;if(resolved.route===root)target=resolved.localId;}
    if(action.operation.startsWith('VISUAL_'))point=safeCoordinate(action,this.lastSnapshot.viewport);
    await this.command(root,'mark',{message:action.operation.replaceAll('_',' '),point,target,color:action.operation==='TYPE'?'#3b82f6':action.operation==='EXTRACT'?'#10b981':'#8b5cf6'});
  }
  async click(point,button='left',count=1) {
    await this.input('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    for(let i=1;i<=count;i++) {await this.input('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,buttons:button==='right'?2:1,clickCount:i}); await this.input('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button,buttons:0,clickCount:i});}
  }
  async press(key) {for(const event of keyEvents(key,/Mac/.test(globalThis.navigator?.platform||''))) await this.input('Input.dispatchKeyEvent',event);}
  async armed(routes,task) {
    routes=[...new Set([...routes,...this.routes.values()].filter(route=>route&&!route.unavailable))];
    try {for(const route of routes)await this.command(route,'arm');return await task();}
    finally {for(const route of routes)await this.command(route,'disarm').catch(()=>{});}
  }
  async act(action) {
    await this.ensureBackground(this.tabId);
    const root=this.routes.get(this.rootFrame);
    if(action.operation==='COPY_SELECTION'){const target=action.target&&this.targets.get(action.target);if(action.target&&!target)throw Error('STALE: Copy target unavailable');const selection=await this.command(target?.route||root,'selection',{target:target?.localId});return {ok:true,selection:selection.text.slice(0,50000)};}
    if(action.operation==='FIND_TEXT')return this.command(root,'find',{text:action.text});
    if(action.operation==='WAIT'){await sleep(350);return {ok:true};}
    if(action.operation==='DIALOG_ACCEPT'||action.operation==='DIALOG_DISMISS') {
      if(!this.dialog)throw Error('STALE: Dialog closed');const dialog=this.dialog;
      await this.send(dialog.source,'Page.handleJavaScriptDialog',{accept:action.operation==='DIALOG_ACCEPT',...(action.text?{promptText:action.text}:{})});return {ok:true};
    }
    if(['BACK','FORWARD'].includes(action.operation)) {const h=await this.send({tabId:this.tabId},'Page.getNavigationHistory'); const index=h.currentIndex+(action.operation==='BACK'?-1:1);if(!h.entries[index])throw Error('No history in that direction');await this.ensureBackground(this.tabId);await this.send({tabId:this.tabId},'Page.navigateToHistoryEntry',{entryId:h.entries[index].id});return {ok:true};}
    if(action.operation==='RELOAD'){await this.ensureBackground(this.tabId);await this.send({tabId:this.tabId},'Page.reload');return {ok:true};}
    if(['SCROLL_DOWN','SCROLL_UP','SCROLL_TO'].includes(action.operation)) {
      const target=action.target&&this.targets.get(action.target);if(action.target&&!target)throw Error('STALE: Scroll target unavailable');
      await this.command(target?.route||root,'act',{action:{...action,target:target?.localId}});
      if(action.operation==='SCROLL_TO'&&target){let route=target.route;while(route.parentId){const parent=this.routes.get(route.parentId);if(!parent)throw Error('STALE: Parent frame unavailable');const owner=await this.send(parent.source,'DOM.getFrameOwner',{frameId:route.frameId});const remote=await this.send(parent.source,'DOM.resolveNode',{backendNodeId:owner.backendNodeId});try{await this.ensureBackground(this.tabId);await this.send(parent.source,'Runtime.callFunctionOn',{objectId:remote.object.objectId,functionDeclaration:"function(){this.scrollIntoView({block:'center',inline:'center',behavior:'instant'});}",returnByValue:true});}finally{await this.send(parent.source,'Runtime.releaseObject',{objectId:remote.object.objectId}).catch(()=>{});}route=parent;}}
      return {ok:true};
    }
    if(action.operation==='PRESS_KEY') {
      const resolved=action.target?await this.resolve(action.target,'PRESS_KEY'):null;
      return this.armed([...(resolved?[resolved.route]:[]),root].filter((r,i,a)=>r&&a.indexOf(r)===i),async()=>{if(resolved)await this.click(resolved.point);await this.press(action.key);return {ok:true};});
    }
    if(action.operation==='VISUAL_CLICK'||action.operation==='VISUAL_HOVER') {
      const point=await this.command(root,'visual',{x:action.x,y:action.y,epoch:action.epoch});
      return this.armed([root],async()=>{if(action.operation==='VISUAL_CLICK')await this.click(point);else await this.input('Input.dispatchMouseEvent',{type:'mouseMoved',...point});return {ok:true};});
    }
    const resolved=await this.resolve(action.target,action.operation);
    const affected=[resolved.route,root].filter((r,i,a)=>r&&a.indexOf(r)===i);
    return this.armed(affected,async()=>{
      if(action.operation==='CLICK')await this.click(resolved.point);
      else if(action.operation==='DOUBLE_CLICK')await this.click(resolved.point,'left',2);
      else if(action.operation==='RIGHT_CLICK')await this.click(resolved.point,'right');
      else if(action.operation==='HOVER')await this.input('Input.dispatchMouseEvent',{type:'mouseMoved',...resolved.point});
      else if(action.operation==='TYPE'||action.operation==='PASTE') {await this.click(resolved.point);await this.press('SELECT_ALL');await this.input('Input.insertText',{text:action.text});await this.press('Tab');}
      else if(action.operation==='SELECT')await this.command(resolved.route,'act',{action:{...action,target:resolved.localId}});
      else if(action.operation==='DRAG') {
        const destination=await this.resolve(action.destination,'DRAG');if(destination.route!==resolved.route)throw Error('Drag across frames is unsupported.');
        await this.input('Input.dispatchMouseEvent',{type:'mouseMoved',...resolved.point});await this.input('Input.dispatchMouseEvent',{type:'mousePressed',...resolved.point,button:'left',buttons:1,clickCount:1});
        try {for(let i=1;i<=12;i++){await this.input('Input.dispatchMouseEvent',{type:'mouseMoved',x:resolved.point.x+(destination.point.x-resolved.point.x)*i/12,y:resolved.point.y+(destination.point.y-resolved.point.y)*i/12,button:'left',buttons:1});await sleep(20);}}
        finally {await this.input('Input.dispatchMouseEvent',{type:'mouseReleased',...destination.point,button:'left',buttons:0,clickCount:1}).catch(()=>{});}
      }else if(action.operation==='UPLOAD') {
        if(resolved.info.kind!=='file'||!Array.isArray(action.files)||!action.files.length)throw Error('Upload requires an assigned file input and an attached file.');
        if(!resolved.info.multiple&&action.files.length>1)throw Error('This input accepts only one file.');
        const object=await this.evaluate(resolved.route,`(${pageCommand.toString()})('node',${JSON.stringify({nativeInput:true,action:{target:resolved.localId,operation:'UPLOAD'}})})`,false);
        try {await this.send(resolved.route.source,'DOM.setFileInputFiles',{objectId:object.objectId,files:action.files});}finally{await this.send(resolved.route.source,'Runtime.releaseObject',{objectId:object.objectId}).catch(()=>{});}
      }else throw Error('Unsupported browser operation '+action.operation);
      return {ok:true};
    });
  }
  async extract() {
    const pages=[];
    for(const route of this.routes.values())if(!route.unavailable)try{pages.push(await this.command(route,'extract'));}catch(error){if(route.frameId===this.rootFrame)throw error;}
    const root=pages.find(p=>p.url===this.routes.get(this.rootFrame)?.url)||pages[0];
    if(!root)throw Error('No page content available');return {...root,headings:pages.flatMap(p=>p.headings||[]).slice(0,200),text:pages.map(p=>`[${p.url}]\n${p.text}`).join('\n').slice(0,200000),links:pages.flatMap(p=>p.links).slice(0,1000),tables:pages.flatMap(p=>p.tables).slice(0,50),frames:pages.map(p=>({url:p.url,title:p.title}))};
  }
  async screenshot() {await this.ensureBackground(this.tabId);const image=await this.send({tabId:this.tabId},'Page.captureScreenshot',{format:'jpeg',quality:65,fromSurface:true,captureBeyondViewport:false});return {dataUrl:'data:image/jpeg;base64,'+image.data};}
  async cleanup() {
    for(const route of this.routes.values()) {
      await this.command(route,'release').catch(()=>{});
      if(route.mainContext)await this.send(route.source,'Runtime.evaluate',{contextId:route.mainContext,expression:`(${pageFocusGuard.toString()})('release')`}).catch(()=>{});
    }
    for(const [key,contextId]of this.contexts){const sessionId=key.slice(0,key.indexOf(':'));const source=this.sources.get(sessionId);if(source)await this.send(source,'Runtime.evaluate',{contextId,expression:`(${pageFocusGuard.toString()})('release')`,timeout:1000}).catch(()=>{});}
    for(const source of this.sources.values())await this.send(source,'Runtime.removeBinding',{name:'__jev_takeover'}).catch(()=>{});
    for(const [sessionId,identifier]of this.scripts)await this.send(this.sources.get(sessionId)||{tabId:this.tabId},'Page.removeScriptToEvaluateOnNewDocument',{identifier}).catch(()=>{});
  }
  async release() {
    if(this.closed)return;
    if(this.releasing)return this.releasing;
    this.releasing=(async()=>{
      try{await withTimeout(this.cleanup(),'Releasing browser control',4000).catch(()=>{});}
      finally{this.closed=true;this.api.debugger.onEvent.removeListener(this.listener);await withTimeout(this.api.debugger.detach({tabId:this.tabId}),'Detaching browser control',1500).catch(()=>{});}
    })();
    return this.releasing;
  }
}
