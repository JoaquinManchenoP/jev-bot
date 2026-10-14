// Loaded only into the integration-test child process. No remote API calls.
globalThis.fetch=async(url,options)=>{
  if(url!=='https://api.typesafe.ai/v1/systemone')throw Error('Unexpected provider URL');
  const request=JSON.parse(options.body),step=request.state.plan.steps[request.state.plan.index];
  // Argument requests omit page elements; choose from the offered questions.
  if(!request.questions.operation){
    const answers=Object.fromEntries(Object.entries(request.questions).map(([key,question])=>{
      const selected=Object.keys(question.criteria).find(value=>value!=='NONE');
      if(!selected)throw Error('No mock choice available for '+key);
      return [key,{type:'choice',choice:selected,confidence:1}];
    }));
    return {ok:true,json:async()=>({answers})};
  }
  const operation=step.resolveSite&&request.state.page.url.includes('google.com/search')?'NAVIGATE':step.kind==='navigate'?'DONE':/\b(extract|scrape|collect)\b/i.test(step.text)?request.state.extracted.length>(step.resultStart||0)?'DONE':'EXTRACT':request.state.page.elements.length?'TYPE':'DONE';
  const answers={operation:{type:'choice',choice:operation,confidence:1}};
  return {ok:true,json:async()=>({answers})};
};
