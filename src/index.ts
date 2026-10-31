import { Plugin, Dialog, getFrontend, openTab, openMobileFileById } from "siyuan";
import { kernel, createDidaRequest } from "./api";
import { SiyuanPageWriter } from "./page-writer";
import { defaultConfig, errorText, formatTime, normalizeToken, parseTime, syncAll, type SyncConfig } from "./sync";
import "./index.css";

const STORAGE_NAME = "dida-sync-config";
const ICON = '<svg viewBox="0 0 32 32"><path fill="currentColor" d="M12 24 3 15l3-3 6 6L26 4l3 3z"/><path fill="currentColor" d="M4 27h24v3H4z"/></svg>';

export default class DidaSync extends Plugin {
  private config: SyncConfig = defaultConfig();
  private syncing = false;
  private mobile = false;
  private topBar?: HTMLElement;

  async onload(): Promise<void> {
    const saved = await this.loadData(STORAGE_NAME) as Partial<SyncConfig> | null;
    this.config = { ...defaultConfig(), ...(saved || {}) };
    // Persist the first-run starting point even before the first successful sync.
    if (!saved) await this.saveConfig();
    this.mobile = ["mobile", "browser-mobile"].includes(getFrontend());
    this.topBar = this.addTopBar({
      icon: ICON, title: "滴答同步：收集箱 + 已完成任务", position: "right",
      callback: () => { void this.runSync(); },
    });
    this.addCommand({
      langKey: "syncDida", langText: "同步滴答收集箱与已完成任务",
      hotkey: "",
      callback: () => { void this.runSync(); },
    });
  }

  private async saveConfig(): Promise<void> {
    await this.saveData(STORAGE_NAME, { ...this.config });
  }

  private async notify(message: string, error = false): Promise<void> {
    await kernel(error ? "/api/notification/pushErrMsg" : "/api/notification/pushMsg", {
      msg: `滴答同步：${message}`, timeout: error ? 12000 : 7000,
    });
  }

  async runSync(): Promise<void> {
    if (this.syncing) return;
    if (!normalizeToken(this.config.token) || !/^\d{14}-[a-z0-9]{7}$/.test(this.config.pageId)) {
      await this.notify("请先在插件设置中填写滴答 API Token 和指定文档 ID", true);
      this.openSetting();
      return;
    }
    this.syncing = true;
    const startedAt = Date.now();
    this.topBar?.classList.add("dida-sync--running");
    try {
      const writer = new SiyuanPageWriter(this.config.pageId, kernel);
      await writer.load();
      const result = await syncAll({
        config: this.config, request: createDidaRequest(this.config.token), writer,
        save: () => this.saveConfig(), now: startedAt,
      });
      const summary = `新增收集箱 ${result.inbox} 条（删除原任务 ${result.deleted} 条），已完成 ${result.completed} 条`;
      const problems = [...result.errors, ...result.warnings];
      await this.notify([summary, ...problems].join("\n"), problems.length > 0);
      if (this.config.openAfterSync && (result.inbox > 0 || result.completed > 0)) {
        if (this.mobile) openMobileFileById(this.app, this.config.pageId);
        else openTab({ app: this.app, doc: { id: this.config.pageId } });
      }
    } catch (error) {
      await this.notify(errorText(error), true);
    } finally {
      this.syncing = false;
      this.topBar?.classList.remove("dida-sync--running");
    }
  }

  private settingRow(title: string, description: string, input: HTMLElement): HTMLElement {
    const row = document.createElement("label");
    row.className = "b3-label config__item dida-sync-setting__row";
    const caption = document.createElement("div");
    caption.textContent = title;
    const help = document.createElement("div");
    help.className = "b3-label__text";
    help.textContent = description;
    row.append(caption, help, input);
    return row;
  }

  openSetting(): void {
    const config = this.config;
    const token = document.createElement("input");
    token.type = "password";
    token.autocomplete = "off";
    token.className = "b3-text-field fn__block";
    token.value = config.token;
    const page = document.createElement("input");
    page.className = "b3-text-field fn__block";
    page.value = config.pageId;
    page.placeholder = "20261031120000-abcdefg";
    const since = document.createElement("input");
    since.className = "b3-text-field fn__block";
    // Preserve milliseconds and timezone when saving unrelated settings.
    since.value = config.completedSince;
    const initialSince = since.value;
    const open = document.createElement("input");
    open.type = "checkbox";
    open.className = "b3-switch";
    open.checked = config.openAfterSync;
    const dialog = new Dialog({
      title: "滴答同步设置", width: this.mobile ? "92vw" : "700px",
      content: '<div class="b3-dialog__content dida-sync-setting"></div><div class="b3-dialog__action"><button type="button" class="b3-button b3-button--cancel">取消</button><div class="fn__space"></div><button type="button" class="b3-button b3-button--text" data-action="save">保存</button></div>',
    });
    const content = dialog.element.querySelector(".dida-sync-setting")!;
    const status = document.createElement("p");
    status.className = "b3-label__text";
    status.textContent = `收集箱上次成功同步：${config.lastInboxSync ? formatTime(config.lastInboxSync) : "尚未同步"}；已完成任务起点：${formatTime(config.completedSince)}。收集箱成功写入并校验后删除原任务，已完成任务保留。`;
    content.append(
      this.settingRow("滴答 API Token", "滴答网页版 → 头像 → 设置 → 账号 → API Token。需要读、写任务权限；Token 仅保存在本插件配置中，请勿分享。", token),
      this.settingRow("指定思源文档 ID", "右击目标文档 → 复制 → 复制块 ID。按「滴答收集箱」「最近已完成任务」两个标题归类，每条一行：创建/完成时间加正文。", page),
      this.settingRow("已完成任务同步起点", "默认首次启用当天 00:00。支持 ISO 时间或本地 YYYY-MM-DD HH:mm:ss；成功后自动记录本轮开始时间。往前调整可补同步历史，已有标识的记录不会重复。", since),
      this.settingRow("有新内容时打开目标文档", "点击顶栏勾号或命令面板中的「同步滴答收集箱与已完成任务」执行同步。", open),
      status,
    );
    dialog.element.querySelector(".b3-button--cancel")!.addEventListener("click", () => dialog.destroy());
    const save = dialog.element.querySelector('[data-action="save"]') as HTMLButtonElement;
    save.addEventListener("click", async () => {
      if (this.syncing) { await this.notify("同步进行中，请结束后再保存设置", true); return; }
      const time = parseTime(since.value);
      if (!normalizeToken(token.value)) { await this.notify("请填写滴答 API Token", true); return; }
      if (!/^\d{14}-[a-z0-9]{7}$/.test(page.value.trim())) { await this.notify("请填写有效的思源文档块 ID", true); return; }
      if (!Number.isFinite(time) || time > Date.now()) { await this.notify("已完成任务起点必须是有效时间，且不能晚于当前时间", true); return; }
      save.disabled = true;
      const previous = this.config;
      this.config = {
        ...previous, token: normalizeToken(token.value), pageId: page.value.trim(),
        completedSince: since.value === initialSince ? previous.completedSince : new Date(time).toISOString(),
        openAfterSync: open.checked,
      };
      try {
        await this.saveConfig();
        dialog.destroy();
        await this.notify("设置已保存");
      } catch (error) {
        this.config = previous;
        save.disabled = false;
        await this.notify(`设置保存失败：${errorText(error)}`, true);
      }
    });
  }
}
