import {BrowserDriver,isWebTab} from './driver.js';
import {withTimeout} from './timeout.js';
let connectionPromise;
let socket, heartbeat, currentTab, blocked = true, generation = 0, downloadWindow = 0;
const owned = new Map(), createdTabs = new Set();
const send = message => {if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));};
const progress=message=>send({type:'activity',message});
async function publish() {
  let {name,browserId} = await chrome.storage.local.get(['name','browserId']);
  if(!browserId){browserId=crypto.randomUUID();await chrome.storage.local.set({browserId});}
  const tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || '')).map(t => ({id:t.id,title:t.title,url:t.url,windowId:t.windowId}));
  send({type:'hello',browserId,name:name || 'Chrome',tabs,version:3,capabilities:['native-input','frames','shadow-dom','keyboard','hover','drag','uploads','downloads','tabs','screenshots','action-preview']});
}
async function ensureBackground(tabId) {
  if (blocked || !owned.has(tabId)) throw Error('Paused: browser ownership was released.');
  const tab = await chrome.tabs.get(tabId), win = await chrome.windows.get(tab.windowId);
  if (tab.active && win.focused) {void pause('Paused: you opened an owned tab. Switch away and press Resume.'); throw Error('Paused: target tab is in use.');}
  if (blocked || !owned.has(tabId)) throw Error('Paused: target was released.');
  if (!isWebTab(tab)) throw Error('Only HTTP and HTTPS pages can be automated.');
}
async function release() {
  blocked = true; generation++; const drivers = [...owned.values()]; owned.clear();createdTabs.clear(); currentTab = undefined; downloadWindow = 0;
  await Promise.allSettled(drivers.map(driver => driver.release())); await chrome.action.setBadgeText({text:''});
}
async function pause(reason) {if(blocked)return; blocked=true; send({type:'pause',reason}); await release();}
async function adopt(tabId) {
  // Reserve ownership before checking focus. Failed adoption is cleaned up by release.
  const driver = new BrowserDriver(chrome,tabId,ensureBackground,reason=>void pause(reason),dialog=>send({type:'activity',message:`Browser dialog: ${dialog.type} · ${dialog.message.slice(0,200)}`}),async()=>{if(paramsPreview){const preview=await driver.screenshot();send({type:'preview',preview});}});
  owned.set(tabId,driver); await ensureBackground(tabId); progress('Attaching browser control'); await driver.attach(); progress('Browser control attached'); return driver;
}
async function waitLoaded(tabId) {
  progress('Waiting for the page to load');
  for(let i=0;i<60;i++){await ensureBackground(tabId);if((await chrome.tabs.get(tabId)).status==='complete')return;await new Promise(r=>setTimeout(r,100));}
  // News sites may keep loading ads indefinitely; inspect the available document.
  progress('The page is still loading; inspecting the available content');
}
let paramsPreview=false;
async function handle(method,params={}) {
  if(method==='release'){await release();return {ok:true};}
  if(method==='takeover'){await release();const tab=await chrome.tabs.get(Number(params.tabId));await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});return {ok:true};}
  if(method==='prepare'||method==='resume') {
    if(owned.size)throw Error('A browser task is already assigned.');
    blocked=false;paramsPreview=params.livePreview===true; const expected=++generation;
    try {
      let ids=[];
      if(method==='resume'){ids=params.tabs.map(Number);for(const id of params.createdTabs||[])createdTabs.add(Number(id));}
      else if(params.mode==='existing')ids=[Number(params.tabId)];
      else if(params.mode==='new-window') {progress('Creating a background window');const win=await withTimeout(chrome.windows.create({url:params.url,focused:false}),'Creating a browser window');ids=[win.tabs[0].id];createdTabs.add(ids[0]);}
      else {progress('Creating a background tab');const tab=await withTimeout(chrome.tabs.create({url:params.url,active:false}),'Creating a browser tab');ids=[tab.id];createdTabs.add(tab.id);}
      if(expected!==generation||blocked)throw Error('Task stopped during tab creation.');
      for(const id of ids){await adopt(id);await waitLoaded(id);}
      if(expected!==generation||blocked)throw Error('Task stopped during browser preparation.');
      currentTab=method==='resume'&&ids.includes(params.tabId)?params.tabId:ids[0];
      await chrome.action.setBadgeBackgroundColor({color:'#8b5cf6'});await chrome.action.setBadgeText({text:'JEV'});
      return {tabId:currentTab,tabs:ids,createdTabs:[...createdTabs],title:(await chrome.tabs.get(currentTab)).title};
    }catch(error){await release();throw error;}
  }
  if(blocked||!currentTab)throw Error('Browser task is paused.');
  if(method==='act'&&params.action?.operation==='SWITCH_TAB') {
    const tabId=Number(params.action.tabId);await ensureBackground(tabId);currentTab=tabId;return {ok:true,tabId,tabs:[...owned.keys()],createdTabs:[...createdTabs]};
  }
  const driver=owned.get(currentTab);await ensureBackground(currentTab);
  if(method==='observe') {const snapshot=await driver.observe(); snapshot.tabId=currentTab;snapshot.tabs=await Promise.all([...owned.keys()].map(async id=>{const t=await chrome.tabs.get(id);return {id,title:t.title,url:t.url,current:id===currentTab,created:createdTabs.has(id)};}));return snapshot;}
  if(method==='extract')return driver.extract();
  if(method==='screenshot')return driver.screenshot();
  if(method==='preview-action'){await driver.previewAction(params.action);return driver.screenshot();}
  if(method==='act') {
    const action=params.action;
    if(action.operation==='NAVIGATE') {const url=new URL(action.url);if(!['https:','http:'].includes(url.protocol))throw Error('Unsupported URL');await chrome.tabs.update(currentTab,{url:url.href});await waitLoaded(currentTab);return {ok:true};}
    if(action.operation==='OPEN_TAB') {
      if(owned.size>=8)throw Error('Task reached its eight-tab limit.');
      const url=new URL(action.url);if(!['https:','http:'].includes(url.protocol))throw Error('Unsupported URL');
      const expected=generation,source=await chrome.tabs.get(currentTab),tab=await chrome.tabs.create({url:url.href,active:false,windowId:source.windowId});
      if(blocked||expected!==generation)throw Error('Task stopped while creating the tab.');
      createdTabs.add(tab.id);await adopt(tab.id);await waitLoaded(tab.id);if(blocked||expected!==generation)throw Error('Task stopped while opening the tab.');currentTab=tab.id;return {ok:true,tabId:currentTab,tabs:[...owned.keys()],createdTabs:[...createdTabs]};
    }
    if(action.operation==='CLOSE_TAB') {
      const id=Number(action.tabId);if(!owned.has(id)||!createdTabs.has(id)||owned.size<2)throw Error('Can only close an owned tab when another remains.');
      await ensureBackground(id);const closing=owned.get(id);owned.delete(id);createdTabs.delete(id);await closing.release();await chrome.tabs.remove(id);if(currentTab===id)currentTab=[...owned.keys()][0];return {ok:true,tabId:currentTab,tabs:[...owned.keys()],createdTabs:[...createdTabs]};
    }
    downloadWindow=Date.now()+5000;
    const result=await driver.act(action);return {...result,tabId:currentTab,tabs:[...owned.keys()],createdTabs:[...createdTabs]};
  }
  throw Error('Unsupported browser command');
}
function connect(){if(connectionPromise)return connectionPromise;connectionPromise=connectOnce().finally(()=>connectionPromise=undefined);return connectionPromise;}
async function connectOnce() {
  if(socket){socket.onclose=null;socket.close();}clearInterval(heartbeat);await release();
  const {token}=await chrome.storage.local.get('token');if(!token)return;
  const ws=socket=new WebSocket('ws://localhost:3210/bridge?token='+encodeURIComponent(token));
  ws.onopen=()=>{if(socket!==ws)return;publish();heartbeat=setInterval(()=>{send({type:'ping'});publish();},20000);};
  let queue=Promise.resolve();
  ws.onmessage=event=>{
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    // Stop/takeover sets the synchronous lock before the queued operation can emit input.
    if(msg.method==='release') {blocked=true;generation++;}
    const process=async()=>{try{const result=await handle(msg.method,msg.params);if(socket===ws)send({id:msg.id,result});}catch(error){if(socket===ws)send({id:msg.id,error:error.message});}};
    queue=queue.then(process,process);
  };
  ws.onclose=()=>{if(socket!==ws)return;clearInterval(heartbeat);release();chrome.alarms.create('reconnect',{delayInMinutes:.5});};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type==='connect'&&!sender.tab){connect().then(()=>reply({ok:true})).catch(e=>reply({error:e.message}));return true;}});
chrome.tabs.onActivated.addListener(async({tabId})=>{if(owned.has(tabId)){const t=await chrome.tabs.get(tabId);if((await chrome.windows.get(t.windowId)).focused)void pause('Paused: you activated an owned tab.');}publish();});
chrome.windows.onFocusChanged.addListener(async windowId=>{if(windowId<0||blocked)return;for(const id of owned.keys()){const t=await chrome.tabs.get(id).catch(()=>null);if(t?.windowId===windowId&&t.active){void pause('Paused: you focused an owned browser window.');break;}}});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')publish();});
chrome.tabs.onRemoved.addListener(id=>{if(owned.has(id))void pause('Paused: an owned tab was closed.');publish();});
chrome.debugger.onDetach.addListener(source=>{if(owned.has(source.tabId)&&!blocked)void pause('Paused: browser control was detached. Close DevTools before resuming.');});
chrome.downloads.onCreated.addListener(item=>{
  // Correlate only downloads immediately following this task's input and its owned page.
  if(blocked||Date.now()>downloadWindow)return;
  Promise.all([...owned.keys()].map(id=>chrome.tabs.get(id).catch(()=>null))).then(tabs=>{if(tabs.some(t=>t&&item.referrer&&item.referrer===t.url))send({type:'download',item:{id:item.id,url:item.finalUrl||item.url,filename:item.filename,state:item.state}});});
});
chrome.downloads.onChanged.addListener(delta=>{if(delta.state||delta.filename)send({type:'download-state',id:delta.id,state:delta.state?.current,filename:delta.filename?.current});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='reconnect'&&socket?.readyState!==WebSocket.OPEN)connect();});
chrome.runtime.onStartup.addListener(connect);chrome.runtime.onInstalled.addListener(connect);connect();
