package com.memoweft.weftmate.mobile

import org.junit.Assert.*
import org.junit.Test

class ConnectionErrorUnitTest {
    @Test fun transportFailuresUseLocalNetworkEvidence() {
        assertEquals("NETWORK", connectionErrorCode(java.net.ConnectException(), true))
        assertEquals("TIMEOUT", connectionErrorCode(java.net.SocketTimeoutException(), true))
        assertEquals("NETWORK_UNAVAILABLE", connectionErrorCode(java.net.UnknownHostException(), false))
        assertEquals("NETWORK_UNAVAILABLE", connectionErrorCode(java.net.SocketException(), false))
    }
    @Test fun modelAuthorizationAndTrustErrorsDoNotBecomeComputerOffline() {
        assertNull(connectionErrorCode(ApiFailure(401, "UNAUTHORIZED"), true))
        assertNull(connectionErrorCode(ApiFailure(503, "MODEL_UNAVAILABLE"), true))
        assertNull(connectionErrorCode(javax.net.ssl.SSLHandshakeException("synthetic pin rejection"), true))
    }
}
