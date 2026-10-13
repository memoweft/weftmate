package com.memoweft.weftmate.mobile

/** Service directories explicitly identify non-chat tasks; known non-chat ID families are filtered too. */
internal fun isServiceChatModel(id: String, type: String = ""): Boolean =
    !Regex("(?i)embedding|speech|audio|image|moderation|rerank|transcription").containsMatchIn(type) &&
    !Regex("(?i)(?:^|[-_/.])(?:embedding|embeddings|embed|rerank|tts|asr|stt|whisper|dall-e|moderation|imagen|flux|stable-diffusion|speech|transcription)(?:$|[-_/.0-9])").containsMatchIn(id) &&
    !Regex("(?i)^(?:text-embedding|omni-moderation|gpt-image)").containsMatchIn(id)

internal fun phoneModelDisplayName(id: String, supplied: String = ""): String {
    if (supplied.isNotBlank()) return supplied.replace(Regex("[\\u0000-\\u001f]"), " ").trim().take(100)
    val brands = mapOf("mimo" to "MiMo", "gpt" to "GPT", "claude" to "Claude", "deepseek" to "DeepSeek", "qwen" to "Qwen")
    return id.split(Regex("[-_]+")).joinToString(" ") { brands[it.lowercase()] ?: if (Regex("^v?[0-9]").containsMatchIn(it)) it else it.replaceFirstChar(Char::uppercase) }
}

internal fun phoneCatalogFailureStatus(error: Exception): String = if (error is ApiFailure) when (error.status) {
    401, 403 -> "authentication_failed"
    404, 405, 501 -> "unsupported"
    else -> "failed"
} else "offline"

internal fun phoneServiceDisplayName(endpoint: String): String {
    val host = java.net.URL(endpoint).host.lowercase()
    return mapOf("api.xiaomimimo.com" to "MiMo", "api.deepseek.com" to "DeepSeek",
        "api.openai.com" to "OpenAI", "api.anthropic.com" to "Claude", "openrouter.ai" to "OpenRouter",
        "dashscope.aliyuncs.com" to "通义千问", "api.moonshot.cn" to "Kimi")[host] ?: host
}

internal fun phoneServiceEndpoint(input: String): String {
    val url = java.net.URL(input.trim())
    require(Endpoints.allowedModelProtocol(url) && url.userInfo == null && url.query == null && url.ref == null)
    val path = url.path.trimEnd('/').replace(Regex("/(?:chat/completions|models|messages)$"), "")
    return "${url.protocol}://${url.authority}$path/chat/completions"
}
