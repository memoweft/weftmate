package com.memoweft.weftmate.mobile

import org.json.JSONObject

/** Closed vocabularies: redact by omission, never by guessing what free text means. */
internal object DiagnosticPolicy {
    const val RETENTION_DAYS = 7
    const val MAX_BYTES = 2L * 1024 * 1024
    val events = setOf("app.start", "app.exit", "app.background", "app.previous_unclean_exit", "app.previous_exit",
        "app.failure", "connection.change", "sync.failure", "approval.failure", "notification.failure",
        "webview.process_gone", "webview.recovery", "ui.load_failure", "ui.verification_failure", "ui.fallback")
    val reasons = setOf("unknown", "crash", "native_crash", "anr", "low_memory", "user_requested", "user_stopped",
        "system_update", "permission_change", "system_other", "terminated_in_background", "activity_finished")
    private val names = setOf("Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError",
        "AggregateError", "AbortError", "DOMException", "java.lang.RuntimeException", "java.lang.IllegalStateException", "java.lang.IllegalArgumentException",
        "java.lang.NullPointerException", "java.lang.OutOfMemoryError", "java.lang.SecurityException", "java.io.IOException",
        "java.net.SocketTimeoutException", "javax.net.ssl.SSLException", "javax.net.ssl.SSLHandshakeException", "com.memoweft.weftmate.mobile.ApiFailure", "com.memoweft.weftmate.mobile.SyncInterrupted", "com.memoweft.weftmate.mobile.ModelCancelled", "com.memoweft.weftmate.mobile.ModelNotCompleted", "com.memoweft.weftmate.mobile.ModelLimitReached")
    private val scripts = setOf("account.js",
        "activity-view.js",
        "activity.js",
        "android-bridge.js",
        "app.js",
        "appearance.js",
        "approvals.js",
        "attachments.js",
        "auth.js",
        "backup.js",
        "chat-window.js",
        "chat.js",
        "client.js",
        "cloud-account.js",
        "cloud-auth.js",
        "cloud-login.js",
        "cloud-native.js",
        "cloud-settings.js",
        "composer-subtasks.js",
        "composer.js",
        "conversation-scroll.js",
        "data.js",
        "decisions.js",
        "folder-choice.js",
        "goals-view.js",
        "goals.js",
        "help-view.js",
        "help.js",
        "icons.js",
        "layout.js",
        "library-view.js",
        "library.js",
        "local-diagnostics.js",
        "main-chat-mobile.js",
        "main-chat-registry.js",
        "main-chat.js",
        "memory.js",
        "message-actions.js",
        "messages.js",
        "mobile-decisions.js",
        "mobile-host.js",
        "mobile-settings.js",
        "mobile-web.js",
        "mobile.js",
        "motion.js",
        "next-suggestions.js",
        "notifications.js",
        "offline.js",
        "onboarding-copy.js",
        "personalization.js",
        "phone.js",
        "popovers.js",
        "presence.js",
        "question-bar.js",
        "questions.js",
        "release-notes.js",
        "rendering.js",
        "reply-motion.js",
        "resources.js",
        "schedules-view.js",
        "schedules.js",
        "search-view.js",
        "search.js",
        "sessions.js",
        "settings-controls.js",
        "settings-registry.js",
        "settings.js",
        "shell.js",
        "shortcuts.js",
        "store.js",
        "subtasks.js",
        "system-bars.js",
        "tasks.js",
        "timeline-model.js",
        "timeline.js",
        "update.js",
        "usage-view.js",
        "usage.js")
    private val classes = setOf("HybridActivity", "MainActivity", "RunDiagnostics", "WeftMateApplication", "DiagnosticJournal", "DiagnosticQaReceiver",
        "LocalStore", "PersonalApi", "JsonHttp", "SyncManager", "SyncJobService", "NotificationWorker", "ActivityNotifications",
        "MobileUiBundles", "SignedUiManifest", "SharedChat", "SecureSettings", "AttachmentStore", "CloudAppLogin", "ModelClient")
    private val methods = setOf("onReceive","abort","accept","acceptedSharedImageCommands","accountModel","accountModelByRequest","accountModelIntent","accountModels","accountState",
        "accountView","activeModelScope","activityCommandProjection","actualOriginalModel","addMessage","adopt","adoptSharedConversation","adopted",
        "afterTextChanged","allowed","allowedModelProtocol","allowedProtocol","answerQuestion","appOverLimit","appValue","appearance",
        "applicationAppearanceMode","apply","applyRemotePage","applySystemBars","approvalDecisionPath","approvalListPath","approvals","artifactBytes",
        "artifactPreview","artifactSaveCurrent","artifactSaveMimeType","attachmentPickCurrent","attachmentResultBody","attachmentScopeAllowed","authWriteHeaders","autoUpdates",
        "availableThumbnail","beforeTextChanged","begin","bindSharedAttempt","bindUnbound","bindUnboundTo","body","bridge",
        "buildDrawer","buildPlanPage","buildSettingsSheet","buildUi","buildWeaveUi","business","button","byRequest",
        "bytes","cachedProfile","cachedSharedHistory","canCancelScheduled","canContinue","canShowNotification","cancel","cancelOnlyThisGeneration",
        "cancelPreviousNotifications","cancelScope","cancelVisible","canonical","captureLegacyOwner","category","changePassword","channel",
        "check","checkActive","checkAllowed","checkClientTrusted","checkFinish","checkForUpdate","checkServerTrusted","checked",
        "checkedScope","chooseApp","circle","claimDraft","clear","clearAttachmentPick","clearHost","clearLocked",
        "clearSharedHistory","clearWelcomeLayoutListener","close","cloudAppHostTrustRoute","cloudAppRouteAllowed","cloudBase64","cloudCallbackMatches","cloudDecision",
        "cloudIdentity","cloudJoseSignature","cloudKeyAlias","cloudPending","cloudValue","commandByRequest","commandDetail","compare",
        "complete","configure","configureWeb","connection","connectionErrorCode","consumeShared","control","conversationTime",
        "coordinate","createAccountModel","createAccountModelIntents","createConversation","createConversationHandoffs","createMessageImages","createMessageThumbnails","createProjectSession",
        "createSharedCommands","createSharedHistoryCache","credentials","current","currentAttachmentOwner","currentGeneration","currentHost","cursor",
        "dataUri","decideApproval","decode","decrypt","device","deviceKey","devices","digest",
        "directTool","discardOrphanFiles","discover","displayBytes","displayFile","displayFileForUpload","divider","doWork",
        "download","downloadImage","downloadOriginalAttachment","downloadSharedImage","dp","drawer","drawerShortcut","emit",
        "emitArtifactSave","emitAttachmentResult","emitForAccount","emitOriginalSave","empty","encode","encrypt","ensureCapacity",
        "ensureConversation","ensureCurrent","ensureMigrated","ensureOpen","errorCode","event","execute","failed",
        "failure","fallbackUi","fileForUpload","fileMime","files","find","finish","finishTurn",
        "forbidden","foreground","generate","get","getAcceptedIssuers","getEvents","handle","handleNotificationIntent",
        "handoffIntent","has","hasPendingConversationEvents","hasResult","hasSavedDraft","history","host","hostAuthenticationSource",
        "hostChoice","hostModelTransport","hostModels","hostOrigin","humanError","icon","iconButton","identityFromAuth",
        "imageForMessage","imageMime","imagePreviewUrl","imagePublished","imageUploadState","imageUrl","import","importModel",
        "importToPhone","inbox","install","integer","invoke","invokeSuspend","isChatCatalogModel","jobPreferences",
        "key","latestTurnFailure","latestTurnStatus","launchAttachmentCamera","launchableApps","legacyLibrary","legacyOwnerScope","library",
        "list","listConversations","listenForUpdates","load","loadPage","localImage","localTurn","login",
        "logout","makeThumbnail","manifest","mark","markAccepted","markImageUploaded","markPermissionAsked","markUsed",
        "materializeRemoteEvent","mayShow","maybeApplyStaged","me","mediaImage","mediaSharedImage","message","messageSyncEvent",
        "messageThumbnails","messages","migrateAcceptedEvents","mobileUiNativeLoginCompatible","mobileUiNeedsNativeLoginUpgrade","model","modelAttachment","modelCatalogUrl",
        "modelFile","modelProfiles","modelReadable","modelRouteFingerprint","modelStatus","modelTextType","modelUrl","modelView",
        "moduleProjection","moveDraft","mutateAccountModel","nativeInsets","navigateTo","nextClientSeq","note","notices",
        "now","officialXiaomiChatEndpoint","onActivityCreated","onActivityDestroyed","onActivityPaused","onActivityResult","onActivityResumed","onActivitySaveInstanceState",
        "onActivityStarted","onActivityStopped","onBackPressed","onChange","onClick","onConfigurationChanged","onCreate","onDestroy",
        "onDismissSucceeded","onGlobalLayout","onNewIntent","onPageFinished","onPause","onPermissionRequest","onPermissionRequestCanceled","onReceivedError",
        "onRenderProcessGone","onRequestPermissionsResult","onResume","onStartJob","onStopJob","onTextChanged","onUpgrade","onWindowFocusChanged",
        "open","openLocked","originalSaveCurrent","outbox","owner","ownerKey","ownerOf","ownerOverLimit",
        "parseLibrary","pending","pendingImages","persist","pickAttachment","planGroup","plus","poll",
        "pollNotifications","post","postCommand","postEvents","preferHighDisplayRefreshRate","prepare","profileFor","projects",
        "prune","pruneSharedHistory","publicBusiness","publicModel","publicOperation","publicReply","publicView","publishSaved",
        "publishedImages","questionAnswerPath","questionListPath","questions","queueAccountModelIntent","queueHandoffIntent","queueLocalTurnReservation","queueSharedCommand",
        "queueSync","quote","read","readAvatar","receiptCard","receiveCloudCallback","recentCommands","reconcile",
        "reconcileOutbox","reconcileTurns","record","recordAttempt","recordFailure","recordHandoffResponse","recordLocalTurnReservation","recordRow",
        "recoverInterruptedTurns","refreshConversations","refreshDrawerHistory","refreshes","register","registerPush","registerSyncCapabilities","rejectActive",
        "rejected","rememberProfile","remoteEventDetail","remoteEvents","remoteHistory","remoteSessions","remove","removeDraft",
        "removeModelProfile","renameDevice","renderDisplay","renderModelPicker","renderSettingsInfo","renderSettingsPage","renderWelcome","renew",
        "reportRenderedSystemBars","request","requestByteLimit","requestModelId","requireHost","requireLegacyCloudRequestWithoutToken","requireLegacyCloudTokensClear","reserveLocalTurn",
        "resolvedAppearanceDark","respond","response","restartUpdateSubscription","result","retireUploaded","retry","retryRejected",
        "revokeDevice","rollback","routeNewUserTurn","rows","run","runKey","safeCode","safeError",
        "safeName","safeOriginal","sameCredential","sampleFor","save","saveAppValue","saveCloudValue","saveHost",
        "saveLocked","saveMarker","saveModel","saveProfile","saveSharedConversationSnapshot","saveSharedHistoryPage","saveSharedSessions","savedAppearance",
        "savedIdentityView","schedule","scheduleSharedReconcile","scheduleStagedApply","scheduledGeneration","scope","scopedKey","selectModel",
        "selectPreferredRefreshRate","send","serialize","sessionLifecycle","sessions","setEnabled","setForeground","setModelName",
        "setSending","settingInput","settingsCard","settingsGroup","settle","settleArtifactSave","settleAttachmentPick","settleOriginalSave",
        "sha","sha256","shape","share","sharedAttachmentPending","sharedCommand","sharedCommands","sharedConversation",
        "sharedConversationSnapshot","sharedHistoryDigest","sharedImagePreviewUrl","sharedOriginalAttachment","sharedSession","sharedSessions","shouldInterceptRequest","shouldNotify",
        "shouldOverrideUrlLoading","show","showAccountEvents","showComputerSessions","showDeviceChoice","showDrawer","showModelPicker","showNativeCompatibility",
        "showPhoneActions","showSettings","showThings","showTranscript","sign","sourceDetail","stamp","start",
        "startArtifactSave","startOriginalSave","startTurn","startVoiceInput","state","status","stillCurrent","stop",
        "store","streamRequest","strictText","submit","supportsAttachmentImage","surface","sync","syncConflict",
        "syncMotionPreference","syncOnce","syncSafeInsets","systemAppearanceDark","systemBarStyle","tag","taskControl","taskDetail",
        "text","thumbnailBytes","thumbnailFile","timeline","title","tokens","tool","toolDefinitions",
        "toolReceipt","toolReceipts","topSheet","transferAccountModel","turnStatus","uiState","unboundConversationCount","updateAccountModelIntent",
        "updateDraftState","updateLocalTurn","updateProfile","updateSettingsSheetSize","updateSharedCommand","uploadDisplay","uploadImage","uploadSharedImage",
        "uploadedImages","upstreamHttpStatus","useScope","uuid","validBusinessPath","validImageScopeId","validIntent","values",
        "verify","verifyBytes","verifyHostModel","verifySignature","version","voice","weaveAvatar","weaveCircle",
        "welcomePrompt","write")
    private val codes = setOf("UNAVAILABLE", "SERVICE_UNAVAILABLE", "LOGIN_REQUIRED", "AUTH_REQUIRED", "UNAUTHORIZED", "FORBIDDEN",
        "CERTIFICATE_ERROR", "RELAY_UNAVAILABLE", "NETWORK_UNAVAILABLE", "TIMEOUT", "CANCELLED", "ACCOUNT_SWITCHED",
        "SYNC_UNAVAILABLE", "SYNC_CONFLICT", "SYNC_INTERRUPTED", "SYNC_EVENT_TOO_LARGE", "SYNC_RECEIPT_INVALID", "SYNC_CURSOR_INVALID", "NETWORK", "RELAY_HOST_OFFLINE", "RELAY_NETWORK_UNAVAILABLE", "APPROVAL_UNAVAILABLE", "APPROVAL_RECEIPT_INVALID",
        "UI_SIGNATURE_INVALID", "UI_UPDATE_REJECTED", "UI_UPDATE_INCOMPATIBLE", "UI_UPDATE_UNAVAILABLE", "UI_HASH_INVALID",
        "UI_LOAD_FAILED", "UI_BOOT_FAILED", "UI_RENDERER_GONE", "SCHEDULE_FAILED", "STORAGE_UNAVAILABLE")
    private val vocab = mapOf("reason" to reasons, "source" to setOf("native-uncaught", "web-error", "web-rejection", "native"),
        "phase" to setOf("cold", "resume", "foreground", "background", "manual", "background-job", "notification-worker", "notification-action", "bridge", "offline-copy", "download", "cached", "load", "recovery"),
        "state" to setOf("online", "offline", "login_required", "certificate_error", "relay_unavailable"),
        "importance" to setOf("foreground", "background", "unknown"), "action" to setOf("rebuild", "builtin", "previous", "approve", "reject"))
    fun fields(input: JSONObject): JSONObject = JSONObject().apply {
        for (key in listOf("previousRunId")) input.optString(key).takeIf { it.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")) }?.let { put(key, it) }
        input.optString("previousAt").takeIf { try { java.time.Instant.parse(it); true } catch (_: Exception) { false } }?.let { put("previousAt", it) }
        vocab.forEach { (key, words) -> input.optString(key).takeIf { it in words }?.let { put(key, it) } }
        if (input.has("code")) put("code", input.optString("code").takeIf { it in codes } ?: "UNAVAILABLE")
        if (input.has("name")) put("name", input.optString("name").takeIf { it in names } ?: "Error")
        input.optString("script").takeIf { it in scripts }?.let { put("script", it) }
        for (key in listOf("status", "line", "column", "priority", "reasonCode", "importanceCode", "recordIndex")) {
            val value = input.opt(key)
            if (value is Number && value.toLong() in (if (key == "status") -20 else -1)..Int.MAX_VALUE.toLong()) put(key, value.toLong())
        }
        for (key in listOf("normal", "didCrash", "exitTimeKnown")) if (input.opt(key) is Boolean) put(key, input.getBoolean(key))
        input.optJSONArray("stackFrames")?.let { frames ->
            val safe = org.json.JSONArray()
            for (index in 0 until minOf(frames.length(), 8)) {
                val frame = frames.optString(index)
                val match = Regex("^com\\.memoweft\\.weftmate\\.mobile\\.([A-Za-z]+)\\.([A-Za-z_$][A-Za-z0-9_$]{0,60}):(-?\\d{1,7})$").matchEntire(frame)
                if (match != null && match.groupValues[1] in classes && match.groupValues[2] in methods) safe.put(frame)
            }
            if (safe.length() > 0) put("stackFrames", safe)
        }
    }
    fun failure(error: Throwable) = fields(JSONObject().put("name", error.javaClass.name).put("source", "native-uncaught")
        .put("stackFrames", org.json.JSONArray(error.stackTrace.filter { it.className.startsWith("com.memoweft.weftmate.mobile.") }
            .take(8).map { "${it.className.substringBefore('$')}.${it.methodName.substringBefore('$')}:${it.lineNumber}" })))
    fun exit(reason: Int, importance: Int, wasForeground: Boolean): Pair<String, Boolean> {
        val mapped = when (reason) {
            1 -> "activity_finished"; 3 -> "low_memory"; 4 -> "crash"; 5 -> "native_crash"; 6 -> "anr"
            8 -> "permission_change"; 10 -> "user_requested"; 11 -> "user_stopped"; 16 -> "system_update"
            0 -> "unknown"; else -> "system_other"
        }
        val foreground = if (importance > 0) importance <= 200 else wasForeground
        if (!foreground && mapped !in setOf("crash", "native_crash", "anr", "user_requested", "user_stopped", "permission_change", "system_update"))
            return "terminated_in_background" to true
        return mapped to (mapped in setOf("activity_finished", "permission_change", "system_update"))
    }
    fun abnormal(event: String) = event.endsWith(".failure") || event.endsWith("_failure") || event == "app.previous_unclean_exit" || event == "webview.process_gone"
}
