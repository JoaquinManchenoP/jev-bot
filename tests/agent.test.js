import test from 'node:test';
import assert from 'node:assert/strict';
import {textCandidates,buildQuestions,resolveAction,webUrl,stableSnapshot} from '../agent.js';
const snapshot={url:'https://example.com',text:'Hello',elements:[{id:'e1',kind:'type',name:'Email',inViewport:true},{id:'e2',kind:'click',name:'Search',inViewport:true},{id:'e3',kind:'select',name:'Department → Sales',inViewport:true}],links:[]};
const answer=(choice,confidence=.9)=>({type:'choice',choice,confidence});
const response=choices=>({answers:Object.fromEntries(Object.entries(choices).map(([key,value])=>[key,answer(value)]))});
test('form values stay grounded in user supplied literals',()=>{assert.deepEqual(textCandidates('Fill name: Alex Morgan; email: alex@example.com; message: Hello team.'),['Alex Morgan','alex@example.com','Hello team.']);assert.ok(textCandidates('Search for "solar panels"').includes('solar panels'));assert.ok(textCandidates('Search for solar panels on Google').includes('solar panels'));});
test('batches native action heads and only consumes the selected target',()=>{const goal='Enter "hello"',q=buildQuestions(snapshot,goal);assert.ok(q.hover_target&&q.double_click_target&&q.key);assert.deepEqual(resolveAction(response({operation:'TYPE',type_target:'e1',field_text:'v0',click_target:'invented'}),q,goal,snapshot),{operation:'TYPE',target:'e1',text:'hello',confidence:.9});});
test('rejects unknown, low confidence, missing and unavailable choices',()=>{const q=buildQuestions(snapshot,'Enter "hello"');for(const a of [answer('invented'),answer('CLICK',.1),answer('CLICK',NaN),null])assert.throws(()=>resolveAction({answers:{operation:a}},q,'Enter "hello"',snapshot));assert.throws(()=>resolveAction(response({operation:'TYPE',type_target:'e1',field_text:'NONE'}),q,'Enter "hello"',snapshot));});
test('restricts navigation to HTTP(S) without embedded credentials',()=>{assert.equal(webUrl('https://example.com'),'https://example.com/');for(const url of ['file:///etc/passwd','javascript:alert(1)','chrome://settings','https://user:password@example.com','invalid'])assert.throws(()=>webUrl(url));});
test('does not send singleton choices without form values',()=>{const q=buildQuestions(snapshot,'Extract the table');assert.ok(!q.field_text&&!q.type_target);for(const item of Object.values(q))assert.ok(Object.keys(item.criteria).length>=2);});
test('resolves files, tabs, link navigation, nested scroll and keyboard from exact offered choices',()=>{
  const page={...snapshot,elements:[...snapshot.elements,{id:'upload',kind:'upload',name:'CV'},{id:'scroll',kind:'scroll',name:'Results'}],attachments:[{id:'f1',name:'cv.pdf',size:12}],tabs:[{id:7,current:true},{id:8,current:false}],links:[{url:'https://example.com/pricing',text:'Pricing'}]};const goal='Upload attached CV, then open pricing',q=buildQuestions(page,goal);
  assert.equal(resolveAction(response({operation:'UPLOAD',upload_target:'upload',file:'f1'}),q,goal,page).fileId,'f1');
  assert.equal(resolveAction(response({operation:'SWITCH_TAB',tab:'8'}),q,goal,page).tabId,8);
  assert.equal(resolveAction(response({operation:'OPEN_TAB',url:'u0'}),q,goal,page).url,'https://example.com/pricing');
  assert.equal(resolveAction(response({operation:'SCROLL_DOWN',scroll_target:'scroll'}),q,goal,page).target,'scroll');
  assert.deepEqual(resolveAction(response({operation:'PRESS_KEY',press_key_target:'NONE',key:'Escape'}),q,goal,page),{operation:'PRESS_KEY',confidence:.9,key:'Escape'});
});
test('snapshot equality excludes ephemeral element/frame IDs',()=>{assert.equal(stableSnapshot(snapshot),stableSnapshot({...snapshot,elements:snapshot.elements.map(e=>({...e,id:'new'+e.id,frameId:'newframe'}))}));});
test('visual points must be selected from helper candidates',()=>{const page={...snapshot,epoch:'1',visualTargets:[{id:'visual0',x:12,y:13,label:'Canvas menu'}]},q=buildQuestions(page,'Open menu');assert.deepEqual(resolveAction(response({operation:'VISUAL_CLICK',visual_target:'visual0'}),q,'Open menu',page),{operation:'VISUAL_CLICK',confidence:.9,x:12,y:13,epoch:'1'});assert.throws(()=>resolveAction(response({operation:'VISUAL_CLICK',visual_target:'made-up'}),q,'Open menu',page));});

test('does not offer repeated extraction once an unchanged page has been saved',()=>{const questions=buildQuestions({...snapshot,alreadyExtracted:true},'Extract the pricing table');assert.ok(!questions.operation.criteria.EXTRACT);assert.ok(questions.operation.criteria.DONE);});

test('read-only extraction tolerates moderate uncertainty while clicks stay confidence-gated',()=>{const q=buildQuestions(snapshot,'Extract the table');assert.equal(resolveAction({answers:{operation:answer('EXTRACT',.2)}},q,'Extract the table',snapshot).operation,'EXTRACT');assert.throws(()=>resolveAction({answers:{operation:answer('CLICK',.2)}},q,'Extract the table',snapshot),/UNCERTAIN/);});

test('only selected operation arguments are evaluated; geometry stays local',async()=>{
  const {selectedQuestions,compactPage}=await import('../agent.js');const q=buildQuestions(snapshot,'Type "hello"');
  assert.deepEqual(Object.keys(selectedQuestions(q,'TYPE')),['type_target','field_text']);assert.deepEqual(Object.keys(selectedQuestions(q,'DONE')),[]);
  assert.equal(compactPage({...snapshot,elements:[{...snapshot.elements[0],rect:{x:10,y:20}}]}).elements[0].rect,undefined);
});
