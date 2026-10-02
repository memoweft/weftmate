package com.memoweft.weftmate.mobile

/** System recognizer output is only a draft, bound to the conversation that launched it. */
data class SpeechAttempt(val owner: String?, val conversationId: String?,
    val accountGeneration: Int, val paneGeneration: Int)

sealed interface SpeechDraftResult {
    data class Text(val draft: String) : SpeechDraftResult
    data object Cancelled : SpeechDraftResult
    data object Empty : SpeechDraftResult
    data object TooLong : SpeechDraftResult
    data object Stale : SpeechDraftResult
}

object SpeechDraftGate {
    fun settle(attempt: SpeechAttempt, owner: String?, conversationId: String?,
        accountGeneration: Int, paneGeneration: Int, inChat: Boolean,
        accepted: Boolean, recognized: String?, previousDraft: String): SpeechDraftResult {
        if (!inChat || attempt.owner != owner || attempt.conversationId != conversationId ||
            attempt.accountGeneration != accountGeneration || attempt.paneGeneration != paneGeneration) {
            return SpeechDraftResult.Stale
        }
        if (!accepted) return SpeechDraftResult.Cancelled
        val text = recognized?.trim()?.takeIf { it.isNotEmpty() } ?: return SpeechDraftResult.Empty
        val joined = if (previousDraft.isBlank()) text else previousDraft.trimEnd() + " " + text
        return if (joined.length <= 16_384) SpeechDraftResult.Text(joined) else SpeechDraftResult.TooLong
    }
}
