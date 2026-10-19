package com.memoweft.weftmate.mobile

/** New UI writes bind to the attaching account; released UI without scope keeps its existing path. */
internal fun phoneVaultWriteMatchesAccount(expectedAccountId: String?, expectedOrigin: String?, accountId: String, origin: String): Boolean =
    if (expectedAccountId == null && expectedOrigin == null) true
    else !expectedAccountId.isNullOrBlank() && !expectedOrigin.isNullOrBlank() && expectedAccountId == accountId && expectedOrigin == origin
