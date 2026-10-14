import test from 'node:test';
import assert from 'node:assert/strict';
import {withTimeout} from '../extension/timeout.js';
test('hung protocol calls fail with an actionable stage error and do not block subsequent calls',async()=>{
  await assert.rejects(withTimeout(new Promise(()=>{}),'Runtime.enable',20),/Runtime.enable timed out.*Reload/);
  assert.equal(await withTimeout(Promise.resolve('ready'),'Next command',20),'ready');
  await assert.rejects(withTimeout(Promise.reject(Error('Detached')),'Command',20),/Detached/);
});
