import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { durableSourceRange } from '../runtime/dsh-adapter/source-range.mjs';

export const name = 'weftmate-personal-desktop';
export const PERSONAL_DESKTOP_PROTOCOL = 'weftmate.personal-desktop.v1';
export const PERSONAL_DESKTOP_TOOL = 'personal_open_notepad';
export const PERSONAL_DOCUMENT_TOOL = 'personal_save_document';
export const PERSONAL_PROJECT_LIST_TOOL = 'personal_list_project_files';
export const PERSONAL_PROJECT_READ_TOOL = 'personal_read_project_file';
export const PERSONAL_BROWSER_OPEN_TOOL = 'personal_browser_open';
export const PERSONAL_BROWSER_FOLLOW_TOOL = 'personal_browser_follow';
export const PERSONAL_BROWSER_SEGMENT_TOOL = 'personal_browser_read_segment';
const NATIVE_SESSION_TOOLS = new Set(['get_goal', 'create_goal', 'update_goal', 'ask_user_question']);
const LEGACY_PERSONAL_TOOLS = new Set([PERSONAL_DESKTOP_TOOL, PERSONAL_DOCUMENT_TOOL, PERSONAL_PROJECT_LIST_TOOL,
  PERSONAL_PROJECT_READ_TOOL, PERSONAL_BROWSER_OPEN_TOOL, PERSONAL_BROWSER_FOLLOW_TOOL, PERSONAL_BROWSER_SEGMENT_TOOL]);
const executionToolName = name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(name);
export const PERSONAL_PROJECT_PROOF_PROTOCOL = 'weftmate.personal-project-proof.v1';
export const inject = ['tools'];
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
const READ_TOOLS = new Set([PERSONAL_PROJECT_READ_TOOL, PERSONAL_BROWSER_OPEN_TOOL,
  PERSONAL_BROWSER_FOLLOW_TOOL, PERSONAL_BROWSER_SEGMENT_TOOL]);

function refused(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function safeDocumentName(value) {
  if (typeof value !== 'string') return null;
  const fileName = value.normalize('NFC');
  if (!fileName || Buffer.byteLength(fileName, 'utf8') > 160 || fileName.includes('..') ||
      !/^[\p{L}\p{N}][\p{L}\p{N} _.-]*\.[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(fileName)) return null;
  const stem = fileName.slice(0, fileName.lastIndexOf('.'));
  if (/[ .]$/.test(stem) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(stem)) return null;
  return fileName;
}

/** Identity comes from durable DSH events, never from model-provided arguments. */
export function personalToolIdentity(exec) {
  const session = exec?.agent?.session;
  if (session?.header?.agentPreset !== 'personal-remote' || typeof session.id !== 'string' ||
      !Array.isArray(session.events) || typeof exec.callId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,160}$/.test(exec.callId)) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const events = session.events;
  const callIndex = events.findLastIndex((event) => event?.type === 'tool/call' && event.data?.callId === exec.callId);
  if (callIndex < 0) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const turn = events[callIndex]?.data?.turn;
  if (!Number.isSafeInteger(turn) || turn < 0) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const startIndex = events.findLastIndex((event, index) => index < callIndex &&
    event?.type === 'turn/start' && event.data?.turn === turn);
  if (startIndex < 0) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const users = events.slice(startIndex + 1, callIndex).filter((event) =>
    event?.type === 'user/message' && event.data?.source?.kind === 'user');
  if (users.length !== 1) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const parts = users[0].data?.content;
  if (!Array.isArray(parts) || !parts.length || parts.some((part) => part?.type !== 'text' || typeof part.text !== 'string')) {
    throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  }
  const text = parts.map((part) => part.text).join('');
  if (!text.trim() || text.length > 8_192) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  const receiptId = users[0].data?.source?.rpcId;
  return { sessionId: session.id, turn, callId: exec.callId,
    messageHash: createHash('sha256').update(text).digest('hex'),
    ...(typeof receiptId === 'string' && SAFE_ID.test(receiptId) ? { receiptId } : {}) };
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
export function installPersonalApprovalBridge(ctx, bridge, { pollDelayMs = 250 } = {}) {
  const callsByAgent = new WeakMap();
  const uncertainRootsByAgent = new WeakMap();
  const bindings = new Map();
  const resolutions = new Map();
  const activeRequests = new Set();
  const disposers = [];
  let closed = false;
  const keyOf = (sessionId, approvalId) => `${sessionId}\u0000${approvalId}`;
  const liveAgent = agent => agent?.session?.header?.agentPreset === 'personal-remote' &&
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
        if (calls.size < 256) calls.set(exec.callId, { ...identity, toolName: exec.name,
          argumentsHash: executionHash(exec.arguments) });
      } catch { /* Missing real tool/receipt identity cannot become an approval request. */ }
    }
    return next();
  }));
  disposers.push(ctx.on('approval/request', async (request, next) => {
    if (request.agent?.session?.header?.agentPreset !== 'personal-remote') return next();
    if (closed || !liveAgent(request.agent)) return 'unavailable';
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
  if (exec.agent?.session?.header?.agentPreset !== 'personal-remote' || NATIVE_SESSION_TOOLS.has(exec.name) ||
      LEGACY_PERSONAL_TOOLS.has(exec.name)) return next();
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

function projectIdentity(exec) {
  const identity = personalToolIdentity(exec);
  if (!identity.receiptId) throw refused('PERSONAL_TOOL_SOURCE_UNAVAILABLE');
  return identity;
}

function safePublicUrl(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2_048 ||
      /[\x00-\x1f\x7f]/.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password &&
    parsed.hostname ? value : null;
}

function safeQuery(value) {
  return value === undefined ? '' : typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= 200 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
}

function safeSnapshotIds(value) {
  return value === undefined ? undefined : Array.isArray(value) && value.length <= 16 &&
    value.every((id) => typeof id === 'string' && SNAPSHOT_ID.test(id)) &&
    new Set(value).size === value.length ? value : null;
}

function proofRequest(frame) {
  return frame && typeof frame === 'object' && !Array.isArray(frame) &&
    Object.keys(frame).sort().join(',') === ['beforeCallId', 'id', 'protocol', 'readCallId',
      'sessionId', 'snapshotId', 'sourceReceiptId', 'turn',
      ...(frame.readTool === undefined ? [] : ['readTool']),
      ...(frame.beforeTool === undefined ? [] : ['beforeTool'])].sort().join(',') &&
    (frame.readTool === undefined || READ_TOOLS.has(frame.readTool)) &&
    (frame.beforeTool === undefined || ['personal_save_document',
      PERSONAL_BROWSER_FOLLOW_TOOL, PERSONAL_BROWSER_SEGMENT_TOOL].includes(frame.beforeTool)) &&
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
  const readTool = request.readTool ?? PERSONAL_PROJECT_READ_TOOL;
  const beforeTool = request.beforeTool ?? PERSONAL_DOCUMENT_TOOL;
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
      if (readTool === PERSONAL_PROJECT_READ_TOOL) {
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
      const timeout = ['list_project', 'read_project', 'open_page', 'follow_link', 'read_segment'].includes(payload.action) ||
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

export function apply(ctx) {
  const bridge = new PersonalDesktopBridge();
  const disposeProof = installProofBridge(ctx);
  const background = createPersonalBackgroundTracker(ctx, bridge);
  const approvals = installPersonalApprovalBridge(ctx, bridge);
  ctx.on('tools/execute', (exec, next) => trackPersonalExecution(bridge, exec, next, background, approvals));
  const disposeTool = ctx.tools.register(defineTool({
    name: PERSONAL_DESKTOP_TOOL,
    description: 'Only when the latest user explicitly asks to open Notepad on their computer. Opens the fixed Notepad app and returns a durable command state; never accepts a path or shell command.',
    parameters: { appId: { type: 'string', required: true, enum: ['notepad'] } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (args?.appId !== 'notepad') throw refused('PERSONAL_TOOL_INVALID');
      const identity = personalToolIdentity(exec);
      return bridge.request({ ...identity, appId: 'notepad' }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '打开记事本', kind: 'execute' }),
  }));
  const disposeDocument = ctx.tools.register(defineTool({
    name: PERSONAL_DOCUMENT_TOOL,
    description: 'Save one UTF-8 text document requested by the current user. Give a simple Chinese or English filename with its original extension (for example .md, .txt, .csv, .tsv, .json or .xml) and the complete text, up to 128 KiB. The content must be nonempty text without NUL characters; the extension does not enable binary files. The host chooses the storage path, preserves the filename and verifies the saved text. CSV and TSV use their text media types; other extensions use text/plain.',
    parameters: { fileName: { type: 'string', required: true }, content: { type: 'string', required: true },
      sourceSnapshotIds: { type: 'array', items: { type: 'string' },
        description: 'For project or browser summaries, provide snapshot IDs returned by successful reads in this same turn.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const fileName = safeDocumentName(args?.fileName);
      if (!fileName || typeof args?.content !== 'string' || !args.content.length ||
          Buffer.byteLength(args.content, 'utf8') > 128 * 1024 || args.content.includes('\0') ||
          Buffer.from(args.content, 'utf8').toString('utf8') !== args.content) throw refused('PERSONAL_TOOL_INVALID');
      const sourceSnapshotIds = safeSnapshotIds(args?.sourceSnapshotIds);
      if (sourceSnapshotIds === null) throw refused('PERSONAL_TOOL_INVALID');
      const identity = personalToolIdentity(exec);
      return bridge.request({ action: 'write_document', ...identity, fileName,
        content: args.content, ...(sourceSnapshotIds === undefined ? {} : { sourceSnapshotIds }) }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '保存文档', kind: 'execute' }),
  }));
  const disposeList = ctx.tools.register(defineTool({
    name: PERSONAL_PROJECT_LIST_TOOL,
    description: 'List a bounded set of UTF-8 Markdown/plain-text files in the project selected by the user. Use an optional short search query. Returns opaque fileId values; never pass or request an absolute path.',
    parameters: { query: { type: 'string', description: 'Optional short filename query (up to 200 UTF-8 bytes).' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const query = safeQuery(args?.query);
      if (query === null) throw refused('PERSONAL_TOOL_INVALID');
      return bridge.request({ action: 'list_project', ...projectIdentity(exec), query }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '查找项目资料', kind: 'execute' }),
  }));
  const disposeRead = ctx.tools.register(defineTool({
    name: PERSONAL_PROJECT_READ_TOOL,
    description: 'Read one bounded page of a project file selected by opaque fileId from personal_list_project_files. Specify a 1-based startLine for later pages. Read every needed page before citing or summarizing its contents.',
    parameters: { fileId: { type: 'string', required: true },
      startLine: { type: 'integer', description: '1-based first line; omit for the first page.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (typeof args?.fileId !== 'string' || !/^file-[a-f0-9]{48}$/.test(args.fileId) ||
          (args.startLine !== undefined && (!Number.isSafeInteger(args.startLine) ||
            args.startLine < 1 || args.startLine > 1_000_000))) throw refused('PERSONAL_TOOL_INVALID');
      return bridge.request({ action: 'read_project', ...projectIdentity(exec), fileId: args.fileId,
        ...(args.startLine === undefined ? {} : { startLine: args.startLine }) }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '读取项目资料', kind: 'execute' }),
  }));
  const disposeBrowserOpen = ctx.tools.register(defineTool({
    name: PERSONAL_BROWSER_OPEN_TOOL,
    description: 'Read one public HTTP/HTTPS page that belongs to the current user browser task. The host checks the user-submitted URL, public network destination and real rendered page. Returns bounded visible text and observed link IDs. Never accepts JavaScript, cookies or browser actions.',
    parameters: { url: { type: 'string', required: true,
      description: 'Public page URL from the current user request; no local or private address.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const url = safePublicUrl(args?.url);
      if (!url) throw refused('PERSONAL_TOOL_INVALID');
      return bridge.request({ action: 'open_page', ...projectIdentity(exec), url }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '阅读公共网页', kind: 'execute' }),
  }));
  const disposeBrowserFollow = ctx.tools.register(defineTool({
    name: PERSONAL_BROWSER_FOLLOW_TOOL,
    description: 'Follow one link ID actually observed in a successful page snapshot of this same browser task. Pass only the prior snapshotId and linkId; the host resolves the URL. Never invent a link or provide a script, click target, form or download.',
    parameters: { snapshotId: { type: 'string', required: true },
      linkId: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (typeof args?.snapshotId !== 'string' || !/^source-[a-f0-9]{48}$/.test(args.snapshotId) ||
          typeof args?.linkId !== 'string' || !/^link-[a-f0-9]{40}$/.test(args.linkId)) {
        throw refused('PERSONAL_TOOL_INVALID');
      }
      return bridge.request({ action: 'follow_link', ...projectIdentity(exec),
        snapshotId: args.snapshotId, linkId: args.linkId }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '沿已读链接继续阅读', kind: 'execute' }),
  }));
  const disposeBrowserSegment = ctx.tools.register(defineTool({
    name: PERSONAL_BROWSER_SEGMENT_TOOL,
    description: 'Read one 0-based segment (0..31) from a frozen page capture already read in this same turn. Pass its exact source snapshotId and segmentIndex. The host checks the committed parent read, owner, task, receipt and capture version; this cannot navigate to a new URL. Cite only segments actually returned.',
    parameters: { snapshotId: { type: 'string', required: true },
      segmentIndex: { type: 'integer', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (typeof args?.snapshotId !== 'string' || !/^source-[a-f0-9]{48}$/.test(args.snapshotId) ||
          !Number.isSafeInteger(args.segmentIndex) || args.segmentIndex < 0 || args.segmentIndex > 31) {
        throw refused('PERSONAL_TOOL_INVALID');
      }
      return bridge.request({ action: 'read_segment', ...projectIdentity(exec),
        snapshotId: args.snapshotId, segmentIndex: args.segmentIndex }, exec.signal);
    },
    presentCall: () => ({ card: 'generic', title: '读取网页段落', kind: 'execute' }),
  }));
  const disposeGuard = ctx.tools.guard((exec) => [PERSONAL_DESKTOP_TOOL, PERSONAL_DOCUMENT_TOOL,
    PERSONAL_PROJECT_LIST_TOOL, PERSONAL_PROJECT_READ_TOOL,
    PERSONAL_BROWSER_OPEN_TOOL, PERSONAL_BROWSER_FOLLOW_TOOL, PERSONAL_BROWSER_SEGMENT_TOOL].includes(exec.name) &&
    exec.agent?.session?.header?.agentPreset !== 'personal-remote' ? 'PERSONAL_TOOL_SCOPE_DENIED' : undefined);
  ctx.effect(() => () => { disposeGuard(); disposeBrowserSegment(); disposeBrowserFollow(); disposeBrowserOpen(); disposeRead();
    disposeList(); disposeDocument(); disposeTool(); disposeProof(); approvals.close(); background.close(); bridge.close(); }, 'weftmate-personal-desktop: lifecycle');
}

export default { name, inject, apply };
