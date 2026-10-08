package com.memoweft.weftmate.mobile

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.ColorDrawable
import android.graphics.Color
import android.text.TextUtils
import android.widget.AdapterView
import android.view.Gravity
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.animation.ValueAnimator
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/** Native phone surface: local conversation is always usable; host and model have separate states. */
class MainActivity : Activity() {
    private companion object { const val SPEECH_REQUEST = 1042 }
    private enum class Pane { CHAT, THINGS, PHONE_RECORDS, COMPUTER_SESSIONS }
    private val worker = Executors.newSingleThreadExecutor()
    private val modelWorker = Executors.newSingleThreadExecutor()
    private lateinit var store: LocalStore
    private lateinit var secrets: SecureSettings
    private val api = PersonalApi()
    private var host: HostIdentity? = null
    private var model: ModelSettings? = null
    @Volatile private var currentOwner: String? = null
    @Volatile private var selectedConversation: String? = null
    private var activeModel: ModelClient? = null
    @Volatile private var generation = 0
    @Volatile private var pane = Pane.CHAT
    @Volatile private var paneGeneration = 0
    @Volatile private var sending = false
    @Volatile private var cancelRequested = false

    private lateinit var root: LinearLayout
    private lateinit var stateText: TextView
    private lateinit var hostChip: TextView
    private lateinit var modelChip: TextView
    private lateinit var syncChip: TextView
    private lateinit var originInput: EditText
    private lateinit var usernameInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var modelEndpointInput: EditText
    private lateinit var modelIdInput: EditText
    private lateinit var modelKeyInput: EditText
    private lateinit var chatPanel: LinearLayout
    private lateinit var sessionRow: LinearLayout
    private lateinit var actionRow: LinearLayout
    private lateinit var sendRow: LinearLayout
    private lateinit var chatTab: Button
    private lateinit var phoneTab: Button
    private lateinit var computerTab: Button
    private lateinit var settingsPanel: ScrollView
    private lateinit var settingsToggle: View
    private lateinit var drawerProfileTitle: TextView
    private lateinit var headerTitle: TextView
    private lateinit var headerSubtitle: TextView
    private lateinit var menuAction: FrameLayout
    private lateinit var backAction: FrameLayout
    private lateinit var thingsAction: LinearLayout
    private lateinit var thingsBadge: TextView
    private lateinit var composerWrap: LinearLayout
    private lateinit var composerView: WeaveComposerView
    private var modelPicker: PopupWindow? = null
    private var pickerGeneration = 0
    private var pendingSpeech: SpeechAttempt? = null
    private lateinit var sendButton: Button
    private lateinit var readonlyStopButton: Button
    private lateinit var drawerDialog: Dialog
    private var phoneActionsDialog: AlertDialog? = null
    private lateinit var drawerList: LinearLayout
    private lateinit var drawerSearch: EditText
    private lateinit var settingsDialog: Dialog
    private lateinit var settingsSheetRoot: LinearLayout
    private lateinit var settingsHome: LinearLayout
    private lateinit var accountSettingsPage: LinearLayout
    private lateinit var modelSettingsPage: LinearLayout
    private lateinit var syncSettingsPage: LinearLayout
    private lateinit var planSettingsPage: LinearLayout
    private lateinit var settingsTitle: TextView
    private lateinit var settingsProfileSubtitle: TextView
    private lateinit var settingsAvatar: TextView
    private lateinit var drawerAvatar: TextView
    private lateinit var settingsBack: FrameLayout
    private lateinit var settingsStop: FrameLayout
    private var settingsPage = "home"
    private var drawerGeneration = 0
    private lateinit var conversationSpinner: Spinner
    private lateinit var conversationAdapter: ArrayAdapter<String>
    private var conversationIds = emptyList<String>()
    private lateinit var transcript: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var composer: EditText
    private lateinit var stopButton: Button
    private var transcriptGeneration = 0
    private var welcomeLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        store = LocalStore(this)
        secrets = SecureSettings(this)
        buildUi()
        worker.execute {
            try {
                store.recoverInterruptedTurns()
                val savedHost = secrets.host()
                val savedModel = savedHost?.let { secrets.model(Endpoints.ownerKey(it.origin, it.ownerId)) }
                runOnUiThread {
                    host = savedHost; model = savedModel
                    currentOwner = savedHost?.let { Endpoints.ownerKey(it.origin, it.ownerId) }
                    val backgroundSync = savedHost == null || SyncJobService.schedule(this)
                    hostChip.text = if (savedHost == null) "电脑 · 未登录" else "电脑 · 已登录"
                    modelChip.text = if (savedModel == null) "模型 · 未配置" else "模型 · 已配置"
                    syncChip.text = if (backgroundSync) "同步 · 待连接" else "同步 · 手动"
                    settingsProfileSubtitle.text = savedHost?.username ?: "本机个人空间"
                    drawerProfileTitle.text = savedHost?.username ?: "本机个人空间"
                    val avatar = savedHost?.username?.firstOrNull()?.uppercase() ?: "我"
                    settingsAvatar.text = avatar
                    drawerAvatar.text = avatar
                    composerView.setModelName(savedModel?.displayName)
                    originInput.setText(savedHost?.origin ?: "https://home.weftmate.com:8443")
                    usernameInput.setText(savedHost?.username ?: "")
                    modelEndpointInput.setText(savedModel?.endpoint ?: "")
                    modelIdInput.setText(savedModel?.modelId ?: "")
                    state(if (backgroundSync) "本机记录已保存" else "本机记录已保存 · 后台同步未启用")
                    refreshConversations()
                }
            } catch (_: Exception) { runOnUiThread { state("本机资料无法安全读取，请检查设备存储") } }
        }
    }

    override fun onDestroy() {
        modelPicker?.dismiss()
        pendingSpeech = null
        if (::scroll.isInitialized) clearWelcomeLayoutListener()
        activeModel?.cancel()
        generation += 1
        worker.shutdownNow()
        modelWorker.shutdownNow()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when {
            settingsDialog.isShowing && settingsPage != "home" -> renderSettingsPage("home")
            settingsDialog.isShowing -> settingsDialog.dismiss()
            drawerDialog.isShowing -> drawerDialog.dismiss()
            pane != Pane.CHAT -> { navigateTo(Pane.CHAT); showTranscript() }
            else -> super.onBackPressed()
        }
    }

    private fun startVoiceInput() {
        if (pane != Pane.CHAT || sending) return state("当前回复结束后可使用语音输入")
        val attempt = SpeechAttempt(currentOwner, selectedConversation, generation, paneGeneration)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "语音输入到草稿")
        }
        try {
            pendingSpeech = attempt
            @Suppress("DEPRECATION")
            startActivityForResult(intent, SPEECH_REQUEST)
        } catch (_: ActivityNotFoundException) {
            pendingSpeech = null
            state("这台手机没有可用的系统语音输入服务")
        } catch (_: SecurityException) {
            pendingSpeech = null
            state("系统未允许使用语音输入，请检查语音服务设置")
        }
    }

    @Deprecated("Uses the platform speech activity result until the Activity Result API is available here")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != SPEECH_REQUEST) return
        val attempt = pendingSpeech ?: return
        pendingSpeech = null
        val recognized = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        when (val result = SpeechDraftGate.settle(attempt, currentOwner, selectedConversation,
            generation, paneGeneration, pane == Pane.CHAT && !sending,
            resultCode == RESULT_OK, recognized, composer.text.toString())) {
            is SpeechDraftResult.Text -> {
                composer.setText(result.draft)
                composer.setSelection(composer.text.length)
                state("语音文字已填入草稿，请确认后发送")
            }
            SpeechDraftResult.Cancelled -> state("已取消语音输入，草稿未更改")
            SpeechDraftResult.Empty -> state("没有识别到文字，草稿未更改")
            SpeechDraftResult.TooLong -> state("语音结果超过消息长度，草稿未更改")
            SpeechDraftResult.Stale -> state("已切换对话，较早的语音结果未填入当前草稿")
        }
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
    private fun button(text: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        this.text = text; isAllCaps = false; textSize = DesignTokens.font13
        backgroundTintList = null
        stateListAnimator = null
        setTextColor(if (primary) Weave.surface else Weave.accent)
        background = GradientDrawable().apply {
            setColor(if (primary) Weave.accent else Weave.surface)
            if (!primary) setStroke(dp(DesignTokens.space1), Weave.line)
            cornerRadius = dp(DesignTokens.space10).toFloat()
        }
        minWidth = dp(DesignTokens.space48); minimumWidth = dp(DesignTokens.space48)
        minHeight = dp(DesignTokens.space48); minimumHeight = dp(DesignTokens.space48)
        elevation = 0f
        setPadding(dp(DesignTokens.space9), dp(DesignTokens.space4), dp(DesignTokens.space9), dp(DesignTokens.space4))
        setOnClickListener { action() }
    }
    private fun state(text: String) {
        stateText.text = text
        val issue = listOf("失败", "不可达", "冲突", "已失效", "未完成", "容量", "拒绝").any(text::contains)
        stateText.textSize = if (issue || text.contains("正在") || text.contains("停止")) DesignTokens.font12 else DesignTokens.font10
        stateText.setTextColor(if (issue) Weave.danger else Weave.muted)
    }
    private fun buildUi() = buildWeaveUi()

    private fun buildWeaveUi() {
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Weave.surface) }
        setContentView(root)
        window.decorView.setBackgroundColor(Weave.surface)
        window.statusBarColor = Weave.surface
        window.navigationBarColor = Weave.surface
        if (Build.VERSION.SDK_INT >= 30) window.decorView.windowInsetsController?.setSystemBarsAppearance(
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS)
        else window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener { view, insets ->
            val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }

        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space16), 0)
        }
        root.addView(header, LinearLayout.LayoutParams(-1, dp(DesignTokens.space64)))
        menuAction = Weave.iconButton(this, R.drawable.wm_menu, "打开会话导航") { showDrawer() }
        backAction = Weave.iconButton(this, R.drawable.wm_back, "返回对话") {
            navigateTo(Pane.CHAT); showTranscript()
        }.apply { visibility = View.GONE }
        header.addView(menuAction, LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))
        header.addView(backAction, LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))
        val heading = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL }
        headerTitle = Weave.text(this, "WeftMate", DesignTokens.font18, Weave.ink, android.graphics.Typeface.BOLD)
        headerSubtitle = Weave.text(this, "同一个助手，接着聊。", DesignTokens.font12, Weave.muted)
        heading.addView(headerTitle)
        heading.addView(headerSubtitle)
        header.addView(heading, LinearLayout.LayoutParams(0, -1, 1f))
        thingsAction = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(DesignTokens.space48)
            setPadding(dp(DesignTokens.space8), 0, 0, 0)
            isClickable = true; isFocusable = true
            contentDescription = "查看正在做的事"
            setOnClickListener { showThings() }
        }
        thingsAction.addView(Weave.icon(this, R.drawable.wm_task, Weave.secondary, 18))
        thingsAction.addView(Weave.text(this, "事情", DesignTokens.font14, Weave.secondary), LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(DesignTokens.space8) })
        thingsBadge = Weave.text(this, "1", DesignTokens.font12, Weave.accent).apply {
            gravity = Gravity.CENTER
            background = Weave.shape(this@MainActivity, Weave.accentSoft, DesignTokens.radius6)
            visibility = View.GONE
        }
        thingsAction.addView(thingsBadge, LinearLayout.LayoutParams(dp(DesignTokens.space20), dp(DesignTokens.space20)).apply { leftMargin = dp(DesignTokens.space8) })
        header.addView(thingsAction)
        readonlyStopButton = weaveCircle(R.drawable.wm_stop, "停止当前手机回复") {
            cancelRequested = true; activeModel?.cancel(); state("已请求停止手机当前回复，等待结果")
        }.apply { visibility = View.GONE }
        header.addView(readonlyStopButton, LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))

        chatPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Weave.surface) }
        root.addView(chatPanel, LinearLayout.LayoutParams(-1, 0, 1f))
        scroll = ScrollView(this).apply {
            id = R.id.chat_scroll
            isFillViewport = true
            setBackgroundColor(Weave.surface)
            clipToPadding = false
        }
        transcript = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; id = R.id.transcript }
        scroll.addView(transcript, FrameLayout.LayoutParams(-1, -1))
        chatPanel.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        composerView = WeaveComposerView(this, object : WeaveComposerView.Actions {
            override fun plus() = showPhoneActions()
            override fun model() = showModelPicker()
            override fun device() = showDeviceChoice()
            override fun voice() = startVoiceInput()
            override fun send() = this@MainActivity.send()
            override fun stop() {
                cancelRequested = true; activeModel?.cancel(); state("已请求停止本轮，等待本地终态")
            }
        })
        composerWrap = composerView
        composer = composerView.composer
        sendButton = composerView.sendButton
        stopButton = composerView.stopButton
        stateText = composerView.statusText
        chatPanel.addView(composerWrap, LinearLayout.LayoutParams(-1, -2))

        // Retain the proven auth/sync/model callbacks; only their native surface moves.
        buildDrawer()
        buildSettingsSheet()
        navigateTo(Pane.CHAT)
    }

    private fun weaveCircle(icon: Int, description: String, action: () -> Unit) = Button(this).apply {
        text = ""; contentDescription = description
        isAllCaps = false; backgroundTintList = null; stateListAnimator = null
        minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
        elevation = 0f
        gravity = Gravity.CENTER
        setPadding(0, 0, 0, 0)
        background = Weave.shape(this@MainActivity, Weave.accent, DesignTokens.radius24)
        val drawable = getDrawable(icon)?.mutate()?.apply { setTint(Weave.surface) }
        setCompoundDrawablesWithIntrinsicBounds(drawable, null, null, null)
        setOnClickListener { action() }
    }

    private fun buildDrawer() {
        drawerDialog = Dialog(this, android.R.style.Theme_Material_Light_NoActionBar).apply {
            window?.setBackgroundDrawableResource(android.R.color.transparent)
            window?.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window?.attributes = window?.attributes?.apply { dimAmount = .28f; gravity = Gravity.START or Gravity.TOP }
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Weave.drawer(this@MainActivity)
            setPadding(dp(DesignTokens.space20), dp(DesignTokens.space16), dp(DesignTokens.space20), dp(DesignTokens.space16))
        }
        drawerDialog.setContentView(panel)
        val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        head.addView(Weave.mark(this, 32), LinearLayout.LayoutParams(dp(DesignTokens.space32), dp(DesignTokens.space32)))
        head.addView(Weave.text(this, "WeftMate", DesignTokens.font24, Weave.ink, android.graphics.Typeface.BOLD),
            LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space8) })
        head.addView(Weave.iconButton(this, R.drawable.wm_close, "关闭会话导航") { drawerDialog.dismiss() },
            LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))
        panel.addView(head)
        val newRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = Weave.shape(this@MainActivity, Weave.accentSoft, DesignTokens.radius16)
            setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0)
            minimumHeight = dp(DesignTokens.space48)
            isClickable = true; isFocusable = true
            contentDescription = "开始新的对话"
            id = R.id.new_conversation_button
            setOnClickListener {
                drawerDialog.dismiss()
                navigateTo(Pane.CHAT)
                createConversation()
            }
        }
        newRow.addView(Weave.icon(this, R.drawable.wm_plus, Weave.accent, 18))
        newRow.addView(Weave.text(this, "开始新的对话", DesignTokens.font14, Weave.accent),
            LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space12) })
        newRow.addView(Weave.icon(this, R.drawable.wm_right, Weave.accent, 16))
        panel.addView(newRow, LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)).apply { topMargin = dp(DesignTokens.space16); bottomMargin = dp(DesignTokens.space16) })
        val searchRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = Weave.shape(this@MainActivity, Weave.soft, DesignTokens.radius10)
            setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0)
        }
        searchRow.addView(Weave.icon(this, R.drawable.wm_search, Weave.muted, 18))
        drawerSearch = EditText(this).apply {
            id = R.id.drawer_search
            hint = "找一段聊过的内容"
            textSize = DesignTokens.font12; setTextColor(Weave.ink); setHintTextColor(Weave.muted)
            setSingleLine(true); background = null
            setPadding(dp(DesignTokens.space8), 0, 0, 0)
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) { }
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { refreshDrawerHistory(s?.toString() ?: "") }
                override fun afterTextChanged(s: android.text.Editable?) { }
            })
        }
        searchRow.addView(drawerSearch, LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f))
        panel.addView(searchRow)
        val shortcuts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val shortcutOne = LinearLayout(this)
        shortcutOne.addView(drawerShortcut(R.drawable.wm_task, "事情") { drawerDialog.dismiss(); showThings() },
            LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f))
        shortcutOne.addView(drawerShortcut(R.drawable.wm_phone, "手机记录") { drawerDialog.dismiss(); showAccountEvents() },
            LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f))
        val shortcutTwo = LinearLayout(this)
        shortcutTwo.addView(drawerShortcut(R.drawable.wm_pc, "电脑会话") { drawerDialog.dismiss(); showComputerSessions() },
            LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f))
        shortcutTwo.addView(drawerShortcut(R.drawable.wm_device, "连接") { drawerDialog.dismiss(); showSettings(true, "account") },
            LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f))
        shortcuts.addView(shortcutOne); shortcuts.addView(shortcutTwo)
        panel.addView(shortcuts, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space12) })
        panel.addView(drawerShortcut(R.drawable.wm_layers, "能力与规划") {
            drawerDialog.dismiss(); showSettings(true, "plan")
        }, LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)))
        val historyScroll = ScrollView(this).apply { isFillViewport = false }
        val historyBody = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        historyBody.addView(Weave.text(this, "最近", DesignTokens.font12, Weave.muted),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space20); bottomMargin = dp(DesignTokens.space8) })
        drawerList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; id = R.id.drawer_history }
        historyBody.addView(drawerList)
        historyScroll.addView(historyBody)
        panel.addView(historyScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        panel.addView(Weave.divider(this), LinearLayout.LayoutParams(-1, dp(DesignTokens.space1)).apply { topMargin = dp(DesignTokens.space8) })
        settingsToggle = LinearLayout(this).apply {
            id = R.id.settings_toggle
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(DesignTokens.space56)
            background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius16)
            isClickable = true; isFocusable = true
            contentDescription = "打开个人设置"
            setOnClickListener { drawerDialog.dismiss(); showSettings(true, "home") }
            drawerAvatar = weaveAvatar(40)
            addView(drawerAvatar, LinearLayout.LayoutParams(dp(DesignTokens.space40), dp(DesignTokens.space40)))
            val labels = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
            drawerProfileTitle = Weave.text(this@MainActivity, "本机个人空间", DesignTokens.font14, Weave.ink)
            labels.addView(drawerProfileTitle)
            labels.addView(Weave.text(this@MainActivity, "设置、连接与偏好", DesignTokens.font12, Weave.muted))
            addView(labels, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space12) })
            addView(Weave.icon(this@MainActivity, R.drawable.wm_settings, Weave.secondary, 18))
        }
        panel.addView(settingsToggle, LinearLayout.LayoutParams(-1, dp(DesignTokens.space56)))
    }

    private fun drawerShortcut(icon: Int, title: String, action: () -> Unit) = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(DesignTokens.space48)
        isClickable = true; isFocusable = true
        setPadding(dp(DesignTokens.space8), 0, 0, 0)
        addView(Weave.icon(this@MainActivity, icon, Weave.secondary, 18))
        addView(Weave.text(this@MainActivity, title, DesignTokens.font14, Weave.ink),
            LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(DesignTokens.space8) })
        setOnClickListener { action() }
    }

    private fun showDrawer() {
        if (drawerDialog.isShowing) return
        drawerDialog.show()
        val width = minOf(dp(DesignTokens.space324), resources.displayMetrics.widthPixels - dp(DesignTokens.space52))
        drawerDialog.window?.setLayout(width, WindowManager.LayoutParams.MATCH_PARENT)
        drawerDialog.window?.setGravity(Gravity.START or Gravity.TOP)
        refreshDrawerHistory(drawerSearch.text.toString())
    }

    private fun refreshDrawerHistory(query: String = if (::drawerSearch.isInitialized) drawerSearch.text.toString() else "") {
        if (!::drawerList.isInitialized) return
        val owner = currentOwner
        val currentGeneration = generation
        val request = ++drawerGeneration
        worker.execute {
            val normalized = query.trim().lowercase()
            val rows = (if (owner == null) emptyList() else store.listConversations(owner)).take(200).mapNotNull { conversation ->
                val messages = store.messages(conversation.id, owner)
                val title = if (conversation.title == "新对话") messages.firstOrNull { it.role == "user" }?.text
                    ?.replace(Regex("\\s+"), " ")?.trim()?.take(26)?.takeIf { it.isNotBlank() } ?: "新对话"
                else conversation.title
                if (normalized.isNotEmpty() && !title.lowercase().contains(normalized) &&
                    messages.none { it.text.lowercase().contains(normalized) }) null
                else Triple(conversation.id, title, conversationTime(conversation.createdAt))
            }.take(50)
            runOnUiThread {
                if (request != drawerGeneration || currentGeneration != generation || owner != currentOwner) return@runOnUiThread
                drawerList.removeAllViews()
                if (rows.isEmpty()) drawerList.addView(Weave.text(this, if (normalized.isEmpty()) "还没有本机对话。" else "没有找到这段对话。", DesignTokens.font12, Weave.muted))
                for ((id, title, time) in rows) {
                    val item = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER_VERTICAL
                        setPadding(dp(DesignTokens.space8), dp(DesignTokens.space8), dp(DesignTokens.space8), dp(DesignTokens.space8))
                        background = if (id == selectedConversation) Weave.shape(this@MainActivity, Weave.accentSoft, DesignTokens.radius10) else null
                        isClickable = true; isFocusable = true
                        setOnClickListener {
                            selectedConversation = id
                            drawerDialog.dismiss()
                            navigateTo(Pane.CHAT)
                            showTranscript()
                        }
                    }
                    item.addView(Weave.text(this, title, DesignTokens.font14, if (id == selectedConversation) Weave.accent else Weave.ink).apply {
                        maxLines = 1; ellipsize = TextUtils.TruncateAt.END
                    })
                    item.addView(Weave.text(this, time, DesignTokens.font12, Weave.muted),
                        LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space4) })
                    drawerList.addView(item, LinearLayout.LayoutParams(-1, dp(DesignTokens.space64)))
                }
            }
        }
    }

    private fun conversationTime(value: String): String = try {
        val moment = java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault())
        val date = moment.toLocalDate()
        val time = moment.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"))
        when (date) {
            java.time.LocalDate.now() -> "今天 $time"
            java.time.LocalDate.now().minusDays(1) -> "昨天 $time"
            else -> moment.format(java.time.format.DateTimeFormatter.ofPattern("M月d日 HH:mm:ss"))
        }
    } catch (_: Exception) { "时间未知" }

    private fun buildSettingsSheet() {
        settingsDialog = Dialog(this, android.R.style.Theme_Material_Light_NoActionBar).apply {
            window?.setBackgroundDrawableResource(android.R.color.transparent)
            window?.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window?.attributes = window?.attributes?.apply { dimAmount = .28f; gravity = Gravity.BOTTOM }
            setOnKeyListener { _, keyCode, event ->
                if (keyCode == android.view.KeyEvent.KEYCODE_BACK && event.action == android.view.KeyEvent.ACTION_UP &&
                    settingsPage != "home") {
                    renderSettingsPage("home")
                    true
                } else false
            }
        }
        settingsSheetRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Weave.topSheet(this@MainActivity)
            setPadding(dp(DesignTokens.space20), dp(DesignTokens.space8), dp(DesignTokens.space20), 0)
        }
        val sheet = settingsSheetRoot
        settingsDialog.setContentView(sheet)
        val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        settingsBack = Weave.iconButton(this, R.drawable.wm_back, "返回设置", Weave.secondary) { renderSettingsPage("home") }
            .apply { visibility = View.GONE }
        head.addView(settingsBack, LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))
        settingsTitle = Weave.text(this, "设置", DesignTokens.font18, Weave.ink, android.graphics.Typeface.BOLD)
        head.addView(settingsTitle, LinearLayout.LayoutParams(0, -2, 1f))
        settingsStop = Weave.iconButton(this, R.drawable.wm_stop, "停止当前手机回复", Weave.danger) {
            cancelRequested = true; activeModel?.cancel(); state("已请求停止手机当前回复")
        }.apply { visibility = View.GONE }
        head.addView(settingsStop, LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))
        head.addView(Weave.iconButton(this, R.drawable.wm_close, "关闭设置") { settingsDialog.dismiss() },
            LinearLayout.LayoutParams(dp(DesignTokens.space48), dp(DesignTokens.space48)))
        sheet.addView(head, LinearLayout.LayoutParams(-1, dp(DesignTokens.space64)))
        settingsPanel = ScrollView(this).apply { isFillViewport = false }
        sheet.addView(settingsPanel, LinearLayout.LayoutParams(-1, 0, 1f))
        val pages = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(DesignTokens.space8), 0, dp(DesignTokens.space24)) }
        settingsPanel.addView(pages)
        settingsHome = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        accountSettingsPage = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        modelSettingsPage = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        syncSettingsPage = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        planSettingsPage = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        pages.addView(settingsHome)
        pages.addView(accountSettingsPage)
        pages.addView(modelSettingsPage)
        pages.addView(syncSettingsPage)
        pages.addView(planSettingsPage)

        val profile = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(DesignTokens.space8), dp(DesignTokens.space12), dp(DesignTokens.space8), dp(DesignTokens.space12))
        }
        settingsAvatar = weaveAvatar(64)
        profile.addView(settingsAvatar, LinearLayout.LayoutParams(dp(DesignTokens.space64), dp(DesignTokens.space64)))
        val profileText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        profileText.addView(Weave.text(this, "自己的助手，\n按自己的方式。", DesignTokens.font18, Weave.ink))
        settingsProfileSubtitle = Weave.text(this, "本机个人空间", DesignTokens.font12, Weave.muted)
        profileText.addView(settingsProfileSubtitle, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space4) })
        profile.addView(profileText, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space16) })
        profile.addView(Weave.mark(this, 24, true), LinearLayout.LayoutParams(dp(DesignTokens.space24), dp(DesignTokens.space24)))
        settingsHome.addView(profile)

        settingsGroup(settingsHome, "你的助手", listOf(
            Triple(R.drawable.wm_model, "对话模型", "model"),
            Triple(R.drawable.wm_phone, "手机能力", "capabilities"),
            Triple(R.drawable.wm_layers, "能力与规划", "plan")))
        settingsGroup(settingsHome, "连接与数据", listOf(
            Triple(R.drawable.wm_device, "电脑账户与连接", "account"),
            Triple(R.drawable.wm_sync, "离线与同步", "sync")))
        settingsGroup(settingsHome, "关于", listOf(
            Triple(R.drawable.wm_info, "关于 WeftMate", "about")))

        val accountCard = settingsCard(accountSettingsPage)
        accountCard.addView(Weave.text(this, "同一账户，在手机与电脑间接续。", DesignTokens.font16, Weave.ink),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space16) })
        originInput = settingInput("电脑服务地址 · HTTPS").apply { id = R.id.origin_input }; accountCard.addView(originInput)
        usernameInput = settingInput("用户名").apply { id = R.id.username_input }; accountCard.addView(usernameInput)
        passwordInput = settingInput("密码 · 只用于本次登录", true).apply { id = R.id.password_input }; accountCard.addView(passwordInput)
        hostChip = Weave.text(this, "电脑账户未登录", DesignTokens.font12, Weave.muted)
        accountCard.addView(hostChip, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space12); bottomMargin = dp(DesignTokens.space8) })
        val accountButtons = LinearLayout(this)
        accountButtons.addView(button("登录") { login() }.apply { id = R.id.login_button }, LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f))
        accountButtons.addView(button("退出") { logout() }, LinearLayout.LayoutParams(0, dp(DesignTokens.space48), 1f).apply { leftMargin = dp(DesignTokens.space8) })
        accountCard.addView(accountButtons)
        accountCard.addView(button("关联本机未绑定对话") { bindUnbound() },
            LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)).apply { topMargin = dp(DesignTokens.space8) })

        val modelCard = settingsCard(modelSettingsPage)
        modelCard.addView(Weave.text(this, "手机自己的模型服务", DesignTokens.font16, Weave.ink),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space8) })
        modelCard.addView(Weave.text(this, "聊天直接连接你配置的模型；应用列表仅在工具调用时发送。", DesignTokens.font12, Weave.muted),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space16) })
        modelEndpointInput = settingInput(if (BuildConfig.DEBUG) "HTTPS地址 · 回环调试可HTTP" else "模型HTTPS地址 /v1")
            .apply { id = R.id.model_endpoint_input }; modelCard.addView(modelEndpointInput)
        modelIdInput = settingInput("模型 ID").apply { id = R.id.model_id_input }; modelCard.addView(modelIdInput)
        modelKeyInput = settingInput("API Key · 保存后不回显", true).apply { id = R.id.model_key_input }; modelCard.addView(modelKeyInput)
        modelChip = Weave.text(this, "手机模型未配置", DesignTokens.font12, Weave.muted)
        modelCard.addView(modelChip, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space12); bottomMargin = dp(DesignTokens.space8) })
        modelCard.addView(button("保存手机模型", true) { saveModel() }.apply { id = R.id.save_model_button },
            LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)))

        val syncCard = settingsCard(syncSettingsPage)
        syncCard.addView(Weave.text(this, "记录先留在手机，连接后再同步。", DesignTokens.font16, Weave.ink))
        syncChip = Weave.text(this, "同步尚未连接", DesignTokens.font12, Weave.muted)
        syncCard.addView(syncChip, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space12); bottomMargin = dp(DesignTokens.space12) })
        syncCard.addView(button("立即同步", true) { sync() }, LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)))
        syncCard.addView(button("查看手机同步记录") { settingsDialog.dismiss(); showAccountEvents() },
            LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)).apply { topMargin = dp(DesignTokens.space8) })
        buildPlanPage()
        renderSettingsPage("home")
    }

    private fun buildPlanPage() {
        planSettingsPage.removeAllViews()
        planSettingsPage.addView(Weave.text(this, "同一个助手，按真实能力逐步接续。", DesignTokens.font16, Weave.secondary),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space16); bottomMargin = dp(DesignTokens.space8) })
        planGroup("现在能用", listOf(
            Triple("手机聊天与模型设置", if (model == null) "待配置" else "已填写", "填入手机能连接的模型服务后，就能在手机上聊天。"),
            Triple("手机应用与系统设置", "可请求", "可以让这台手机打开应用或设置；打开后请看一眼结果。"),
            Triple("本地记录与离线保存", "已可用", "断网时对话先留在手机，重新连接后再同步。"),
            Triple("账户同步与电脑会话", if (host == null) "待登录" else "身份已保存", "同一账户可以同步手机记录，也能查看电脑上的对话。")))
        planGroup("正在接上", listOf(
            Triple("更多电脑与设备操作", "待接入", "以后能把电脑和其他设备上的更多操作交给助手。"),
            Triple("记忆与来源", "待接入", "以后能查看和纠正助手记住的内容，并接上手机记录。"),
            Triple("更多业务能力", "待接入", "以后能发现、使用和管理更多能力。"),
            Triple("跨端接着聊", "待接入", "以后可以从手机直接接着电脑上的同一段对话做事。")))
        planGroup("之后会做", listOf(
            Triple("把一件事办到底", "规划中", "目标中断后能继续，完成的办法还能再次使用。"),
            Triple("按约定提醒与跟进", "规划中", "按你的约定提醒和跟进，什么时候提醒由你决定。"),
            Triple("更稳定的连接与模型", "规划中", "电脑会更稳定地运行，手机也会有更多独立模型选择。"),
            Triple("更多输入与终端", "规划中", "逐步接入语音、图片与更多设备。")))
    }

    private fun planGroup(title: String, rows: List<Triple<String, String, String>>) {
        planSettingsPage.addView(Weave.text(this, title, DesignTokens.font12, Weave.muted),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space24); bottomMargin = dp(DesignTokens.space8); leftMargin = dp(DesignTokens.space8) })
        val group = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius24)
            setPadding(dp(DesignTokens.space16), dp(DesignTokens.space4), dp(DesignTokens.space16), dp(DesignTokens.space4))
        }
        planSettingsPage.addView(group)
        rows.forEachIndexed { index, (name, status, description) ->
            val item = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(DesignTokens.space12), 0, dp(DesignTokens.space12)) }
            val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            head.addView(Weave.text(this, name, DesignTokens.font14, Weave.ink), LinearLayout.LayoutParams(0, -2, 1f))
            head.addView(Weave.text(this, status, DesignTokens.font12, if (status == "已可用") DesignTokens.nativeSuccess else Weave.muted))
            item.addView(head)
            item.addView(Weave.text(this, description, DesignTokens.font12, Weave.secondary).apply { setLineSpacing(dp(DesignTokens.space3).toFloat(), 1f) },
                LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space6) })
            group.addView(item)
            if (index < rows.lastIndex) group.addView(Weave.divider(this), LinearLayout.LayoutParams(-1, dp(DesignTokens.space1)))
        }
    }

    private fun settingsCard(parent: LinearLayout): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius24)
        setPadding(dp(DesignTokens.space8), dp(DesignTokens.space16), dp(DesignTokens.space8), dp(DesignTokens.space16))
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space16) })
    }

    private fun settingInput(hint: String, password: Boolean = false) = EditText(this).apply {
        this.hint = hint; setSingleLine(true); textSize = DesignTokens.font14
        setTextColor(Weave.ink); setHintTextColor(Weave.muted)
        background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius10, Weave.lineStrong)
        setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0)
        minimumHeight = dp(DesignTokens.space48)
        if (password) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        layoutParams = LinearLayout.LayoutParams(-1, dp(DesignTokens.space48)).apply { bottomMargin = dp(DesignTokens.space12) }
    }

    private fun settingsGroup(parent: LinearLayout, title: String, items: List<Triple<Int, String, String>>) {
        parent.addView(Weave.text(this, title, DesignTokens.font12, Weave.muted),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space24); leftMargin = dp(DesignTokens.space16); bottomMargin = dp(DesignTokens.space8) })
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius24)
            setPadding(dp(DesignTokens.space16), 0, dp(DesignTokens.space16), 0)
        }
        parent.addView(card)
        items.forEachIndexed { index, (icon, label, route) ->
            val available = route != "unavailable"
            val row = LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(DesignTokens.space56)
                isClickable = available
                if (available) setOnClickListener {
                    if (route == "capabilities") renderSettingsInfo("手机能力", "可读取并打开这台手机上可启动的应用，也可请求打开系统设置。动作回执会区分已派发与已观察。")
                    else if (route == "about") renderSettingsInfo("关于 WeftMate", "WeftMate · 织语 Weave 1.2。手机对话与电脑记录按来源接续。")
                    else renderSettingsPage(route)
                }
            }
            row.addView(Weave.icon(this, icon, if (available) Weave.secondary else Weave.muted))
            row.addView(Weave.text(this, label, DesignTokens.font14, if (available) Weave.ink else Weave.muted),
                LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space12) })
            if (available) row.addView(Weave.icon(this, R.drawable.wm_right, Weave.lineStrong, 16))
            card.addView(row, LinearLayout.LayoutParams(-1, dp(DesignTokens.space56)))
            if (index < items.lastIndex) card.addView(Weave.divider(this), LinearLayout.LayoutParams(-1, dp(DesignTokens.space1)))
        }
    }

    private fun renderSettingsInfo(title: String, description: String) {
        settingsPage = "info"
        settingsTitle.text = title
        settingsBack.visibility = View.VISIBLE
        settingsHome.visibility = View.GONE
        accountSettingsPage.visibility = View.GONE
        modelSettingsPage.visibility = View.GONE
        syncSettingsPage.visibility = View.GONE
        val info = Weave.text(this, description, DesignTokens.font16, Weave.secondary).apply { setPadding(dp(DesignTokens.space12), dp(DesignTokens.space24), dp(DesignTokens.space12), 0) }
        val pages = settingsHome.parent as LinearLayout
        planSettingsPage.visibility = View.GONE
        if (pages.childCount > 5) pages.removeViewAt(5)
        pages.addView(info)
        settingsPanel.scrollTo(0, 0)
        updateSettingsSheetSize("info")
    }

    private fun renderSettingsPage(page: String) {
        if (page == "plan") buildPlanPage()
        settingsPage = page
        settingsTitle.text = when (page) { "account" -> "电脑账户与连接"; "model" -> "对话模型"; "sync" -> "离线与同步"; "plan" -> "能力与规划"; else -> "设置" }
        settingsBack.visibility = if (page == "home") View.GONE else View.VISIBLE
        settingsHome.visibility = if (page == "home") View.VISIBLE else View.GONE
        accountSettingsPage.visibility = if (page == "account") View.VISIBLE else View.GONE
        modelSettingsPage.visibility = if (page == "model") View.VISIBLE else View.GONE
        syncSettingsPage.visibility = if (page == "sync") View.VISIBLE else View.GONE
        planSettingsPage.visibility = if (page == "plan") View.VISIBLE else View.GONE
        val pages = settingsHome.parent as LinearLayout
        if (pages.childCount > 5) pages.removeViewAt(5)
        settingsStop.visibility = if (sending) View.VISIBLE else View.GONE
        settingsPanel.scrollTo(0, 0)
        updateSettingsSheetSize(page)
    }

    private fun updateSettingsSheetSize(page: String) {
        val home = page == "home"
        settingsSheetRoot.background = Weave.topSheet(this, if (home) Weave.canvas else Weave.surface)
        settingsPanel.setBackgroundColor(if (home) Weave.canvas else Weave.surface)
        settingsPanel.layoutParams = if (home) LinearLayout.LayoutParams(-1, 0, 1f)
            else LinearLayout.LayoutParams(-1, -2)
        if (!settingsDialog.isShowing) return
        val maxHeight = resources.displayMetrics.heightPixels - dp(DesignTokens.space52)
        if (home) settingsDialog.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, maxHeight)
        else settingsSheetRoot.post {
            if (!settingsDialog.isShowing || settingsPage != page) return@post
            val pages = settingsHome.parent as LinearLayout
            val contentHeight = pages.measuredHeight
            val desired = (dp(DesignTokens.space64) + contentHeight + dp(DesignTokens.space12)).coerceIn(dp(DesignTokens.space220), maxHeight)
            settingsDialog.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, desired)
        }
    }

    private fun showSettings(show: Boolean, page: String = "home") {
        if (!show) { if (settingsDialog.isShowing) settingsDialog.dismiss(); return }
        if (drawerDialog.isShowing) drawerDialog.dismiss()
        if (!settingsDialog.isShowing) {
            settingsDialog.show()
            settingsDialog.window?.setGravity(Gravity.BOTTOM)
            settingsDialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        renderSettingsPage(page)
    }

    private fun showDeviceChoice() {
        AlertDialog.Builder(this).setTitle("执行设备")
            .setMessage("当前手机动作只在这台手机执行。电脑任务尚未接入手机动作选择。")
            .setPositiveButton("知道了", null).show()
    }

    private fun showPhoneActions() {
        if (pane != Pane.CHAT) return state("请回到对话后再使用手机动作")
        phoneActionsDialog = AlertDialog.Builder(this).setTitle("这台手机能做什么")
            .setItems(arrayOf("打开手机应用", "打开系统设置")) { _, index ->
                if (index == 0) chooseApp() else directTool("open_settings", JSONObject())
            }.setNegativeButton("取消", null).show()
    }

    private fun showThings() {
        navigateTo(Pane.THINGS)
        val owner = currentOwner
        val currentGeneration = generation
        val currentPane = paneGeneration
        val currentTranscript = ++transcriptGeneration
        transcript.removeAllViews()
        transcript.addView(Weave.text(this, "正在读取手机活动…", DesignTokens.font14, Weave.muted))
        worker.execute {
            val activities = (if (owner == null) emptyList() else store.listConversations(owner)).take(20).mapNotNull { conversation ->
                val latest = store.latestTurnStatus(conversation.id)
                val receipts = store.toolReceipts(conversation.id, owner)
                if (latest == null && receipts.isEmpty()) null else {
                    val label = if (latest == "running") "正在回复" else if (latest == "completed") "已结束" else
                        if (latest == "cancelled") "已停止" else if (latest == "failed") "未完成" else "中断"
                    conversation.title to (if (receipts.isEmpty()) label else "$label · ${receipts.last().optString("summary")}")
                }
            }
            runOnUiThread {
                if (pane != Pane.THINGS || currentPane != paneGeneration || currentGeneration != generation ||
                    currentTranscript != transcriptGeneration || owner != currentOwner) return@runOnUiThread
                transcript.removeAllViews()
                transcript.setPadding(dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space16))
                if (activities.isEmpty()) transcript.addView(Weave.text(this, "当前没有手机活动。", DesignTokens.font16, Weave.secondary))
                for ((title, summary) in activities) {
                    val card = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        background = Weave.shape(this@MainActivity, Weave.soft, DesignTokens.radius16, Weave.line)
                        setPadding(dp(DesignTokens.space16), dp(DesignTokens.space12), dp(DesignTokens.space16), dp(DesignTokens.space12))
                    }
                    card.addView(Weave.text(this, title, DesignTokens.font14, Weave.ink))
                    card.addView(Weave.text(this, summary, DesignTokens.font12, Weave.muted),
                        LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space4) })
                    transcript.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space12) })
                }
            }
        }
    }

    private fun navigateTo(target: Pane) {
        if (pane != target) { pane = target; paneGeneration++; transcriptGeneration++ }
        val chatting = target == Pane.CHAT
        menuAction.visibility = if (chatting) View.VISIBLE else View.GONE
        backAction.visibility = if (chatting) View.GONE else View.VISIBLE
        headerTitle.text = when (target) {
            Pane.CHAT -> "WeftMate"
            Pane.THINGS -> "正在做的事"
            Pane.PHONE_RECORDS -> "手机记录"
            Pane.COMPUTER_SESSIONS -> "电脑会话"
        }
        headerSubtitle.visibility = if (chatting) View.VISIBLE else View.GONE
        thingsAction.visibility = if (chatting) View.VISIBLE else View.GONE
        composerWrap.visibility = if (chatting) View.VISIBLE else View.GONE
        composerView.setSending(sending)
        readonlyStopButton.visibility = if (sending && !chatting) View.VISIBLE else View.GONE
        thingsBadge.visibility = if (sending && chatting) View.VISIBLE else View.GONE
        if (!chatting) state(if (sending) "手机会话仍在回复，可点右上停止；当前页面只读" else
            if (target == Pane.THINGS) "手机活动 · 只读" else if (target == Pane.PHONE_RECORDS) "手机同步记录 · 只读" else "电脑会话 · 只读")
    }

    private fun chooseApp() {
        if (pane != Pane.CHAT) return state("请回到对话后再使用手机动作")
        val currentPane = paneGeneration
        val owner = currentOwner
        worker.execute {
            val apps = DeviceTools(this).launchableApps()
            val values = (0 until apps.length()).map { apps.getJSONObject(it) }
            runOnUiThread {
                if (pane != Pane.CHAT || currentPane != paneGeneration || owner != currentOwner) return@runOnUiThread
                AlertDialog.Builder(this).setTitle("打开手机应用")
                    .setItems(values.map { it.optString("name") }.toTypedArray()) { _, index ->
                        directTool("open_app", JSONObject().put("packageName", values[index].getString("packageName")))
                    }.setNegativeButton("取消", null).show()
            }
        }
    }

    private fun refreshConversations() {
        val owner = currentOwner
        val currentGeneration = generation
        worker.execute {
            val conversations = if (owner == null) emptyList() else store.listConversations(owner)
            runOnUiThread {
                if (currentGeneration != generation || owner != currentOwner) return@runOnUiThread
                conversationIds = conversations.map { it.id }
                if (selectedConversation !in conversationIds) selectedConversation = conversationIds.firstOrNull()
                if (drawerDialog.isShowing) refreshDrawerHistory()
                showTranscript()
            }
        }
    }

    private fun showModelPicker() {
        if (currentOwner == null) return state("请先登录或注册账户，再选择模型")
        if (sending) return state("当前回复结束后可切换模型")
        if (modelPicker?.isShowing == true) {
            modelPicker?.dismiss()
            return
        }
        val current = model
        val popupContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius20, Weave.line)
            setPadding(dp(DesignTokens.space8), dp(DesignTokens.space8), dp(DesignTokens.space8), dp(DesignTokens.space8))
        }
        val title = Weave.text(this, "选择手机模型", DesignTokens.font14, Weave.ink, android.graphics.Typeface.BOLD).apply {
            setPadding(dp(DesignTokens.space12), dp(DesignTokens.space8), dp(DesignTokens.space12), dp(DesignTokens.space8))
        }
        popupContent.addView(title)
        val listScroll = ScrollView(this).apply { isFillViewport = false }
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        listScroll.addView(list)
        popupContent.addView(listScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val footer = Weave.text(this, "配置自定义模型", DesignTokens.font14, Weave.accent).apply {
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(DesignTokens.space48)
            setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0)
            isClickable = true; isFocusable = true
            setOnClickListener { modelPicker?.dismiss(); showSettings(true, "model") }
        }
        popupContent.addView(footer)
        val width = (resources.displayMetrics.widthPixels - dp(DesignTokens.space32)).coerceAtMost(dp(DesignTokens.space380))
        val height = dp(DesignTokens.space340).coerceAtMost(resources.displayMetrics.heightPixels / 2)
        val popup = PopupWindow(popupContent, width, height, true).apply {
            isOutsideTouchable = true
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            elevation = dp(DesignTokens.space12).toFloat()
            setOnDismissListener {
                pickerGeneration++
                if (modelPicker === this) modelPicker = null
            }
        }
        modelPicker = popup
        val request = ++pickerGeneration
        fun message(text: String, retry: Boolean = false) {
            list.removeAllViews()
            list.addView(Weave.text(this, text, DesignTokens.font13, Weave.muted).apply {
                minimumHeight = dp(DesignTokens.space48); gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0)
                if (retry) {
                    isClickable = true
                    setOnClickListener { popup.dismiss(); showModelPicker() }
                }
            })
        }
        message("正在读取已保存模型…")
        val location = IntArray(2)
        composerView.modelChoice.getLocationOnScreen(location)
        val x = dp(DesignTokens.space16).coerceAtMost((resources.displayMetrics.widthPixels - width).coerceAtLeast(0))
        val y = (location[1] - height + dp(DesignTokens.space4)).coerceAtLeast(dp(DesignTokens.space32))
        popup.showAtLocation(root, Gravity.TOP or Gravity.START, x, y)
        if (ValueAnimator.areAnimatorsEnabled()) {
            popupContent.alpha = 0f
            popupContent.animate().alpha(1f).setDuration(DesignTokens.duration160ms).start()
        }
        worker.execute {
            val saved = try { secrets.modelProfiles() } catch (_: Exception) { emptyList() }
            runOnUiThread {
                if (modelPicker !== popup || pickerGeneration != request) return@runOnUiThread
                renderModelPicker(list, saved, emptyList(), current, popup, loading = current != null)
            }
            if (current != null) {
                val discovered = try { ModelCatalogClient().discover(current) } catch (_: Exception) { null }
                runOnUiThread {
                    if (modelPicker !== popup || pickerGeneration != request) return@runOnUiThread
                    renderModelPicker(list, saved, discovered, current, popup, loading = false)
                }
            }
        }
    }

    private fun renderModelPicker(list: LinearLayout, saved: List<ModelSettings>, discovered: List<DiscoveredModel>?,
        current: ModelSettings?, popup: PopupWindow, loading: Boolean) {
        list.removeAllViews()
        val entries = saved.toMutableList()
        if (current != null) for (item in discovered.orEmpty()) {
            val index = entries.indexOfFirst { it.endpoint == current.endpoint && it.modelId == item.id }
            val profile = ModelSettings(current.endpoint, item.id, current.apiKey, item.displayName)
            if (index >= 0) entries[index] = profile else entries += profile
        }
        if (entries.isEmpty()) list.addView(Weave.text(this,
            if (loading) "正在读取模型目录…" else if (current == null) "先配置一个手机模型" else "模型目录暂不可用，请检查连接",
            DesignTokens.font13, Weave.muted).apply { minimumHeight = dp(DesignTokens.space48); gravity = Gravity.CENTER_VERTICAL; setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0) })
        for (profile in entries) {
            val selected = current?.endpoint == profile.endpoint && current.modelId == profile.modelId
            val row = LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(DesignTokens.space56)
                setPadding(dp(DesignTokens.space12), dp(DesignTokens.space4), dp(DesignTokens.space12), dp(DesignTokens.space4))
                isClickable = true; isFocusable = true
                background = Weave.shape(this@MainActivity, if (selected) Weave.accentSoft else Weave.surface, DesignTokens.radius12)
                contentDescription = "${profile.displayName}，${if (selected) "已选择" else "可选择"}，模型 ID ${profile.modelId}"
                setOnClickListener {
                    if (sending) return@setOnClickListener
                    popup.dismiss()
                    worker.execute {
                        try {
                            val configured = secrets.saveModel(profile)
                            runOnUiThread {
                                if (sending) return@runOnUiThread
                                model = configured
                                modelChip.text = "模型 · 已配置"
                                composerView.setModelName(configured.displayName)
                                modelEndpointInput.setText(configured.endpoint)
                                modelIdInput.setText(configured.modelId)
                                state("已选择 ${configured.displayName}")
                            }
                        } catch (_: Exception) { runOnUiThread { state("模型选择未保存，请在设置中检查") } }
                    }
                }
            }
            val names = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            names.addView(Weave.text(this, profile.displayName, DesignTokens.font14, Weave.ink).apply {
                maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            })
            names.addView(Weave.text(this, profile.modelId, DesignTokens.font11, Weave.muted).apply {
                maxLines = 1; ellipsize = TextUtils.TruncateAt.MIDDLE
            })
            row.addView(names, LinearLayout.LayoutParams(0, -2, 1f))
            if (selected) row.addView(Weave.icon(this, R.drawable.wm_check, Weave.accent, 18))
            list.addView(row)
        }
        if (loading || discovered == null && current != null) {
            list.addView(Weave.text(this, if (loading) "正在发现当前服务的模型…" else "目录暂不可用 · 点此重试", DesignTokens.font12, Weave.muted).apply {
                minimumHeight = dp(DesignTokens.space44); gravity = Gravity.CENTER_VERTICAL; setPadding(dp(DesignTokens.space12), 0, dp(DesignTokens.space12), 0)
                if (!loading) { isClickable = true; setOnClickListener { popup.dismiss(); showModelPicker() } }
            })
        }
    }

    private fun showTranscript() {
        if (pane != Pane.CHAT) return
        val id = selectedConversation
        val owner = currentOwner
        val currentGeneration = generation
        val currentPane = paneGeneration
        val currentTranscript = ++transcriptGeneration
        if (id == null) { renderWelcome(); return }
        worker.execute {
            val items = store.timeline(id, owner)
            runOnUiThread {
                if (pane != Pane.CHAT || currentPane != paneGeneration ||
                    currentGeneration != generation || currentTranscript != transcriptGeneration ||
                    owner != currentOwner || id != selectedConversation) return@runOnUiThread
                if (items.isEmpty()) { renderWelcome(); return@runOnUiThread }
                clearWelcomeLayoutListener()
                transcript.removeAllViews()
                transcript.minimumHeight = 0
                transcript.setPadding(dp(DesignTokens.space20), dp(DesignTokens.space20), dp(DesignTokens.space20), dp(DesignTokens.space8))
                for (item in items) {
                    if (item.user) {
                        val bubble = Weave.text(this, item.text.removePrefix("我 · "), DesignTokens.font16, Weave.ink).apply {
                            setLineSpacing(dp(DesignTokens.space4).toFloat(), 1f)
                            setPadding(dp(DesignTokens.space16), dp(DesignTokens.space12), dp(DesignTokens.space16), dp(DesignTokens.space12))
                            background = GradientDrawable().apply {
                                setColor(Weave.accentSoft)
                                val large = dp(DesignTokens.space24).toFloat(); val small = dp(DesignTokens.space6).toFloat()
                                cornerRadii = floatArrayOf(large, large, large, large, small, small, large, large)
                            }
                            maxWidth = (resources.displayMetrics.widthPixels * .87f).toInt()
                        }
                        transcript.addView(bubble, LinearLayout.LayoutParams(-2, -2).apply {
                            gravity = Gravity.END; bottomMargin = dp(DesignTokens.space24)
                        })
                    } else if (item.text.startsWith("助手 · ")) {
                        val row = LinearLayout(this).apply { gravity = Gravity.TOP }
                        row.addView(Weave.mark(this, 24, true), LinearLayout.LayoutParams(dp(DesignTokens.space24), dp(DesignTokens.space24)))
                        row.addView(Weave.text(this, item.text.removePrefix("助手 · "), DesignTokens.font16, Weave.ink).apply {
                            setLineSpacing(dp(DesignTokens.space5).toFloat(), 1f)
                        }, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space8) })
                        transcript.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space24) })
                    } else if (item.text.startsWith("系统设置 · ") || item.text.startsWith("打开应用 · ") ||
                        item.text.startsWith("应用列表 · ") || item.text.startsWith("手机动作 · ")) {
                        transcript.addView(receiptCard(item.text),
                            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space16) })
                    } else {
                        transcript.addView(Weave.text(this, item.text, DesignTokens.font12, Weave.secondary).apply {
                            background = Weave.shape(this@MainActivity, Weave.soft, DesignTokens.radius10)
                            setPadding(dp(DesignTokens.space12), dp(DesignTokens.space8), dp(DesignTokens.space12), dp(DesignTokens.space8))
                        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space12) })
                    }
                }
                scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
            }
        }
    }

    private fun receiptCard(line: String): View {
        val fields = line.split(" · ", limit = 3)
        val title = fields.getOrNull(0) ?: "手机动作"
        val status = fields.getOrNull(1) ?: "结果待确认"
        val summary = fields.getOrNull(2) ?: ""
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Weave.shape(this@MainActivity, Weave.surface, DesignTokens.radius24, Weave.line)
            setPadding(dp(DesignTokens.space16), dp(DesignTokens.space16), dp(DesignTokens.space16), dp(DesignTokens.space16))
            val head = LinearLayout(this@MainActivity).apply { gravity = Gravity.CENTER_VERTICAL }
            head.addView(Weave.text(this@MainActivity, title, DesignTokens.font14, Weave.ink, android.graphics.Typeface.BOLD),
                LinearLayout.LayoutParams(0, -2, 1f))
            head.addView(Weave.text(this@MainActivity, status, DesignTokens.font12,
                if (status.contains("未完成")) Weave.danger else Weave.accent).apply {
                background = Weave.shape(this@MainActivity, if (status.contains("未完成")) DesignTokens.nativeDangerSoft else Weave.accentSoft, DesignTokens.radius10)
                setPadding(dp(DesignTokens.space8), dp(DesignTokens.space4), dp(DesignTokens.space8), dp(DesignTokens.space4))
            })
            addView(head)
            if (summary.isNotBlank()) addView(Weave.text(this@MainActivity, summary, DesignTokens.font12, Weave.secondary).apply {
                setLineSpacing(dp(DesignTokens.space3).toFloat(), 1f)
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space10) })
        }
    }

    private fun recordRow(source: String, content: String): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(DesignTokens.space2), dp(DesignTokens.space12), dp(DesignTokens.space2), dp(DesignTokens.space12))
        addView(Weave.text(this@MainActivity, source, DesignTokens.font12, Weave.muted))
        addView(Weave.text(this@MainActivity, content, DesignTokens.font14, Weave.ink).apply {
            setLineSpacing(dp(DesignTokens.space3).toFloat(), 1f)
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space6) })
        addView(Weave.divider(this@MainActivity), LinearLayout.LayoutParams(-1, dp(DesignTokens.space1)).apply { topMargin = dp(DesignTokens.space12) })
    }

    private fun renderWelcome() {
        if (pane != Pane.CHAT) return
        clearWelcomeLayoutListener()
        transcript.removeAllViews()
        transcript.setPadding(dp(DesignTokens.space24), dp(DesignTokens.space16), dp(DesignTokens.space24), 0)
        val shortScreen = resources.configuration.screenHeightDp <= 680
        val welcome = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        transcript.addView(welcome, LinearLayout.LayoutParams(-1, -2))
        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(if (shortScreen) 92 else 148)
        }
        welcome.addView(hero, LinearLayout.LayoutParams(-1, -2))
        val signature = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        signature.addView(Weave.mark(this, 32, true), LinearLayout.LayoutParams(dp(DesignTokens.space32), dp(DesignTokens.space32)))
        signature.addView(Weave.text(this, "你的个人空间", DesignTokens.font12, Weave.muted),
            LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(DesignTokens.space12) })
        hero.addView(signature, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space20) })
        hero.addView(Weave.text(this, "你好，慢慢聊。", if (shortScreen) DesignTokens.font24 else 30f, Weave.ink),
            LinearLayout.LayoutParams(-1, -2))
        hero.addView(Weave.text(this, "说说今天，\n也可以让我帮你做一件手机上的事。", DesignTokens.font16, Weave.muted).apply {
            setLineSpacing(dp(DesignTokens.space7).toFloat(), 1f)
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space12) })
        val starts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        welcome.addView(starts)
        starts.addView(Weave.text(this, "从这里开始", DesignTokens.font12, Weave.muted),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space8) })
        starts.addView(welcomePrompt(R.drawable.wm_chat, "先聊一会儿", "从一句话开始") {
            composer.requestFocus()
            (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                .showSoftInput(composer, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
        })
        starts.addView(welcomePrompt(R.drawable.wm_phone, "打开手机应用", "只在这台手机") { chooseApp() })
        starts.addView(welcomePrompt(R.drawable.wm_edit, "留下一个想法", "以后接着聊") {
            if (composer.text.isBlank()) composer.setText("我想记下：")
            composer.requestFocus()
        })
        val connection = Weave.text(this,
            if (host == null) "本机已保存 · 电脑账户未登录" else "本机已保存 · 电脑账户已登录，连接待核对",
            DesignTokens.font12, Weave.muted).apply { gravity = Gravity.CENTER_VERTICAL; id = R.id.welcome_connection }
        starts.addView(Weave.divider(this), LinearLayout.LayoutParams(-1, dp(DesignTokens.space1)).apply { topMargin = dp(DesignTokens.space16) })
        starts.addView(connection, LinearLayout.LayoutParams(-1, dp(DesignTokens.space40)))
        val listener = object : ViewTreeObserver.OnGlobalLayoutListener {
            override fun onGlobalLayout() {
                if (pane != Pane.CHAT || transcript.childCount != 1 || transcript.getChildAt(0) !== welcome) {
                    clearWelcomeLayoutListener(); return
                }
                val available = (scroll.height - transcript.paddingTop - transcript.paddingBottom).coerceAtLeast(0)
                if (available == 0 || starts.measuredHeight == 0) return
                val neededHero = maxOf(dp(if (shortScreen) 92 else 148), available - starts.measuredHeight)
                if (hero.minimumHeight != neededHero) hero.minimumHeight = neededHero
                if (welcome.minimumHeight != available) welcome.minimumHeight = available
            }
        }
        welcomeLayoutListener = listener
        scroll.viewTreeObserver.addOnGlobalLayoutListener(listener)
        scroll.post { listener.onGlobalLayout() }
    }

    private fun clearWelcomeLayoutListener() {
        val listener = welcomeLayoutListener ?: return
        if (scroll.viewTreeObserver.isAlive) scroll.viewTreeObserver.removeOnGlobalLayoutListener(listener)
        welcomeLayoutListener = null
    }

    private fun welcomePrompt(icon: Int, title: String, hint: String, action: () -> Unit): View = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(DesignTokens.space48)
        isClickable = true; isFocusable = true
        addView(Weave.icon(this@MainActivity, icon, Weave.secondary, 18))
        addView(Weave.text(this@MainActivity, title, DesignTokens.font14, Weave.ink),
            LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(DesignTokens.space12) })
        addView(Weave.text(this@MainActivity, hint, DesignTokens.font12, Weave.muted))
        addView(Weave.icon(this@MainActivity, R.drawable.wm_right, Weave.muted, 12),
            LinearLayout.LayoutParams(dp(DesignTokens.space12), dp(DesignTokens.space12)).apply { leftMargin = dp(DesignTokens.space8) })
        setOnClickListener { action() }
    }

    private fun weaveAvatar(size: Int): TextView = Weave.text(this, "我", if (size >= 64) DesignTokens.font24 else DesignTokens.font16, Weave.accent).apply {
        gravity = Gravity.CENTER
        background = Weave.shape(this@MainActivity, Weave.accentSoft, if (size >= 64) 24 else 16)
    }

    private fun showAccountEvents() {
        navigateTo(Pane.PHONE_RECORDS)
        val owner = currentOwner
        if (owner == null) {
            transcript.removeAllViews()
            transcript.setPadding(dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space12))
            transcript.addView(Weave.text(this, "登录电脑账户并同步后，可在这里查看手机来源记录。", DesignTokens.font14, Weave.muted))
            return state("先登录电脑账户，再查看手机记录")
        }
        val currentGeneration = generation
        val currentPane = paneGeneration
        val currentTranscript = ++transcriptGeneration
        transcript.removeAllViews()
        transcript.setPadding(dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space12))
        transcript.addView(Weave.text(this, "正在读取手机记录…", DesignTokens.font14, Weave.muted))
        worker.execute {
            val events = store.remoteEvents(owner).takeLast(100)
            runOnUiThread {
                if (pane != Pane.PHONE_RECORDS || currentPane != paneGeneration ||
                    currentGeneration != generation || owner != currentOwner ||
                    currentTranscript != transcriptGeneration) return@runOnUiThread
                transcript.removeAllViews()
                transcript.addView(Weave.text(this, "手机记录", DesignTokens.font24, Weave.ink),
                    LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space8) })
                transcript.addView(Weave.text(this, "同一账户下已同步的手机来源内容，仅供查看。", DesignTokens.font12, Weave.muted),
                    LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space20) })
                if (events.isEmpty()) transcript.addView(Weave.text(this, "暂时没有已同步的手机记录。", DesignTokens.font14, Weave.muted))
                for (event in events) {
                    val payload = event.optJSONObject("payload") ?: continue
                    val detail = when (event.optString("kind")) {
                        "conversation.created" -> "新会话 · ${payload.optString("title").take(120)}"
                        "message.created" -> "${if (payload.optString("role") == "assistant") "助手" else "我"} · ${payload.optString("text").take(500)}"
                        "turn.finished" -> when (payload.optString("status")) {
                            "completed" -> "本轮已结束"
                            "cancelled" -> "本轮已停止"
                            "failed" -> "本轮未完成"
                            else -> "本轮中断"
                        }
                        "tool.receipt" -> "手机动作 · ${payload.optString("summary").take(200)}"
                        else -> continue
                    }
                    val source = if (event.optString("sourceDeviceId") == host?.deviceId) "这台手机" else "另一台设备"
                    transcript.addView(recordRow(source, detail))
                }
            }
        }
    }

    private fun showComputerSessions() {
        navigateTo(Pane.COMPUTER_SESSIONS)
        val identity = host
        if (identity == null) {
            transcript.removeAllViews()
            transcript.setPadding(dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space12))
            transcript.addView(Weave.text(this, "登录电脑账户后，可在这里查看电脑会话。", DesignTokens.font14, Weave.muted))
            return state("先登录电脑账户，再查看电脑会话")
        }
        val owner = currentOwner
        val currentPane = paneGeneration
        val currentTranscript = ++transcriptGeneration
        transcript.removeAllViews()
        transcript.setPadding(dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space24), dp(DesignTokens.space12))
        transcript.addView(Weave.text(this, "正在连接电脑会话…", DesignTokens.font14, Weave.muted))
        worker.execute {
            try {
                val rows = api.remoteSessions(identity).getJSONArray("sessions")
                val visible = (0 until minOf(rows.length(), 30)).map { rows.getJSONObject(it) }
                runOnUiThread {
                    if (pane != Pane.COMPUTER_SESSIONS || currentPane != paneGeneration ||
                        owner != currentOwner || host?.deviceId != identity.deviceId ||
                        currentTranscript != transcriptGeneration) return@runOnUiThread
                    transcript.removeAllViews()
                    transcript.addView(Weave.text(this, "电脑会话", DesignTokens.font24, Weave.ink))
                    transcript.addView(Weave.text(this, if (visible.isEmpty()) "电脑还没有可读会话。" else "请选择一段电脑会话查看；本页只读。", DesignTokens.font14, Weave.muted),
                        LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(DesignTokens.space12) })
                    AlertDialog.Builder(this).setTitle("电脑会话 · 只读")
                        .setItems(visible.map { it.optString("title", "新对话").take(80) }.toTypedArray()) { _, index ->
                            val id = visible[index].getString("sessionId")
                            worker.execute {
                                try {
                                    val projected = mutableListOf<String>()
                                    var cursor = -1L
                                    for (page in 0 until 5) {
                                        val result = api.remoteHistory(identity, id, cursor)
                                        val events = result.getJSONArray("events")
                                        for (n in 0 until events.length()) {
                                            val row = events.getJSONObject(n)
                                            val type = row.optString("type")
                                            if (type in setOf("user.message", "assistant.message"))
                                                projected += "${if (type == "user.message") "我" else "电脑助手"} · ${row.optJSONObject("data")?.optString("text")?.take(1000) ?: ""}"
                                        }
                                        val next = result.getLong("nextSeq")
                                        if (!result.getBoolean("hasMore") || next <= cursor) break
                                        cursor = next
                                    }
                                    runOnUiThread {
                                        if (pane != Pane.COMPUTER_SESSIONS || currentPane != paneGeneration ||
                                            owner != currentOwner || host?.deviceId != identity.deviceId ||
                                            currentTranscript != transcriptGeneration) return@runOnUiThread
                                        transcript.removeAllViews()
                                        transcript.addView(Weave.text(this, "电脑会话 · 只读", DesignTokens.font24, Weave.ink),
                                            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(DesignTokens.space20) })
                                        for (line in projected.takeLast(100)) transcript.addView(recordRow("电脑来源", line))
                                    }
                                } catch (_: Exception) { runOnUiThread {
                                    if (pane == Pane.COMPUTER_SESSIONS && currentPane == paneGeneration && owner == currentOwner)
                                        state("电脑会话历史暂不可读取，手机本地记录不受影响")
                                } }
                            }
                        }.setNegativeButton("关闭", null).show()
                }
            } catch (_: Exception) { runOnUiThread {
                if (pane == Pane.COMPUTER_SESSIONS && currentPane == paneGeneration && owner == currentOwner) {
                    transcript.removeAllViews()
                    transcript.addView(Weave.text(this, "电脑暂时不可达。手机本地对话仍可使用。", DesignTokens.font14, Weave.muted))
                    state("电脑不可达或会话读取失败；手机本地记录仍可用")
                }
            } }
        }
    }

    private fun createConversation() {
        if (pane != Pane.CHAT) return state("请回到对话后再新建会话")
        val owner = currentOwner
        worker.execute {
            val conversation = store.createConversation("新对话", owner)
            runOnUiThread { if (owner == currentOwner) { selectedConversation = conversation.id; refreshConversations() } }
        }
    }

    private fun login() {
        val origin = originInput.text.toString()
        val username = usernameInput.text.toString()
        val password = passwordInput.text.toString()
        passwordInput.text.clear()
        cancelRequested = true; activeModel?.cancel(); generation += 1; selectedConversation = null
        state("正在验证账户…")
        worker.execute {
            try {
                val verified = api.login(origin, username, password, "Android 手机")
                secrets.saveHost(verified)
                val selectedModel = secrets.model(Endpoints.ownerKey(verified.origin, verified.ownerId))
                runOnUiThread {
                    host = verified; currentOwner = Endpoints.ownerKey(verified.origin, verified.ownerId)
                    model = selectedModel
                    modelChip.text = if (selectedModel == null) "模型 · 未配置" else "模型 · 已配置"
                    composerView.setModelName(selectedModel?.displayName)
                    modelEndpointInput.setText(selectedModel?.endpoint ?: "")
                    modelIdInput.setText(selectedModel?.modelId ?: "")
                    modelKeyInput.text.clear()
                    navigateTo(Pane.CHAT)
                    val backgroundSync = SyncJobService.schedule(this)
                    hostChip.text = "电脑 · 已登录"
                    syncChip.text = if (backgroundSync) "同步 · 待连接" else "同步 · 手动"
                    settingsProfileSubtitle.text = verified.username
                    drawerProfileTitle.text = verified.username
                    val avatar = verified.username.firstOrNull()?.uppercase() ?: "我"
                    settingsAvatar.text = avatar
                    drawerAvatar.text = avatar
                    state(if (backgroundSync) "电脑账户已登录" else "电脑账户已登录 · 后台同步未启用")
                    refreshConversations()
                }
            } catch (error: Exception) {
                runOnUiThread { state("登录失败：${safeError(error)}；原本机资料保留") }
            }
        }
    }

    private fun logout() {
        val old = host ?: return
        cancelRequested = true; activeModel?.cancel(); generation += 1; selectedConversation = null
        worker.execute {
            val revoked = try { api.logout(old); true } catch (_: Exception) { false }
            secrets.clearHost()
            runOnUiThread {
                host = null; currentOwner = null
                model = null
                modelChip.text = "模型 · 未配置"
                composerView.setModelName(null)
                modelEndpointInput.text.clear(); modelIdInput.text.clear(); modelKeyInput.text.clear()
                navigateTo(Pane.CHAT)
                SyncJobService.cancel(this)
                hostChip.text = "电脑 · 未登录"
                syncChip.text = "同步 · 本机"
                settingsProfileSubtitle.text = "本机个人空间"
                drawerProfileTitle.text = "本机个人空间"
                settingsAvatar.text = "我"
                drawerAvatar.text = "我"
                state(if (revoked) "已退出账户；本机资料仍保留" else "本机已退出；服务器撤销未确认，请联网后在设备列表移除本设备")
                refreshConversations()
            }
        }
    }

    private fun saveModel() {
        if (currentOwner == null) return state("请先登录或注册账户，再配置模型")
        if (sending) return state("当前回复结束后可切换模型")
        val endpoint = modelEndpointInput.text.toString().trim()
        val modelId = modelIdInput.text.toString().trim()
        val key = modelKeyInput.text.toString()
        modelKeyInput.text.clear()
        worker.execute {
            try {
                Endpoints.modelUrl(endpoint)
                require(modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
                if (sending) { runOnUiThread { state("当前回复结束后可切换模型") }; return@execute }
                val configured = secrets.saveModel(ModelSettings(endpoint, modelId, key))
                runOnUiThread {
                    model = configured
                    modelChip.text = "模型 · 已配置"
                    composerView.setModelName(configured.displayName)
                    state("手机模型已配置")
                }
            } catch (_: Exception) { runOnUiThread { state("模型配置无效：须是安全的 /v1 地址及模型 ID") } }
        }
    }

    private fun bindUnbound() {
        val owner = currentOwner ?: return state("先登录账户，再明确关联本机对话")
        if (secrets.legacyOwnerScope() != owner) return state("旧本机记录归属未确认，不能直接并入当前账户")
        worker.execute {
            store.bindUnboundTo(owner)
            runOnUiThread { state("本机未绑定对话已关联当前账户，等待同步"); refreshConversations() }
        }
    }

    private fun sync() {
        val identity = host ?: return state("未登录，只有本机记录")
        state("正在同步本机记录…")
        worker.execute {
            try {
                val outcome = SyncManager(store, api).syncOnce(identity)
                runOnUiThread {
                    if (host?.deviceId == identity.deviceId) {
                        syncChip.text = if (outcome.hasMore) "同步 · 续接中" else "同步 · 已连接"
                        state("同步完成：上传 ${outcome.uploaded}、接收 ${outcome.downloaded}${if (outcome.hasMore) "；仍有后续页" else ""}")
                    }
                }
            } catch (error: Exception) {
                if (error is ApiFailure && error.status in setOf(401, 409, 413, 429)) SyncJobService.cancel(this)
                runOnUiThread { syncChip.text = "同步 · 待处理"; state(when (error) {
                    is ApiFailure -> when (error.status) {
                        401 -> "登录已失效，暂停同步；本地记录未删除"
                        409 -> "同步冲突，已停下并保留本地事件"
                        413 -> "同步批次超出服务上限；本地事件保留，已暂停自动重试"
                        429 -> "电脑同步存储容量已满；本地事件保留，已暂停自动重试"
                        else -> "暂时无法同步；本地记录保留，可稍后重试"
                    }
                    else -> "电脑不可达或网络中断；本地记录保留"
                }) }
            }
        }
    }

    private fun ensureConversation(owner: String?, title: String): String {
        val selected = selectedConversation
        if (selected != null && store.listConversations(owner).any { it.id == selected }) return selected
        return store.createConversation(title, owner).id
    }

    private fun send() {
        if (pane != Pane.CHAT) return state("当前页面只读；请先回到对话再发送")
        if (currentOwner == null) return state("请先登录或注册账户；旧本机资料不会自动显示")
        val text = composer.text.toString().trim()
        if (text.isBlank()) return
        if (sending) return state("当前回合尚未结束，请等待或停止")
        if (text.length > 16_384) return state("消息超过 16384 字符")
        sending = true
        cancelRequested = false
        composerView.setSending(true)
        composerView.modelChoice.isEnabled = false
        composerView.voiceButton.isEnabled = false
        readonlyStopButton.visibility = if (pane == Pane.CHAT) View.GONE else View.VISIBLE
        thingsBadge.visibility = if (pane == Pane.CHAT) View.VISIBLE else View.GONE
        settingsStop.visibility = if (settingsDialog.isShowing) View.VISIBLE else View.GONE
        composer.text.clear()
        val owner = currentOwner
        val currentGeneration = generation
        val configured = model
        modelWorker.execute {
            var turnId: String? = null
            var conversationIdForTurn: String? = null
            try {
                val conversationId = ensureConversation(owner, text.take(40))
                conversationIdForTurn = conversationId
                store.addMessage(conversationId, "user", text)
                turnId = store.startTurn(conversationId)
                runOnUiThread {
                    if (currentGeneration == generation && owner == currentOwner) {
                        selectedConversation = conversationId; refreshConversations()
                        state(if (configured == null) "消息已保存在手机；手机模型尚未配置" else "手机模型正在回复…")
                    }
                }
                if (configured == null) {
                    store.finishTurn(turnId, "failed", "MODEL_NOT_CONFIGURED")
                    return@execute
                }
                if (cancelRequested || currentGeneration != generation) throw ModelCancelled()
                val guardedTools = object : DeviceToolExecutor {
                    private val device = DeviceTools(this@MainActivity)
                    override fun execute(name: String, arguments: JSONObject): ToolResult {
                        if (cancelRequested || currentGeneration != generation || owner != currentOwner)
                            throw ModelCancelled()
                        return device.execute(name, arguments)
                    }
                }
                val client = ModelClient(this, JsonHttp(), guardedTools)
                activeModel = client
                if (cancelRequested) client.cancel()
                val reply = client.complete(configured, store.messages(conversationId, owner),
                    receipt = { callId, name, status, summary ->
                        store.toolReceipt(conversationId, callId, name, status, summary)
                        runOnUiThread { if (currentGeneration == generation) state("手机动作：$summary") }
                    }, contextOmitted = { count ->
                        if (count > 0) runOnUiThread { if (currentGeneration == generation) state("本轮仅带入最近对话，省略较早 $count 条；完整历史仍在手机") }
                    })
                if (currentGeneration != generation) throw ModelCancelled()
                store.addMessage(conversationId, "assistant", reply, turnId)
                store.finishTurn(turnId, "completed")
                runOnUiThread { if (currentGeneration == generation) { state("手机模型已回复；同步待确认"); showTranscript() } }
            } catch (error: Exception) {
                val status = if (error is ModelCancelled || currentGeneration != generation) "cancelled" else "failed"
                val partial = (when (error) {
                    is ModelCancelled -> error.partialText
                    is ModelNotCompleted -> error.partialText
                    else -> ""
                }).trim().take(16_384)
                if (partial.isNotBlank() && turnId != null) try {
                    val conversation = conversationIdForTurn
                    if (conversation != null) store.addMessage(conversation, "assistant", partial, turnId)
                } catch (_: Exception) { }
                turnId?.let { store.finishTurn(it, status, if (status == "failed") safeError(error) else null) }
                runOnUiThread { if (currentGeneration == generation) {
                    state(if (status == "cancelled") "本轮已停止" else "手机模型未完成：${humanError(error)}")
                    if (partial.isNotBlank()) showTranscript()
                } }
            } finally {
                activeModel = null
                sending = false
                runOnUiThread {
                    composerView.setSending(false)
                    composerView.modelChoice.isEnabled = true
                    composerView.voiceButton.isEnabled = true
                    readonlyStopButton.visibility = View.GONE
                    thingsBadge.visibility = View.GONE
                    settingsStop.visibility = View.GONE
                    if (host != null && currentGeneration == generation) sync()
                }
            }
        }
    }

    private fun directTool(name: String, args: JSONObject) {
        if (pane != Pane.CHAT) return state("当前页面只读；请先回到对话再使用手机动作")
        if (currentOwner == null) return state("请先登录或注册账户")
        val owner = currentOwner
        val currentPane = paneGeneration
        worker.execute {
            try {
                if (pane != Pane.CHAT || currentPane != paneGeneration || owner != currentOwner) return@execute
                val id = ensureConversation(owner, "手机操作")
                if (pane != Pane.CHAT || currentPane != paneGeneration || owner != currentOwner) return@execute
                val result = DeviceTools(this).execute(name, args)
                store.toolReceipt(id, "tool-${UUID.randomUUID()}", name, result.status, result.summary)
                runOnUiThread {
                    if (pane == Pane.CHAT && currentPane == paneGeneration && owner == currentOwner) {
                        selectedConversation = id; refreshConversations()
                        state("${result.summary}${if (name == "list_launchable_apps") "：${result.result.optJSONArray("apps")?.let { apps -> (0 until minOf(apps.length(), 12)).joinToString("、") { apps.getJSONObject(it).getString("name") + " (" + apps.getJSONObject(it).getString("packageName") + ")" } } ?: ""}" else ""}")
                    }
                }
            } catch (_: Exception) { runOnUiThread { state("手机动作未完成；未记录成功") } }
        }
    }

    private fun safeError(error: Exception): String = when (error) {
        is ApiFailure -> error.safeCode
        is ModelNotCompleted -> error.code
        is ModelLimitReached -> "MODEL_TOOL_LIMIT"
        is ModelCancelled -> "CANCELLED"
        else -> "UNAVAILABLE"
    }

    private fun humanError(error: Exception): String = when (error) {
        is ModelLimitReached -> "重复操作已停止"
        is ModelNotCompleted -> when (error.code) {
            "MODEL_OUTPUT_LIMIT" -> "模型达到输出上限；已保留生成的文字"
            "MODEL_CONTENT_FILTERED" -> "模型停止输出；已保留生成的文字"
            else -> "模型结束状态不明确；已保留生成的文字"
        }
        is ApiFailure -> when (error.safeCode) {
            "MODEL_CONTEXT_TOO_LARGE" -> "当前对话太长，请新建会话继续"
            "MODEL_EMPTY_REPLY" -> "模型未返回可显示的回复"
            else -> if (error.status == 401 || error.status == 403) "模型凭据或权限无效" else "模型服务暂不可用"
        }
        else -> "模型服务暂不可用"
    }
}
