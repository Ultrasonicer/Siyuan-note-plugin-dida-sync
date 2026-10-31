export interface DidaItem {
  id?: string;
  title?: string;
  status?: number;
}

export interface DidaTask {
  id: string;
  projectId?: string;
  title?: string;
  content?: string;
  desc?: string;
  status?: number;
  createdTime?: string;
  modifiedTime?: string;
  completedTime?: string;
  items?: DidaItem[];
}

export interface SyncConfig {
  token: string;
  pageId: string;
  completedSince: string;
  lastInboxSync: string;
  openAfterSync: boolean;
}

export type EntryKind = "inbox" | "completed";
export const SECTION_TITLES: Record<EntryKind, string> = {
  inbox: "滴答收集箱",
  completed: "最近已完成任务",
};
export type DidaRequest = (path: string, method?: string, body?: unknown) => Promise<unknown>;
export interface PageWriter {
  has(key: string): boolean;
  append(key: string, markdown: string): Promise<void>;
}

export interface SyncResult {
  inbox: number;
  completed: number;
  deleted: number;
  warnings: string[];
  errors: string[];
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function defaultConfig(now = new Date()): SyncConfig {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return { token: "", pageId: "", completedSince: midnight.toISOString(), lastInboxSync: "", openAfterSync: true };
}

export function normalizeToken(token: string): string {
  return token.trim().replace(/^bearer\s+/i, "").trim();
}

export function parseTime(value: string): number {
  if (!value || !value.trim()) return NaN;
  // Accept the original local-time setting and Dida's +0800 / +0000 date format.
  const normalized = value.trim().replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(normalized);
}

export function formatTime(value: string | number): string {
  const date = new Date(typeof value === "number" ? value : parseTime(value));
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function asTasks(data: unknown): DidaTask[] {
  const tasks = Array.isArray(data) ? data : (data as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks) || tasks.some(task => !task || typeof task.id !== "string" || !task.id)) {
    throw new Error("滴答返回的任务数据格式异常；本轮不更新同步时间");
  }
  return tasks;
}

export async function getInboxTasks(request: DidaRequest): Promise<DidaTask[]> {
  // Do not filter by creation time: a task created earlier may only just have moved into the inbox.
  const data = await request("/project/inbox/data");
  return asTasks(data).filter(task => task.status === undefined || task.status === 0);
}

export async function getCompletedTasks(request: DidaRequest, start: number, end: number): Promise<DidaTask[]> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error("已完成任务的起始时间无效或晚于本次同步时间");
  }
  const found = new Map<string, DidaTask>();
  async function readRange(from: number, to: number): Promise<void> {
    // Omit projectIds to cover all accessible lists, including the inbox.
    const tasks = asTasks(await request("/task/completed", "POST", {
      startDate: new Date(from).toISOString(),
      endDate: new Date(to).toISOString(),
    }));
    for (const task of tasks) {
      const time = parseTime(task.completedTime || "");
      if (!Number.isFinite(time)) throw new Error(`已完成任务 ${task.id} 缺少有效完成时间；本轮不更新同步时间`);
      if (time >= start && time <= end && (task.status === undefined || task.status === 2)) {
        found.set(`${task.id}:${time}`, task);
      }
    }
    // Official API caps each result at 200; it has no offset or cursor parameter.
    if (tasks.length >= 200) {
      if (to - from <= 1000) {
        throw new Error("同一秒内的已完成任务达到接口 200 条上限，无法确认是否取全；同步时间保持不变");
      }
      const mid = Math.floor((from + to) / 2);
      // Overlap the split boundary. Deduplication uses task ID + completion time.
      await readRange(from, mid);
      await readRange(mid, to);
    }
  }
  await readRange(start, end);
  return [...found.values()].sort((a, b) => parseTime(a.completedTime!) - parseTime(b.completedTime!) || a.id.localeCompare(b.id));
}

export function taskSnapshot(task: DidaTask): string {
  return JSON.stringify([task.title || "", task.content || "", task.desc || "", (task.items || []).map(item => [item.id || "", item.title || "", item.status ?? 0])]);
}

export async function entryKey(task: DidaTask, kind: EntryKind): Promise<string> {
  if (kind === "completed") return `completed:${encodeURIComponent(task.id)}:${parseTime(task.completedTime || "")}`;
  const bytes = new TextEncoder().encode(taskSnapshot(task));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
  return `inbox:${encodeURIComponent(task.id)}:${hex}`;
}

export function renderTask(task: DidaTask, kind: EntryKind): string {
  const flatten = (text: string) => text.replace(/\s+/g, " ").trim();
  const parts = [task.title || "", task.content || "", task.desc || ""].map(flatten).filter(Boolean);
  const content = [...new Set(parts)];
  for (const item of task.items || []) {
    const title = flatten(item.title || "");
    if (title) content.push(`${item.status === 1 || item.status === 2 ? "☑" : "☐"} ${title}`);
  }
  const time = kind === "completed" ? task.completedTime : task.createdTime;
  // Each task is a single ordinary paragraph. Its source is identified by the section heading.
  return `${formatTime(time || "")} ${content.join(" ") || "（无内容任务）"}`;
}

export async function syncAll(options: {
  config: SyncConfig;
  request: DidaRequest;
  writer: PageWriter;
  save: () => Promise<void>;
  now?: number;
}): Promise<SyncResult> {
  const { config, request, writer, save } = options;
  const end = options.now ?? Date.now();
  const result: SyncResult = { inbox: 0, completed: 0, deleted: 0, warnings: [], errors: [] };

  // The two streams have independent success tracking. One failing must not hide the other.
  try {
    const tasks = await getCompletedTasks(request, parseTime(config.completedSince), end);
    for (const task of tasks) {
      const key = await entryKey(task, "completed");
      if (!writer.has(key)) {
        await writer.append(key, renderTask(task, "completed"));
        result.completed++;
      }
    }
    const previous = config.completedSince;
    config.completedSince = new Date(end).toISOString();
    try { await save(); } catch (error) { config.completedSince = previous; throw error; }
  } catch (error) {
    result.errors.push(`已完成任务同步失败：${errorText(error)}`);
  }

  try {
    const tasks = await getInboxTasks(request);
    for (const task of tasks) {
      const key = await entryKey(task, "inbox");
      if (!writer.has(key)) {
        await writer.append(key, renderTask(task, "inbox"));
        result.inbox++;
      }
    }
    // Archive every task before deleting any parent: deleting a parent can also remove its children.
    for (const task of tasks) {
      try {
        const project = task.projectId || "inbox";
        const path = `/project/${encodeURIComponent(project)}/task/${encodeURIComponent(task.id)}`;
        // Do not delete a task that was edited, moved or completed while the sync was running.
        const current = await request(path) as DidaTask;
        if (!current || current.id !== task.id) throw new Error("删除前校验任务失败");
        if ((current.status !== undefined && current.status !== 0) ||
            (task.projectId && current.projectId && current.projectId !== task.projectId) ||
            taskSnapshot(current) !== taskSnapshot(task)) {
          result.warnings.push(`「${task.title || task.id}」已写入思源，但滴答任务发生变化，保留原任务`);
          continue;
        }
        await request(path, "DELETE");
        result.deleted++;
      } catch (error) {
        result.warnings.push(`「${task.title || task.id}」已写入思源，删除原任务失败，下次重试：${errorText(error)}`);
      }
    }
    const previous = config.lastInboxSync;
    config.lastInboxSync = new Date(end).toISOString();
    try { await save(); } catch (error) { config.lastInboxSync = previous; throw error; }
  } catch (error) {
    result.errors.push(`收集箱同步失败：${errorText(error)}`);
  }
  return result;
}
