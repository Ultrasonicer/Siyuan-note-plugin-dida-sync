import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { entryKey, renderTask } from '../.test-build/sync.mjs';

if (!process.argv[2]) throw new Error('Usage: node scripts/verify-lute.mjs <path-to-SiYuan-lute.min.js> (run npm test first)');
createRequire(import.meta.url)(resolve(process.argv[2]));
const engine = globalThis.Lute.New();
engine.SetKramdownIAL(true);
engine.SetKramdownBlockIAL(true);
engine.SetTag(true);
const task = {
  id: 'roundtrip', projectId: 'work', status: 2, title: '任务标题',
  createdTime: '2026-10-30T09:00:00+0800',
  completedTime: '2026-10-31T08:00:00+0800', content: '正文\n第二行',
  items: [{ title: '子项', status: 1 }],
};
for (const kind of ['inbox', 'completed']) {
  const key = await entryKey(task, kind);
  const heading = kind === 'inbox' ? '滴答收集箱' : '最近已完成任务';
  const markdown = `## ${heading}\n{: custom-dida-sync-section="${kind}"}\n\n${renderTask(task, kind)}\n\n{: custom-dida-sync-key="${key}"}\n`;
  const dom = engine.Md2BlockDOM(markdown);
  const recovered = engine.BlockDOM2Md(dom);
  assert.ok(recovered.includes(`custom-dida-sync-key="${key}"`), 'Task key must survive Markdown → block DOM → Markdown');
  assert.ok(recovered.includes(heading));
  assert.ok(recovered.includes('子项'));
  assert.match(dom, /data-type="NodeParagraph"[^>]*custom-dida-sync-key=/, 'Key must belong to the ordinary task paragraph');
  assert.match(dom, /data-type="NodeHeading"[^>]*custom-dida-sync-section=/, 'Section marker must belong to the heading');
  assert.doesNotMatch(dom, /NodeBlockquote|NodeList/);
  console.log(`${kind}: SiYuan Lute round-trip passed (heading, ordinary paragraph, hidden key and single-line body)`);
}
