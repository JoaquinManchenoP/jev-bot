import http from 'node:http';
import {readFile,writeFile,mkdir,stat,chmod,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {buildQuestions,resolveAction,webUrl,stableSnapshot,compactPage,selectedQuestions,operationChoice} from './agent.js';
import {helperAdvice,helperConfigured} from './lib/helper.js';
import {createPlan,currentGoal,completionError,verifiedFields} from './lib/planner.js';
const port=Number(process.env.PORT||3210),origin=`http://localhost:${port}`;
const dataDir=path.resolve(process.env.JEV_DATA_DIR||'.jev-data');await mkdir(dataDir,{recursive:true,mode:0o700});
let token=process.env.JEV_CONNECTION_TOKEN;
if(!token){try{token=(await readFile(path.join(dataDir,'connection-token'),'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;token=randomBytes(32).toString('hex');await writeFile(path.join(dataDir,'connection-token'),token,{mode:0o600,flag:'wx'});}if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid stored browser connection token.');}
await chmod(dataDir,0o700);
const browsers=new Map(),pending=new Map(),runs=new Map(),files=new Map();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function rpc(browser,method,params={}) {
  const timeout=['prepare','resume','observe','extract'].includes(method)?45000:['screenshot','preview-action','release'].includes(method)?10000:30000;
  return new Promise((resolve,reject)=>{if(!browser||browser.ws.readyState!==1)return reject(Error('Browser is disconnected.'));const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser ${method} timed out after ${timeout/1000}s. Reload the companion, reconnect, and try again.`));},timeout);pending.set(id,{browser:browser.id,resolve,reject,timer});browser.ws.send(JSON.stringify({id,method,params}));});
}
function log(run,message,color='purple'){run.events.push({time:Date.now(),message:String(message).slice(0,3000),color});if(run.events.length>1000)run.events.shift();}
function publicRun(run){const {abort,preview,visualFrames,input,clipboard,lastExtractionSignature,...data}=run;return {...data,visualFrames:(visualFrames||[]).map(({dataUrl,...frame})=>frame),attachments:run.attachments.map(({path,...f})=>f)};}
function savePreview(run,preview,label){
  if(run.status!=='running'||typeof preview?.dataUrl!=='string'||!preview.dataUrl.startsWith('data:image/jpeg;base64,')||preview.dataUrl.length>4*1024*1024)return;
  run.preview=preview;run.previewVersion++;run.previewLabel=label;
  run.visualFrames.push({id:run.previewVersion,label,time:Date.now(),dataUrl:preview.dataUrl});
  if(run.visualFrames.length>30)run.visualFrames.shift();
}
async function capture(run,browser,label,action){
  if(!run.input.livePreview||run.status!=='running')return;
  try{savePreview(run,await rpc(browser,action?'preview-action':'screenshot',action?{action}:{}),label);}catch(error){log(run,'Preview unavailable: '+error.message,'red');}
}
function retainRuns(){while(runs.size>30){const old=[...runs.values()].find(r=>r.released&&!['paused','needs-human'].includes(r.status));if(!old)break;runs.delete(old.id);}}
async function evaluate(run,snapshot,questions,goal) {
  for(let attempt=0;attempt<3;attempt++) {
    const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${process.env.TYPESAFE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.TYPESAFE_MODEL||'jev-latest',state:{goal,originalGoal:run.goal,plan:run.plan,page:compactPage(snapshot,!questions.operation),history:run.events.slice(-6),actions:run.history.slice(-4),extracted:run.results.map(r=>r.url)},questions}),signal:AbortSignal.any([run.abort.signal,AbortSignal.timeout(30000)])});
    if([429,529].includes(response.status)&&attempt<2){log(run,'Provider busy; retrying shortly.');await delay(750*2**attempt);if(run.abort.signal.aborted)throw Error('Task cancelled');continue;}
    if(!response.ok){let detail='';try{const body=await response.json();detail=String(body.error?.message||body.message||JSON.stringify(body.error||body)).slice(0,700);}catch{}throw Error(`TypeSafe returned HTTP ${response.status}${detail?': '+detail:'. Check your key, quota and API availability.'}`);}
    return response.json();
  }
}
async function decide(run,snapshot,questions,goal){
  // Large real pages exceeded the provider's context budget when every target head
  // was evaluated together. Choose the operation, then only its arguments.
  const first=await evaluate(run,snapshot,{operation:questions.operation},goal);
  const operation=operationChoice(first,questions),argumentsQ=selectedQuestions(questions,operation);
  const second=Object.keys(argumentsQ).length?await evaluate(run,snapshot,argumentsQ,goal+'\nThe next operation has been selected: '+operation):{answers:{}};
  return resolveAction({answers:{...second.answers,operation:first.answers.operation}},questions,goal,snapshot);
}
async function execute(run,browser,resume=false) {
  try {
    log(run,resume?'Reconnecting to the task tabs':'Preparing your browser');
    const prepared=await rpc(browser,resume?'resume':'prepare',resume?{tabs:run.ownedTabs,createdTabs:run.createdTabs,tabId:run.tabId,livePreview:run.input.livePreview}:run.input);
    run.tabId=prepared.tabId;run.ownedTabs=prepared.tabs||[prepared.tabId];run.createdTabs=prepared.createdTabs||run.createdTabs||[];
    if(run.status!=='running')return;log(run,resume?'Resumed from the current browser state':'Connected to '+prepared.title);
    let previous='',unchanged=0,rejections=0;
    for(let cycle=0;cycle<run.maxSteps&&run.status==='running';cycle++) {
      const taskStep=run.plan.steps[run.plan.index];
      if(taskStep.status==='pending'){
        taskStep.status='running';taskStep.historyStart=run.history.length;taskStep.resultStart=run.results.length;
        log(run,`Step ${run.plan.index+1}/${run.plan.steps.length}: ${taskStep.text}`);
        if(taskStep.url){
          // Even an existing tab obeys an explicit navigation instruction.
          const initial=run.plan.index===0&&!resume&&run.input.mode!=='existing'&&run.input.url===taskStep.url;
          if(!initial){await rpc(browser,'act',{tabId:run.tabId,action:{operation:'NAVIGATE',url:taskStep.url}});if(run.status!=='running')break;}
          log(run,taskStep.resolveSite?'Searching for the official website: '+taskStep.destination:'Opening '+taskStep.url);
          await delay(400);
        }
      }
      const goal=currentGoal(run);
      let snapshot;
      for(let attempt=0;attempt<4;attempt++){
        try{snapshot=await rpc(browser,'observe',{tabId:run.tabId});break;}
        catch(error){if(run.status!=='running')throw error;if(!/Main page is unavailable|execution context|STALE/i.test(error.message)||attempt===3)throw error;log(run,'Waiting for the new page to become readable');await delay(500*(attempt+1));}
      }
      if(run.status!=='running')break;
      run.url=snapshot.url;run.step++;
      if(snapshot.tabId)run.tabId=snapshot.tabId;if(snapshot.tabs)run.ownedTabs=snapshot.tabs.map(t=>t.id);
      snapshot.clipboard=run.clipboard||'';snapshot.capabilities=browser.capabilities;snapshot.attachments=run.attachments.map(({path,...f})=>f);
      run.warnings=snapshot.warnings||[];
      const signature=stableSnapshot(snapshot);unchanged=signature===previous?unchanged+1:0;previous=signature;
      let screenshot;
      if((run.input.livePreview||run.input.useVision)&&!snapshot.dialog)try{screenshot=await rpc(browser,'screenshot',{tabId:run.tabId});if(!run.previewVersion&&run.input.livePreview)savePreview(run,screenshot,'Page ready');}catch(error){log(run,'Preview unavailable: '+error.message);}
      if(run.status!=='running')break;
      if(run.input.useHelper) {
        try{const advice=await helperAdvice(goal,snapshot,run.history,run.input.useVision?screenshot:undefined,run.abort.signal);Object.assign(snapshot,advice);run.helperAdvice=advice.advice;
          if(advice.needsHuman){run.status='needs-human';log(run,advice.advice||'The helper requests user takeover.','red');break;}
        }catch(error){if(run.abort.signal.aborted)break;log(run,'Helper unavailable: '+error.message+'; continuing with Jev.','red');}
      }
      if(unchanged>=10){run.status='needs-human';log(run,'The page is not changing. Take over, clarify the task, or resume after resolving it.','red');break;}
      snapshot.alreadyExtracted=run.lastExtractionSignature===signature;
      snapshot.savedResults=run.results.slice(-8).map(result=>({url:result.url,tableCount:result.tables.length,tables:result.tables.map(table=>table.slice(0,3)).slice(0,4),linkCount:result.links.length}));
      const questions=buildQuestions(snapshot,goal);log(run,'Reading page and choosing the next action');
      let action;
      try {action=verifiedFields(taskStep,snapshot)?{operation:'DONE',confidence:1}:await decide(run,snapshot,questions,goal);}catch(error){if(/^(UNCERTAIN|MISSING_VALUE):/.test(error.message)){run.status='needs-human';log(run,error.message,'red');break;}throw error;}
      if(run.status!=='running')break;
      if(action.operation==='DONE') {
        const problem=completionError(run,snapshot);
        if(problem){log(run,'Completion rejected: '+problem,'red');if(++rejections>=3){run.status='needs-human';break;}continue;}
        if(run.input.useHelper&&snapshot.complete===false){log(run,'Completion rejected by helper: '+(snapshot.evidence||'No evidence observed.'),'red');if(++rejections>=3){run.status='needs-human';break;}continue;}
        taskStep.status='completed';taskStep.evidence=snapshot.evidence||snapshot.title+' · '+snapshot.url;
        if(run.plan.index<run.plan.steps.length-1){run.plan.index++;previous='';unchanged=0;rejections=0;log(run,'Step complete; continuing with the next instruction.','green');continue;}
        run.status='completed';run.evidence=snapshot.evidence||'Jev reported completion from the observed page and action history.';log(run,'Task complete. Review the page and collected results.','green');break;
      }
      if(['BLOCKED','HANDOFF'].includes(action.operation)){run.status='needs-human';log(run,snapshot.advice||'Jev needs your help. Handle the page or clarify the goal, then resume.','red');break;}
      try {
        run.currentAction=action.operation.replaceAll('_',' ');log(run,'Next: '+run.currentAction+(action.target?' · '+(snapshot.elements.find(e=>e.id===action.target)?.name||'observed control'):''));
        if(!snapshot.dialog)await capture(run,browser,'Before '+run.currentAction,action);
        if(run.status!=='running')break;
        if(action.operation==='EXTRACT'){const result=await rpc(browser,'extract',{tabId:run.tabId});if(run.status!=='running')break;run.results.push(result);run.lastExtractionSignature=signature;log(run,'Saved text, links and tables from the page and its frames','green');}
        else {
          if(action.operation==='UPLOAD'){const file=run.attachments.find(f=>f.id===action.fileId);if(!file)throw Error('Upload file was not attached to this task.');await stat(file.path);action.files=[file.path];}
          const outcome=await rpc(browser,'act',{tabId:run.tabId,action});if(run.status!=='running')break;
          if(outcome?.selection!==undefined)run.clipboard=String(outcome.selection).slice(0,50000);if(outcome?.tabId)run.tabId=outcome.tabId;if(outcome?.tabs)run.ownedTabs=outcome.tabs;if(outcome?.createdTabs)run.createdTabs=outcome.createdTabs;
          log(run,action.operation+(action.url?' · '+action.url:action.target?' · '+snapshot.elements.find(e=>e.id===action.target)?.name:''),action.operation==='TYPE'?'blue':action.operation==='UPLOAD'?'green':'purple');
        }
        const {files,...record}=action;run.history.push({...record,fromUrl:snapshot.url,url:action.url||snapshot.url,outcome:'executed'});rejections=0;
        if(!snapshot.dialog)await capture(run,browser,'After '+run.currentAction);
      }catch(error){if(run.status!=='running')break;log(run,'Interaction rejected: '+error.message,'red');const {files,...record}=action;run.history.push({...record,url:snapshot.url,outcome:'rejected',reason:error.message});if(++rejections>=4){run.status='needs-human';break;}}
      await delay(400);
    }
    if(run.status==='running'){run.status='needs-human';log(run,'Reached the task step budget. Resume to continue.','red');}
  }catch(error){if(run.status==='running'){run.status='failed';log(run,error.message,'red');}}
  finally{await rpc(browser,'release',{tabId:run.tabId}).catch(()=>{});run.released=true;retainRuns();}
}
const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return send(403,{error:'Invalid host'});
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/')) {
      if(req.headers.origin&&![origin,`http://127.0.0.1:${port}`].includes(req.headers.origin))return send(403,{error:'Invalid origin'});
      if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'Cross-site access denied'});
      if(req.method==='GET'&&url.pathname==='/api/state')return send(200,{configured:Boolean(process.env.TYPESAFE_API_KEY),helperConfigured:helperConfigured(),token,browsers:[...browsers.values()].map(({id,name,tabs,capabilities,version})=>({id,name,tabs,capabilities,version})),runs:[...runs.values()].map(publicRun)});
      if(req.method==='GET'&&url.pathname.startsWith('/api/preview/')){const run=runs.get(url.pathname.split('/').at(-1)),frameId=url.searchParams.get('frame'),preview=frameId?run?.visualFrames.find(f=>f.id===Number(frameId)):run?.preview;if(!preview)return send(404,{error:'No preview yet'});const base64=preview.dataUrl.split(',')[1];res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(Buffer.from(base64,'base64'));}
      const limit=url.pathname==='/api/files'?15*1024*1024:20000;
      const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>limit)return send(413,{error:'Request too large'});chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');
      if(req.method==='POST'&&url.pathname==='/api/files') {
        if(files.size>=100)throw Error('Attachment storage is full. Delete unused files or restart the app.');
        if(typeof input.name!=='string'||!input.name.trim()||typeof input.data!=='string'||!input.data.length||input.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))throw Error('Invalid file attachment');
        const buffer=Buffer.from(input.data,'base64');if(buffer.toString('base64')!==input.data)throw Error('Invalid base64 file attachment');if(buffer.length>10*1024*1024)throw Error('Maximum attachment size is 10 MB.');
        const id=randomUUID(),name=path.basename(input.name).replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,160),filename=path.join(dataDir,id+'-'+name);await writeFile(filename,buffer,{mode:0o600});
        const file={id,name,type:String(input.type||'').slice(0,120),size:buffer.length,path:filename};files.set(id,file);const {path:localPath,...metadata}=file;return send(201,metadata);
      }
      if(req.method==='POST'&&url.pathname==='/api/files/remove') {const file=files.get(input.id);if(!file)throw Error('File not found');if([...runs.values()].some(r=>!r.released&&r.attachments.some(f=>f.id===file.id)))throw Error('This file belongs to an active task.');await unlink(file.path);files.delete(file.id);return send(200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/run') {
        if(!process.env.TYPESAFE_API_KEY)throw Error('Set TYPESAFE_API_KEY in .env and restart the server.');const browser=browsers.get(input.browserId);if(!browser)throw Error('Connect a browser first.');
        if(browser.version<3)throw Error('Reload the updated Jev companion on the extensions page.');
        if([...runs.values()].some(r=>r.browserId===browser.id&&!r.released))throw Error('This browser already has a task or is releasing its previous task.');
        if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>8000)throw Error('Enter a task (up to 8,000 characters).');
        if(!['new-tab','new-window','existing'].includes(input.mode))throw Error('Invalid target mode');
        const plan=createPlan(input.goal);
        if(input.mode!=='existing'){
          const start=input.url||plan.steps[0].url||input.goal.match(/https?:\/\/[^\s<>"']+/)?.[0]?.replace(/[),.;]+$/,'');
          if(!start)throw Error('Tell Jev which website to use (for example: Go to the New York Times website, then extract the headlines), or choose an existing tab.');
          input.url=webUrl(start);
        }
        if(input.useHelper&&!helperConfigured())throw Error('Configure the optional helper before enabling it.');if(input.useVision&&!input.useHelper)throw Error('Visual assistance requires the helper.');
        const ids=Array.isArray(input.fileIds)?[...new Set(input.fileIds)].slice(0,20):[];const attachments=ids.map(id=>{const file=files.get(id);if(!file)throw Error('An attached file is no longer available');return file;});
        const options={...input,livePreview:input.livePreview===true,useHelper:input.useHelper===true,useVision:input.useVision===true};
        const run={id:randomUUID(),browserId:browser.id,goal:input.goal,messages:[input.goal],plan,status:'running',step:0,maxSteps:Math.max(20,Math.min(300,Number(input.maxSteps)||100)),events:[],history:[],results:[],downloads:[],attachments,ownedTabs:[],abort:new AbortController(),released:false,input:options,previewVersion:0,visualFrames:[]};runs.set(run.id,run);retainRuns();execute(run,browser);return send(201,{id:run.id});
      }
      if(req.method==='POST'&&url.pathname==='/api/resume') {
        const run=runs.get(input.id);if(!run||!run.released||!['paused','needs-human','failed','stopped'].includes(run.status))throw Error('This task is not ready to resume.');
        const browser=browsers.get(run.browserId);if(!browser)throw Error('Reconnect the original browser before resuming.');
        if([...runs.values()].some(r=>r.browserId===browser.id&&!r.released))throw Error('This browser already has an active task.');
        if(!run.ownedTabs.length)throw Error('No task tabs remain. Start a new task.');
        if(input.goal!==undefined){if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>8000)throw Error('Invalid updated goal');run.plan=createPlan(input.goal);run.goal=input.goal;run.messages.push(input.goal);}
        run.status='running';run.released=false;run.abort=new AbortController();execute(run,browser,true);return send(200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/stop') {const run=runs.get(input.id);if(!run)throw Error('Task not found');if(run.status==='running'){run.status='stopped';run.abort.abort();log(run,'Stopped by you','red');await rpc(browsers.get(run.browserId),'release',{tabId:run.tabId}).catch(()=>{});}return send(200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/takeover') {
        const run=runs.get(input.id);if(!run?.tabId)throw Error('No task tab is available yet.');
        if(run.status==='running'){run.status='paused';run.abort.abort();log(run,'Paused for you to take over the browser','red');await rpc(browsers.get(run.browserId),'release',{tabId:run.tabId});}
        await rpc(browsers.get(run.browserId),'takeover',{tabId:run.tabId});return send(200,{ok:true});
      }
      return send(404,{error:'Not found'});
    }
    const filesByUrl={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/fixture':'fixture.html','/fixture.js':'fixture.js'};
    if(!filesByUrl[url.pathname])return send(404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",'Cache-Control':'no-store'});res.end(await readFile(new URL('./public/'+filesByUrl[url.pathname],import.meta.url)));
  }catch(error){send(400,{error:error.message});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:8*1024*1024});
server.on('upgrade',(req,socket,head)=>{const url=new URL(req.url,origin);if(req.headers.host!==`localhost:${port}`||url.pathname!=='/bridge'||url.searchParams.get('token')!==token||!req.headers.origin?.startsWith('chrome-extension://'))return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
wss.on('connection',ws=>{
  const browser={id:randomUUID(),name:'Browser',tabs:[],capabilities:[],version:1,ws};browsers.set(browser.id,browser);
  ws.on('message',raw=>{try{const msg=JSON.parse(raw);
    if(msg.type==='hello') {
      if(typeof msg.browserId==='string'&&/^[a-f0-9-]{36}$/.test(msg.browserId)&&msg.browserId!==browser.id){const existing=browsers.get(msg.browserId);if(existing&&existing!==browser)existing.ws.close();browsers.delete(browser.id);browser.id=msg.browserId;browsers.set(browser.id,browser);}
      browser.name=String(msg.name||'Browser').slice(0,80);browser.tabs=Array.isArray(msg.tabs)?msg.tabs.slice(0,500):[];browser.capabilities=Array.isArray(msg.capabilities)?msg.capabilities.slice(0,30):[];browser.version=Number(msg.version)||1;
    }
    const active=[...runs.values()].find(r=>r.browserId===browser.id&&r.status==='running');
    if(msg.type==='pause'&&active){active.status='paused';active.abort.abort();log(active,msg.reason||'Paused because you are using a task tab.','red');}
    if(msg.type==='activity'&&active)log(active,msg.message);
    if(msg.type==='preview'&&active&&active.input.livePreview)savePreview(active,msg.preview,active.currentAction||'Browser action');
    if(msg.type==='download'&&active&&Number.isInteger(msg.item?.id)){active.downloads.push(msg.item);log(active,'Download started: '+(msg.item.filename||msg.item.url),'green');}
    if(msg.type==='download-state')for(const run of runs.values())if(run.browserId===browser.id){const item=run.downloads.find(d=>d.id===msg.id);if(item){if(msg.state)item.state=msg.state;if(msg.filename)item.filename=msg.filename;}}
    const p=pending.get(msg.id);if(p&&p.browser===browser.id){clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(Error(msg.error)):p.resolve(msg.result);}
  }catch{/* Ignore malformed bridge messages. */}});
  ws.on('close',()=>{if(browsers.get(browser.id)===browser)browsers.delete(browser.id);for(const [id,p]of pending)if(p.browser===browser.id){clearTimeout(p.timer);pending.delete(id);p.reject(Error('Browser disconnected'));}for(const run of runs.values())if(run.browserId===browser.id&&!run.released){run.status='paused';run.abort.abort();log(run,'Browser disconnected. Reconnect and resume.','red');}});
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Jev workspace: ${origin}\nPairing persists in ${dataDir}. Load the extension/ folder in your browser.`));
