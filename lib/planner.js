// Preserve the user's wording. Jev decides the actual interactions from live pages.
const verb='(?:go|navigate|visit|open|find|search|look|fill|enter|type|click|select|choose|extract|scrape|collect|download|upload|read|copy|hover|scroll|press|give|show|list|tell)';
export function needsExtraction(text){return /\b(extract|scrape|collect)\b/i.test(text)||/\b(give|show|list|tell)\b.*\b(headlines?|articles?|links?|prices?|tables?|information|results?|details|text)\b/i.test(text);}
const boundary=new RegExp(`(?:[;,]\\s*(?:and\\s+)?(?:then\\s+)?|\\s+(?:and\\s+then|then|and)\\s+|[.!?]\\s+)(?=${verb}\\b)`,'gi');
export function searchUrl(query){return 'https://www.google.com/search?q='+encodeURIComponent(query);}
export function isSearchPage(value){try{const u=new URL(value);return /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(u.hostname)&&(/\/(search|html)(\/|$)/.test(u.pathname)||u.searchParams.has('q')||u.searchParams.has('p'));}catch{return false;}}
export function directUrl(value){
  const text=value.trim().replace(/^["“']|["”']$/g,'').replace(/[.,;]+$/,'');
  if(!/^(?:https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$))/i.test(text))return;
  try{const u=new URL(/^https?:\/\//i.test(text)?text:'https://'+text);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)return u.href;}catch{}
}
export function createPlan(goal){
  const constraints=[...goal.matchAll(/(?:^|[.;\n]\s*)(do not|don't|never)\b[^.;\n]*/gi)].map(m=>m[0].trim());
  const clauses=goal.replace(/(?:^|[.;\n]\s*)(?:do not|don't|never)\b[^.;\n]*/gi,' ').split(boundary).map(s=>s.trim().replace(/^[,;\s]+|[.;\s]+$/g,'')).filter(Boolean);
  if(clauses.length>20)throw Error('Split this request into at most 20 explicit steps.');
  const steps=clauses.map(text=>{
    const step={text,status:'pending',kind:'page'};
    const nav=text.match(/^(?:(?:please|can you|could you|i want you to|i want to)\s+)*(?:go (?:to|into|on)|navigate to|visit|take me to|open)\s+(.+)$/i);
    if(nav){
      const destination=nav[1].replace(/\s+(?:in|using)\s+(?:a |the |my )?(?:new |background |separate )?(?:tab|window|browser).*$/i,'').trim();
      const url=directUrl(destination);
      // Relative page/control instructions remain with the live-page action chooser.
      if(url||/\b(?:website|web site|homepage|home page)\b/i.test(destination)||/^(?:go to|navigate to|visit|take me to)\b/i.test(text)||(!/\b(?:page|tab|window|menu|link|form|button|dialog|settings|it)\b/i.test(destination)&&/^open\b/i.test(text))){
        step.kind='navigate';step.destination=destination.replace(/^(?:the\s+)?(?:website|web site|homepage|home page)\s+of\s+/i,'').replace(/^(?:the\s+)|\s+(?:website|web site|homepage|home page)$/gi,'').trim();step.url=url||searchUrl(step.destination+' official website');step.resolveSite=!url;
      }
    }
    const search=text.match(/^(?:please\s+)?(?:search(?: the web)? for|look up)\s+(.+)$/i);
    if(search&&!/\s+on\s+/i.test(search[1])){step.kind='search';step.query=search[1].replace(/^["“']|["”']$/g,'');step.url=searchUrl(step.query);}
    if(/^fill\b/i.test(text)&&! /\b(?:click|submit|press|select|navigate|extract|upload)\b/i.test(text)){
      const parts=text.replace(/^fill\s+(?:in\s+)?/i,'').split(';');
      if(parts.every(p=>/^\s*[^:]{1,80}:\s*\S/.test(p)))step.fields=parts.map(p=>{const split=p.indexOf(':');return {name:p.slice(0,split).trim(),value:p.slice(split+1).trim()};});
    }
    return step;
  });
  return {steps:steps.length?steps:[{text:goal,status:'pending',kind:'page'}],index:0,constraints};
}
export function verifiedFields(step,snapshot){
  if(!step.fields?.length)return false;
  const normalize=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return step.fields.every(f=>(snapshot.elements||[]).some(e=>e.kind==='type'&&(normalize(e.name)===normalize(f.name)||normalize(e.name).startsWith(normalize(f.name)+' '))&&e.value===f.value));
}
export function currentGoal(run){
  const step=run.plan.steps[run.plan.index];
  let goal=`${step.text}\nComplete only this current step (${run.plan.index+1}/${run.plan.steps.length}). Later steps are pending.\n${run.plan.constraints.join('. ')}`;
  if(step.resolveSite)goal+=`\nResolve the named website '${step.destination}' using the observed search results and navigate to its official website. A search results page is NOT completion. Choose the official homepage, not ads, reviews, Wikipedia or third-party stories. Do not invent a URL. Once its official website has loaded, choose DONE; reading articles or signing in is not required for this navigation step.`;
  if(needsExtraction(step.text))goal+='\nSave the requested information using EXTRACT before DONE. The chat will show the saved page evidence.';
  return goal;
}
export function completionError(run,snapshot){
  const step=run.plan.steps[run.plan.index];
  if(step.kind==='navigate'){
    if(isSearchPage(snapshot.url))return 'The browser is still on search results; open the requested official website.';
    if(step.resolveSite&&!run.history.slice(step.historyStart||0).some(a=>a.outcome==='executed'&&['NAVIGATE','CLICK','OPEN_TAB'].includes(a.operation)))return 'No navigation from the search results has been observed.';
    if(!step.resolveSite&&new URL(snapshot.url).hostname!==new URL(step.url).hostname)return 'The requested destination has not loaded.';
  }
  if(needsExtraction(step.text)&&run.results.length<=(step.resultStart||0))return 'This step has not saved the requested information.';
}
