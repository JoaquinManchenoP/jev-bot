const $=selector=>document.querySelector(selector);
let state={browsers:[],runs:[]},selectedRun,renderedEvents='',attached=[],uploading=false,sending=false,pinnedFrame=null,newConversation=false;
const notice=message=>{$('#notice').hidden=!message;$('#notice').textContent=message||'';};
function fillSelect(select,options,placeholder){const key=JSON.stringify(options);if(select.dataset.items===key)return;select.dataset.items=key;const old=select.value;select.replaceChildren();if(!options.length)select.add(new Option(placeholder,''));for(const option of options)select.add(new Option(option.label,option.value));if(options.some(o=>o.value===old))select.value=old;}
function currentRun(){return state.runs.find(r=>r.id===selectedRun);}
function fillTabs(){const b=state.browsers.find(b=>b.id===$('#browser').value);fillSelect($('#tab'),(b?.tabs||[]).map(t=>({value:String(t.id),label:t.title||t.url})),'No web tabs');}
async function api(path,body){const response=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
function syncComposer(){
  const run=currentRun(),resume=run&&['paused','needs-human','failed','stopped'].includes(run.status)&&run.ownedTabs.length;
  $('#run-button').textContent=resume?'Reply & resume ↑':'Send ↑';
  $('#goal').placeholder=resume?'Add missing information or revise the task…':'Ask Jev to browse, fill a form, or collect information…';
  const browser=state.browsers.find(b=>b.id===$('#browser').value);
  $('#run-button').disabled=sending||uploading||!state.configured||!browser||browser.version<3||state.runs.some(r=>r.browserId===$('#browser').value&&!r.released);
  $('#composer-hint').textContent=!browser?'Connect your browser in Settings to begin.':resume?'Your reply updates the task. Switch away from its tab before resuming.':'Enter to send · Shift+Enter for a new line';
}
function message(role,text,status){
  const card=document.createElement('article');card.className='message '+role+(status?' '+status:'');
  const author=document.createElement('span');author.className='message-author';author.textContent=role==='user'?'You':'Jev';
  const p=document.createElement('p');p.textContent=text;card.append(author,p);return card;
}
function renderChat(run){
  const host=$('#conversation'),key=run.id+':'+run.status+':'+run.events.at(-1)?.time+':'+run.results.length+':'+(run.messages?.length||0);
  if(host.dataset.key===key)return;
  const nearBottom=host.scrollHeight-host.scrollTop-host.clientHeight<100,changedRun=host.dataset.run!==run.id;
  host.dataset.key=key;host.dataset.run=run.id;host.replaceChildren();
  for(const text of run.messages||[run.goal])host.append(message('user',text));
  const last=run.events.at(-1)?.message||'Preparing your browser…';
  let reply=last;
  if(run.status==='completed')reply=run.results.length?'Here’s the information saved from the page.':'The task is complete. You can review the browser actions beside this chat.';
  if(run.status==='paused')reply='I’ve paused so you can take over. '+last+'\nWhen you’re ready, switch away from the task tab and press Resume.';
  if(run.status==='needs-human')reply='I need your help to continue. '+last+'\nReply with missing information or take over the browser.';
  if(run.status==='failed')reply='I couldn’t finish this task. '+last+(run.ownedTabs.length?'\nYou can reply with revised instructions and resume.':'\nStart a new task after resolving the connection issue.');
  if(run.status==='stopped')reply='Stopped. You can resume this task or start another conversation.';
  const card=message('assistant',reply,run.status);host.append(card);
  for(const result of run.results){
    const saved=message('assistant','Saved from '+(result.title||'the page'));
    if(/headlines?|headings?/i.test(run.goal)&&result.headings?.length){
      const words={one:1,two:2,three:3,four:4,five:5,ten:10},match=run.goal.match(/(?:first|top)\s+(\d+|one|two|three|four|five|ten)\b/i);
      const limit=Math.min(30,match?(Number(match[1])||words[match[1].toLowerCase()]):10),list=document.createElement('ol');
      const seen=new Set();
      for(const heading of result.headings){if(!heading.text||seen.has(heading.text))continue;seen.add(heading.text);const li=document.createElement('li');li.textContent=heading.text;list.append(li);if(list.children.length>=limit)break;}
      const note=document.createElement('p');note.className='hint';note.textContent='Observed page headings, in page order.';saved.append(note,list);
    }else if(result.tables?.length){
      const p=document.createElement('p');p.textContent=result.tables.slice(0,3).map(table=>table.slice(0,8).map(row=>row.join(' · ')).join('\n')).join('\n\n');saved.append(p);
    }else {const p=document.createElement('p');p.textContent=result.text?.slice(0,1400)||'Page links and details are available in Saved information below.';saved.append(p);}
    const source=document.createElement('a');source.className='source';source.textContent=result.url;if(/^https?:/.test(result.url))source.href=result.url;source.target='_blank';source.rel='noopener';saved.append(source);host.append(saved);
  }
  if(changedRun||nearBottom)host.scrollTop=host.scrollHeight;
}
function renderPreview(run){
  $('#preview-wrap').hidden=!run.previewVersion;$('#preview-pending').hidden=Boolean(run.previewVersion);
  const frames=run.visualFrames||[];
  if(pinnedFrame&&!frames.some(f=>f.id===pinnedFrame))pinnedFrame=null;
  const version=run.id+':'+(pinnedFrame||run.previewVersion);
  if(run.previewVersion&&$('#page-preview').dataset.version!==version){
    $('#page-preview').dataset.version=version;$('#page-preview').src='/api/preview/'+run.id+(pinnedFrame?'?frame='+pinnedFrame:'?v='+run.previewVersion);
  }
  $('#preview-label').textContent=pinnedFrame?'Reviewing: '+frames.find(f=>f.id===pinnedFrame)?.label:run.previewLabel||'Browser view';
  $('#return-live').hidden=!pinnedFrame;
  const timeline=$('#visual-timeline'),key=run.id+':'+run.previewVersion+':'+pinnedFrame;
  if(timeline.dataset.key!==key){timeline.dataset.key=key;timeline.replaceChildren();for(const frame of frames){
    const button=document.createElement('button');button.className='frame-button';button.type='button';button.setAttribute('aria-pressed',String(frame.id===(pinnedFrame||run.previewVersion)));
    const img=document.createElement('img');img.src='/api/preview/'+run.id+'?frame='+frame.id;img.alt='';img.loading='lazy';
    const label=document.createElement('span');label.textContent=frame.label;button.append(img,label);button.onclick=()=>{pinnedFrame=frame.id;renderPreview(run);};timeline.append(button);
  }if(!pinnedFrame)timeline.scrollLeft=timeline.scrollWidth;}
}
function renderRun(run){
  if(!run)return;
  $('#activity-empty').hidden=true;$('#activity-running').hidden=false;
  $('#run-title').textContent=run.goal;$('#step').textContent=run.history.length+' actions · '+run.step+' decisions';
  $('#browser-address').textContent=run.url||'Preparing browser…';
  $('#plan').replaceChildren();for(const [i,step] of (run.plan?.steps||[]).entries()){const row=document.createElement('li');row.textContent=(step.status==='completed'?'✓ ':i===run.plan.index?'→ ':'')+step.text;row.dataset.status=step.status;$('#plan').append(row);}
  $('#run-status').textContent=run.status==='needs-human'?'Needs your help':run.status.replaceAll('-',' ');$('#run-status').dataset.status=run.status;
  $('#stop').hidden=run.status!=='running';$('#stop').disabled=run.status!=='running';
  $('#resume').hidden=!['paused','needs-human','failed','stopped'].includes(run.status);$('#resume').disabled=!run.released||!run.ownedTabs.length||!state.browsers.some(b=>b.id===run.browserId);
  $('#takeover').disabled=!run.ownedTabs.length||!state.browsers.some(b=>b.id===run.browserId);
  if(/^https?:/.test(run.url||'')){$('#run-url').href=run.url;$('#run-url').hidden=false;}else $('#run-url').hidden=true;
  renderChat(run);renderPreview(run);syncComposer();
  const eventKey=run.id+':'+run.events.length+':'+run.events.at(-1)?.time;
  if(renderedEvents!==eventKey){renderedEvents=eventKey;$('#events').replaceChildren();for(const e of run.events){const row=document.createElement('div');row.className='event';const dot=document.createElement('i');dot.className=['purple','blue','green','red'].includes(e.color)?e.color:'purple';const text=document.createElement('span');text.textContent=e.message;const time=document.createElement('time');time.textContent=new Date(e.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});row.append(dot,text,time);$('#events').append(row);}$('#events').scrollTop=$('#events').scrollHeight;}
  $('#result-count').textContent=run.results.length+' pages';$('#export-json').disabled=!run.results.length&&!run.downloads.length;$('#export-csv').disabled=!run.results.some(r=>r.tables.length);
  const key=run.id+':'+run.results.length+':'+JSON.stringify(run.downloads),results=$('#results');
  if(results.dataset.key!==key){results.dataset.key=key;results.replaceChildren();if(!run.results.length&&!run.downloads.length)results.append(message('assistant','No saved information yet.'));for(const r of run.results){const card=document.createElement('article');card.className='result';const heading=document.createElement('h3');heading.textContent=r.title;const a=document.createElement('a');a.textContent=r.url;if(/^https?:/.test(r.url))a.href=r.url;a.target='_blank';a.rel='noopener';const pre=document.createElement('pre');pre.textContent=r.text;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=r.links.length+' links · '+r.tables.length+' tables';const json=document.createElement('pre');json.textContent=JSON.stringify({headings:r.headings,links:r.links,tables:r.tables},null,2);details.append(summary,json);card.append(heading,a,pre,details);results.append(card);}for(const item of run.downloads){const row=document.createElement('div');row.className='download-result';row.textContent='↓ '+(item.filename||item.url)+' · '+item.state;results.append(row);}}
}
let refreshing=false;
async function refresh(){if(refreshing)return;refreshing=true;try{
  state=await api('state');fillSelect($('#browser'),state.browsers.map(b=>({value:b.id,label:b.name+(b.version<3?' · reload companion':'')})),'No browser connected');fillTabs();$('#token').value=state.token;
  $('#connection-status').textContent=state.browsers.length?state.browsers.map(b=>b.name).join(', ')+' connected':'Browser not connected';$('#connection-status').dataset.ready=String(Boolean(state.browsers.length));
  $('#key-status').textContent=state.configured?'✓ TypeSafe API key configured':'API key missing. Add TYPESAFE_API_KEY to .env and restart.';
  $('#helper-status').textContent=state.helperConfigured?'✓ Optional text/vision helper configured':'Optional text and vision assistance is not configured.';
  $('#use-helper').disabled=!state.helperConfigured;$('#helper-label').textContent=state.helperConfigured?'Available':'Setup required';
  if(!state.helperConfigured){$('#use-helper').checked=false;$('#use-vision').checked=false;}$('#use-vision').disabled=!state.helperConfigured||!$('#use-helper').checked;
  fillSelect($('#history'),[{value:'new',label:'＋ New conversation'},...[...state.runs].reverse().map(r=>({value:r.id,label:r.goal.slice(0,38)}))],'No tasks yet');
  const run=newConversation?undefined:currentRun()||state.runs.at(-1);if(run){if(selectedRun!==run.id)pinnedFrame=null;selectedRun=run.id;$('#history').value=run.id;renderRun(run);}else $('#history').value='new';
  syncComposer();
  if(!state.configured)notice('Add your TypeSafe API key in Settings to enable tasks.');else if(state.browsers.some(b=>b.version<3))notice('Reload Jev Browser Companion on your browser’s extensions page to use the updated browser controls.');else if(!state.browsers.length)notice('Connect a browser using Settings & connections.');else if(/^(Add your|Connect a|Cannot reach|Reload Jev)/.test($('#notice').textContent))notice();
}catch(error){$('#connection-status').textContent='Server offline';$('#run-button').disabled=true;notice('Cannot reach the local server. Restart it with npm start. '+error.message);}finally{refreshing=false;}}
$('#task-form').addEventListener('submit',async event=>{
  event.preventDefault();if(uploading||sending||$('#run-button').disabled)return;sending=true;syncComposer();notice();
  try{const goal=$('#goal').value.trim(),run=currentRun();
    if(run&&['paused','needs-human','failed','stopped'].includes(run.status)&&run.ownedTabs.length){
      await api('resume',{id:run.id,goal});selectedRun=run.id;
    }else{
      const input={goal,browserId:$('#browser').value,mode:$('#mode').value,url:$('#url').value||undefined,tabId:Number($('#tab').value),fileIds:attached.map(f=>f.id),useHelper:$('#use-helper').checked,useVision:$('#use-vision').checked,livePreview:$('#live-preview').checked,maxSteps:Number($('#max-steps').value)};
      if(run?.status==='completed'&&run.browserId===input.browserId&&run.ownedTabs.length&&!input.url&&input.mode==='new-tab'){input.mode='existing';input.tabId=run.tabId;}
      const result=await api('run',input);selectedRun=result.id;
    }
    newConversation=false;pinnedFrame=null;$('#goal').value='';attached=[];renderAttachments();await refresh();
  }catch(error){notice(error.message);}finally{sending=false;syncComposer();}
});
$('#goal').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#task-form').requestSubmit();}});
$('#mode').addEventListener('change',()=>{const existing=$('#mode').value==='existing';$('#url-wrap').hidden=existing;$('#tab-wrap').hidden=!existing;$('#tab').required=existing;});
$('#browser').addEventListener('change',()=>{fillTabs();syncComposer();});
$('#use-helper').addEventListener('change',()=>{$('#use-vision').disabled=!$('#use-helper').checked;if(!$('#use-helper').checked)$('#use-vision').checked=false;});
$('#options-toggle').addEventListener('click',()=>{const options=$('#task-options');options.open=!options.open;$('#options-toggle').setAttribute('aria-expanded',String(options.open));});
$('#history').addEventListener('change',()=>{pinnedFrame=null;newConversation=$('#history').value==='new';selectedRun=newConversation?undefined:$('#history').value;if(newConversation){$('#conversation').replaceChildren(message('assistant','What would you like me to do? Name a website or choose a starting page.'));delete $('#conversation').dataset.key;$('#activity-empty').hidden=false;$('#activity-running').hidden=true;$('#run-status').textContent='Ready';$('#run-status').dataset.status='';$('#results').replaceChildren();delete $('#results').dataset.key;$('#result-count').textContent='0 pages';$('#export-json').disabled=true;$('#export-csv').disabled=true;$('#url').value='';$('#goal').value='';syncComposer();}else renderRun(currentRun());});
$('#return-live').addEventListener('click',()=>{pinnedFrame=null;renderPreview(currentRun());});
$('#stop').addEventListener('click',async()=>{try{await api('stop',{id:selectedRun});await refresh();}catch(error){notice(error.message);}});
$('#resume').addEventListener('click',async()=>{try{$('#resume').disabled=true;await api('resume',{id:selectedRun});notice();await refresh();}catch(error){notice(error.message);}});
$('#takeover').addEventListener('click',async()=>{try{await api('takeover',{id:selectedRun});await refresh();}catch(error){notice(error.message);}});
function renderAttachments(){const host=$('#attached-files');host.replaceChildren();for(const file of attached){const chip=document.createElement('span');chip.className='attachment-chip';chip.textContent=file.name;const button=document.createElement('button');button.type='button';button.textContent='×';button.setAttribute('aria-label','Remove '+file.name);button.onclick=async()=>{try{await api('files/remove',{id:file.id});attached=attached.filter(f=>f.id!==file.id);renderAttachments();}catch(error){notice(error.message);}};chip.append(button);host.append(chip);}}
$('#attachments').addEventListener('change',async()=>{
  uploading=true;syncComposer();try{for(const file of $('#attachments').files){if(attached.length>=20)throw Error('Attach at most 20 files.');if(file.size>10*1024*1024)throw Error(file.name+' exceeds 10 MB.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});attached.push(await api('files',{name:file.name,type:file.type,data}));renderAttachments();}}catch(error){notice(error.message);}finally{uploading=false;$('#attachments').value='';syncComposer();}
});
function setup(){$('#setup').hidden=!$('#setup').hidden;if(!$('#setup').hidden)$('#setup').scrollIntoView({behavior:'smooth'});}
$('#setup-toggle').addEventListener('click',setup);$('#setup-nav').addEventListener('click',setup);
$('#copy-token').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.token);$('#copy-token').textContent='Copied ✓';setTimeout(()=>$('#copy-token').textContent='Copy token',2000);}catch{notice('Copy the token from the field manually.');$('#token').type='text';$('#token').select();}});
const examples={form:'Fill email: alex@example.com; then extract the pricing table. Do not submit any form.',research:'Go to the New York Times website and give me the first 3 headlines.',extract:'Extract the pricing table.'};
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('#goal').value=examples[button.dataset.example];if(button.dataset.example!=='research')$('#url').value=location.origin+'/fixture';else $('#url').value='';$('#goal').focus();}));
$('#try-fixture').addEventListener('click',()=>{$('#url').value=location.origin+'/fixture';$('#goal').value=examples.form;$('#goal').focus();});
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-json').addEventListener('click',()=>download(JSON.stringify(currentRun(),null,2),'application/json','jev-results.json'));
$('#export-csv').addEventListener('click',()=>{const run=currentRun();const cell=value=>'"'+String(value).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';const rows=run.results.flatMap(r=>r.tables.flatMap((t,i)=>[[r.url,'Table '+(i+1)],...t,[]]));download(rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv','jev-tables.csv');});
refresh();setInterval(refresh,600);
