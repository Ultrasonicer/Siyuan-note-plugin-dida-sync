import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, entryKey, formatTime, getCompletedTasks, getInboxTasks, parseTime, renderTask, syncAll } from '../.test-build/sync.mjs';

const start = Date.parse('2026-10-31T00:00:00Z');
const end = start + 3600000;
const task = (id, completedTime = start + 1000) => ({ id, projectId: 'work', title: id, status: 2, completedTime: new Date(completedTime).toISOString() });
const inboxTask = (id = 'inbox-a') => ({ id, projectId: 'inbox-real', status: 0, title: id, createdTime: '2020-01-01T00:00:00Z', content: '保留正文' });
function fakeWriter() {
  const keys = new Set(), writes = [];
  return { keys, writes, has: key => keys.has(key), append: async (key, markdown) => { writes.push({ key, markdown }); keys.add(key); } };
}
function setup(completed = [], inbox = []) {
  const requests = [];
  const writer = fakeWriter();
  const config = { ...defaultConfig(), completedSince: new Date(start).toISOString() };
  const request = async (path, method = 'GET', body) => {
    requests.push({ path, method, body });
    if (path === '/task/completed') return completed;
    if (path === '/project/inbox/data') return { tasks: inbox };
    if (method === 'DELETE') return null;
    return inbox.find(item => path.endsWith('/' + item.id));
  };
  return { writer, config, request, requests, save: async () => {}, now: end };
}

test('time parser accepts original local settings and Dida timezones', () => {
  assert.equal(parseTime('2026-10-31T08:00:00+0800'), start);
  assert.ok(Number.isFinite(parseTime('2026-10-31 08:00:00')));
  assert.ok(Number.isNaN(parseTime('')));
});
test('inbox includes old creations and skips completed/abandoned records', async () => {
  const tasks = await getInboxTasks(async () => ({ tasks: [inboxTask(), task('done'), { ...inboxTask('abandoned'), status: -1 }] }));
  assert.deepEqual(tasks.map(t => t.id), ['inbox-a']);
});
test('completion time, not creation time, selects all projects within inclusive boundaries', async () => {
  const calls = [];
  const tasks = await getCompletedTasks(async (path, method, body) => {
    calls.push({ path, method, body });
    return [task('before', start - 1), task('start', start), task('work', start + 1), { ...task('inbox', end), projectId: 'inbox' }, task('after', end + 1)];
  }, start, end);
  assert.deepEqual(tasks.map(t => t.id), ['start', 'work', 'inbox']);
  assert.equal(calls[0].path, '/task/completed');
  assert.equal(calls[0].method, 'POST');
  assert.equal('projectIds' in calls[0].body, false);
});
test('more than 200 completed tasks split the time range and recover all results', async () => {
  const all = Array.from({ length: 451 }, (_, i) => task('t' + i, start + i * 5000));
  let count = 0;
  const tasks = await getCompletedTasks(async (_p, _m, b) => {
    count++;
    return all.filter(t => parseTime(t.completedTime) >= parseTime(b.startDate) && parseTime(t.completedTime) <= parseTime(b.endDate)).slice(-200);
  }, start, end);
  assert.equal(tasks.length, 451);
  assert.ok(count > 1);
});
test('cap at one timestamp aborts rather than silently advancing the cursor', async () => {
  await assert.rejects(getCompletedTasks(async () => Array.from({ length: 200 }, (_, i) => task('t' + i, start)), start, start + 1000), /200 条上限/);
});
test('first sync routes both kinds, deletes only inbox, advances empty/nonempty windows', async () => {
  const options = setup([task('done')], [inboxTask()]);
  const result = await syncAll(options);
  assert.deepEqual([result.inbox, result.completed, result.deleted], [1, 1, 1]);
  assert.equal(result.errors.length, 0);
  assert.match(options.writer.writes[0].key, /^completed:/);
  assert.match(options.writer.writes[1].key, /^inbox:/);
  assert.equal(options.writer.writes[0].markdown, `${formatTime(start + 1000)} done`);
  assert.equal(options.writer.writes[1].markdown, `${formatTime('2020-01-01T00:00:00Z')} inbox-a 保留正文`);
  assert.equal(options.requests.filter(r => r.method === 'DELETE').length, 1);
  assert.equal(options.config.completedSince, new Date(end).toISOString());
  const empty = setup();
  await syncAll(empty);
  assert.equal(empty.config.completedSince, new Date(end).toISOString());
});
test('write failure never deletes inbox or advances its checkpoint', async () => {
  const options = setup([], [inboxTask()]);
  options.writer.append = async () => { throw new Error('append failed'); };
  const result = await syncAll(options);
  assert.equal(options.requests.filter(r => r.method === 'DELETE').length, 0);
  assert.equal(options.config.lastInboxSync, '');
  assert.match(result.errors[0], /收集箱同步失败/);
});
test('completion fetch failure leaves checkpoint and still syncs inbox', async () => {
  const options = setup([], [inboxTask()]);
  const original = options.request;
  options.request = async (...args) => { if (args[0] === '/task/completed') throw new Error('unauthorized'); return original(...args); };
  const result = await syncAll(options);
  assert.equal(result.deleted, 1);
  assert.equal(options.config.completedSince, new Date(start).toISOString());
});
test('partial completed write retries without duplicating successful records', async () => {
  const options = setup([task('a'), task('b')]);
  const append = options.writer.append;
  options.writer.append = async (key, md) => { if (key.startsWith('completed:b:')) throw new Error('fail b'); await append(key, md); };
  await syncAll(options);
  assert.equal(options.config.completedSince, new Date(start).toISOString());
  options.writer.append = append;
  await syncAll(options);
  assert.equal(options.writer.writes.length, 2);
  assert.equal(options.config.completedSince, new Date(end).toISOString());
});
test('delete failure retries deletion without writing a duplicate inbox record', async () => {
  const options = setup([], [inboxTask()]);
  const original = options.request;
  let fail = true;
  options.request = async (...args) => { if (args[1] === 'DELETE' && fail) throw new Error('delete failed'); return original(...args); };
  assert.equal((await syncAll(options)).warnings.length, 1);
  fail = false;
  const result = await syncAll(options);
  assert.equal(options.writer.writes.length, 1);
  assert.equal(result.deleted, 1);
});
test('all inbox items are archived before deleting a parent', async () => {
  const options = setup([], [inboxTask('parent'), inboxTask('child')]);
  const original = options.request;
  options.request = async (...args) => { if (args[1] === 'DELETE') assert.equal(options.writer.writes.length, 2); return original(...args); };
  await syncAll(options);
});
test('partial inbox batch failure keeps all sources and retries only missing records', async () => {
  const options = setup([], [inboxTask('a'), inboxTask('b')]);
  const append = options.writer.append;
  options.writer.append = async (key, md) => { if (key.startsWith('inbox:b:')) throw new Error('fail b'); return append(key, md); };
  const failed = await syncAll(options);
  assert.equal(failed.deleted, 0);
  assert.equal(options.config.lastInboxSync, '');
  assert.equal(options.writer.writes.length, 1);
  options.writer.append = append;
  const retry = await syncAll(options);
  assert.equal(retry.deleted, 2);
  assert.equal(options.writer.writes.length, 2);
});
test('same completion at the checkpoint is deduplicated while a later recurrence is imported', async () => {
  const options = setup([task('recurring', end)]);
  await syncAll(options);
  const original = options.request;
  options.now = end + 5000;
  options.request = async (...args) => args[0] === '/task/completed' ? [task('recurring', end), task('recurring', end + 1000)] : original(...args);
  const result = await syncAll(options);
  assert.equal(result.completed, 1);
  assert.equal(options.writer.writes.length, 2);
  assert.equal(options.config.completedSince, new Date(end + 5000).toISOString());
});
test('an inbox task completed or edited during sync is preserved', async () => {
  for (const change of [{ status: 2 }, { title: 'changed' }, { projectId: 'other' }]) {
    const options = setup([], [inboxTask()]);
    const original = options.request;
    options.request = async (...args) => args[0].endsWith('/inbox-a') && !args[1] ? { ...inboxTask(), ...change } : original(...args);
    const result = await syncAll(options);
    assert.equal(result.deleted, 0);
    assert.equal(result.warnings.length, 1);
  }
});
test('recurring tasks use completion occurrence keys, separate from inbox identity', async () => {
  assert.notEqual(await entryKey(task('a', start), 'completed'), await entryKey(task('a', end), 'completed'));
  assert.notEqual(await entryKey(inboxTask(), 'inbox'), await entryKey({ ...inboxTask(), content: 'new text' }, 'inbox'));
});
test('checkpoint save failure restores completion start so no time window is lost', async () => {
  const options = setup();
  options.save = async () => { throw new Error('storage unavailable'); };
  const result = await syncAll(options);
  assert.equal(options.config.completedSince, new Date(start).toISOString());
  assert.equal(options.config.lastInboxSync, '');
  assert.equal(result.errors.length, 2);
});
test('malformed and missing-time responses do not turn into successful empty syncs', async () => {
  await assert.rejects(getInboxTasks(async () => '<html>login</html>'), /数据格式异常/);
  await assert.rejects(getCompletedTasks(async () => [{ id: 'a', status: 2 }], start, end), /缺少有效完成时间/);
});
test('render uses creation/completion time and exactly one plain body line per task', () => {
  const example = {
    ...task('任务标题', end), createdTime: new Date(start).toISOString(),
    content: '正文\n第二行', desc: '备注', items: [{ title: '子项\n续行', status: 1 }],
  };
  assert.equal(renderTask(example, 'inbox'), `${formatTime(start)} 任务标题 正文 第二行 备注 ☑ 子项 续行`);
  assert.equal(renderTask(example, 'completed'), `${formatTime(end)} 任务标题 正文 第二行 备注 ☑ 子项 续行`);
  assert.doesNotMatch(renderTask(example, 'completed'), /\n|^>|【|同步时间|所属清单|完成时间：/);
});
test('missing creation time is not substituted with modification or sync time', () => {
  assert.equal(renderTask({ id: 'a', title: '任务', modifiedTime: new Date(start).toISOString() }, 'inbox'), '时间未知 任务');
});
