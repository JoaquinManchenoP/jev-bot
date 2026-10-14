import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlan,currentGoal,completionError,isSearchPage,directUrl} from '../lib/planner.js';
import {textCandidates} from '../agent.js';
test('conversational website and headline requests become navigation followed by saved evidence',()=>{
  const plan=createPlan('go into the website of the new yourk times and give me the first 3 headlines you find.');
  assert.equal(plan.steps.length,2);assert.equal(plan.steps[0].kind,'navigate');assert.equal(plan.steps[0].destination,'new yourk times');
  plan.index=1;const run={plan,history:[],results:[]};
  assert.match(currentGoal(run),/EXTRACT before DONE/);assert.match(completionError(run,{url:'https://example.com'}),/not saved/);
  run.results.push({text:'Evidence'});assert.equal(completionError(run,{url:'https://example.com'}),undefined);
});
test('named websites resolve through browser search without requiring or guessing a domain',()=>{
  for(const site of ['New York Times','BBC','a small bookstore in Berlin']){
    const p=createPlan(`Go to the ${site} website`);assert.equal(p.steps[0].kind,'navigate');assert.equal(p.steps[0].destination,site);assert.ok(p.steps[0].resolveSite);assert.equal(new URL(p.steps[0].url).searchParams.get('q'),site+' official website');
  }
});
test('ordered clauses preserve field values, punctuation, and constraints',()=>{
  const p=createPlan('Go to the New York Times website, then click the science section and extract the headlines. Do not sign in.');assert.equal(p.steps.length,3);assert.deepEqual(p.steps.map(s=>s.kind),['navigate','page','page']);assert.ok(p.constraints[0].includes('Do not sign in'));
  const form=createPlan('Fill name: Alex Morgan; email: alex@example.com; then extract the pricing table. Do not submit any form.');assert.equal(form.steps.length,2);assert.ok(form.steps[0].text.includes('alex@example.com'));
  assert.deepEqual(textCandidates(currentGoal({plan:form})),['Alex Morgan','alex@example.com']);
});
test('explicit URLs, bare domains and relative page instructions have distinct handling',()=>{
  assert.equal(createPlan('Visit nytimes.com').steps[0].url,'https://nytimes.com/');assert.equal(createPlan('Open the pricing page').steps[0].kind,'page');assert.equal(createPlan('Search for solar panels').steps[0].kind,'search');assert.equal(createPlan('Search for solar panels on this website').steps[0].kind,'page');assert.equal(directUrl('https://user:pass@example.com'),undefined);
});
test('completion rejects search results and extraction without new saved evidence',()=>{
  const plan=createPlan('Go to the New York Times website then extract the headlines'),run={plan,history:[],results:[]};
  assert.match(completionError(run,{url:plan.steps[0].url}),/search results/);assert.match(completionError(run,{url:'https://www.nytimes.com/'}),/No navigation/);
  run.history.push({operation:'NAVIGATE',outcome:'executed'});assert.equal(completionError(run,{url:'https://www.nytimes.com/'}),undefined);plan.index=1;assert.match(completionError(run,{url:'https://www.nytimes.com/'}),/not saved/);run.results.push({});assert.equal(completionError(run,{url:'https://www.nytimes.com/'}),undefined);
  assert.equal(isSearchPage('https://www.google.com/search?q=test'),true);assert.equal(isSearchPage('https://www.nytimes.com/search?query=test'),false);
});
test('natural form phrases expose the actual supplied text',()=>{assert.ok(textCandidates('Type Alex Morgan into the name field').includes('Alex Morgan'));assert.ok(textCandidates('Fill the message field with Hello team').includes('Hello team'));});

test('form steps advance only when every requested field value is observed',async()=>{
  const {verifiedFields}=await import('../lib/planner.js');const step=createPlan('Fill name: Alex; email: alex@example.com').steps[0];
  const page={elements:[{kind:'type',name:'Name',value:'Alex'},{kind:'type',name:'Email',value:'wrong@example.com'}]};assert.equal(verifiedFields(step,page),false);page.elements[1].value='alex@example.com';assert.equal(verifiedFields(step,page),true);assert.equal(verifiedFields(createPlan('Fill name: Alex and submit the form').steps[0],page),false);
});
