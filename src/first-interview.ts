import { randomUUID } from 'node:crypto';

export const FIRST_INTERVIEW_TOTAL_STEPS = 3;

export type FirstInterviewStatus = 'new' | 'in_progress' | 'paused' | 'skipped' | 'completed';
export type FirstInterviewAction = 'start' | 'pause' | 'resume' | 'skip' | 'skip_step';

export interface FirstInterviewState {
  status: FirstInterviewStatus;
  step: number;
  conversationId: string | null;
  /** 一次完整三轮认识的标识；只用于幂等，不包含任何回答。 */
  runId: string | null;
  updatedAt: string;
}

export interface FirstInterviewStep {
  id: 'life' | 'goals' | 'preferences';
  question: { zh: string; en: string };
  guidance: { zh: string; en: string };
}

export const FIRST_INTERVIEW_STEPS: readonly FirstInterviewStep[] = [
  {
    id: 'life',
    question: {
      zh: '先从现在开始吧：你目前主要在忙什么，正处在怎样的生活或工作阶段？',
      en: 'Let’s start with right now: what are you mainly focused on, and what stage of life or work are you in?',
    },
    guidance: {
      zh: '这是首次认识的第 1 轮。简短、自然地接住用户关于当前生活或工作的回答，不要给用户下定义；然后只问下一轮：用户感兴趣的事，以及近期或长期想实现的目标。',
      en: 'This is round 1 of the first introduction. Briefly acknowledge what the user shared about their current life or work without defining them, then ask only the next question: what interests them and what near-term or long-term goals they want to pursue.',
    },
  },
  {
    id: 'goals',
    question: {
      zh: '你最近对什么感兴趣？有没有正在推进，或以后很想实现的目标？',
      en: 'What have you been interested in lately? Is there anything you’re working toward now or would really like to achieve later?',
    },
    guidance: {
      zh: '这是首次认识的第 2 轮。简短接住用户的兴趣与目标，不要夸大承诺；然后只问下一轮：用户偏好的做事、学习和沟通方式。可以顺带说明人格测试结果（如 MBTI）完全可选且只作参考。',
      en: 'This is round 2 of the first introduction. Briefly acknowledge the user’s interests and goals without overpromising, then ask only the next question: how they prefer to work, learn, and communicate. You may mention that personality-test results such as MBTI are entirely optional and only a reference.',
    },
  },
  {
    id: 'preferences',
    question: {
      zh: '最后，怎样一起做事、学习和沟通会让你更舒服？如果你愿意，也可以说说 MBTI 一类测试结果；它只作参考，不会定义你。',
      en: 'Finally, what ways of working, learning, and communicating feel best to you? If you want, you can also share an MBTI-style result; it is only a reference and does not define you.',
    },
    guidance: {
      zh: '这是首次认识的第 3 轮，也是最后一轮。简短接住用户的偏好；若用户提到 MBTI 或类似标签，只能把它当可变化的参考。明确告诉用户：这些只是初步印象，不是对用户的定义，之后可以随时修改或指正。不要再提新问题。',
      en: 'This is round 3 and the final round. Briefly acknowledge the user’s preferences. If they mention MBTI or a similar label, treat it only as a changeable reference. Clearly say these are early impressions, not a definition of the user, and they can edit or correct them at any time. Do not ask another question.',
    },
  },
] as const;

function validStep(value: unknown): number {
  return Number.isInteger(value) ? Math.max(0, Math.min(FIRST_INTERVIEW_TOTAL_STEPS - 1, Number(value))) : 0;
}

export function normalizeFirstInterviewState(value: unknown): FirstInterviewState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!['new', 'in_progress', 'paused', 'skipped', 'completed'].includes(String(raw.status))) return null;
  return {
    status: raw.status as FirstInterviewStatus,
    step: validStep(raw.step),
    conversationId: typeof raw.conversationId === 'string' && raw.conversationId ? raw.conversationId : null,
    runId: typeof raw.runId === 'string' && raw.runId.trim() ? raw.runId.trim() : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export function newFirstInterviewState(now = new Date().toISOString()): FirstInterviewState {
  return { status: 'new', step: 0, conversationId: null, runId: null, updatedAt: now };
}

function nextRunId(value?: string): string {
  const supplied = typeof value === 'string' ? value.trim() : '';
  return supplied || randomUUID();
}

/** 兼容旧版已进行/已暂停但没有 runId 的状态；只补幂等元数据，不改变进度和时间。 */
export function ensureFirstInterviewRunId(current: FirstInterviewState, runId?: string): FirstInterviewState {
  if (current.runId) return current;
  if (current.status !== 'in_progress' && current.status !== 'paused') {
    throw new Error('只有已开始的认识流程可以补运行标识');
  }
  return { ...current, runId: nextRunId(runId) };
}

export function transitionFirstInterview(
  current: FirstInterviewState,
  action: FirstInterviewAction,
  options: { conversationId?: string; now?: string } = {},
): FirstInterviewState {
  const now = options.now ?? new Date().toISOString();
  if (action === 'skip') return { ...current, status: 'skipped', updatedAt: now };

  if (action === 'start') {
    if (!options.conversationId) throw new Error('开始认识需要绑定当前对话');
    if (current.status !== 'new' && current.status !== 'skipped') throw new Error('当前状态不能重新开始认识');
    return { status: 'in_progress', step: 0, conversationId: options.conversationId, runId: nextRunId(), updatedAt: now };
  }
  if (action === 'pause') {
    if (current.status !== 'in_progress') throw new Error('只有进行中的认识可以暂停');
    return { ...current, status: 'paused', updatedAt: now };
  }
  if (action === 'resume') {
    if (current.status !== 'paused' || !current.conversationId) throw new Error('没有可继续的认识对话');
    return { ...current, status: 'in_progress', updatedAt: now };
  }
  if (action === 'skip_step') {
    if (current.status !== 'in_progress') throw new Error('只有进行中的认识可以跳过这一题');
    return advanceFirstInterview(current, now);
  }
  throw new Error('不支持的认识流程操作');
}

export function advanceFirstInterview(current: FirstInterviewState, now = new Date().toISOString()): FirstInterviewState {
  if (current.status !== 'in_progress') throw new Error('只有进行中的认识可以推进');
  if (current.step >= FIRST_INTERVIEW_TOTAL_STEPS - 1) {
    return { ...current, status: 'completed', step: FIRST_INTERVIEW_TOTAL_STEPS - 1, updatedAt: now };
  }
  return { ...current, step: current.step + 1, updatedAt: now };
}

export function firstInterviewStep(step: number): FirstInterviewStep {
  return FIRST_INTERVIEW_STEPS[validStep(step)];
}

export function firstInterviewCopy(step: number, lang: 'zh' | 'en'): { question: string; guidance: string } {
  const item = firstInterviewStep(step);
  return { question: item.question[lang], guidance: item.guidance[lang] };
}
