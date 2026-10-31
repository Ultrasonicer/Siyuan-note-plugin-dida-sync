# 验证记录

日期：2026-10-31。

- `npm run typecheck`：通过 TypeScript 严格类型检查。
- `npm test`：30 项行为测试通过，涵盖收集箱与已完成分类、时间边界、跨清单、200 条截断拆分、重复任务完成实例、空批次、部分写入失败、删除失败、重试去重、同步期间任务变更、游标保存失败、HTTP 鉴权/代理回退及思源写入确认。新增分类标题顺序、重复同步标题复用、对应区域插入、旧引用去重兼容和单行时间格式验证。
- `node scripts/verify-lute.mjs 'C:\Program Files\SiYuan\resources\stage\protyle\js\lute\lute.min.js'`：使用本机安装的思源 Lute 解析器验证两类记录 Markdown → 块 DOM → Markdown 往返。同步标识保留在普通正文段落上，分类标识保留在标题上；无引用块或列表块，正文及检查项合并到单行。
- `npm run build`：生成独立 `dist/` 与 `package.zip`；ZIP 条目可解压读取，包内有 `index.js`、`index.css`、`plugin.json`、图标、预览、两份说明、验证记录及许可共 9 个文件。
- 源代码和构建脚本不包含原服务 API、账号配置、Markdown 转换/签名依赖、旧开发目录或发布脚本。
- 原目录 `Siyuan-note-plugin-flomo-sync` 的 `git status --short` 为空，未修改原项目。

未安装到思源、未读取旧版插件 Token、未连接真实滴答账户、未创建/删除用户真实任务。模拟接口与解析器验证不能代替实际账户的端到端验证；首次使用请用少量任务确认。

本机沙箱限制使 Vite 配置打包读取父目录时报拒绝访问；经许可在沙箱外构建成功。项目构建目录始终位于本项目 `dist/`，不指向思源工作空间。
