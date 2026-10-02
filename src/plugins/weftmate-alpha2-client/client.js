/**
 * DSH V4 client seam.  WeftMate uses only documented alpha.2 Client services:
 * ctx.remote.session (authenticated Session RPC/stream) and ctx.uiWorkspace
 * (official selection/retention).  It does not read a token, scrape the DSH
 * DOM, call the removed apiProxy, or synthesize a conversation result.
 */
window.__ModuleLoader__.load({
  id: '@weftmate/alpha2-client',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement
    var alpha2Services = null
    var alpha2Ui = null

    function makeStore() {
      // The conversation directory is part of the primary WeftMate surface,
      // rather than a transient modal hidden behind an official sidebar.
      var value = { page: 'chat', workbench: false, sessions: true, activity: null }
      var listeners = new Set()
      function set(next) { value = Object.assign({}, value, next); listeners.forEach(function (fn) { fn() }) }
      return {
        getSnapshot: function () { return value },
        subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
        page: function (page) { set({ page: page, workbench: false, sessions: page === 'chat' }) },
        workbench: function () { set({ page: 'chat', workbench: !value.workbench, sessions: false }) },
        close: function () { set({ page: 'chat', workbench: false, sessions: false }) },
        activity: function (activity) { set({ activity: activity }) },
      }
    }
    function useSource(source, fallback) {
      var _state = React.useState(function () { return source && source.getSnapshot ? source.getSnapshot() : fallback }), value = _state[0], setValue = _state[1]
      React.useEffect(function () {
        if (!source || !source.getSnapshot) { setValue(fallback); return function () {} }
        function update() { setValue(source.getSnapshot()) }
        update()
        return source.subscribe ? source.subscribe(update) : function () {}
      }, [source, fallback])
      return value
    }
    function errorText(error) { return error && error.code ? error.code + '：' + (error.message || '请求失败') : (error && error.message || String(error || '未知错误')) }
    function short(id) { return typeof id === 'string' && id.length > 12 ? id.slice(0, 8) + '…' : String(id || '未选择') }
    function textOf(value, depth) {
      depth = depth || 0
      if (depth > 5 || value === null || value === undefined) return ''
      if (typeof value === 'string' || typeof value === 'number') return String(value)
      if (Array.isArray(value)) return value.map(function (item) { return textOf(item, depth + 1) }).join('')
      if (typeof value === 'object') {
        if (typeof value.text === 'string') return value.text
        if (typeof value.delta === 'string') return value.delta
        if (value.content !== undefined) return textOf(value.content, depth + 1)
        if (value.message !== undefined) return textOf(value.message, depth + 1)
        if (value.chunk !== undefined) return textOf(value.chunk, depth + 1)
      }
      return ''
    }
    function eventRow(event) {
      var type = event.type || 'event'
      // Session V4 also publishes durable protocol facts (preset, sandbox,
      // inbox splice, turn start). They are essential to the engine but are
      // not messages a person should read as a chat transcript.
      if (type !== 'user/message' && type !== 'assistant/message'
        && type !== 'tool/call' && type !== 'tool/result'
        && type !== 'approval/request' && type !== 'approval/resolved') return null
      // Prompt assembly records can use the same event name for system-owned
      // context. Only a human-authored source is presented as “你”.
      if (type === 'user/message' && event.data && event.data.source
        && event.data.source.kind !== 'user') return null
      var role = type.indexOf('user/') === 0 ? 'user' : type.indexOf('assistant/') === 0 ? 'assistant' : 'system'
      var text = textOf(event.data)
      if (!text && type === 'turn/end') text = event.data && event.data.reason && event.data.reason.kind === 'aborted' ? '本轮已停止。' : '本轮已完成。'
      if (!text && type.indexOf('tool/') === 0) text = '工具过程：' + type.slice(5)
      return { id: String(event.seq) + ':' + type, seq: event.seq || 0, role: role, text: text || type, type: type }
    }
    var note = { margin: '5px 0 0', color: '#647793', fontSize: '12px', lineHeight: 1.5 }
    var empty = { margin: 0, padding: '10px', borderRadius: '9px', background: '#f6f8fc', color: '#71819a', fontSize: '12px', lineHeight: 1.55 }
    // Deliberately left-only.  The native alpha.2 right workspace owns files,
    // terminal, tabs, and its own lifecycle; WeftMate must never paint over it.
    var panel = { position: 'fixed', zIndex: 10010, top: '18px', left: '82px', width: 'min(304px, calc(100vw - 102px))', maxHeight: 'calc(100vh - 36px)', overflow: 'auto', pointerEvents: 'auto', padding: '16px', borderRadius: '16px', background: 'linear-gradient(160deg, rgba(18,29,54,.985), rgba(23,40,72,.985))', border: '1px solid rgba(139,169,226,.30)', boxShadow: '0 18px 54px rgba(0,0,0,.34)', fontFamily: 'system-ui, sans-serif', color: '#edf4ff' }
    var softButton = { border: '1px solid rgba(170,196,244,.22)', borderRadius: '9px', padding: '8px 10px', background: 'rgba(255,255,255,.07)', color: '#dce9ff', cursor: 'pointer', fontWeight: 650, fontSize: '12px' }
    function action(disabled, danger) { return { border: 0, borderRadius: '9px', padding: '8px 11px', background: disabled ? '#dbe4f2' : danger ? '#d85a70' : '#2469ed', color: disabled ? '#8191aa' : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '12px', whiteSpace: 'nowrap' } }

    function Brand() { return h('span', { 'data-weftmate-alpha2-brand': '', style: { color: '#2469ed', fontSize: '28px', fontWeight: 800 } }, '织') }
    function ShellHeader() {
      var state = useSource(alpha2Ui, alpha2Ui && alpha2Ui.getSnapshot())
      function open(page) { return function () { alpha2Ui && alpha2Ui.page(page) } }
      function item(key, label, symbol) {
        var active = state && ((key === 'workbench' && state.workbench) || (key !== 'workbench' && state.page === key && !state.workbench))
        return h('button', { type: 'button', onClick: key === 'workbench' ? function () { alpha2Ui && alpha2Ui.workbench() } : open(key),
          'data-weftmate-page': key === 'workbench' ? undefined : key,
          'data-weftmate-workbench-toggle-global': key === 'workbench' ? '' : undefined,
          'aria-label': label, 'aria-expanded': key === 'workbench' ? !!(state && state.workbench) : undefined,
          title: label, style: { width: '52px', minHeight: '54px', border: active ? '1px solid rgba(110,162,255,.72)' : '1px solid transparent', borderRadius: '14px', background: active ? 'linear-gradient(145deg, #376ff2, #2657cf)' : 'transparent', color: active ? '#fff' : '#9fb5dc', cursor: 'pointer', display: 'grid', gap: '3px', placeItems: 'center', fontSize: '10px', fontWeight: 700 } },
          h('span', { style: { fontSize: '19px', lineHeight: 1 } }, symbol), h('span', null, label))
      }
      return h('nav', { 'data-weftmate-alpha2-header': '', 'data-weftmate-alpha2-left-rail': '', 'aria-label': 'WeftMate 导航', style: { position: 'fixed', zIndex: 10011, top: '12px', bottom: '12px', left: '12px', width: '58px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', padding: '9px 3px', borderRadius: '18px', pointerEvents: 'auto', background: 'linear-gradient(180deg, rgba(18,31,58,.99), rgba(13,23,43,.99))', border: '1px solid rgba(140,169,223,.26)', boxShadow: '0 14px 44px rgba(0,0,0,.28)', font: '600 12px system-ui' } },
        h('strong', { title: 'WeftMate', 'aria-label': 'WeftMate', style: { width: '38px', height: '38px', borderRadius: '13px', display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(145deg, #4f85ff, #2855d4)', fontSize: '21px', boxShadow: '0 8px 18px rgba(40,85,212,.35)' } }, '纬'),
        item('chat', '对话', '◰'), item('memory', '记忆', '◇'), item('mods', 'Mods', '▦'), item('settings', '设置', '⚙'),
        h('span', { style: { flex: 1 } }), item('workbench', '概览', '◧'))
    }
    function StreamView(props) {
      var session = props.useSession(function (state) { return state }) || {}
      var _rows = React.useState([]), rows = _rows[0], setRows = _rows[1]
      var _live = React.useState(''), live = _live[0], setLive = _live[1]
      var _notice = React.useState('正在连接会话事件流…'), notice = _notice[0], setNotice = _notice[1]
      // The transient Assistant stream and the durable journal arrive on one
      // Remote but can be observed in either terminal order. Keep the journal
      // boundary authoritative so a late stream-end cannot erase a confirmed
      // `turn/end` message.
      var turnSettled = React.useRef(false)
      var _stop = React.useState(false), stopping = _stop[0], setStopping = _stop[1]
      React.useEffect(function () {
        var controller = new AbortController(), dead = false, events = new Map()
        function render() { if (!dead) setRows(Array.from(events.values()).sort(function (a, b) { return a.seq - b.seq })) }
        function add(event) {
          var row = eventRow(event)
          if (row !== null) events.set(row.id, row)
          if (event.type === 'turn/end') {
            turnSettled.current = true
            var stopped = event.data && event.data.reason && event.data.reason.kind === 'aborted'
            var confirmed = stopped ? 'DSH 已确认 turn/end：本轮已停止。' : 'DSH 已确认 turn/end：本轮已结束。'
            setNotice(confirmed)
            alpha2Ui && alpha2Ui.activity({ kind: stopped ? 'stopped' : 'completed', text: confirmed })
          } else if (event.type === 'turn/start') {
            turnSettled.current = false
            setStopping(false)
            alpha2Ui && alpha2Ui.activity({ kind: 'running', text: 'DSH 正在处理当前回合。' })
          } else if (event.type === 'tool/call') {
            alpha2Ui && alpha2Ui.activity({ kind: 'tool', text: '正在执行一项工具操作。' })
          } else if (event.type === 'approval/request') {
            alpha2Ui && alpha2Ui.activity({ kind: 'approval', text: '有一项授权等待处理。' })
          }
          render()
        }
        async function follow() {
          try {
            for await (var frame of props.remote.session.follow({ address: { kind: 'session', sessionId: props.sessionId }, assistantStream: true }, controller.signal)) {
              if (dead) return
              if (frame.type === 'snapshot') { frame.records.forEach(function (record) { add(record.event) }); setNotice(frame.hasMore ? '已显示最近历史；更早内容可在官方对话加载。' : '会话历史已同步。') }
              else if (frame.type === 'assistant-stream') {
                if (frame.frame.type === 'start') { setLive('正在生成…'); setNotice('正在接收实时回复。') }
                if (frame.frame.type === 'chunk') setLive(function (value) { return value + textOf(frame.frame.chunk) })
                if (frame.frame.type === 'end') {
                  setLive('')
                  if (!turnSettled.current) setNotice(frame.frame.outcome.kind === 'abandoned'
                    ? '模型流已中止，等待 DSH turn/end…'
                    : '回复流已写入，等待 DSH turn/end…')
                }
              } else { add(frame.event) }
            }
          } catch (error) { if (!controller.signal.aborted) setNotice('事件流不可用：' + errorText(error)) }
        }
        void follow(); return function () { dead = true; controller.abort() }
      }, [props.remote, props.sessionId])
      async function stop() {
        if (!session.running || stopping) return
        setStopping(true)
        setNotice('停止请求已发送，正在等待 DSH 的 turn/end…')
        try {
          var result = await props.remote.session.cancel({ sessionId: props.sessionId })
          if (!result.ok) throw result.error
        } catch (error) {
          setStopping(false)
          setNotice('停止请求失败：' + errorText(error))
        }
      }
      var awaitingStop = stopping && !turnSettled.current
      return h('section', { 'data-weftmate-alpha2-weave-view': '', 'data-weftmate-v2-shell': 'alpha2', style: { maxWidth: '820px', margin: '12px auto', padding: '16px', borderRadius: '16px', background: '#fff', border: '1px solid #dfe8f3', boxShadow: '0 8px 24px rgba(43,70,108,.08)', fontFamily: 'system-ui, sans-serif', color: '#314866' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } }, h('div', null, h('strong', { style: { color: '#17243f' } }, 'Weave 实时会话'), h('p', { style: note }, '会话 ' + short(props.sessionId) + ' · ' + (session.running ? '运行中' : '空闲')), h('p', { 'data-weftmate-stream-status': '', role: 'status', style: note }, notice)), h('div', { style: { textAlign: 'right' } }, h('button', { type: 'button', onClick: stop, disabled: !session.running || awaitingStop, style: action(!session.running || awaitingStop, true) }, awaitingStop ? '等待停止' : '停止'), h('p', { style: Object.assign({}, note, { maxWidth: '190px' }) }, '发送与附件继续使用下方 DSH 官方输入区。'))),
        h('div', { style: { display: 'grid', gap: '8px', maxHeight: '42vh', overflow: 'auto', padding: '8px 0' } }, rows.length === 0 ? h('p', { style: empty }, '暂无消息；这里不会把空历史伪装成示例对话。') : rows.map(function (row) { return h('article', { key: row.id, 'data-weftmate-message-role': row.role, style: { padding: '9px 10px', borderRadius: '10px', background: row.role === 'user' ? '#edf4ff' : row.role === 'assistant' ? '#f8fafc' : '#fff8e9', border: '1px solid #e4eaf3', fontSize: '13px', lineHeight: 1.52, whiteSpace: 'pre-wrap' } }, h('small', { style: { color: '#71819a', fontWeight: 700 } }, row.role === 'user' ? '你' : row.role === 'assistant' ? 'WeftMate' : '系统'), h('div', { style: { marginTop: '3px' } }, row.text)) }), live ? h('article', { 'data-weftmate-live-message': '', style: { padding: '9px 10px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e4eaf3', whiteSpace: 'pre-wrap' } }, h('small', { style: { color: '#71819a' } }, 'WeftMate · 实时'), h('div', null, live)) : null),
        h('p', { style: note }, '内部协议状态与当前操作摘要可在 WeftMate 工作台查看。'))
    }

    function Overlay(props) {
      var state = useSource(props.ui, props.ui.getSnapshot())
      var local = useSource(props.ctx.sessions.list, { ids: [], byId: {} })
      var _directory = React.useState({ phase: 'loading', items: [], error: null }), directory = _directory[0], setDirectory = _directory[1]
      var _catalog = React.useState({ phase: 'idle', providers: [], failures: [], error: null }), catalog = _catalog[0], setCatalog = _catalog[1]
      var _capability = React.useState({ phase: 'loading', value: null, error: null }), capability = _capability[0], setCapability = _capability[1]
      var _memory = React.useState({ phase: 'idle', value: null, error: null }), memory = _memory[0], setMemory = _memory[1]
      var refresh = React.useCallback(async function () {
        try { var result = await props.ctx.remote.session.list({}); if (!result.ok) throw result.error; setDirectory({ phase: 'ready', items: result.value.items || [], error: null }) } catch (error) { setDirectory({ phase: 'error', items: [], error: error }) }
      }, [props.ctx])
      React.useEffect(function () { void refresh(); var a = props.ctx.remote.$on('api-session/added', refresh), b = props.ctx.remote.$on('api-session/removed', refresh); return function () { a && a(); b && b() } }, [props.ctx, refresh])
      React.useEffect(function () {
        if (state.page !== 'settings') return
        var cancelled = false; setCatalog({ phase: 'loading', providers: [], failures: [], error: null })
        props.ctx.remote.session.modelCatalog().then(function (result) { if (!result.ok) throw result.error; if (!cancelled) setCatalog({ phase: 'ready', providers: result.value.routableProviders || [], failures: result.value.failures || [], error: null }) }).catch(function (error) { if (!cancelled) setCatalog({ phase: 'error', providers: [], failures: [], error: error }) })
        return function () { cancelled = true }
      }, [props.ctx, state.page])
      React.useEffect(function () {
        var cancelled = false
        fetch('/api/weftmate/status', { credentials: 'same-origin' }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }).then(function (value) {
          if (!cancelled) setCapability({ phase: 'ready', value: value, error: null })
        }).catch(function (error) {
          if (!cancelled) setCapability({ phase: 'error', value: null, error: error })
        })
        return function () { cancelled = true }
      }, [])
      React.useEffect(function () {
        if (state.page !== 'memory') return
        var cancelled = false
        setMemory({ phase: 'loading', value: null, error: null })
        fetch('/api/weftmate/memory/status', { credentials: 'same-origin' }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }).then(function (value) {
          if (!cancelled) setMemory({ phase: 'ready', value: value, error: null })
        }).catch(function (error) {
          if (!cancelled) setMemory({ phase: 'error', value: null, error: error })
        })
        return function () { cancelled = true }
      }, [state.page])
      if (state.page === 'chat' && !state.workbench && !state.sessions) return null
      async function create() { try { var result = await props.ctx.remote.session.create({}); if (!result.ok) throw result.error; props.ctx.uiWorkspace.openSession(result.value.sessionId); props.ui.close(); await refresh() } catch (error) { setDirectory(function (previous) { return Object.assign({}, previous, { error: error }) }) } }
      function close() { props.ui.close() }
      function sessionsBody() {
        if (directory.phase === 'loading') return h('p', { style: note }, '正在读取 DSH 会话目录…')
        if (directory.phase === 'error') return h('div', null, h('p', { style: Object.assign({}, note, { color: '#aa3450' }) }, '读取失败：' + errorText(directory.error)), h('button', { type: 'button', onClick: refresh, style: softButton }, '重试'))
        return h('div', { style: { display: 'grid', gap: '8px', marginTop: '12px' } }, h('button', { type: 'button', onClick: create, 'data-weftmate-new-session': '', style: action(false, false) }, '+ 新建会话'), directory.items.length === 0 ? h('p', { style: empty }, 'DSH 已返回空会话目录；这里不会使用示例数据。') : directory.items.slice(0, 20).map(function (item) { var title = item.projections && item.projections.title || item.cwd || short(item.sessionId); return h('button', { key: item.sessionId, type: 'button', onClick: function () { props.ctx.uiWorkspace.openSession(item.sessionId); props.ui.close() }, style: { border: '1px solid #e0e8f3', borderRadius: '9px', padding: '9px', background: '#fff', color: '#314866', cursor: 'pointer', textAlign: 'left', display: 'grid', gap: '3px', fontSize: '12px' } }, h('strong', null, title), h('small', { style: { color: '#71819a' } }, item.running ? '运行中' : item.blank ? '新会话' : '已保存')) }))
      }
      function workbench() { var current = local.ids.find(function (id) { return local.byId[id] && local.byId[id].retainedBy && local.byId[id].retainedBy.mainView > 0 }), summary = current && local.byId[current], caps = capability.value && capability.value.capabilities || capability.value || {}, activity = state.activity; return h('div', { style: { display: 'grid', gap: '10px', marginTop: '12px' } }, h('div', { style: empty }, h('strong', null, summary && summary.running ? '任务进行中' : '当前无运行任务'), h('p', { style: note }, summary ? '会话 ' + short(current) + (summary.running ? ' 正在执行；停止要等待 turn/end。' : ' 已空闲。') : '尚未选择会话。')), activity ? h('div', { 'data-weftmate-workbench-activity': activity.kind, style: empty }, h('strong', null, '当前摘要'), h('p', { style: note }, activity.text)) : h('p', { style: note }, '协议事件不会混入聊天记录；工具、授权与回合状态会在这里显示摘要。'), capability.phase === 'ready' ? h('p', { style: note }, caps.transport === 'official-typert-remote-v4' ? '会话能力已由官方 DSH V4 Remote 提供。' : '候选能力状态已读取。') : capability.phase === 'error' ? h('p', { style: Object.assign({}, note, { color: '#aa3450' }) }, '候选能力状态读取失败：' + errorText(capability.error)) : h('p', { style: note }, '正在读取候选能力状态…')) }
      function settings() { if (catalog.phase === 'loading') return h('p', { style: note }, '正在读取 DSH 模型目录…'); if (catalog.phase === 'error') return h('p', { style: Object.assign({}, note, { color: '#aa3450' }) }, '模型目录不可用：' + errorText(catalog.error)); return h('div', { style: { marginTop: '12px' } }, h('p', { style: note }, '模型选择仍由 DSH 官方输入栏和安全凭据桥处理；本页不读取或保存密钥。'), catalog.providers.length ? catalog.providers.map(function (provider) { return h('p', { key: provider.id || provider.provider || String(provider), style: empty }, String(provider.id || provider.provider || provider)) }) : h('p', { style: empty }, '当前没有可路由模型。'), catalog.failures.length ? h('p', { style: Object.assign({}, note, { color: '#aa3450' }) }, '提供方异常：' + catalog.failures.map(errorText).join('；')) : null) }
      function memoryBody() { if (memory.phase === 'loading') return h('p', { style: note }, '正在读取记忆候选状态…'); if (memory.phase === 'error') return h('p', { style: Object.assign({}, note, { color: '#aa3450' }) }, '记忆状态读取失败：' + errorText(memory.error)); var view = memory.value || {}; if (view.enabled === true) return h('div', { style: { marginTop: '12px' } }, h('p', { style: note }, '记忆回合交接已部分接入（' + (view.protocol || '协议未知') + '）。recall 与 pre-step 尚未迁移，因此这里不会显示“记忆已就绪”。'), h('p', { style: empty }, '当前可验证交接状态；检索、采用、纠正和恢复界面仍待接入。')); return h('div', { style: { marginTop: '12px' } }, h('p', { style: note }, '记忆当前未启用。该状态来自 alpha.2 宿主，不以空列表伪装成已连接。'), h('p', { style: empty }, '启用后的 turn/end 交接、recall 和前置上下文仍分别验收。')) }
      function unready(label, key) { var caps = capability.value && capability.value.capabilities || capability.value || {}, enabled = caps[key]; if (capability.phase === 'loading') return h('p', { style: note }, '正在读取 ' + label + ' 的候选能力状态…'); if (capability.phase === 'error') return h('p', { style: Object.assign({}, note, { color: '#aa3450' }) }, label + ' 状态读取失败：' + errorText(capability.error)); return h('div', { style: { marginTop: '12px' } }, h('p', { style: note }, enabled === false ? label + ' 的 alpha.2 宿主能力当前为未接入。不会把旧版数据、按钮或样例冒充为新版能力。' : label + ' 能力尚未可用；宿主未宣称已经接入。'), h('p', { style: empty }, '待接入真实状态、授权、失败反馈与恢复链路。')) }
      var content = state.workbench ? workbench() : state.page === 'chat' ? sessionsBody() : state.page === 'settings' ? settings() : state.page === 'memory' ? memoryBody() : unready('Mods', 'mods')
      var title = state.workbench ? '工作台' : ({ chat: '会话', memory: '记忆', mods: 'Mods', settings: '设置' }[state.page])
      return h('aside', { 'data-weftmate-alpha2-panel': state.workbench ? 'workbench' : state.page, role: 'dialog', 'aria-label': 'WeftMate ' + title, style: panel }, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } }, h('strong', { style: { color: '#17243f' } }, title), h('button', { type: 'button', onClick: close, 'aria-label': '关闭面板', style: Object.assign({}, softButton, { width: '28px', height: '28px', padding: 0, fontSize: '18px' }) }, '×')), content)
    }

    // `shell.overlay` is root-scoped and does not pass the plugin's services
    // as slot props.  Keep the shell control and its stateful panel in the
    // same registered component so a navigation click rerenders the mounted
    // panel instead of merely updating a detached store.
    function ShellOverlay() {
      if (!alpha2Ui || !alpha2Services) return null
      return h(React.Fragment, null,
        h(ShellHeader),
        h(Overlay, { ui: alpha2Ui, ctx: alpha2Services }))
    }

    return {
      name: 'weftmate-alpha2-client',
      inject: ['slots', 'remote', 'remote.session', 'sessions', 'uiWorkspace'],
      apply: function (ctx) {
        alpha2Ui = makeStore()
        alpha2Services = { remote: ctx.get('remote'), sessions: ctx.get('sessions'), uiWorkspace: ctx.get('uiWorkspace') }
        ctx.slots.inject('conversation.hero.brand.mark', function () { return ctx.slots.register({ name: 'conversation.hero.brand.mark', id: 'weftmate-alpha2-brand', order: -100 }, Brand) })
        ctx.slots.inject('conversation.view', function () { return ctx.slots.register({ name: 'conversation.view', id: 'weftmate-alpha2-weave', label: '织语', order: 5, inject: function () { return { remote: alpha2Services.remote } } }, StreamView) })
        // Alpha.2 now owns the V2 navigation/session column in native
        // ui-sidebar. Do not mount the old fixed ShellOverlay: it would
        // duplicate the left rail and obscure the native session browser.
      },
    }
  },
})
