// A real named-site command, with no supplied URL. Uses the paired browser and API credits.
const base='http://localhost:3210';
const api=async(path,body)=>{const r=await fetch(base+'/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
let state=await api('state');for(let i=0;i<80&&!state.browsers.some(b=>b.version>=3);i++){await new Promise(r=>setTimeout(r,500));state=await api('state');}
const browser=state.browsers.find(b=>b.version>=3);if(!browser)throw Error('No paired browser');
const started=await api('run',{browserId:browser.id,mode:'new-tab',goal:'Go to the New York Times website',maxSteps:20,livePreview:true});
console.log('Started named-site navigation without a URL');
for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,500));const run=(await api('state')).runs.find(r=>r.id===started.id);if(run.released){console.log(JSON.stringify({status:run.status,url:run.url,plan:run.plan,actions:run.history.map(a=>({operation:a.operation,url:a.url,outcome:a.outcome})),events:run.events.map(e=>e.message)}));if(run.status!=='completed'||!/(^|\.)nytimes\.com$/.test(new URL(run.url).hostname))process.exitCode=1;break;}if(i===179){await api('stop',{id:run.id});throw Error('Navigation test timed out');}}
