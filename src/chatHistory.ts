/**
 * Host 聊天历史落盘（Host 自建，架构归位·批次5 步1→步4）。
 *
 * 这是【Host 职责】的持久化编排（蓝图 §3.3）：Host 自己记"每轮谁说了什么"，
 * 不依赖 Core 的 RunLogger 内幕格式（那是调试用、字段随内幕演进）。够用即从简：
 * 一条对话 = 一个 .jsonl 文件，每行一条 {role, content, ts}，追加写、顺序读回。
 *
 * 步4 扩多对话：一条对话一个 jsonl（文件名含 conversationId）。会话册（列表/归档）是
 *   【Host 自己的持久数据】，不从 Core 掏——Core 的 conversations Map 只是活跃实例窗口缓存、
 *   故意不暴露枚举（蓝图 §3.3）。多对话（列表/新建/切换/续聊/归档）全在这一层文件系统编排。
 *
 * 归档 = 软移除：给 jsonl 加 `.archived` 后缀，数据不删、可恢复（对齐 testbench 的调性——
 *   "记住你"的产品不毁历史）。列表默认不列已归档；archive 只改后缀、内容原样留盘。
 *
 * UTF-8 护栏（testbench readJson 的教训）：读写全显式 utf-8，中文别乱码。
 * 读时对损坏行容错：跳过解析不了的行，不让一行坏数据毁掉整段历史。
 * 文件名安全：conversationId 只允许安全字符，其余 sanitize 掉，防路径穿越/非法文件名。
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export type HistoryImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export interface HistoryImageAttachment {
  kind: 'image';
  name: string;
  mime: HistoryImageMime;
  /** sessions/assets/<conversationId>/ 下的安全文件名，不是任意路径。 */
  assetId: string;
}
export interface HistoryFileAttachment { kind: 'file'; name: string; }
export type HistoryAttachment = HistoryImageAttachment | HistoryFileAttachment;

/** 一轮里的一条消息（用户或助手）。 */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  /** 记录时刻（ISO 字符串）。 */
  ts: string;
  /** 用户本轮附带的资源；旧历史没有该字段，保持兼容。 */
  attachments?: HistoryAttachment[];
}

/** 一条对话在列表里的摘要（供侧栏渲染）。 */
export interface SessionMeta {
  /** 对话标识（= jsonl 文件名去掉扩展名，已是安全字符）。 */
  id: string;
  /** 首轮用户话的预览（截断），空对话为空串。 */
  preview: string;
  /** 最后活跃时刻（文件 mtime，毫秒）。 */
  lastActiveMs: number;
  /** 是否已归档（.archived 后缀）。 */
  archived: boolean;
  /** 这段对话绑定的 Agent 工作区；旧会话可能暂时没有。 */
  workspace?: string;
}

export interface ChatHistory {
  /** 追加一条消息到指定对话历史（每轮 chat 存 user + assistant 两条）。 */
  append(conversationId: string, turn: HistoryTurn): void;
  /** 读回指定对话全部历史（按写入顺序；损坏行跳过）。空/不存在返回空列表。 */
  read(conversationId: string): HistoryTurn[];
  /** 列所有对话（默认只列未归档；archived:true 连归档一起列）。按最后活跃倒序。 */
  list(opts?: { includeArchived?: boolean }): SessionMeta[];
  /** 归档一条对话（jsonl 加 .archived 后缀，数据不删）。文件不在则静默略过。 */
  archive(conversationId: string): void;
  /** 生成一个新对话 id（时间戳 + 进程内递增序号，防同毫秒撞车；已是安全字符）。 */
  newId(): string;
  /** 读取会话绑定的工作区。旧会话/不存在时返回空字符串。 */
  getWorkspace(conversationId: string): string;
  /** 绑定（或重绑）会话工作区；会立即创建会话文件，因此空白新会话也能出现在侧栏。 */
  setWorkspace(conversationId: string, workspace: string): void;
  /** 把一张受支持的 data URL 图片落到会话资源目录，返回可写进 JSONL 的安全引用。 */
  saveImage(conversationId: string, image: { name: string; mime: string; dataUrl: string }): HistoryImageAttachment | null;
  /** 按安全引用读回图片；路径非法、文件缺失或内容签名不符都返回 null。 */
  readImage(conversationId: string, assetId: string): { mime: HistoryImageMime; data: Buffer } | null;
}

/** 与消息共存在同一 JSONL 的 Host 会话元数据。read() 会过滤它，旧文件完全兼容。 */
interface WorkspaceRecord {
  type: 'session_meta';
  workspace: string;
  ts: string;
}

/**
 * 把 conversationId 收敛成安全文件名片段：只留 [A-Za-z0-9._-]，其余替换成 '_'，避免
 *   路径穿越（'/'、'..'）与 Windows 非法文件名字符。空/全非法 → 'default'（兜底不产生空文件名）。
 */
function sanitizeId(id: string): string {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'default';
}

function isCanonicalConversationId(id: unknown): id is string {
  return typeof id === 'string'
    && id.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
    && sanitizeId(id) === id;
}

const IMAGE_EXT: Record<HistoryImageMime, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};
const EXT_MIME: Record<string, HistoryImageMime> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function cleanAttachmentName(name: unknown): string {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || '附件';
}

function validImageSignature(data: Buffer, mime: HistoryImageMime): boolean {
  if (mime === 'image/png') return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === 'image/gif') return data.length >= 6 && (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a');
  return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
}

function normalizeAttachments(value: unknown): HistoryAttachment[] {
  if (!Array.isArray(value)) return [];
  const normalized: HistoryAttachment[] = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = cleanAttachmentName(item.name);
    if (item.kind === 'file') {
      normalized.push({ kind: 'file', name });
      continue;
    }
    if (item.kind !== 'image' || typeof item.mime !== 'string' || typeof item.assetId !== 'string') continue;
    const mime = item.mime as HistoryImageMime;
    const ext = IMAGE_EXT[mime];
    if (!ext || !new RegExp(`^img-[A-Za-z0-9-]+\\.${ext}$`).test(item.assetId)) continue;
    normalized.push({ kind: 'image', name, mime, assetId: item.assetId });
  }
  return normalized;
}

/**
 * @param dir 会话文件目录（如 <库目录>/sessions）。
 */
export function createChatHistory(dir: string): ChatHistory {
  mkdirSync(dir, { recursive: true }); // 目录不存在则建，首启即可写
  let seq = 0; // 进程内递增序号，防同毫秒 newId 撞车
  const assetsRoot = join(dir, 'assets');

  const fileFor = (conversationId: string): string => join(dir, `${sanitizeId(conversationId)}.jsonl`);

  /** 读一个 jsonl 文件为轮列表（损坏行跳过）。文件不存在返回空。 */
  function readFile(file: string): HistoryTurn[] {
    if (!existsSync(file)) return [];
    const text = readFileSync(file, { encoding: 'utf-8' });
    const turns: HistoryTurn[] = [];
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const obj = JSON.parse(s) as HistoryTurn;
        // 轻校验：结构不对的行跳过（防坏数据毁整段）。
        if (obj && (obj.role === 'user' || obj.role === 'assistant') && typeof obj.content === 'string') {
          const attachments = normalizeAttachments(obj.attachments);
          turns.push({
            role: obj.role, content: obj.content, ts: typeof obj.ts === 'string' ? obj.ts : '',
            ...(attachments.length ? { attachments } : {}),
          });
        }
      } catch {
        /* 损坏行跳过，不中断整段历史读回 */
      }
    }
    return turns;
  }

  /** 最后一条工作区元数据生效；损坏/旧格式行照常跳过。 */
  function readWorkspace(file: string): string {
    if (!existsSync(file)) return '';
    const text = readFileSync(file, { encoding: 'utf-8' });
    let workspace = '';
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const obj = JSON.parse(s) as Partial<WorkspaceRecord>;
        if (obj?.type === 'session_meta' && typeof obj.workspace === 'string' && obj.workspace.trim()) {
          workspace = obj.workspace.trim();
        }
      } catch {
        /* 损坏行跳过 */
      }
    }
    return workspace;
  }

  /** 写入前若只剩归档文件，先恢复，避免同一 id 分叉成活跃/归档两份。 */
  function restoreBeforeWrite(active: string): void {
    const archived = active + '.archived';
    if (!existsSync(active) && existsSync(archived)) renameSync(archived, active);
  }

  return {
    append(conversationId, turn) {
      const active = fileFor(conversationId);
      // 不变量：同一 id 不能【活跃 + 归档】并存。此前归档过（只剩 .archived）、现在又要写入 →
      //   先把归档【恢复成活跃】（取消归档），续写在同一份历史上。这一招根治步4 审查两处：
      //   ① 别新建空活跃文件把归档历史遮蔽/分叉（open 已归档对话再聊，历史不隐身）；
      //   ② 之后再归档时 .archived 已被恢复走、renameSync 不会覆盖旧归档丢历史（must-fix）。
      restoreBeforeWrite(active);
      // 一行一条 JSON，末尾换行。显式 utf-8。
      const attachments = normalizeAttachments(turn.attachments);
      const cleanTurn: HistoryTurn = {
        role: turn.role, content: String(turn.content), ts: typeof turn.ts === 'string' ? turn.ts : '',
        ...(attachments.length ? { attachments } : {}),
      };
      appendFileSync(active, JSON.stringify(cleanTurn) + '\n', { encoding: 'utf-8' });
    },

    read(conversationId) {
      const active = fileFor(conversationId);
      // 活跃文件优先；不在（已归档）则回退读 .archived——让"归档=软移除、数据可恢复"名副其实：
      //   查看/恢复一条已归档对话时，read 仍能拿到它的历史，而非空。
      if (existsSync(active)) return readFile(active);
      return readFile(active + '.archived');
    },

    list(opts) {
      const includeArchived = opts?.includeArchived === true;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return []; // 目录还没建/读不到 → 空列表
      }
      const metas: SessionMeta[] = [];
      for (const name of names) {
        // 活跃文件 <id>.jsonl；归档文件 <id>.jsonl.archived。
        const archived = name.endsWith('.jsonl.archived');
        const active = name.endsWith('.jsonl');
        if (!archived && !active) continue;
        if (archived && !includeArchived) continue;
        const id = archived ? name.slice(0, -'.jsonl.archived'.length) : name.slice(0, -'.jsonl'.length);
        const full = join(dir, name);
        let lastActiveMs = 0;
        try {
          lastActiveMs = statSync(full).mtimeMs;
        } catch {
          continue; // 读不到状态的坏文件跳过
        }
        const turns = readFile(full);
        // 首轮用户话作预览（截断 40 字）；纯空对话预览为空串（但仍列出，供"刚新建还没聊"的对话可见）。
        const firstUser = turns.find((t) => t.role === 'user');
        const preview = firstUser ? firstUser.content.slice(0, 40) : '';
        const workspace = readWorkspace(full);
        metas.push({ id, preview, lastActiveMs, archived, ...(workspace ? { workspace } : {}) });
      }
      // 最后活跃倒序（新的在上）。
      metas.sort((a, b) => b.lastActiveMs - a.lastActiveMs);
      return metas;
    },

    archive(conversationId) {
      const file = fileFor(conversationId);
      try {
        renameSync(file, file + '.archived');
      } catch {
        /* 文件不在（从没聊过就归档）就算了，不报错 */
      }
    },

    newId() {
      // s-<毫秒>-<进程内序号>：时间戳保证跨进程大致有序、序号保证同毫秒不撞。已是安全字符。
      return `s-${Date.now()}-${seq++}`;
    },

    getWorkspace(conversationId) {
      const active = fileFor(conversationId);
      return readWorkspace(existsSync(active) ? active : active + '.archived');
    },

    setWorkspace(conversationId, workspace) {
      const value = String(workspace).trim();
      if (!value) return;
      const active = fileFor(conversationId);
      restoreBeforeWrite(active);
      const record: WorkspaceRecord = { type: 'session_meta', workspace: value, ts: new Date().toISOString() };
      appendFileSync(active, JSON.stringify(record) + '\n', { encoding: 'utf-8' });
    },

    saveImage(conversationId, image) {
      if (!isCanonicalConversationId(conversationId)) return null;
      const safeConversation = conversationId;
      const mime = String(image.mime ?? '').toLowerCase() as HistoryImageMime;
      const ext = IMAGE_EXT[mime];
      if (!ext || typeof image.dataUrl !== 'string') return null;
      const prefix = `data:${mime};base64,`;
      if (!image.dataUrl.startsWith(prefix)) return null;
      const encoded = image.dataUrl.slice(prefix.length);
      if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
      const data = Buffer.from(encoded, 'base64');
      if (!data.length || data.length > MAX_IMAGE_BYTES || !validImageSignature(data, mime)) return null;
      const assetId = `img-${randomUUID()}.${ext}`;
      const assetDir = join(assetsRoot, safeConversation);
      mkdirSync(assetDir, { recursive: true });
      writeFileSync(join(assetDir, assetId), data, { flag: 'wx' });
      return { kind: 'image', name: cleanAttachmentName(image.name), mime, assetId };
    },

    readImage(conversationId, assetId) {
      if (!isCanonicalConversationId(conversationId) || typeof assetId !== 'string') return null;
      const safeConversation = conversationId;
      const match = assetId.match(/^img-[A-Za-z0-9-]+\.(png|jpg|webp|gif)$/);
      if (!match) return null;
      const mime = EXT_MIME[match[1]];
      if (!mime) return null;
      const file = join(assetsRoot, safeConversation, assetId);
      try {
        const info = lstatSync(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) return null;
        const data = readFileSync(file);
        return validImageSignature(data, mime) ? { mime, data } : null;
      } catch {
        return null;
      }
    },
  };
}
