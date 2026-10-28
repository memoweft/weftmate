import test from 'node:test';
import assert from 'node:assert/strict';
import {startFixture} from './integration/ux-4-fixture.mjs';

test('device sync summary is authenticated, account scoped and does not invent a zero for unknown phones',async t=>{
  const fixture=await startFixture({auth1:false});t.after(()=>fixture.close());
  const result=await fixture.request('/devices/sync');
  assert.equal(result.devices.length,1);assert.equal(result.devices[0].deviceId,fixture.auth.device.id);
  assert.equal(result.devices[0].sync,null);
  assert.deepEqual(Object.keys(result.devices[0]).sort(),['deviceId','sync']);
  const denied=await fetch(fixture.origin+'/personal/v1/devices/sync');assert.equal(denied.status,401);
  await assert.rejects(fixture.request('/devices/sync?ownerId=another-account'),{status:400});
});
