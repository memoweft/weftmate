package com.memoweft.weftmate.mobile

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.RippleDrawable
import android.text.Editable
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/** Native Weave composer: draft above, actions in one row beside the system IME. */
class WeaveComposerView(context: Context, private val actions: Actions) : LinearLayout(context) {
    interface Actions {
        fun plus()
        fun model()
        fun device()
        fun voice()
        fun send()
        fun stop()
    }
    private fun dp(value: Int) = Weave.dp(context, value)
    val composer: EditText
    val modelName: TextView
    val modelChoice: LinearLayout
    val deviceLabel: TextView
    val voiceButton: FrameLayout
    val sendButton: Button
    val stopButton: Button
    val statusText: TextView

    init {
        orientation = VERTICAL
        setPadding(dp(16), dp(5), dp(16), dp(10))
        setBackgroundColor(Weave.surface)
        deviceLabel = Weave.text(context, "执行于这台手机", 12f, Weave.muted).apply {
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            minHeight = dp(32)
            maxLines = 1
            contentDescription = "执行设备：这台手机"
            isClickable = true; isFocusable = true
            setOnClickListener { actions.device() }
        }
        addView(deviceLabel, LayoutParams(-1, dp(32)))
        val card = LinearLayout(context).apply {
            orientation = VERTICAL
            background = Weave.shape(context, Weave.soft, 26, Weave.line)
            setPadding(dp(8), dp(5), dp(8), dp(5))
        }
        addView(card, LayoutParams(-1, -2))
        composer = EditText(context).apply {
            id = R.id.composer
            hint = "和 WeftMate 聊聊…"
            textSize = 16f; setTextColor(Weave.ink); setHintTextColor(Weave.muted)
            setSingleLine(false); minLines = 2; maxLines = 5
            background = null
            setPadding(dp(12), dp(8), dp(12), dp(8))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        card.addView(composer, LayoutParams(-1, -2))
        val row = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        card.addView(row, LayoutParams(-1, dp(48)))
        val plus = Weave.iconButton(context, R.drawable.wm_plus, "添加手机动作", Weave.secondary) { actions.plus() }
        row.addView(plus, LayoutParams(dp(48), dp(48)))
        modelChoice = LinearLayout(context).apply {
            id = R.id.model_choice
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(48)
            isClickable = true; isFocusable = true
            background = RippleDrawable(ColorStateList.valueOf(Weave.accentSoft), Weave.shape(context, Weave.soft, 10), null)
            contentDescription = "选择对话模型"
            setPadding(dp(4), 0, dp(4), 0)
            setOnClickListener { actions.model() }
        }
        modelName = Weave.text(context, "选择模型", 12f, Weave.secondary).apply {
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
        }
        modelChoice.addView(modelName, LayoutParams(0, -2, 1f))
        modelChoice.addView(Weave.icon(context, R.drawable.wm_down, Weave.secondary, 14),
            LayoutParams(dp(14), dp(14)).apply { leftMargin = dp(4) })
        row.addView(modelChoice, LayoutParams(0, dp(48), 1f))
        voiceButton = Weave.iconButton(context, R.drawable.wm_mic, "语音输入", Weave.secondary) { actions.voice() }
            .apply { id = R.id.mic_button }
        row.addView(voiceButton, LayoutParams(dp(48), dp(48)))
        sendButton = circle(R.drawable.wm_arrow, "发送消息") { actions.send() }.apply { id = R.id.send_button }
        stopButton = circle(R.drawable.wm_stop, "停止回复") { actions.stop() }.apply {
            id = R.id.stop_button; visibility = GONE
        }
        row.addView(sendButton, LayoutParams(dp(48), dp(48)))
        row.addView(stopButton, LayoutParams(dp(48), dp(48)))
        statusText = Weave.text(context, "本机对话会保存在手机。", 10f, Weave.muted).apply {
            id = R.id.status_text
            maxLines = 2; ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(8), dp(6), dp(8), 0)
        }
        addView(statusText)
        composer.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) { }
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { updateDraftState() }
            override fun afterTextChanged(s: Editable?) { }
        })
        updateDraftState()
    }

    private fun circle(icon: Int, description: String, onClick: () -> Unit) = Button(context).apply {
        text = ""; contentDescription = description
        isAllCaps = false; backgroundTintList = null; stateListAnimator = null
        minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
        elevation = 0f; gravity = Gravity.CENTER; setPadding(0, 0, 0, 0)
        val drawable = context.getDrawable(icon)?.mutate()?.apply { setTint(Weave.surface) }
        setCompoundDrawablesWithIntrinsicBounds(drawable, null, null, null)
        setOnClickListener { onClick() }
    }

    fun setModelName(name: String?) {
        val display = name?.takeIf { it.isNotBlank() } ?: "选择模型"
        modelName.text = display
        modelChoice.contentDescription = "选择对话模型，当前 $display"
    }

    fun setSending(sending: Boolean) {
        sendButton.visibility = if (sending) GONE else VISIBLE
        stopButton.visibility = if (sending) VISIBLE else GONE
    }

    private fun updateDraftState() {
        val ready = composer.text?.isNotBlank() == true
        sendButton.isEnabled = ready
        sendButton.alpha = 1f
        sendButton.background = Weave.shape(context, if (ready) Weave.accent else Weave.soft, 24)
        sendButton.compoundDrawables[0]?.mutate()?.setTint(if (ready) Weave.surface else Weave.secondary)
    }
}
