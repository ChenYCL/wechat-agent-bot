/**
 * /task skill — create, list, and manage user tasks from inside WeChat.
 *
 *   /task new <natural language>   create a task (LLM parses your intent)
 *   /task list                     list your tasks
 *   /task show <id>                show details
 *   /task delete <id>              delete
 *   /task pause <id>               disable without deleting
 *   /task resume <id>              re-enable
 *   /task run <id>                 trigger now (for testing)
 *
 * Task IDs are shown as short prefixes (8 chars). The skill resolves a
 * prefix back to the full UUID for convenience.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderAccess } from '../provider-access.js';
import type { UserTaskManager } from '../../tasks/manager.js';
import type { MemoryManager } from './memory.js';
import { getLangPreference } from './lang.js';
import { parseTaskFromText } from '../../tasks/parser.js';
import type { UserTask } from '../../tasks/types.js';
import { logger } from '../../utils/logger.js';

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export interface TaskSkillDeps {
  manager: UserTaskManager;
  providers: ProviderAccess;
  memory?: MemoryManager;
}

export function createTaskSkill(deps: TaskSkillDeps): Skill {
  return {
    name: 'task',
    description: 'Create/manage reminders. Usage: /task new <natural language> | list | show/delete/pause/resume/run <id>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = (request.text ?? '').trim();
      if (!text) return { text: usage() };

      const [head, ...rest] = text.split(/\s+/);
      const arg = rest.join(' ').trim();

      switch (head.toLowerCase()) {
        case 'new':
        case 'add':
        case 'create':
          return await handleNew(arg, request.conversationId, deps);
        case 'list':
        case 'ls':
          return handleList(request.conversationId, deps);
        case 'show':
        case 'get':
          return handleShow(arg, request.conversationId, deps);
        case 'delete':
        case 'remove':
        case 'rm':
          return handleDelete(arg, request.conversationId, deps);
        case 'pause':
        case 'disable':
          return handleEnable(arg, false, request.conversationId, deps);
        case 'resume':
        case 'enable':
          return handleEnable(arg, true, request.conversationId, deps);
        case 'run':
        case 'trigger':
          return handleRun(arg, request.conversationId, deps);
        case 'pause-all':
        case 'pauseall':
          return { text: `⏸️ 已暂停 ${deps.manager.pauseAll(request.conversationId)} 个任务` };
        case 'resume-all':
        case 'resumeall':
          return { text: `▶️ 已恢复 ${deps.manager.resumeAll(request.conversationId)} 个任务` };
        case 'delete-all':
        case 'deleteall':
        case 'clear':
          return { text: `🗑️ 已删除 ${deps.manager.deleteAll(request.conversationId)} 个任务` };
        case 'history':
        case 'log':
          return handleHistory(arg, request.conversationId, deps);
        case 'message':
        case 'msg':
          return handleMessage(arg, request.conversationId, deps);
        case 'edit':
        case 'update':
          return await handleEdit(arg, request.conversationId, deps);
        default:
          // Treat the whole thing as a NL request (e.g. "/task 茅台跌破1500提醒我")
          return await handleNew(text, request.conversationId, deps);
      }
    },
  };
}

async function handleNew(input: string, conversationId: string, deps: TaskSkillDeps): Promise<ChatResponse> {
  if (!input) return { text: '用法：/task new <自然语言>\n例如：/task new 每天早上 8 点提醒我喝水' };

  const lang = deps.memory ? await getLangPreference(deps.memory, conversationId) : null;
  const result = await parseTaskFromText(input, {
    providers: deps.providers,
    ownerConversationId: conversationId,
    language: lang,
  });

  if (!result.ok || !result.draft) {
    return { text: `⚠️ 无法解析为任务：${result.error}\n\n💡 试试更具体一点，例如：\n• 每天早上 8 点提醒我喝水\n• 茅台股价跌破 1500 提醒我\n• 明天下午 3 点提醒我开会` };
  }

  try {
    const task = deps.manager.create(result.draft);
    return { text: renderCreatedSummary(task) };
  } catch (err) {
    logger.warn(`[/task new] create failed: ${(err as Error).message}`);
    return { text: `⚠️ 任务创建失败：${(err as Error).message}` };
  }
}

function handleList(conversationId: string, deps: TaskSkillDeps): ChatResponse {
  const tasks = deps.manager.list(conversationId);
  if (tasks.length === 0) {
    return { text: '📭 你还没有任务\n\n💡 试试 /task new 每天早上 8 点提醒我喝水' };
  }
  const lines = tasks.map((t) => renderListLine(t));
  return { text: `📋 你的任务 (${tasks.length})\n━━━━━━━━━━\n${lines.join('\n\n')}\n\n💡 /task show <id> 查看详情` };
}

function handleShow(idArg: string, conversationId: string, deps: TaskSkillDeps): ChatResponse {
  if (!idArg) return { text: '用法：/task show <id>' };
  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };
  return { text: renderDetail(task) };
}

function handleDelete(idArg: string, conversationId: string, deps: TaskSkillDeps): ChatResponse {
  if (!idArg) return { text: '用法：/task delete <id>' };
  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };
  deps.manager.delete(task.id, conversationId);
  return { text: `🗑️ 已删除：${task.description}` };
}

function handleEnable(idArg: string, enable: boolean, conversationId: string, deps: TaskSkillDeps): ChatResponse {
  if (!idArg) return { text: `用法：/task ${enable ? 'resume' : 'pause'} <id>` };
  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };
  const updated = deps.manager.setEnabled(task.id, enable, conversationId);
  if (!updated) return { text: '⚠️ 操作失败' };
  return { text: `${enable ? '▶️ 已恢复' : '⏸️ 已暂停'}：${updated.description}` };
}

async function handleRun(idArg: string, conversationId: string, deps: TaskSkillDeps): Promise<ChatResponse> {
  if (!idArg) return { text: '用法：/task run <id>' };
  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };
  try {
    await deps.manager.runNow(task.id);
    return { text: `▶️ 已触发：${task.description}\n(消息会在你下一条消息后送达，或立即送达 if direct send is wired)` };
  } catch (err) {
    return { text: `⚠️ 触发失败：${(err as Error).message}` };
  }
}

function resolveTask(idArg: string, conversationId: string, deps: TaskSkillDeps): UserTask | null {
  // Exact match first
  const exact = deps.manager.get(idArg);
  if (exact && exact.ownerConversationId === conversationId) return exact;
  // Prefix match within the owner's tasks
  const all = deps.manager.list(conversationId);
  const matches = all.filter((t) => t.id.startsWith(idArg));
  if (matches.length === 1) return matches[0];
  return null;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function renderListLine(t: UserTask): string {
  const status = t.enabled ? '✅' : '⏸️';
  const kind = t.type === 'reminder' ? '⏰' : '👁️';
  const next = renderNextHint(t);
  return `${status} ${kind} [${shortId(t.id)}] ${t.description}${next ? `\n   ${next}` : ''}`;
}

function renderNextHint(t: UserTask): string {
  if (t.type === 'reminder' && t.schedule) {
    if (t.schedule.kind === 'once' && t.schedule.runAt) {
      return `at ${new Date(t.schedule.runAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    }
    if (t.schedule.kind === 'cron' && t.schedule.cron) {
      return `cron ${t.schedule.cron}`;
    }
  }
  if (t.type === 'watch' && t.watch) {
    return `poll ${t.watch.pollCron} → ${t.watch.condition.op}${t.watch.condition.value ?? ''}`;
  }
  return '';
}

function renderCreatedSummary(t: UserTask): string {
  const lines = [
    `✅ 已创建任务 [${shortId(t.id)}]`,
    '━━━━━━━━━━',
    `📝 ${t.description}`,
    renderNextHint(t) ? `🕘 ${renderNextHint(t)}` : '',
    `💬 触发时：${t.message}`,
    '',
    `💡 /task list 查看 · /task delete ${shortId(t.id)} 删除`,
  ].filter(Boolean);
  return lines.join('\n');
}

function renderDetail(t: UserTask): string {
  const lines = [
    `📋 任务详情 [${shortId(t.id)}]`,
    '━━━━━━━━━━',
    `📝 ${t.description}`,
    `状态: ${t.enabled ? '✅ 启用' : '⏸️ 已暂停'}`,
    `类型: ${t.type === 'reminder' ? '⏰ 提醒' : '👁️ 监控'}`,
    renderNextHint(t) ? `调度: ${renderNextHint(t)}` : '',
  ];
  if (t.type === 'watch' && t.watch) {
    lines.push(`URL: ${t.watch.fetcher.url}`);
    if (t.watch.fetcher.jsonPath) lines.push(`jsonPath: ${t.watch.fetcher.jsonPath}`);
    if (t.watch.condition.value !== undefined) {
      lines.push(`条件: 值 ${t.watch.condition.op} ${t.watch.condition.value}`);
    } else {
      lines.push(`条件: ${t.watch.condition.op}`);
    }
    if (t.lastSeenValue !== null) lines.push(`最近观察值: ${t.lastSeenValue}`);
  }
  lines.push(`💬 触发消息: ${t.message}`);
  if (t.lastTriggeredAt) {
    lines.push(`上次触发: ${new Date(t.lastTriggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (共 ${t.triggerCount} 次)`);
  } else {
    lines.push(`尚未触发`);
  }
  return lines.filter(Boolean).join('\n');
}

function usage(): string {
  return [
    '━━ /task 用法 ━━',
    '',
    '基础：',
    '  /task new <自然语言>     创建（AI 解析）',
    '  /task list               列出你的任务',
    '  /task show <id>          详情',
    '  /task delete <id>        删除',
    '  /task pause/resume <id>  暂停/恢复',
    '  /task run <id>           立即触发',
    '',
    '编辑：',
    '  /task message <id> <新文案>',
    '  /task edit <id> <自然语言>   AI 修改（保留 type）',
    '',
    '批量：',
    '  /task pause-all          暂停全部',
    '  /task resume-all         恢复全部',
    '  /task delete-all         删除全部',
    '',
    '观察历史（仅 watch）：',
    '  /task history <id>       查看最近观察值',
    '',
    '示例：',
    '/task new 每天早上 8 点提醒我喝水',
    '/task new 茅台股价跌破 1500 提醒我',
    '/task edit abc123 改成每天 9 点',
  ].join('\n');
}

function handleHistory(idArg: string, conversationId: string, deps: TaskSkillDeps): ChatResponse {
  if (!idArg) return { text: '用法：/task history <id>' };
  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };
  if (task.type !== 'watch') return { text: 'ℹ️ 只有 watch 类型才有观察历史' };

  const obs = deps.manager.observations(task.id, 20);
  if (obs.length === 0) return { text: '📭 暂无观察记录（还没有轮询过）' };

  const lines = obs.map((o) => {
    const mark = o.matched ? '🎯' : '·';
    return `${mark} ${fmtTime(o.observedAt)}  ${o.value ?? '(fetch failed)'}`;
  });
  return {
    text: [
      `📈 观察历史 [${shortId(task.id)}] (最近 ${obs.length} 条)`,
      '━━━━━━━━━━',
      ...lines,
    ].join('\n'),
  };
}

function handleMessage(arg: string, conversationId: string, deps: TaskSkillDeps): ChatResponse {
  const space = arg.indexOf(' ');
  if (space < 0) return { text: '用法：/task message <id> <新文案>' };
  const idArg = arg.slice(0, space);
  const newMsg = arg.slice(space + 1).trim();
  if (!newMsg) return { text: '⚠️ 新文案不能为空' };

  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };

  try {
    const updated = deps.manager.updateMessage(task.id, newMsg, conversationId);
    if (!updated) return { text: '⚠️ 修改失败' };
    return { text: `✏️ 已更新触发文案 [${shortId(task.id)}]\n${updated.message}` };
  } catch (err) {
    return { text: `⚠️ ${(err as Error).message}` };
  }
}

async function handleEdit(arg: string, conversationId: string, deps: TaskSkillDeps): Promise<ChatResponse> {
  const space = arg.indexOf(' ');
  if (space < 0) return { text: '用法：/task edit <id> <自然语言>' };
  const idArg = arg.slice(0, space);
  const instruction = arg.slice(space + 1).trim();
  if (!instruction) return { text: '⚠️ 请告诉我怎么改' };

  const task = resolveTask(idArg, conversationId, deps);
  if (!task) return { text: `⚠️ 找不到任务: ${idArg}` };

  const lang = deps.memory ? await getLangPreference(deps.memory, conversationId) : null;
  // Pose the edit to the parser as: "here is the current task, please apply this change".
  // We use the existing parser by prefixing the instruction with task context so the
  // LLM regenerates a complete spec; we then enforce type-preservation on apply.
  const augmented = [
    `Current task (${task.type}):`,
    `  description: ${task.description}`,
    `  message: ${task.message}`,
    task.type === 'reminder' && task.schedule
      ? `  schedule: ${JSON.stringify(task.schedule)}`
      : '',
    task.type === 'watch' && task.watch
      ? `  watch: ${JSON.stringify(task.watch)}`
      : '',
    '',
    'Apply this edit (keep the task type the same):',
    instruction,
  ].filter(Boolean).join('\n');

  const result = await parseTaskFromText(augmented, {
    providers: deps.providers,
    ownerConversationId: conversationId,
    language: lang,
  });
  if (!result.ok || !result.draft) {
    return { text: `⚠️ 无法应用修改：${result.error}` };
  }
  if (result.draft.type !== task.type) {
    return { text: `⚠️ 编辑无法跨任务类型（原为 ${task.type}，AI 输出 ${result.draft.type}）。请用 /task delete + /task new` };
  }

  try {
    const updated = deps.manager.applyEdit(task.id, {
      description: result.draft.description,
      message: result.draft.message,
      schedule: result.draft.schedule,
      watch: result.draft.watch,
    }, conversationId);
    if (!updated) return { text: '⚠️ 修改失败' };
    return { text: `✏️ 已更新 [${shortId(task.id)}]\n${renderDetail(updated)}` };
  } catch (err) {
    logger.warn(`[/task edit] apply failed: ${(err as Error).message}`);
    return { text: `⚠️ ${(err as Error).message}` };
  }
}
