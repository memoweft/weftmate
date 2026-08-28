/**
 * WeftMate 客户端插件（R3-01/R3-02），浏览器 half，手写 classic script（无构建步骤）。
 *
 * 载入：modules node half 服务本文件于 `/plugins/@weftmate/client/client.js`（cache-control: no-cache），
 * 以外部 classic script 注入；脚本唯一职责是向 window.__ModuleLoader__ 注册 factory。
 * factory 在 materialize 时收到同步 require，返回 cordis 客户端插件对象 { name, inject, apply }。
 *
 * Slot 选择依据（以 DSH checkout 源码为准）：
 * - `shell.overlay`（packages/client/ui-layout/src/client/index.ts SlotMap 声明 + AppFrame.tsx renderSlot）
 *   是「frame-wide floating layer」的 list 槽位：additive（新 id 追加而非替换）、root 作用域、无 owner props。
 *   官方注释明确「a badge ... a status pill all belong here」——与本插件的「品牌标识 + 托盘联动状态条」吻合。
 *
 * R3-02 接缝（main ↔ 宿主插件 ↔ 本 UI）：
 * - 状态面：轮询 `GET /weftmate/status.json`（宿主插件实时读 main 写的状态文件；10s 一次），
 *   展示真实版本、托盘常驻、更新态（disabled/checking/available/downloaded/error）。
 * - 动作面：更新已下载时胶囊出现「重启安装」按钮（此时才恢复 pointer-events），
 *   `POST /weftmate/update {action:'install'}`；「检查更新」留 R3-03 设置卡（本胶囊保持最小）。
 * - 连接态：继续从官方 connection.hostDescription 可观察源读「运行时已连接」真值。
 *
 * 开关面（R6/R8 收口）：感知/桌宠浮动胶囊已删，全部开关并入官方设置页
 * `settings.section` 槽位的「WeftMate」节（感知/桌宠/设备配对块）；
 * shell.overlay 只剩品牌状态条 + 记忆管理胶囊。
 */
window.__ModuleLoader__.load({
  id: '@weftmate/client',
  factory: function (require) {
    var React = require('react')

    /** 状态接口失败/首次加载时的回退（与宿主插件 fallbackState 同形状语义）。 */
    var FALLBACK_STATE = {
      app: { name: 'WeftMate', version: 'dev' },
      tray: { resident: false },
      dataDirs: null,
      update: { enabled: false, status: 'disabled', version: null, error: null },
    }

    var baseStyle = {
      position: 'absolute',
      top: '12px',
      right: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '7px 14px',
      borderRadius: '999px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
      border: '1.5px solid var(--dsw-alias-brand-primary, var(--dsw-alias-border-l1))',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px',
      lineHeight: '1',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
    }
    var brandStyle = { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 }
    var dimStyle = { color: 'var(--dsw-alias-label-secondary)' }
    var separatorStyle = { width: '1px', height: '10px', background: 'var(--dsw-alias-border-l2)' }
    var dotStyle = function (connected) {
      return {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: connected ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)',
      }
    }
    var installBtnStyle = {
      pointerEvents: 'auto',
      cursor: 'pointer',
      border: '1px solid var(--dsw-alias-brand-primary)',
      background: 'var(--dsw-alias-brand-primary)',
      color: '#fff',
      borderRadius: '999px',
      padding: '3px 10px',
      fontSize: '11px',
      lineHeight: '1.2',
    }

    function pollStatus(setState) {
      fetch('/weftmate/status.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (state) { if (state && typeof state === 'object') setState(state) })
        .catch(function () { /* 网络抖动保持旧值 */ })
    }

    function pollPerception(setState) {
      fetch('/weftmate/perception.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (perception) { if (perception && typeof perception === 'object') setState(perception) })
        .catch(function () { /* 网络抖动保持旧值 */ })
    }

    /** 设置节动作面：确定性 set-* 动作 + value；失败静默（轮询以真值纠正）。 */
    function postSeam(path, action, value) {
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action, value: value }),
      }).catch(function () { /* 请求失败保持旧值 */ })
    }

    var FALLBACK_PERCEPTION = {
      config: {
        enabled: false,
        capture: 'app_title',
        clipboard: false,
        inject: { enabled: false, intervalMs: 60_000 },
        mobile: false,
      },
      sample: null,
    }

    /** 品牌 + 托盘联动状态条（纯指示；仅「重启安装」可点）。 */
    function WeftMateStatusBadge(props) {
      var source = props.hostDescription
      var descState = React.useState(function () { return source.getSnapshot() })
      var desc = descState[0]
      var setDesc = descState[1]

      var statusState = React.useState(FALLBACK_STATE)
      var status = statusState[0]
      var setStatus = statusState[1]

      React.useEffect(function () {
        var update = function () { setDesc(source.getSnapshot()) }
        var unsubscribe = source.subscribe(update)
        update()
        return unsubscribe
      }, [source])

      React.useEffect(function () {
        pollStatus(setStatus)
        var timer = setInterval(function () { pollStatus(setStatus) }, 10_000)
        return function () { clearInterval(timer) }
      }, [])

      var connected = desc !== undefined && desc !== null
      var version = status.app && typeof status.app.version === 'string' ? status.app.version : '0.0.0'
      var trayResident = status.tray && status.tray.resident === true
      var update = status.update || FALLBACK_STATE.update
      var updateReady = update.status === 'downloaded'
      var updateBusy = update.status === 'checking' || update.status === 'available'
      var updateFailed = update.status === 'error'

      var children = [
        React.createElement('span', { key: 'brand', style: brandStyle }, 'WeftMate'),
        React.createElement('span', { key: 'version', style: dimStyle }, 'v' + version),
        React.createElement('span', { key: 'sep1', style: separatorStyle }),
        React.createElement('span', { key: 'dot', style: dotStyle(connected) }),
        React.createElement(
          'span',
          { key: 'conn', style: dimStyle },
          connected ? '运行时已连接' : '连接中…',
        ),
        React.createElement('span', { key: 'sep2', style: separatorStyle }),
        React.createElement('span', { key: 'tray', style: dimStyle }, trayResident ? '托盘常驻' : '托盘未就绪'),
      ]
      if (updateReady) {
        children.push(React.createElement('span', { key: 'sep3', style: separatorStyle }))
        children.push(React.createElement(
          'button',
          {
            key: 'install',
            style: installBtnStyle,
            onClick: function () {
              fetch('/weftmate/update', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'install' }),
              }).catch(function () { /* 请求失败保持旧值 */ })
            },
          },
          '重启安装 v' + (update.version || ''),
        ))
      } else if (updateBusy) {
        children.push(React.createElement('span', { key: 'sep3', style: separatorStyle }))
        children.push(React.createElement('span', { key: 'upd', style: dimStyle }, '更新下载中…'))
      } else if (updateFailed) {
        children.push(React.createElement('span', { key: 'sep3', style: separatorStyle }))
        children.push(React.createElement('span', { key: 'upd', style: dimStyle }, '更新出错'))
      }

      var containerStyle = Object.assign({}, baseStyle)
      if (!updateReady) {
        containerStyle.pointerEvents = 'none'
        containerStyle.userSelect = 'none'
      }
      var title = 'WeftMate 托盘联动状态条'
      if (status.dataDirs && typeof status.dataDirs.workspace === 'string') {
        title += ' · 工作区 ' + status.dataDirs.workspace
      }
      return React.createElement('div', { style: containerStyle, title: title }, children)
    }

    // ── 记忆管理页（MemoWeft dsh_rpc v2：健康/浏览/搜索/导出）──
    var memoryPanelStyle = {
      position: 'absolute', top: '84px', right: '12px', width: '340px', maxHeight: '70vh',
      display: 'flex', flexDirection: 'column', gap: '10px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
      border: '1.5px solid var(--dsw-alias-brand-primary, var(--dsw-alias-border-l1))',
      borderRadius: '12px', padding: '14px', color: 'var(--dsw-alias-label-primary)',
      fontSize: '13px', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)', zIndex: 60, overflow: 'auto',
    }
    var sectionTitleStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' }
    var listItemStyle = { padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)', display: 'flex', justifyContent: 'space-between', gap: '8px' }
    var pillStyle = { fontSize: '11px', color: 'var(--dsw-alias-brand-primary)' }

    function fetchMemoryJson(path, setter) {
      fetch(path, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (data) { if (data && typeof data === 'object') setter(data) })
        .catch(function () { /* 失败保持旧值 */ })
    }

    function MemoryBadge() {
      var worldState = React.useState({ cognitions: [] })
      var world = worldState[0]
      var setWorld = worldState[1]
      var healthState = React.useState({ ready: false, protocolVersion: null })
      var health = healthState[0]
      var setHealth = healthState[1]
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]

      React.useEffect(function () {
        fetchMemoryJson('/weftmate/memory/world.json', setWorld)
        fetchMemoryJson('/weftmate/memory/health.json', setHealth)
        var timer = setInterval(function () { fetchMemoryJson('/weftmate/memory/world.json', setWorld) }, 30_000)
        var healthTimer = setInterval(function () { fetchMemoryJson('/weftmate/memory/health.json', setHealth) }, 10_000)
        return function () { clearInterval(timer); clearInterval(healthTimer) }
      }, [])

      var cognitions = world.cognitions || []
      var entities = world.entities || []
      var relationships = world.relationships || []
      var events = world.events || []
      var protocolLabel = health.protocolVersion ? 'v' + health.protocolVersion : '连接中'
      var label = '记忆 ' + protocolLabel + ' · ' + cognitions.length + ' 条'
      var capsuleStyle = Object.assign({}, baseStyle, { top: '48px', pointerEvents: 'auto', cursor: 'pointer' })
      var capsule = React.createElement(
        'div',
        { key: 'capsule', style: capsuleStyle, title: health.ready ? 'MemoWeft 版本化桥接已就绪' : 'MemoWeft 桥接尚未就绪', onClick: function () { setOpen(!open) } },
        React.createElement('span', { key: 'dot', style: dotStyle(health.ready === true) }),
        React.createElement('span', { key: 'label', style: health.ready ? {} : dimStyle }, label),
      )
      if (!open) return capsule

      return React.createElement('div', { key: 'memory-root' }, capsule, React.createElement(MemoryPanel, {
        world: world,
        health: health,
        onClose: function () { setOpen(false) },
      }))
    }

    function MemoryPanel(props) {
      var searchState = React.useState('')
      var query = searchState[0]
      var setQuery = searchState[1]
      var resultState = React.useState(null)
      var result = resultState[0]
      var setResult = resultState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      var world = props.world || {}
      var health = props.health || {}
      var cognitions = world.cognitions || []
      var entities = world.entities || []
      var relationships = world.relationships || []
      var events = world.events || []

      var doSearch = function () {
        if (!query.trim() || busy) return
        setBusy(true)
        fetch('/weftmate/memory/search.json?q=' + encodeURIComponent(query.trim()))
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (data) { setResult(data); setBusy(false) })
          .catch(function () { setBusy(false) })
      }

      var doExport = function () {
        fetch('/weftmate/memory/export.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (data) {
            if (!data) return
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            var url = URL.createObjectURL(blob)
            var a = document.createElement('a')
            a.href = url
            a.download = 'weftmate-memory-export.json'
            a.click()
            URL.revokeObjectURL(url)
          })
          .catch(function () { /* 导出失败静默 */ })
      }

      var rows = []
      rows.push(React.createElement('div', { key: 'cog-title', style: sectionTitleStyle }, '认知 · ' + cognitions.length))
      for (var i = 0; i < cognitions.length; i++) {
        rows.push(React.createElement(
          'div', { key: 'cog' + i, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(cognitions[i].content || '')),
          React.createElement('span', { key: 'c', style: pillStyle }, String(cognitions[i].confidence || '')),
        ))
      }
      rows.push(React.createElement('div', { key: 'ent-title', style: sectionTitleStyle }, '实体 · ' + entities.length))
      for (var j = 0; j < entities.length; j++) {
        rows.push(React.createElement(
          'div', { key: 'ent' + j, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(entities[j].canonical_name || '')),
          React.createElement('span', { key: 'k', style: pillStyle }, String(entities[j].kind || '')),
        ))
      }
      rows.push(React.createElement('div', { key: 'rel-title', style: sectionTitleStyle }, '关系 · ' + relationships.length))
      for (var k = 0; k < relationships.length; k++) {
        rows.push(React.createElement(
          'div', { key: 'rel' + k, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(relationships[k].content || '')),
          React.createElement('span', { key: 'c', style: pillStyle }, String(relationships[k].confidence || '')),
        ))
      }
      rows.push(React.createElement('div', { key: 'ev-title', style: sectionTitleStyle }, '事件 · ' + events.length))
      for (var m = 0; m < events.length; m++) {
        rows.push(React.createElement(
          'div', { key: 'ev' + m, style: listItemStyle },
          React.createElement('span', { key: 't' }, String(events[m].content || '')),
          React.createElement('span', { key: 'c', style: pillStyle }, String(events[m].confidence || '')),
        ))
      }

      var searchBlock = [
        React.createElement('div', { key: 's-title', style: sectionTitleStyle }, '确定性搜索（0 生成调用）'),
        React.createElement('div', { key: 's-row', style: { display: 'flex', gap: '8px' } },
          React.createElement('input', {
            key: 's-input', value: query, style: { flex: 1, background: 'transparent', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', padding: '6px 8px', color: 'inherit' },
            onChange: function (e) { setQuery(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') doSearch() },
            placeholder: '问点什么（如：我喜欢喝什么）',
          }),
          React.createElement('button', { key: 's-btn', style: installBtnStyle, onClick: doSearch }, busy ? '…' : '搜索'),
        ),
      ]
      if (result !== null) {
        var hit = result && typeof result.text === 'string' && result.text.trim()
        searchBlock.push(React.createElement('div', {
          key: 's-result', style: { padding: '8px', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1)', whiteSpace: 'pre-wrap' },
        }, hit ? result.text : (result && result.count === 0 ? '没有命中的记忆（诚实回答：未找到）' : '查询失败')))
      }

      return React.createElement(
        'div', { style: memoryPanelStyle },
        React.createElement('div', { key: 'h', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('span', { key: 't', style: brandStyle }, '记忆管理'),
          React.createElement('span', { key: 'sub', style: dimStyle }, '本机 · MemoWeft 2.0 · RPC v' + (health.protocolVersion || '?')),
          React.createElement('button', { key: 'x', style: installBtnStyle, onClick: props.onClose }, '×'),
        ),
        searchBlock,
        React.createElement('div', { key: 'list', style: { flex: 1, overflow: 'auto' } }, rows),
        React.createElement('div', { key: 'f', style: { display: 'flex', gap: '8px' } },
          React.createElement('button', { key: 'export', style: installBtnStyle, onClick: doExport }, '导出备份'),
          React.createElement('span', { key: 'note', style: dimStyle }, 'Evidence 与 provenance 一并导出'),
        ),
      )
    }

    // ── R6/R8 设置节 · 官方设置页「WeftMate」节（感知/桌宠/设备配对；胶囊已删，控制面唯一）──
    var sectionBlockStyle = { marginBottom: '20px' }
    var sectionBlockTitleStyle = {
      fontSize: '12px', color: 'var(--dsw-alias-label-secondary)',
      marginBottom: '8px', letterSpacing: '0.4px',
    }
    var sectionRowStyle = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)',
    }
    var sectionRowLabelStyle = { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' }
    var sectionHintStyle = {
      fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '2px', lineHeight: '1.5',
    }
    var sectionSmallBtnStyle = {
      cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
      color: 'var(--dsw-alias-label-primary)', borderRadius: '6px', padding: '3px 10px',
      fontSize: '12px', lineHeight: '1.4',
    }
    var FALLBACK_DEVICE = { schemaVersion: 1, pairing: null, devices: [] }

    function Toggle(props) {
      return React.createElement('button', {
        key: 'toggle', type: 'button', role: 'switch',
        'aria-checked': props.checked === true,
        title: props.title,
        onClick: function () { props.onChange(props.checked !== true) },
        style: {
          width: '36px', height: '20px', borderRadius: '999px', border: 'none', cursor: 'pointer',
          padding: 0, position: 'relative', flexShrink: 0,
          background: props.checked === true ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
          transition: 'background 0.15s ease',
        },
      }, React.createElement('span', {
        key: 'knob', style: {
          position: 'absolute', top: '2px', left: props.checked === true ? '18px' : '2px',
          width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)', transition: 'left 0.15s ease',
        },
      }))
    }

    function Row(props) {
      return React.createElement('div', { key: 'row', style: sectionRowStyle },
        React.createElement('div', { key: 'text', style: { minWidth: 0 } },
          React.createElement('div', { key: 'label', style: sectionRowLabelStyle }, props.label),
          props.hint ? React.createElement('div', { key: 'hint', style: sectionHintStyle }, props.hint) : null,
        ),
        React.createElement('div', { key: 'control' }, props.control),
      )
    }

    function CaptureSeg(props) {
      var options = [
        { value: 'app_title', label: '应用+标题' },
        { value: 'app_only', label: '仅应用' },
      ]
      var buttons = options.map(function (opt) {
        var active = props.value === opt.value
        return React.createElement('button', {
          key: opt.value, type: 'button',
          onClick: function () { if (!active) props.onChange(opt.value) },
          style: {
            border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', cursor: 'pointer',
            background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
            color: active ? '#fff' : 'var(--dsw-alias-label-primary)',
            padding: '4px 10px', fontSize: '12px', lineHeight: '1.4',
          },
        }, opt.label)
      })
      return React.createElement('div', { key: 'seg', style: { display: 'flex', gap: '6px' } }, buttons)
    }

    function fmtDeviceTime(iso) {
      if (!iso) return '—'
      var d = new Date(iso)
      return isNaN(d.getTime()) ? String(iso) : d.toLocaleString()
    }

    function fmtTokenLeft(ms) {
      if (typeof ms !== 'number' || ms <= 0) return '已过期（自动轮换）'
      var total = Math.floor(ms / 1000)
      var m = Math.floor(total / 60)
      var s = total % 60
      return m + ' 分 ' + (s < 10 ? '0' : '') + s + ' 秒'
    }

    function DeviceBlock(props) {
      var state = props.state
      var pairing = state && state.pairing
      var devices = (state && state.devices) || []
      var leftMs = pairing && typeof pairing.expiresAt === 'number' ? pairing.expiresAt - Date.now() : null
      var copiedState = React.useState(false)
      var copied = copiedState[0]
      var setCopied = copiedState[1]

      var copyToken = function () {
        var text = pairing && typeof pairing.token === 'string' ? pairing.token : ''
        if (!text) return
        var done = function () {
          setCopied(true)
          setTimeout(function () { setCopied(false) }, 1500)
        }
        if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === 'function') {
          window.navigator.clipboard.writeText(text).then(done).catch(function () { /* 剪贴板被拒：静默 */ })
        } else {
          done() // 无剪贴板 API：仍给反馈，用户可手动选中复制
        }
      }

      var tokenNode = pairing && typeof pairing.token === 'string'
        ? React.createElement('div', { key: 'token', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 0' } },
            React.createElement('code', {
              key: 't',
              style: {
                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px',
                background: 'var(--dsw-alias-bg-layer-1)', padding: '6px 8px', borderRadius: '6px',
                wordBreak: 'break-all', color: 'var(--dsw-alias-label-primary)',
              },
            }, pairing.token),
            React.createElement('button', { key: 'c', type: 'button', style: sectionSmallBtnStyle, onClick: copyToken }, copied ? '已复制' : '复制'),
            React.createElement('span', { key: 'x', style: sectionHintStyle }, leftMs === null ? '' : '有效期 ' + fmtTokenLeft(leftMs)),
          )
        : React.createElement('div', { key: 'no-token', style: sectionHintStyle }, '运行时未生成配对 token（重启 WeftMate 后生成）')

      var deviceRows = devices.length === 0
        ? [React.createElement('div', { key: 'empty', style: sectionHintStyle }, '暂无已配对设备——手机 App 输入上方 token 完成配对（token 10 分钟有效，可配多台）')]
        : devices.map(function (d, i) {
            return React.createElement('div', { key: 'd' + i, style: sectionRowStyle },
              React.createElement('span', { key: 'n' }, String(d.name || '未命名设备')),
              React.createElement('span', { key: 't', style: sectionHintStyle }, '最近 ' + fmtDeviceTime(d.lastSeenAt)),
            )
          })

      return React.createElement('div', { key: 'device', style: sectionBlockStyle },
        React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '设备配对（R8 · 手机 App）'),
        tokenNode,
        deviceRows,
      )
    }

    function WeftMateSettingsSection() {
      var perceptionState = React.useState(FALLBACK_PERCEPTION)
      var perception = perceptionState[0]
      var setPerception = perceptionState[1]
      var statusState = React.useState(FALLBACK_STATE)
      var status = statusState[0]
      var setStatus = statusState[1]
      var deviceState = React.useState(FALLBACK_DEVICE)
      var device = deviceState[0]
      var setDevice = deviceState[1]
      var localState = React.useState(null)
      var local = localState[0]
      var setLocal = localState[1]

      React.useEffect(function () {
        var poll = function () {
          pollPerception(setPerception)
          pollStatus(setStatus)
          fetch('/weftmate/device/state.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (next) { if (next && typeof next === 'object') setDevice(next) })
            .catch(function () { /* 失败保持旧值 */ })
        }
        poll()
        var timer = setInterval(poll, 5_000)
        return function () { clearInterval(timer) }
      }, [])

      var cfg = (perception && perception.config) || FALLBACK_PERCEPTION.config
      var sample = perception && perception.sample
      var pet = (status && status.pet) || null

      // 乐观覆盖：点击立即生效；轮询追上真值后自动清掉对应键（值相同即不闪烁）。
      React.useEffect(function () {
        setLocal(function (prev) {
          if (!prev) return null
          var truth = {
            enabled: cfg.enabled,
            capture: cfg.capture,
            clipboard: cfg.clipboard,
            inject: cfg.inject.enabled,
            mobile: cfg.mobile,
            petVisible: pet ? pet.visible : false,
            petFreeActivity: pet ? pet.freeActivity : false,
          }
          var next = null
          for (var key in prev) {
            if (prev[key] !== truth[key]) {
              next = next || {}
              next[key] = prev[key]
            }
          }
          return next
        })
      }, [perception, status])

      var eff = function (key, base) {
        return local && local[key] !== undefined ? local[key] : base
      }
      var applyPerception = function (key, action, value) {
        setLocal(function (prev) {
          var next = Object.assign({}, prev)
          next[key] = value
          return next
        })
        postSeam('/weftmate/perception', action, value)
      }
      var applyPet = function (key, action, value) {
        setLocal(function (prev) {
          var next = Object.assign({}, prev)
          next[key] = value
          return next
        })
        postSeam('/weftmate/pet', action, value)
      }

      var sampleLine = '总开关关闭——不开不采（opt-in）'
      if (cfg.enabled === true) {
        if (!sample) {
          sampleLine = '开启中…（等待首个采样，每 5 秒一次）'
        } else {
          var parts = []
          if (sample.activeWindow) {
            parts.push('窗口 ' + sample.activeWindow.app + (sample.activeWindow.title ? ' — ' + sample.activeWindow.title : ''))
          }
          parts.push('空闲 ' + Math.floor(Math.max(0, Number(sample.idleSeconds) || 0) / 60) + ' 分钟')
          if (sample.locked) parts.push('已锁屏')
          if (sample.mobile && typeof sample.mobile.content === 'string' && sample.mobile.content) {
            parts.push('手机[' + (sample.mobile.deviceName || '未知') + '] ' + sample.mobile.content.slice(0, 40))
          }
          if (sample.clipboardText) parts.push('剪贴板有内容（仅界面可见）')
          sampleLine = parts.join(' · ')
        }
      }
      var intervalMinutes = Math.max(1, Math.round((Number(cfg.inject.intervalMs) || 60_000) / 60_000))

      return React.createElement('div', {
        key: 'weftmate-settings',
        style: { padding: '4px 2px', color: 'var(--dsw-alias-label-primary)' },
      },
        React.createElement('div', { key: 'perception', style: sectionBlockStyle },
          React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '桌面感知（R6 · opt-in）'),
          React.createElement(Row, {
            key: 'enabled',
            label: '桌面感知',
            control: React.createElement(Toggle, {
              checked: eff('enabled', cfg.enabled) === true,
              onChange: function (v) { applyPerception('enabled', 'set-enabled', v) },
            }),
            hint: '开启后才采样窗口/空闲/锁屏；窗口标题截断 300 字符',
          }),
          React.createElement(Row, {
            key: 'capture',
            label: '采集内容',
            control: React.createElement(CaptureSeg, {
              value: eff('capture', cfg.capture),
              onChange: function (v) { applyPerception('capture', 'set-capture', v) },
            }),
            hint: '仅应用 = 不采窗口标题，更省隐私',
          }),
          React.createElement(Row, {
            key: 'clipboard',
            label: '剪贴板感知',
            control: React.createElement(Toggle, {
              checked: eff('clipboard', cfg.clipboard) === true,
              onChange: function (v) { applyPerception('clipboard', 'set-clipboard', v) },
            }),
            hint: '额外敏感，需单独开启；内容仅界面可见、永不注入模型（截断 500 字符）',
          }),
          React.createElement(Row, {
            key: 'inject',
            label: '模型注入',
            control: React.createElement(Toggle, {
              checked: eff('inject', cfg.inject.enabled) === true,
              onChange: function (v) { applyPerception('inject', 'set-inject', v) },
            }),
            hint: '把感知快照追加进模型上下文（每回合至多一次）；最小间隔 ' + intervalMinutes + ' 分钟',
          }),
          React.createElement(Row, {
            key: 'mobile',
            label: '手机感知源（R8）',
            control: React.createElement(Toggle, {
              checked: eff('mobile', cfg.mobile) === true,
              onChange: function (v) { applyPerception('mobile', 'set-mobile', v) },
            }),
            hint: '配对手机上报的观察进感知面；关闭时观察直接丢弃（不开不收）',
          }),
          React.createElement('div', { key: 'sample', style: Object.assign({}, sectionHintStyle, { marginTop: '8px' }) }, '当前：' + sampleLine),
        ),
        React.createElement('div', { key: 'pet', style: sectionBlockStyle },
          React.createElement('div', { key: 'title', style: sectionBlockTitleStyle }, '桌面宠物（R6）'),
          React.createElement(Row, {
            key: 'visible',
            label: '显示桌宠窗口',
            control: React.createElement(Toggle, {
              checked: eff('petVisible', pet ? pet.visible : false) === true,
              onChange: function (v) { applyPet('petVisible', 'set-visible', v) },
            }),
            hint: '透明置顶小窗；托盘图标也可唤醒/休息',
          }),
          React.createElement(Row, {
            key: 'free',
            label: '自由活动',
            control: React.createElement(Toggle, {
              checked: eff('petFreeActivity', pet ? pet.freeActivity : false) === true,
              onChange: function (v) { applyPet('petFreeActivity', 'set-free-activity', v) },
            }),
            hint: '允许读取瞬时鼠标位置自主游走、注视、停靠主窗口',
          }),
        ),
        React.createElement(DeviceBlock, { key: 'deviceblock', state: device }),
      )
    }

    return {
      name: 'weftmate-client',
      inject: ['slots', 'connection'],
      apply: function (ctx) {
        // 声明等待：官方槽位系统要求目标槽已被某个声明者（ui-layout 在 root 的 children 表里
        // 声明 shell.overlay）登记；`slots.inject(key, cb)` 是官方「声明依赖」接缝——声明已存在则
        // 同步注册，否则等声明者的 register 提交后再注册（回调返回注册的 disposer，随声明生命周期回收）。
        // 本行注册进官方 shell.overlay 槽位（list 槽位：additive；inject 面把 hostDescription 源传给组件）。
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'weftmate-status',
            order: 9000,
            inject: function () {
              return { hostDescription: ctx.connection.hostDescription }
            },
          }, WeftMateStatusBadge)
        })
        // R6/R8 开关面收口：感知/桌宠胶囊已删，全部开关进官方设置页「WeftMate」节
        // （settings.section 由 ui-settings-general 在占据 sidebar.settings 时声明；
        // slots.inject 声明依赖接缝——声明就绪后注册，节内块：桌面感知/桌面宠物/设备配对）。
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'weftmate',
            order: 5000,
            label: 'WeftMate',
            inject: function () { return {} },
          }, WeftMateSettingsSection)
        })
        // R7 · 记忆胶囊 + 管理面板（只读 v1）。
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'weftmate-memory',
            order: 8700,
            inject: function () { return {} },
          }, MemoryBadge)
        })
      },
    }
  },
})
