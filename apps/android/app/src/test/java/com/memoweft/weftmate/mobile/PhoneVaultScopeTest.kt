package com.memoweft.weftmate.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneVaultScopeTest {
    @Test fun sameAccountWriteIsAccepted() {
        assertTrue(phoneVaultWriteMatchesAccount("account-a", "https://synthetic.example", "account-a", "https://synthetic.example"))
    }
    @Test fun accountSwitchRejectsTheOldWrite() {
        assertFalse(phoneVaultWriteMatchesAccount("account-a", "https://synthetic.example", "account-b", "https://synthetic.example"))
    }
    @Test fun differentOriginRejectsTheOldWrite() {
        assertFalse(phoneVaultWriteMatchesAccount("account-a", "https://old.example", "account-a", "https://new.example"))
    }
    @Test fun partialOrEmptyScopeCannotAuthorizeAWrite() {
        assertFalse(phoneVaultWriteMatchesAccount("account-a", null, "account-a", "https://synthetic.example"))
        assertFalse(phoneVaultWriteMatchesAccount(null, "https://synthetic.example", "account-a", "https://synthetic.example"))
        assertFalse(phoneVaultWriteMatchesAccount("", "", "account-a", "https://synthetic.example"))
    }
    @Test fun releasedUnscopedUiKeepsItsExistingPath() {
        assertTrue(phoneVaultWriteMatchesAccount(null, null, "account-a", "https://synthetic.example"))
    }
}
