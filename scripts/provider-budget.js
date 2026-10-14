// Isolated provider budget probe; no browser data or secrets in output.
for(const size of [2000,8000,16000]){
 const r=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:'Bearer '+process.env.TYPESAFE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.TYPESAFE_MODEL||'jev-latest',state:{goal:'Choose wait',text:'example '.repeat(size/8)},questions:{operation:{type:'choice',instructions:'Choose WAIT',criteria:{WAIT:'Wait',DONE:'Complete'}}}})});
 console.log(JSON.stringify({characters:size,status:r.status,body:r.ok?(await r.json()).usage:await r.json()}));
 if(!r.ok)break;
}
