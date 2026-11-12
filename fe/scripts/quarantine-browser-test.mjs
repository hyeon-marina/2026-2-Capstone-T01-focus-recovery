// Invoked by the isolated local HTTPS test harness after explicit synthetic-owner login.
import assert from 'node:assert/strict';

export async function checkQuarantine({ context, harness, send, wait, assigned }) {
  const [first, second] = assigned;
  const start = async assignment => {
    const result = await send('start', { plannedSessionId: assignment.plannedSessionId });
    assert.ok(!result?.error, JSON.stringify({error:result?.reason,assignment:assignment.plannedSessionId,status:await send('status')}));
    await wait(s => s.lifecycle === 'ACTIVE' && !s.quarantined, 'fresh session');
  };
  const end = async () => {
    assert.ok(!(await send('stop'))?.error);
    await wait(s => s.lifecycle === 'ENDED' && s.quarantineClose === 'acknowledged', 'quarantine closure');
  };
  const page = await context.newPage();
  await context.route('https://fixture.focus-recovery.org/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/unsafe' ? 'Bearer synthetic-fixture-only'
      : path === '/excluded' ? '<div data-paywall>Subscription required</div>'
      : 'Synthetic public reporting on a local open source project. Contact reporter@example.org for information.';
    return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Public fixture</title><article>'+body+'</article>'});
  });
  const visit = async path => { await page.goto('https://fixture.focus-recovery.org/'+path); await page.bringToFront(); };
  const progress = async () => (await send('progress')).attempts;
  const attemptsBefore = await progress();
  const resumed = attemptsBefore.find(a => a.plannedSessionId === first.plannedSessionId && a.sessionStatus === 'ACTIVE');
  let old = attemptsBefore.find(a => a.plannedSessionId === first.plannedSessionId && a.rawStatus === 'QUARANTINED');
  if (!resumed) {
    await start(first);
    await visit('unsafe');
    await wait(s => s.quarantined && s.validVisits === 0, 'zero visit quarantine');
    await end();
    old = (await progress()).find(a => a.plannedSessionId === first.plannedSessionId);
    assert.equal(old.rawStatus, 'QUARANTINED');
    await page.goto('about:blank');
    await start(second);
    await visit('excluded');
    await page.waitForTimeout(6000);
    assert.equal((await send('status')).validVisits, 0);
    await visit('safe');
    await wait(s => s.validVisits === 1, 'masked contact visit');
    await visit('second-safe');
    await wait(s => s.validVisits === 2, 'second visit');
    await visit('unsafe');
    await wait(s => s.quarantined, 'quarantine after accepted visits');
    await end();
    await page.goto('about:blank');
    for(let i=0;i<2;i++)assert.ok(!(await send('recollect', { attemptId: old.attemptId, reasonCode: 'USER_REQUEST' }))?.error);
    await start(first);
    await visit('short-attempt');
    await wait(s => s.validVisits === 1, 'insufficient attempt');
    await send('stop');
    await wait(s => s.lifecycle === 'ENDED' && s.endPhase === 'acked', 'insufficient END ACK');
    const short = (await progress()).find(a => a.plannedSessionId === first.plannedSessionId && a.sessionId !== old.sessionId);
    assert.ok(short?.deliveryConfirmed && short.rawStatus === 'RECOLLECT_REQUIRED');
    // Keep the same document open across sessions. Its cached snapshot belongs to the prior HMAC.
    assert.ok(!(await send('recollect', {attemptId:short.attemptId, reasonCode:'INSUFFICIENT_VISITS'}))?.error);
    await start(first);
  }
  await page.goto('https://www.koreaherald.com/article/10803838', {waitUntil:'domcontentloaded'});
  await page.bringToFront();
  assert.ok(await page.evaluate(() => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(document.body.innerText)));
  await wait(s => s.validVisits === 1 && !s.quarantined, 'public news contact visit');
  for (const [i, path] of ['tutorial','library','reference','howto','faq','using','installing','distributing','extending'].entries()) {
    await page.goto('https://docs.python.org/3/'+path+'/', { waitUntil: 'domcontentloaded' });
    await wait(s => s.validVisits === i+2, 'recollection visit '+(i+2));
  }
  await send('stop');
  await wait(s => s.lifecycle === 'ENDED' && s.endPhase === 'acked', 'recollected session end');
  const attempts = await progress();
  const fresh = attempts.find(a => a.plannedSessionId === first.plannedSessionId && a.rawStatus === 'RAW_COLLECTED');
  assert.ok(fresh && fresh.attemptId !== old.attemptId && fresh.deliveryConfirmed);
  assert.equal(fresh.rawStatus, 'RAW_COLLECTED');
  await harness.bringToFront();
  console.log('PASS zero/N visit quarantine, paywall continuation, distinct assignments, duplicate recollect and actual news visit');
}
