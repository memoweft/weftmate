import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { installConversationReasoning } from './personal-reasoning.mjs';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { selectProjectContext, inheritProjectContext, routeProjectTool, installProjectSandbox, projectToolDecision, projectContextNotice, executionDirectory } from './personal-project-context.mjs';
import { trackNativeFiles, appendNativeArtifacts, conversationCreatedFiles } from './personal-native-files.mjs';
import { personalWebFetchProvider } from './personal-web-fetch.mjs';
import { durableSourceRange } from '../runtime/dsh-adapter/source-range.mjs';
import PlanModeController, { foldPlanMode } from '@deepseek-ai/dsh-plan-mode';
import { approvalRequired, approvalPrompt, classifyPersonalRisk, RISK_LABELS } from './personal-approval-policy.mjs';

export const name = 'weftmate-personal-desktop';
export const PERSONAL_DESKTOP_PROTOCOL = 'weftmate.personal-desktop.v1';
// Names retained only to verify previously persisted project/browser evidence.
const LEGACY_DOCUMENT_TOOL = 'personal_save_document';
const LEGACY_PROJECT_READ_TOOL = 'personal_read_project_file';
const LEGACY_BROWSER_OPEN_TOOL = 'personal_browser_open';
const LEGACY_BROWSER_FOLLOW_TOOL = 'personal_browser_follow';
const LEGACY_BROWSER_SEGMENT_TOOL = 'personal_browser_read_segment';
const NATIVE_SESSION_TOOLS = new Set(['get_goal', 'create_goal', 'update_goal', 'ask_user_question',
  'schedule_create', 'schedule_list', 'schedule_delete', 'schedule_manage', 'load_tools']);
const executionToolName = name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(name);
export const PERSONAL_PROJECT_PROOF_PROTOCOL = 'weftmate.personal-project-proof.v1';
export const inject = ['tools', 'web', 'approval'];
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_TOOL_ERRORS = new Set(['PERSONAL_TOOL_UNAVAILABLE', 'PERSONAL_TOOL_TIMEOUT',
  'PERSONAL_TOOL_CANCELLED', 'SESSION_READ_ONLY', 'TOOL_SOURCE_UNAVAILABLE',
  'TOOL_INTENT_UNCONFIRMED', 'CAPABILITY_UNAVAILABLE', 'STORAGE_UNAVAILABLE',
  'TASK_NOT_READY',
  'DEVICE_REVOKED', 'SESSION_REPLACED', 'SESSION_EXPIRED', 'INVALID_COMMAND',
  'REQUEST_CONFLICT', 'CAPACITY_LIMIT', 'BACKEND_UNAVAILABLE', 'SERVICE_CLOSING',
  'PROJECT_UNAVAILABLE', 'PROJECT_REVOKED', 'PROJECT_FILE_NOT_FOUND',
  'PROJECT_FILE_CHANGED', 'PROJECT_LIMIT_REACHED', 'PROJECT_MODEL_MISMATCH',
  'PROJECT_MODEL_CHANGED', 'PROJECT_READ_INVALID', 'PROJECT_SOURCE_UNVERIFIED',
  'PROJECT_ROOT_CHANGED', 'PROJECT_UNSAFE_PATH', 'PROJECT_INVALID_UTF8',
  'PROJECT_FILE_UNAVAILABLE', 'PROJECT_READER_TIMEOUT', 'PROJECT_LINE_OUT_OF_RANGE',
  'PROJECT_LINE_TOO_LONG', 'PROJECT_READER_INVALID', 'BROWSER_UNAVAILABLE',
  'BROWSER_BUSY', 'BROWSER_CANCELLED', 'BROWSER_EMPTY_PAGE', 'BROWSER_HTTP_ERROR',
  'BROWSER_LOGIN_REQUIRED', 'BROWSER_NETWORK_ERROR', 'BROWSER_NETWORK_LIMIT',
  'BROWSER_RENDERER_FAILED', 'BROWSER_TARGET_BLOCKED', 'BROWSER_URL_INVALID',
  'BROWSER_LINK_UNAVAILABLE', 'BROWSER_SOURCE_UNVERIFIED', 'BROWSER_DNS_TIMEOUT',
  'BROWSER_DOWNGRADE_BLOCKED', 'BROWSER_PAGE_CHANGED', 'BROWSER_CLEANUP_FAILED']);
const READ_TOOLS = new Set([LEGACY_PROJECT_READ_TOOL, LEGACY_BROWSER_OPEN_TOOL,
  LEGACY_BROWSER_FOLLOW_TOOL, LEGACY_BROWSER_SEGMENT_TOOL]);

function refused(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Nested script calls inherit only their real root tool call and original user receipt. */
export function personalExecutionIdentity(exec) {
  const session = exec?.agent?.session;
  const rootCallId = exec.rootCallId ?? exec.callId;
  if (session?.header?.agentPreset !== 'personal-remote' || typeof session.id !== 'string' ||
      !Array.isArray(session.events) || ![exec.callId, rootCallId].every((id) => typeof id === 'string' && SAFE_ID.test(id))) {
    throw refused('TOOL_SOURCE_UNAVAILABLE');
  }
  const callIndex = session.events.findLastIndex((event) => event?.type === 'tool/call' && event.data?.callId === rootCallId);
  const rootName = session.events[callIndex]?.data?.name;
  const turn = session.events[callIndex]?.data?.turn;
  const start = session.events.findLastIndex((event, index) => index < callIndex &&
    event?.type === 'turn/start' && event.data?.turn === turn);
  const currentTurn = session.events.findLast(event => event?.type === 'turn/start' || event?.type === 'turn/end');
  if (callIndex < 0 || !executionToolName(rootName) || rootCallId === exec.callId && rootName !== exec.name ||
      start < 0 || !Number.isSafeInteger(turn) || turn < 1 ||
      currentTurn?.type !== 'turn/start' || currentTurn.data?.turn !== turn ||
      session.events.slice(start + 1, callIndex).some((event) => event?.type === 'turn/end')) throw refused('TOOL_SOURCE_UNAVAILABLE');
  const users = session.events.slice(start + 1, callIndex).filter((event) =>
    event?.type === 'user/message' && event.data?.source?.kind === 'user');
  if (users.length !== 1 || typeof users[0].data?.source?.rpcId !== 'string' || !SAFE_ID.test(users[0].data.source.rpcId)) {
    throw refused('TOOL_SOURCE_UNAVAILABLE');
  }
  const parts = users[0].data.content;
  if (!Array.isArray(parts) || parts.some(part => part?.type === 'text' && typeof part.text !== 'string')) {
    throw refused('TOOL_SOURCE_UNAVAILABLE');
  }
  const text = parts.filter((part) => part?.type === 'text').map((part) => part.text).join('');
  if (!text.trim()) throw refused('TOOL_SOURCE_UNAVAILABLE');
  return { sessionId: session.id, turn, callId: exec.callId, rootCallId,
    receiptId: users[0].data.source.rpcId, messageHash: createHash('sha256').update(text).digest('hex') };
}

const executionHash = (value) => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
const APPROVAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const APPROVAL_OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);

function approvalPause(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Own only the original native personal-remote answer chain; policies remain native. */
export function installPersonalApprovalBridge(ctx, bridge, { pollDelayMs = 250, policyFor = null } = {}) {
  const callsByAgent = new WeakMap();
  const uncertainRootsByAgent = new WeakMap();
  const bindings = new Map();
  const resolutions = new Map();
  const activeRequests = new Set();
  const disposers = [];
  let closed = false;
  const keyOf = (sessionId, approvalId) => `${sessionId}\u0000${approvalId}`;
  const liveAgent = agent => agent?.session?.header?.origin !== 'subagent' &&
    agent?.session?.header?.agentPreset === 'personal-remote' &&
    ctx.get('agents')?.get(agent.session.id) === agent;
  const currentBinding = binding => {
    if (closed || !liveAgent(binding.agent)) return false;
    const last = binding.agent.session.events.findLast(event => event?.type === 'turn/start' || event?.type === 'turn/end');
    if (last?.type !== 'turn/start' || last.data?.turn !== binding.payload.turn) return false;
    try {
      const current = personalExecutionIdentity({ agent: binding.agent, name: binding.payload.toolName,
        callId: binding.payload.callId, rootCallId: binding.payload.rootCallId });
      return ['sessionId', 'turn', 'callId', 'rootCallId', 'receiptId', 'messageHash']
        .every(key => current[key] === binding.payload[key]);
    } catch { return false; }
  };
  disposers.push(ctx.on('tools/pre-execute', (exec, next) => {
    if (liveAgent(exec.agent)) {
      try {
        const identity = personalExecutionIdentity(exec);
        let calls = callsByAgent.get(exec.agent);
        if (!calls) { calls = new Map(); callsByAgent.set(exec.agent, calls); }
        calls.set(exec.callId, { ...identity, toolName: exec.name,
          argumentsHash: executionHash(exec.arguments) });
      } catch { /* Missing real tool/receipt identity cannot become an approval request. */ }
    }
    return next();
  }));
  disposers.push(ctx.on('approval/request', async (request, next) => {
    if (request.agent?.session?.header?.origin === 'subagent' ||
        request.agent?.session?.header?.agentPreset !== 'personal-remote') return next();
    if (closed || !liveAgent(request.agent)) return 'unavailable';
    if (policyFor) {
      const policy = await policyFor(request.agent);
      if (policy.mode === 'allow-all' && !policy.project) return 'allowed-once';
    }
    const identity = callsByAgent.get(request.agent)?.get(request.callId);
    // The shipped WeftMod script producer asks through its shared "weftmod" approval seam.
    // Keep the host receipt bound to the actual execution name and arguments.
    if (!identity || !(identity.toolName === request.toolName ||
        identity.toolName === 'weftmod_script' && request.toolName === 'weftmod')) return 'unavailable';
    const events = request.agent.session.events;
    const start = events.findLastIndex(event => event?.type === 'turn/start' || event?.type === 'turn/end');
    if (events[start]?.type !== 'turn/start' || events[start]?.data?.turn !== identity.turn) return 'unavailable';
    const asked = events.slice(start + 1).filter(event => event?.type === 'approval/asked' &&
      event.data?.callId === request.callId && event.data?.toolName === request.toolName &&
      typeof event.data?.id === 'string' && APPROVAL_ID.test(event.data.id) &&
      !events.some(decided => decided?.type === 'approval/decided' && decided.data?.id === event.data.id));
    if (asked.length !== 1) return 'unavailable';
    const approvalId = asked[0].data.id;
    const key = keyOf(identity.sessionId, approvalId);
    if (bindings.has(key)) return 'unavailable';
    const payload = { ...identity, approvalId };
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    activeRequests.add(controller);
    const binding = { payload, agent: request.agent, controller, registration: null };
    bindings.set(key, binding);
    try {
      binding.registration = bridge.request({ ...payload, action: 'register_approval',
        reason: typeof request.reason === 'string' ? request.reason.slice(0, 1000) : '' }, controller.signal);
      let state = await binding.registration;
      while (!closed && !controller.signal.aborted) {
        if (!currentBinding(binding) || state?.approvalId !== approvalId) return 'unavailable';
        // Only a current durable user answer can be consumed. A historical native grant never reruns.
        if (state.status === 'answered' && ['allowed-once', 'rejected'].includes(state.decisionOutcome)) return state.decisionOutcome;
        // The source task's durable stop may arrive before its native abort signal.
        if (state.status === 'unavailable' && state.outcome === 'cancelled') return 'cancelled';
        if (state.status !== 'pending') return 'unavailable';
        await approvalPause(pollDelayMs, controller.signal);
        if (closed || controller.signal.aborted) break;
        state = await bridge.request({ ...payload, action: 'read_approval' }, controller.signal);
      }
      return request.signal?.aborted ? 'cancelled' : 'unavailable';
    } catch {
      return request.signal?.aborted ? 'cancelled' : 'unavailable';
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      activeRequests.delete(controller);
    }
  }));
  disposers.push(ctx.on('session/event', (session, event) => {
    if (event?.type === 'approval/decided' && APPROVAL_OUTCOMES.has(event.data?.outcome)) {
      const key = keyOf(session?.id, event.data?.id), binding = bindings.get(key);
      if (!binding || binding.agent.session !== session || !liveAgent(binding.agent)) return;
      // The native committed audit event, rather than the HTTP answer, settles this receipt.
      const work = Promise.resolve(binding.registration).catch(() => undefined).then(() =>
        bridge.request({ ...binding.payload, action: 'resolve_approval', outcome: event.data.outcome })).then(state => {
          const resolved = state?.status === 'resolved' && state.outcome === event.data.outcome;
          const cancelled = state?.status === 'unavailable' && state.outcome === 'cancelled' && event.data.outcome === 'cancelled';
          if (state?.approvalId !== event.data.id || !(resolved || cancelled)) {
            throw refused('TOOL_SOURCE_UNAVAILABLE');
          }
        });
      resolutions.set(key, { binding, work });
      work.catch(() => {}); // before/after execution observes failure and preserves the non-successful path.
      bindings.delete(key);
    }
    if (event?.type === 'turn/end') {
      const agent = ctx.get('agents')?.get(session?.id);
      if (agent?.session === session) { callsByAgent.delete(agent); uncertainRootsByAgent.delete(agent); }
      for (const [key, binding] of bindings) if (binding.agent.session === session && binding.payload.turn === event.data?.turn) {
        binding.controller.abort(); bindings.delete(key);
      }
      for (const [key, resolution] of resolutions) if (resolution.binding.agent.session === session &&
          resolution.binding.payload.turn === event.data?.turn) {
        resolution.work.finally(() => resolutions.delete(key)).catch(() => {});
      }
    }
  }));
  const awaitResolutions = async exec => {
    if (exec.agent?.session?.header?.agentPreset !== 'personal-remote') return;
    if (closed || !liveAgent(exec.agent)) throw refused('TOOL_SOURCE_UNAVAILABLE');
    const rootCallId = exec.rootCallId ?? exec.callId;
    const uncertain = uncertainRootsByAgent.get(exec.agent);
    if (uncertain?.blocked || uncertain?.roots.has(rootCallId)) throw refused('TASK_NOT_READY');
    await Promise.all([...resolutions.values()].filter(({ binding }) => binding.agent === exec.agent &&
      (binding.payload.callId === exec.callId || binding.payload.rootCallId === rootCallId)).map(({ work }) => work));
  };
  const onDisconnect = () => {
    closed = true;
    for (const controller of activeRequests) controller.abort();
  };
  bridge.transport?.once?.('disconnect', onDisconnect);
  return {
    beforeExecution: awaitResolutions,
    afterExecution: awaitResolutions,
    markExecutionUncertain(exec) {
      let state = uncertainRootsByAgent.get(exec.agent);
      if (!state) { state = { roots: new Set(), blocked: false }; uncertainRootsByAgent.set(exec.agent, state); }
      const rootCallId = exec.rootCallId ?? exec.callId;
      if (state.roots.size < 256 || state.roots.has(rootCallId)) state.roots.add(rootCallId);
      else state.blocked = true;
    },
    close() {
      onDisconnect();
      bridge.transport?.off?.('disconnect', onDisconnect);
      for (const dispose of disposers.splice(0)) if (typeof dispose === 'function') dispose();
      bindings.clear(); resolutions.clear();
    },
  };
}

/** Runs after the original sandbox/approval gate. The host grants identity, never model arguments. */
export async function trackPersonalExecution(bridge, exec, next, background = null, approvals = null) {
  // DSH owns delegated execution. The portal receipt authorizes the parent subagent call;
  // the child's native prompt is not another personal/v1 command or account boundary.
  if (exec.agent?.session?.header?.origin === 'subagent' ||
      exec.agent?.session?.header?.agentPreset !== 'personal-remote' || NATIVE_SESSION_TOOLS.has(exec.name)) return next();
  if (!executionToolName(exec.name)) throw refused('TOOL_SOURCE_UNAVAILABLE');
  const identity = personalExecutionIdentity(exec);
  const payload = { ...identity, toolName: exec.name, argumentsHash: executionHash(exec.arguments) };
  await approvals?.beforeExecution(exec);
  const grant = await bridge.request({ ...payload, action: 'authorize_execution' }, exec.signal);
  if (grant.state !== 'running' || typeof grant.executionId !== 'string') throw refused('TOOL_SOURCE_UNAVAILABLE');
  const observeUncertain = async () => {
    approvals?.markExecutionUncertain?.(exec);
    try {
      await bridge.request({ ...payload, action: 'finish_execution', executionId: grant.executionId, state: 'uncertain' });
    } catch { /* A confirmed terminal row is never downgraded; the local root fence still stays closed. */ }
  };
  let result, error, capturedJobId;
  try {
    if (background?.capture && exec.name === 'pwsh' && exec.arguments?.run_in_background === true) {
      const settled = await background.capture(exec, next);
      ({ result, error, jobId: capturedJobId } = settled);
    } else result = await next();
  } catch (caught) { error = caught; }
  try { await approvals?.afterExecution(exec); } catch {
    // The body may already have produced an effect after a native grant. A missing durable
    // approval receipt cannot turn that effect into an ordinary replayable failure.
    error = Object.assign(refused('TOOL_SOURCE_UNAVAILABLE'), { personalExecutionUncertain: true });
  }
  if (error?.personalExecutionUncertain) {
    approvals?.markExecutionUncertain?.(exec);
    if (capturedJobId) try { await background?.stop(exec, capturedJobId, 'approval receipt unavailable'); }
    catch { /* Keep the execution receipt unfinished; an unknown native stop is not success. */ }
    await observeUncertain();
    throw error;
  }
  // tools/execute receives the official ToolResult envelope, not the producer's raw value.
  const returnedJobId = !error && result?.isError === false && exec.name === 'pwsh' &&
    exec.arguments?.run_in_background === true && result.value?.kind === 'background' &&
    typeof result.value.jobId === 'string' && SAFE_ID.test(result.value.jobId) ? result.value.jobId : undefined;
  const jobId = capturedJobId ?? returnedJobId;
  let jobState, claimed = false;
  if (jobId) {
    try {
      if (!background || returnedJobId && capturedJobId && returnedJobId !== capturedJobId) {
        throw refused('TOOL_SOURCE_UNAVAILABLE');
      }
      jobState = await background.claim(exec, identity, grant.executionId, jobId);
      claimed = true;
      if (exec.signal?.aborted) jobState = await background.stop(exec, jobId, 'personal tool cancelled');
    } catch (caught) {
      error = caught;
      approvals?.markExecutionUncertain?.(exec);
      // The observer captured only this exact native producer and owner, never an arbitrary PID.
      let cleanupKnown = false;
      try {
        cleanupKnown = ['completed', 'killed', 'failed'].includes(await background?.stop(exec, jobId, 'unconfirmed task ownership'));
      } catch { /* An unconfirmed stop cannot become a known failed execution. */ }
      if (!cleanupKnown) {
        await observeUncertain();
        throw Object.assign(caught && typeof caught === 'object' ? caught : refused('TOOL_SOURCE_UNAVAILABLE'),
          { personalExecutionUncertain: true });
      }
    }
  }
  const state = exec.signal?.aborted ? 'cancelled' : error || result?.isError ? 'failed' : 'completed';
  // Cancellation must still finish its receipt; it never closes an already opened application.
  try {
    await bridge.request({ ...payload, action: 'finish_execution', executionId: grant.executionId, state,
      resultHash: executionHash(error ? { code: error.code ?? 'TOOL_FAILED' } : result),
      ...(claimed ? { jobId, jobState } : {}) });
  } catch (caught) {
    approvals?.markExecutionUncertain?.(exec);
    if (jobId) try { await background?.stop(exec, jobId, 'execution receipt unavailable'); } catch { /* No claimed stop is invented. */ }
    await observeUncertain();
    throw Object.assign(caught && typeof caught === 'object' ? caught : refused('TOOL_SOURCE_UNAVAILABLE'),
      { personalExecutionUncertain: true });
  }
  if (claimed) await background.observe(exec, { ...payload, executionId: grant.executionId, jobId });
  if (error) throw error;
  return result;
}

/** Correlate native job registration while its real pwsh dispatch is still on the stack. */
export function createPersonalBackgroundTracker(ctx, bridge) {
  const dispatch = new AsyncLocalStorage();
  const seenByOwner = new WeakMap();
  const backgroundClaims = new Map();
  const disposeObservers = [];
  const ownedJob = (jobs, exec, jobId) => {
    const snapshot = jobs?.get(jobId, exec.agent);
    if (!snapshot || snapshot.kind !== 'pwsh' || snapshot.ownerSession !== exec.agent?.session?.id ||
        exec.agent?.id !== snapshot.ownerSession) throw refused('TOOL_SOURCE_UNAVAILABLE');
    return snapshot;
  };
  const stopOwned = async (exec, jobId, reason) => {
    const jobs = ctx.get('jobs');
    const initial = ownedJob(jobs, exec, jobId);
    if (['running', 'stopping'].includes(initial.status)) {
      jobs.kill(jobId, exec.agent, reason);
      await jobs.wait(jobId, 2_000, exec.agent);
    }
    return ownedJob(jobs, exec, jobId).status;
  };
  ctx.inject(['jobs'], jobsCtx => {
    disposeObservers.push(jobsCtx.jobs.onJobsChanged(owner => {
      if (owner?.session?.header?.agentPreset !== 'personal-remote') return;
      const snapshots = jobsCtx.jobs.list(owner).filter(snapshot => snapshot.ownerSession === owner.session.id);
      const seen = seenByOwner.get(owner) ?? new Set();
      const added = snapshots.filter(snapshot => !seen.has(snapshot.id));
      seenByOwner.set(owner, new Set(snapshots.map(snapshot => snapshot.id)));
      const active = dispatch.getStore();
      if (active?.exec.agent !== owner) return;
      for (const snapshot of added) {
        if (snapshot.kind === 'pwsh' && typeof snapshot.id === 'string' && SAFE_ID.test(snapshot.id)) active.jobs.push(snapshot.id);
      }
    }));
    disposeObservers.push(jobsCtx.jobs.onJobDone(async (snapshot, owner) => {
      const claim = backgroundClaims.get(`${owner?.id}|${snapshot.id}`);
      if (!claim || claim.owner !== owner) return;
      await bridge.request({ ...claim.payload, action: 'observe_execution_job', jobState: snapshot.status });
      backgroundClaims.delete(`${owner.id}|${snapshot.id}`);
    }));
  });
  return {
    async capture(exec, next) {
      const jobs = ctx.get('jobs');
      if (!jobs) throw refused('TOOL_SOURCE_UNAVAILABLE');
      // Prime the observer with existing jobs so none can inherit a new user's receipt.
      seenByOwner.set(exec.agent, new Set(jobs.list(exec.agent).filter(snapshot =>
        snapshot.ownerSession === exec.agent.session.id).map(snapshot => snapshot.id)));
      const active = { exec, jobs: [] };
      let result, error;
      try { result = await dispatch.run(active, next); } catch (caught) { error = caught; }
      if (active.jobs.length > 1) {
        // The pinned pwsh producer starts one job. Unexpected multiplicity cannot lose captured handles.
        const stopped = await Promise.allSettled(active.jobs.map(jobId => stopOwned(exec, jobId, 'ambiguous native job registration')));
        error = refused('TOOL_SOURCE_UNAVAILABLE');
        error.personalExecutionUncertain = stopped.some(item => item.status !== 'fulfilled' ||
          !['completed', 'killed', 'failed'].includes(item.value));
      }
      return { result, error, ...(active.jobs.length === 1 ? { jobId: active.jobs[0] } : {}) };
    },
    async claim(exec, identity, executionId, jobId) {
      const jobs = ctx.get('jobs');
      ownedJob(jobs, exec, jobId);
      const accepted = await ctx.waterfall('weftmate/personal-job', { ...identity, executionId, jobId, owner: exec.agent }, () => Promise.resolve(false));
      if (accepted !== true) throw refused('TOOL_SOURCE_UNAVAILABLE');
      return ownedJob(jobs, exec, jobId).status;
    },
    stop: stopOwned,
    async observe(exec, payload) {
      const key = `${exec.agent.id}|${payload.jobId}`;
      backgroundClaims.set(key, { payload, owner: exec.agent });
      const state = ownedJob(ctx.get('jobs'), exec, payload.jobId).status;
      await bridge.request({ ...payload, action: 'observe_execution_job', jobState: state });
      if (['completed', 'killed', 'failed'].includes(state)) backgroundClaims.delete(key);
    },
    close() {
      for (const dispose of disposeObservers.splice(0)) if (typeof dispose === 'function') dispose();
      backgroundClaims.clear(); dispatch.disable();
    },
  };
}

function safePublicUrl(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2_048 ||
      /[\x00-\x1f\x7f]/.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password &&
    parsed.hostname ? value : null;
}

function proofRequest(frame) {
  return frame && typeof frame === 'object' && !Array.isArray(frame) &&
    Object.keys(frame).sort().join(',') === ['beforeCallId', 'id', 'protocol', 'readCallId',
      'sessionId', 'snapshotId', 'sourceReceiptId', 'turn',
      ...(frame.readTool === undefined ? [] : ['readTool']),
      ...(frame.beforeTool === undefined ? [] : ['beforeTool'])].sort().join(',') &&
    (frame.readTool === undefined || READ_TOOLS.has(frame.readTool)) &&
    (frame.beforeTool === undefined || ['personal_save_document',
      LEGACY_BROWSER_FOLLOW_TOOL, LEGACY_BROWSER_SEGMENT_TOOL].includes(frame.beforeTool)) &&
    frame.protocol === PERSONAL_PROJECT_PROOF_PROTOCOL && typeof frame.id === 'string' &&
    /^proof-[0-9a-f-]{36}$/.test(frame.id) &&
    typeof frame.sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(frame.sessionId) &&
    Number.isSafeInteger(frame.turn) && frame.turn > 0 &&
    [frame.readCallId, frame.beforeCallId, frame.sourceReceiptId].every((id) =>
      typeof id === 'string' && SAFE_ID.test(id)) && frame.readCallId !== frame.beforeCallId &&
    typeof frame.snapshotId === 'string' && SNAPSHOT_ID.test(frame.snapshotId);
}

/** Inspect only durable native events, never unflushed live session.events. */
export function verifyStoredProjectRead(content, request) {
  if (!proofRequest({ ...request, protocol: PERSONAL_PROJECT_PROOF_PROTOCOL,
    id: 'proof-00000000-0000-4000-8000-000000000000' }) ||
      !(typeof content === 'string' || Array.isArray(content))) return false;
  let open = null;
  let userCount = 0;
  let readCall = 0;
  let readResult = 0;
  let saveCall = 0;
  let previousSeq = -1;
  const readTool = request.readTool ?? LEGACY_PROJECT_READ_TOOL;
  const beforeTool = request.beforeTool ?? LEGACY_DOCUMENT_TOOL;
  for (const line of Array.isArray(content) ? content : content.split('\n')) {
    if (typeof line === 'string' && !line.trim()) continue;
    let event;
    try { event = typeof line === 'string' ? JSON.parse(line) : line.event ?? line; } catch { return false; }
    if (event.type === 'session' || ['text-chunks', 'reasoning-chunks',
      'tool-call-chunks'].includes(event.type)) continue;
    if (!Number.isSafeInteger(event.seq) || event.seq <= previousSeq) return false;
    previousSeq = event.seq;
    if (event.type === 'turn/start') {
      if (event.data?.turn === request.turn) {
        if (open !== null || saveCall) return false;
        open = request.turn;
      }
      continue;
    }
    if (open !== request.turn) continue;
    if (event.type === 'turn/end' && event.data?.turn === request.turn) return false;
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      userCount++;
      if (event.data.source.rpcId !== request.sourceReceiptId || userCount !== 1) return false;
    }
    if (event.type === 'tool/call' && event.data?.turn === request.turn) {
      if (event.data.callId === request.readCallId) {
        if (event.data.name !== readTool || ++readCall !== 1 || saveCall) return false;
      }
      if (event.data.callId === request.beforeCallId) {
        if (event.data.name !== beforeTool || ++saveCall !== 1 ||
            readResult !== 1 || userCount !== 1) return false;
        return true;
      }
    }
    if (event.type === 'tool/result' && event.data?.turn === request.turn &&
        event.data?.message?.source?.callId === request.readCallId) {
      if (!readCall || saveCall || ++readResult !== 1 || event.data.error !== undefined ||
          event.data.message.source.kind !== 'tool') return false;
      const block = event.data.message.content?.[0];
      if (block?.type !== 'tool-result' || block.toolCallId !== request.readCallId ||
          block.isError === true || !Array.isArray(block.content) || block.content.length !== 1 ||
          block.content[0]?.type !== 'text' || typeof block.content[0].text !== 'string' ||
          block.content[0].text.length > 80_000) return false;
      let value;
      try { value = JSON.parse(block.content[0].text); } catch { return false; }
      if (value?.snapshotId !== request.snapshotId || typeof value?.text !== 'string') return false;
      if (readTool === LEGACY_PROJECT_READ_TOOL) {
        if (typeof value.fileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.fileSha256)) return false;
      } else if (typeof value.contentSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.contentSha256) ||
          typeof value.url !== 'string' || safePublicUrl(value.url) === null) return false;
    }
  }
  return false;
}

function installProofBridge(ctx) {
  const onMessage = (frame) => {
    if (!proofRequest(frame)) return;
    const respond = (verified) => {
      if (typeof process.send === 'function' && process.connected) {
        try { process.send({ protocol: PERSONAL_PROJECT_PROOF_PROTOCOL, id: frame.id, verified }); }
        catch { /* Parent treats disconnect as unverified. */ }
      }
    };
    void (async () => {
      const persistence = ctx.get?.('sessionPersistence');
      if (typeof persistence?.readFrom !== 'function' || typeof persistence?.inspect !== 'function') return false;
      const deadline = Date.now() + 2_200;
      do {
        const artifact = await durableSourceRange(persistence, frame.sessionId, { turn: frame.turn });
        if (artifact?.meta?.id === frame.sessionId &&
            artifact.meta.agentPreset === 'personal-remote' &&
            verifyStoredProjectRead(artifact.events, frame)) return true;
        await new Promise((resolve) => setTimeout(resolve, 60));
      } while (Date.now() < deadline);
      return false;
    })().then(respond, () => respond(false));
  };
  process.on('message', onMessage);
  return () => process.off('message', onMessage);
}

export class PersonalDesktopBridge {
  constructor(transport = process) {
    this.transport = transport;
    this.pending = new Map();
    this.closed = false;
    this.onMessage = (frame) => {
      if (frame?.protocol !== PERSONAL_DESKTOP_PROTOCOL || typeof frame.id !== 'string') return;
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.ok === true && frame.command && typeof frame.command === 'object') entry.resolve(frame.command);
      else entry.reject(refused(SAFE_TOOL_ERRORS.has(frame.error)
        ? frame.error : 'PERSONAL_TOOL_UNAVAILABLE'));
    };
    this.onDisconnect = () => this.close();
    this.transport.on('message', this.onMessage);
    this.transport.once('disconnect', this.onDisconnect);
  }

  request(payload, signal) {
    if (this.closed || typeof this.transport.send !== 'function' || this.transport.connected !== true) {
      return Promise.reject(refused('PERSONAL_TOOL_UNAVAILABLE'));
    }
    if (signal?.aborted) return Promise.reject(refused('PERSONAL_TOOL_CANCELLED'));
    const id = `personal-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        signal?.removeEventListener?.('abort', entry.abort);
        reject(error);
      };
      const timeout = ['browse', 'register_file', 'list_project', 'read_project', 'open_page', 'follow_link', 'read_segment'].includes(payload.action) ||
        payload.action === 'write_document' && payload.sourceSnapshotIds?.length > 0 ? 20_000 : 12_000;
      const timer = setTimeout(() => finish(refused('PERSONAL_TOOL_TIMEOUT')), timeout);
      const abort = () => finish(refused('PERSONAL_TOOL_CANCELLED'));
      this.pending.set(id, { resolve: (value) => { signal?.removeEventListener?.('abort', abort); resolve(value); },
        reject: (error) => { signal?.removeEventListener?.('abort', abort); reject(error); }, timer, abort });
      signal?.addEventListener?.('abort', abort, { once: true });
      try {
        this.transport.send({ protocol: PERSONAL_DESKTOP_PROTOCOL, id, ...payload }, (error) => {
          if (error) finish(refused('PERSONAL_TOOL_UNAVAILABLE'));
        });
      } catch { finish(refused('PERSONAL_TOOL_UNAVAILABLE')); }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.transport.off('message', this.onMessage);
    this.transport.off('disconnect', this.onDisconnect);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(refused('PERSONAL_TOOL_UNAVAILABLE'));
    }
    this.pending.clear();
  }
}

export function registerPersonalBrowserTool(ctx, bridge) {
  return ctx.tools.register(defineTool({
    name: 'browser',
    description: 'Open a web page, read a captured segment, or follow a captured link.',
    parameters: {
      action: { type: 'string', required: true, enum: ['open', 'read', 'follow'] },
      url: { type: 'string', description: 'URL to open.' },
      snapshotId: { type: 'string', description: 'Capture returned by browser.' },
      segmentIndex: { type: 'integer', description: 'Zero-based segment to read.' },
      query: { type: 'string', description: 'For read: space-separated terms selecting relevant verbatim paragraphs across the frozen capture instead of a whole segment.' },
      linkId: { type: 'string', description: 'Link from the capture to follow.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => bridge.request({ ...args, ...personalExecutionIdentity(exec),
      browserAction: args.action, action: 'browse' }, exec.signal),
    presentCall: () => ({ card: 'generic', title: '浏览网页', kind: 'execute' }),
  }));
}

/** Replace the pinned initial file boundary, independently of native approval policy. */
export function initializePersonalFilePolicy(agent, sandboxPolicy) {
  if (agent?.session?.header?.agentPreset !== 'personal-remote') return;
  const session = agent.session;
  const mode = sandboxPolicy?.overrideOf(session);
  const initial = session.events.findIndex(event => event.type === 'sandbox/mode');
  const firstTurn = session.events.findIndex(event => event.type === 'turn/start');
  // DSH pins workspace-write during session creation, before the personal preset runs.
  // Upgrade that initial default, retaining later native permission switches.
  if (mode === undefined || mode === 'workspace-write' && initial >= 0 &&
      (firstTurn < 0 || initial < firstTurn) &&
      session.events.filter(event => event.type === 'sandbox/mode').length === 1)
    setSandboxMode(session, 'danger-full-access');
}

/** Unknown calls cannot execute, so they must fail before asking for consent. */
export function personalToolAvailability(tools, exec) {
  return tools.get(exec.name, exec.agent) ? null : { kind: 'deny',
    reason: `Unknown tool "${exec.name}". Use a tool name from the available tool definitions.` };
}

export function apply(ctx) {
  const bridge = new PersonalDesktopBridge();
  const disposeProjectSandbox = installProjectSandbox(ctx.get('sandboxPolicy'));
  ctx.plugin(PlanModeController, { section: 'You are planning. Present a complete Markdown plan with exit_plan_mode before executing tools. Ask for missing information if needed. Execute only after the user approves the plan.' });
  const policyFor = (agent) => bridge.request({ action: 'approval_policy', sessionId: agent.session.id,
    turn: 0, callId: 'approval-policy', messageHash: '0'.repeat(64) });
  installConversationReasoning(ctx, policyFor);
  const selectedModes = new WeakMap();
  const webExecution = new AsyncLocalStorage();
  const delegatedExecutions = new WeakMap();
  const disposeFetch = ctx.web.registerFetchProvider(personalWebFetchProvider(bridge,
    () => webExecution.getStore(), exec => personalExecutionIdentity(
      delegatedExecutions.get(exec.agent) ?? exec)));
  const initializeFilePolicy = agent => initializePersonalFilePolicy(agent, ctx.get('sandboxPolicy'));
  // Presets can be selected after agent/created, before the first native step.
  ctx.on('agent/pre-step', async (step, next) => {
    initializeFilePolicy(step.agent);
    if (step.agent?.session?.header?.agentPreset !== 'personal-remote') return next();
    if (step.agent.session.header.origin === 'subagent') {
      const decision = await next(), notice = projectContextNotice(step.agent.session);
      if (decision.kind !== 'enter' || !notice) return decision;
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm/message');
      return { ...decision, messages: [...decision.messages.filter(message => message.source?.plugin !== 'weftmate-project'),
        createUserMessage({ content: [{ type: 'text', text: notice }], source: { kind: 'plugin', plugin: 'weftmate-project' } })] };
    }
    const policy = await policyFor(step.agent);
    const projectNotice = await selectProjectContext(step.agent, policy);
    const prior = selectedModes.get(step.agent);
    const newUserMessage = step.messages?.some(message => message.source?.kind === 'user');
    if (policy.mode !== prior || policy.mode === 'plan' && newUserMessage) {
      // Native plan state survives resume. A later user switch explicitly rearms it.
      if (newUserMessage || prior !== undefined || !step.agent.session.events.some(event => event.type === 'plan/mode'))
        ctx.get('planMode')?.set(step.agent, policy.mode === 'plan');
      selectedModes.set(step.agent, policy.mode);
    }
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm/message');
    return { ...decision, messages: [...decision.messages.filter(message => !['weftmate-approval-mode', 'weftmate-project'].includes(message.source?.plugin)),
      createUserMessage({ content: [{ type: 'text', text: approvalPrompt(policy.mode) }],
        source: { kind: 'plugin', plugin: 'weftmate-approval-mode' } }),
      ...(projectNotice ? [createUserMessage({ content: [{ type: 'text', text: projectNotice }],
        source: { kind: 'plugin', plugin: 'weftmate-project' } })] : [])] };
  }, { prepend: true });
  // The pinned driver copies static AgentOptions, while the personal UI selects
  // models through DSH's scoped selection. Initialize a native child before its
  // loop starts, using the parent's actual request configuration and DSH's helper.
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.session?.header?.agentPreset !== 'personal-remote') return;
    // D2: computer file access is unrestricted; approval is a separate native policy.
    initializeFilePolicy(agent);
    if (agent?.session?.header?.origin !== 'subagent' || agent.session.header.agentPreset !== 'personal-remote') return;
    const dispatch = webExecution.getStore();
    if (dispatch) delegatedExecutions.set(agent, delegatedExecutions.get(dispatch.agent) ?? dispatch);
    const parent = ctx.get('agents')?.get(agent.session.header.parentSession);
    inheritProjectContext(agent, parent);
    const config = agent.session.requestHeader?.()?.config ?? parent?.session?.requestHeader?.()?.config;
    if (typeof config?.provider !== 'string' || typeof config?.model !== 'string') throw refused('MODEL_UNAVAILABLE');
    installModelSelection(agent.ctx, { current: { provider: config.provider, model: config.model,
      ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) }, assembled: undefined });
  });
  const disposeProof = installProofBridge(ctx);
  const background = createPersonalBackgroundTracker(ctx, bridge);
  const approvals = installPersonalApprovalBridge(ctx, bridge, { policyFor });
  ctx.on('tools/pre-execute', async (exec, next) => {
    routeProjectTool(exec);
    return await projectToolDecision(exec) ?? next();
  }, { prepend: true });
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next();
    if (exec.agent?.session?.header?.agentPreset !== 'personal-remote' || decision.kind === 'deny' ||
        NATIVE_SESSION_TOOLS.has(exec.name) || exec.name === 'exit_plan_mode' || exec.name === 'todo_write' || exec.name === 'run_code') return decision;
    const unavailable = personalToolAvailability(ctx.tools, exec);
    if (unavailable) return unavailable;
    const delegated = delegatedExecutions.get(exec.agent);
    const owner = delegated?.agent ?? exec.agent;
    const policy = await policyFor(owner);
    const cwd = resolve(executionDirectory(exec.agent.session), exec.arguments?.workdir ?? '.');
    const risks = classifyPersonalRisk(exec.name, exec.arguments, cwd, new Set(),
      { createdFiles: conversationCreatedFiles(exec.agent.session) });
    if (policy.mode === 'plan' && foldPlanMode(owner.session.events))
      return { kind: 'deny', reason: 'Present the plan with exit_plan_mode and wait for approval before executing this operation.' };
    const required = approvalRequired(policy.mode, risks, policy.allowedCategories);
    if (!required.length) return decision;
    const reason = `[weftmate:${required.join(',')}] ${required.map(risk => RISK_LABELS[risk]).join('；')}。操作：${exec.name}\n${JSON.stringify(exec.arguments).slice(0, 700)}`;
    if (delegated) {
      const outcome = await ctx.approval.request({ agent: owner, toolName: delegated.name,
        callId: delegated.callId, reason, signal: exec.signal });
      return outcome === 'allowed-once' ? { kind: 'allow' } : { kind: 'deny', reason: `Delegated operation approval: ${outcome}` };
    }
    return { kind: 'ask', reason };
  });
  ctx.on('tools/execute', (exec, next) => webExecution.run(exec, () => trackNativeFiles(bridge, exec,
    () => trackPersonalExecution(bridge, exec, next, background, approvals), personalExecutionIdentity)));
  ctx.on('tools/post-execute', appendNativeArtifacts);
  ctx.effect(() => () => { disposeProjectSandbox(); disposeFetch(); disposeProof(); approvals.close(); background.close(); bridge.close(); },
    'weftmate-personal-desktop: lifecycle');
}

export default { name, inject, apply };
