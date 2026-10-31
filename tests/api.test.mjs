import test from 'node:test';
import assert from 'node:assert/strict';
import { createDidaRequest } from '../.test-build/api.mjs';

test('proxy sends normalized bearer token and completed filters as JSON', async () => {
  const request = createDidaRequest(' Bearer test-token ', async (path, payload) => {
    assert.equal(path, '/api/network/forwardProxy');
    assert.equal(payload.headers[0].Authorization, 'Bearer test-token');
    assert.deepEqual(payload.payload, { startDate: 'start', endDate: 'end' });
    return { status: 200, body: '[]' };
  });
  assert.deepEqual(await request('/task/completed', 'POST', { startDate: 'start', endDate: 'end' }), []);
});
test('real proxy HTTP errors never fall back and never expose response credentials', async () => {
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('unexpected'); };
  try {
    const request = createDidaRequest('secret', async () => ({ status: 401, body: 'secret' }));
    await assert.rejects(request('/task/completed', 'POST', {}), error => /401/.test(error.message) && !error.message.includes('secret'));
    assert.equal(fetched, false);
  } finally { globalThis.fetch = original; }
});
test('proxy transport failure falls back to direct fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal('body' in options, false);
    return new Response('{"tasks":[]}', { status: 200 });
  };
  try {
    const request = createDidaRequest('token', async () => { throw new Error('proxy unavailable'); });
    assert.deepEqual(await request('/project/inbox/data'), { tasks: [] });
  } finally { globalThis.fetch = original; }
});
test('404 deletes are idempotent and API business errors reject', async () => {
  assert.equal(await createDidaRequest('token', async () => ({ status: 404 }))('/task/a', 'DELETE'), null);
  await assert.rejects(createDidaRequest('token', async () => ({ status: 200, body: { code: -1 } }))('/task/completed', 'POST', {}), /业务错误/);
});
