const saved=await chrome.storage.local.get(['name','token']);
document.querySelector('#name').value=saved.name||'';
document.querySelector('#token').value=saved.token||'';
document.querySelector('#connect').addEventListener('submit',async event=>{
  event.preventDefault();
  await chrome.storage.local.set({name:document.querySelector('#name').value,token:document.querySelector('#token').value.trim()});
  const result=await chrome.runtime.sendMessage({type:'connect'});
  document.querySelector('#status').textContent=result.ok?'Connecting… Check the workspace for this browser.':result.error;
});
