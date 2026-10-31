import test from 'node:test';
import assert from 'node:assert/strict';
import { SiyuanPageWriter } from '../.test-build/page-writer.mjs';

function host(initialBlocks = []) {
  const state = { blocks: [...initialBlocks], writes: 0, loseAttribute: false, fail: false };
  let nextId = initialBlocks.length;
  const call = async (path, body) => {
    if (path.endsWith('getBlockInfo')) return { rootID: body.id };
    if (path.endsWith('getBlockKramdown')) return { kramdown: state.blocks.map(b => b.markdown).join('\n\n') };
    if (path.endsWith('getChildBlocks')) return state.blocks.map(({ id, type, content }) => ({ id, type, content }));
    if (path.endsWith('appendBlock') || path.endsWith('insertBlock')) {
      if (state.fail) throw new Error('kernel write failed');
      if (body.data.includes('custom-dida-sync-key=')) state.writes++;
      const id = `block-${++nextId}`;
      const heading = /^## (.+)/.exec(body.data);
      const block = {
        id, type: heading ? 'h' : 'p', content: heading ? heading[1] : body.data.split('\n')[0],
        markdown: state.loseAttribute ? body.data.split('\n')[0] : body.data.replace('{: ', `{: id="${id}" `),
      };
      if (body.nextID) {
        const index = state.blocks.findIndex(b => b.id === body.nextID);
        assert.notEqual(index, -1, 'Insertion target must exist');
        state.blocks.splice(index, 0, block);
      } else state.blocks.push(block);
      return [];
    }
    throw new Error('unexpected call ' + path);
  };
  return { state, call };
}
test('persistent paragraph marker prevents duplicates after a plugin restart', async () => {
  const { state, call } = host();
  const writer = new SiyuanPageWriter('doc', call);
  await writer.load();
  await writer.append('completed:a:123', '2026-10-31 08:00:00 record');
  const restarted = new SiyuanPageWriter('doc', call);
  await restarted.load();
  assert.equal(restarted.has('completed:a:123'), true);
  await restarted.append('completed:a:123', '2026-10-31 08:00:00 record');
  assert.equal(state.writes, 1);
});
test('failed append or absent round-trip marker must not report write success', async () => {
  const { state, call } = host();
  const writer = new SiyuanPageWriter('doc', call);
  await writer.load();
  state.fail = true;
  await assert.rejects(writer.append('completed:a:1', 'record'), /write failed/);
  state.fail = false;
  state.loseAttribute = true;
  await assert.rejects(writer.append('completed:a:1', 'record'), /未能读回同步标识/);
  assert.equal(writer.has('completed:a:1'), false);
});
test('invalid target block stops before any write', async () => {
  const writer = new SiyuanPageWriter('block', async () => ({ rootID: 'doc' }));
  await assert.rejects(writer.load(), /必须指向一个思源文档/);
});
test('completed-first fetch and repeated syncs keep inbox first and append each row under its heading', async () => {
  const { state, call } = host();
  const writer = new SiyuanPageWriter('doc', call);
  await writer.load();
  await writer.append('completed:a:1', '2026-10-31 09:00:00 完成 A');
  await writer.append('inbox:b:abc', '2026-10-31 08:00:00 收集 B');
  const restarted = new SiyuanPageWriter('doc', call);
  await restarted.load();
  await restarted.append('completed:c:2', '2026-10-31 10:00:00 完成 C');
  await restarted.append('inbox:d:def', '2026-10-31 08:30:00 收集 D');
  assert.deepEqual(state.blocks.map(b => b.content), [
    '滴答收集箱', '2026-10-31 08:00:00 收集 B', '2026-10-31 08:30:00 收集 D',
    '最近已完成任务', '2026-10-31 09:00:00 完成 A', '2026-10-31 10:00:00 完成 C',
  ]);
  assert.deepEqual(state.blocks.map(b => b.type), ['h', 'p', 'p', 'h', 'p', 'p']);
});
test('existing headings are reused and unrelated following sections retain their own content', async () => {
  const heading = (id, content) => ({ id, content, type: 'h', markdown: `## ${content}\n{: id="${id}"}` });
  const { state, call } = host([heading('inbox', '滴答收集箱'), heading('done', '最近已完成任务'), heading('notes', '其他笔记')]);
  const writer = new SiyuanPageWriter('doc', call);
  await writer.load();
  await writer.append('completed:a:1', '完成 A');
  await writer.append('inbox:b:abc', '收集 B');
  assert.deepEqual(state.blocks.map(b => b.content), ['滴答收集箱', '收集 B', '最近已完成任务', '完成 A', '其他笔记']);
});
test('interrupted heading setup creates the missing inbox title above completed', async () => {
  const { state, call } = host([{ id: 'done', content: '最近已完成任务', type: 'h', markdown: '## 最近已完成任务\n{: id="done"}' }]);
  const writer = new SiyuanPageWriter('doc', call);
  await writer.load();
  await writer.append('inbox:b:abc', '收集 B');
  assert.deepEqual(state.blocks.map(b => b.content), ['滴答收集箱', '收集 B', '最近已完成任务']);
});
test('existing quote keys are still recognized after the formatting update', async () => {
  const { state, call } = host([{ id: 'old', type: 'b', content: 'old', markdown: '> old task\n\n{: id="old" custom-dida-sync-key="completed:a:123"}' }]);
  const writer = new SiyuanPageWriter('doc', call);
  await writer.load();
  await writer.append('completed:a:123', 'record');
  assert.equal(state.writes, 0);
  assert.equal(state.blocks.length, 1);
});
