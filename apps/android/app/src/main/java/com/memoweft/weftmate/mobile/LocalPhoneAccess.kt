package com.memoweft.weftmate.mobile

/** Device-owned content never supplies authority for computer/account operations. */
internal fun requireLocalPhoneAccess(method: String, identity: HostIdentity?) {
    if (identity?.authSource != "phone-local") return
    if (listOf("host.", "shared.", "sync.", "offline.").any(method::startsWith) || method in setOf(
            "cloud.pending", "cloud.decision", "auth.profile", "auth.devices", "auth.renameDevice",
            "auth.revokeDevice", "auth.changePassword", "updates.check"))
        throw ApiFailure(401, "CLOUD_LOGIN_REQUIRED")
}
