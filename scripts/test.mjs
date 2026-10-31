import { build } from 'vite';
import { spawnSync } from 'node:child_process';

await build({
  configFile: false,
  build: {
    outDir: '.test-build', emptyOutDir: true, minify: false,
    lib: { entry: 'src/sync.ts', formats: ['es'], fileName: () => 'sync.mjs' },
  },
});
await build({
  configFile: false,
  build: {
    outDir: '.test-build', emptyOutDir: false, minify: false,
    lib: { entry: 'src/page-writer.ts', formats: ['es'], fileName: () => 'page-writer.mjs' },
  },
});
// Alias only the host SDK. Exercise the real API transport against a fake host call.
await build({
  configFile: false,
  resolve: { alias: { siyuan: new URL('../tests/siyuan-stub.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1') } },
  build: {
    outDir: '.test-build', emptyOutDir: false, minify: false,
    lib: { entry: 'src/api.ts', formats: ['es'], fileName: () => 'api.mjs' },
  },
});
const result = spawnSync(process.execPath, ['--test', 'tests/sync.test.mjs', 'tests/page-writer.test.mjs', 'tests/api.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
