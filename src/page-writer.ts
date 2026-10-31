import type { KernelCall } from "./api";
import { SECTION_TITLES, type EntryKind, type PageWriter } from "./sync";

const KEY_ATTR = "custom-dida-sync-key";
const KEY_PATTERN = /custom-dida-sync-key="([^"]+)"/g;
const SECTION_ATTR = "custom-dida-sync-section";

interface ChildBlock {
  id: string;
  type: string;
  content: string;
}

export class SiyuanPageWriter implements PageWriter {
  private keys = new Set<string>();
  private blocks: ChildBlock[] = [];
  private sections: Partial<Record<EntryKind, string>> = {};

  constructor(private readonly pageId: string, private readonly call: KernelCall) {}

  async load(): Promise<void> {
    const info = await this.call<{ rootID: string }>("/api/block/getBlockInfo", { id: this.pageId });
    if (info?.rootID !== this.pageId) throw new Error("指定文档 ID 必须指向一个思源文档，请复制文档块 ID");
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const [data, blocks] = await Promise.all([
      this.call<{ kramdown: string }>("/api/block/getBlockKramdown", { id: this.pageId }),
      this.call<ChildBlock[] | null>("/api/block/getChildBlocks", { id: this.pageId }),
    ]);
    if (typeof data?.kramdown !== "string") throw new Error("无法读取目标文档，停止写入");
    if (blocks !== null && !Array.isArray(blocks)) throw new Error("无法读取目标文档的段落结构，停止写入");
    this.blocks = blocks || [];
    this.keys = new Set([...data.kramdown.matchAll(KEY_PATTERN)].map(match => match[1]));
    this.sections = {};
    for (const match of data.kramdown.matchAll(/\{:[^\n}]*\}/g)) {
      const id = /\sid="([^"]+)"/.exec(match[0])?.[1];
      const kind = /custom-dida-sync-section="(inbox|completed)"/.exec(match[0])?.[1] as EntryKind | undefined;
      if (id && kind && this.blocks.some(block => block.id === id && block.type === "h")) this.sections[kind] = id;
    }
    for (const kind of ["inbox", "completed"] as const) {
      this.sections[kind] ||= this.blocks.find(block => block.type === "h" && block.content === SECTION_TITLES[kind])?.id;
    }
  }

  has(key: string): boolean { return this.keys.has(key); }

  private async ensureSections(): Promise<void> {
    // Always keep inbox above completed, even when completed tasks are fetched first.
    for (const kind of ["inbox", "completed"] as const) {
      if (this.sections[kind]) continue;
      const nextID = kind === "inbox" ? this.sections.completed : undefined;
      await this.call(nextID ? "/api/block/insertBlock" : "/api/block/appendBlock", {
        ...(nextID ? { nextID } : { parentID: this.pageId }),
        dataType: "markdown",
        data: `## ${SECTION_TITLES[kind]}\n{: ${SECTION_ATTR}="${kind}"}\n`,
      });
      await this.refresh();
      if (!this.sections[kind]) throw new Error(`无法确认「${SECTION_TITLES[kind]}」标题已写入，停止同步`);
    }
  }

  async append(key: string, markdown: string): Promise<void> {
    if (!/^(inbox|completed):[A-Za-z0-9%_.!~*'():-]+$/.test(key)) throw new Error("同步标识格式异常");
    if (this.has(key)) return;
    await this.ensureSections();
    const kind = key.startsWith("inbox:") ? "inbox" : "completed";
    const headingIndex = this.blocks.findIndex(block => block.id === this.sections[kind]);
    if (headingIndex < 0) throw new Error("同步分类标题不存在，停止写入");
    // Headings and body paragraphs are siblings in SiYuan. Insert before the next heading
    // so repeated syncs extend the right section without adding duplicate headings.
    const nextID = this.blocks.slice(headingIndex + 1).find(block => block.type === "h")?.id;
    // The record and its key are committed in the same append operation.
    // Retrying after a crash or a failed source deletion will read the key back from the page.
    await this.call(nextID ? "/api/block/insertBlock" : "/api/block/appendBlock", {
      ...(nextID ? { nextID } : { parentID: this.pageId }), dataType: "markdown",
      data: `${markdown}\n\n{: ${KEY_ATTR}="${key}"}\n`,
    });
    await this.refresh();
    if (!this.has(key)) {
      throw new Error("思源写入后未能读回同步标识，停止删除滴答原任务及推进该类同步时间；请检查目标页面");
    }
  }
}
