import assert from 'node:assert/strict';
import test from 'node:test';
import { startTimelineCandidate } from './integration/bl29-rework/fixture.mjs';
import { putActivity, reconcileActivity } from '../src/personal-access/activity-store.mjs';

test('stored layer duplicates collapse through the activity change feed and do not reappear', () => {
  const account:any={sessions:{},commands:{}};
  const input={type:'system.update.available',title:'更新可用',summary:'新版本 1.1 已可用。',at:'2026-10-27T01:00:00Z'};
  const original=putActivity(account,'update:app:1.1',input);
  account.activity.items.duplicate={...structuredClone(original),id:'duplicate'};
  reconcileActivity(account);
  assert.equal(Object.keys(account.activity.items).length,1);
  assert.ok(account.activity.changes.some((row:any)=>row.id==='duplicate'&&row.removed));
  assert.equal(putActivity(account,'update:ui:1.1',input).id,original.id);
  assert.equal(Object.keys(account.activity.items).length,1);
});

test('one version produces one update activity across app, UI and phone layers and repeated polls', async t => {
  const fixture = await startTimelineCandidate({ historyCount: 0 }); t.after(() => fixture.close());
  const context = fixture.debug.service.__reviewContext, owner = fixture.debug.auth.account.ownerId;
  await context.activity.close();
  context.updateStatus = async () => ({ layers: ['app', 'ui', 'mobile'].map(layer => ({ layer, currentVersion: '1.0', availableVersion: '1.1' })) });
  await context.activity.refresh(owner); await context.activity.refresh(owner);
  const updates = () => Object.values(context.accountState(owner).activity.items).filter((row: any) => row.type === 'system.update.available') as any[];
  assert.equal(updates().length, 1);
  const first = updates()[0];
  await fixture.request(`/activity/${first.id}/read`, { requestId: 'update-read-once', read: true, attentionRevision: first.attentionRevision }, 'PATCH');
  await context.activity.refresh(owner);
  assert.equal(updates().length, 1); assert.equal(updates()[0].read, true);
  context.updateStatus = async () => ({ layers: [{ layer: 'app', currentVersion: '1.1', availableVersion: '1.2' }] });
  await context.activity.refresh(owner); assert.equal(updates().length, 2);
});
