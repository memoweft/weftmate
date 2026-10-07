package com.memoweft.weftmate.mobile
import org.junit.Assert.*
import org.junit.Test
class CloudCallbackUnitTest {
    @Test fun acceptsOnlyTheRegisteredCallbackAndOriginalSingleState() {
        assertTrue(cloudCallbackMatches("com.memoweft.weftmate:/oauth?code=synthetic&state=original", "original"))
        assertTrue(cloudCallbackMatches("com.memoweft.weftmate:/oauth?error=access_denied&state=original", "original"))
        for (bad in listOf("com.other:/oauth?code=x&state=original", "com.memoweft.weftmate://fake/oauth?code=x&state=original",
            "com.memoweft.weftmate:/other?code=x&state=original", "com.memoweft.weftmate:/oauth?code=x&state=wrong",
            "com.memoweft.weftmate:/oauth?code=x&state=original&state=original", "com.memoweft.weftmate:/oauth?state=original"))
            assertFalse(bad, cloudCallbackMatches(bad, "original"))
    }
}
