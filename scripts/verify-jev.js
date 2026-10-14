import {buildQuestions,resolveAction} from '../agent.js';
if(!process.env.TYPESAFE_API_KEY)throw Error('Set TYPESAFE_API_KEY in .env');
const scenarios=[
  {name:'Form typing',goal:'Fill email: alex@example.com; do not submit.',snapshot:{url:'https://example.com/contact',title:'Contact',text:'Contact form',elements:[{id:'e1',kind:'type',name:'Email',tag:'INPUT',value:'',inViewport:true}],links:[],capabilities:['native-input']},expected:'TYPE'},
  {name:'Menu hover',goal:'Hover over the Account menu to reveal its dropdown. The menu has not been opened yet.',snapshot:{url:'https://example.com',title:'Example',text:'Account (menu appears on hover)',elements:[{id:'e2',kind:'click',name:'Account menu — opens on hover',tag:'BUTTON',role:'button',inViewport:true}],links:[],capabilities:['native-input']},expected:'HOVER'},
  {name:'Attached file selection',goal:'Upload the attached cv.pdf to the Resume field. It has not been uploaded yet.',snapshot:{url:'https://example.com/application',title:'Application',text:'Resume upload field is empty',elements:[{id:'e3',kind:'upload',name:'Resume',tag:'INPUT',value:'',inViewport:true}],attachments:[{id:'fixture-file',name:'cv.pdf',type:'application/pdf',size:1024}],links:[],capabilities:['native-input']},expected:'UPLOAD'}
];
let failed=false;
for(const scenario of scenarios){
  const questions=buildQuestions(scenario.snapshot,scenario.goal);
  const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.TYPESAFE_API_KEY},body:JSON.stringify({model:process.env.TYPESAFE_MODEL||'jev-latest',state:{goal:scenario.goal,page:scenario.snapshot,history:[]},questions}),signal:AbortSignal.timeout(30000)});
  if(!response.ok){console.error(scenario.name+': HTTP '+response.status);failed=true;continue;}
  try{const data=await response.json(),action=resolveAction(data,questions,scenario.goal,scenario.snapshot);const passed=action.operation===scenario.expected;console.log(JSON.stringify({scenario:scenario.name,passed,operation:action.operation,target:action.target,confidence:action.confidence,model:data.model,usage:data.usage}));if(!passed)failed=true;}
  catch(error){console.error(scenario.name+': '+error.message);failed=true;}
}
if(failed)process.exitCode=1;
