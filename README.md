# Dida sync for SiYuan

An independent Dida365-only SiYuan plugin. See [中文说明](README_zh_CN.md) for setup, recovery behavior and development instructions.

- Archive current uncompleted inbox tasks under the heading **滴答收集箱**. Each record is one ordinary paragraph: creation time, one space, task content. Delete the source only after a verified write and an unchanged-task check.
- Archive tasks completed across all accessible lists between the last successful checkpoint and this run's start under **最近已完成任务**. Each paragraph uses completion time and task content. Keep completed tasks in Dida365.
- Reuse the two headings across syncs, with the inbox above completed tasks. No blockquotes or per-record source/sync metadata. Existing records from the previous version retain their formatting and deduplication keys.
- Store deduplication keys in the destination document; retry partial writes and failed inbox deletions without duplicating unchanged records.
- Split completed-task date ranges when the official 200-task response cap is reached.

Configure a personal API token with read/write access, a destination document ID, and an optional initial completion-history date. Use the top-bar check icon or the sync command to run. This plugin does not install itself or import another plugin's credentials.

```sh
npm install
npm run typecheck
npm test
npm run build
```

The build writes `dist/` and `package.zip`. Install the contents of `dist/` under your SiYuan workspace's `data/plugins/Ultrasonicer-dida-sync/`. Disable the previous plugin's Dida sync to avoid concurrent inbox processing. Initial history starts at local midnight on first activation unless changed in settings.

Tests use mocked services. Validate with a small batch in your actual SiYuan/Dida365 setup before normal use. Tokens are stored in the plugin's local configuration, without encryption.

Based on the original project's MIT-licensed implementation. See `LICENSE`.
