package com.memoweft.weftmate.mobile

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.ServerSocket
import java.net.URLDecoder
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/** Synthetic process-only credentials, independent preferences and key aliases. Never uses the daily account. */
class CloudAppSecurityInstrumentedTest {
    @Test fun privateKeyNeverExportsAndRotatingRefreshNeverCrossesBridge() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("lg1bNativeSecurity") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.lg1bqa")
        val suffix = UUID.randomUUID().toString()
        val storageName = "lg1b-native-security-$suffix"
        val storageAlias = "lg1b-native-storage-$suffix"
        val keyId = "lg1b-native-signing:$suffix"
        val secrets = SecureSettings(context, storageName, storageAlias)
        val keys = CloudAppKeys(secrets)
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val refreshOne = UUID.randomUUID().toString(); val refreshTwo = UUID.randomUUID().toString()
        val receivedRefresh = AtomicReference<String>()
        val serverError = AtomicReference<Throwable>()
        val server = ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${server.localPort}"
        val thread = Thread {
            try {
                repeat(2) { stage ->
                    server.accept().use { socket ->
                        socket.soTimeout = 10000
                        val input = socket.getInputStream()
                        fun line(): String {
                            val output = java.io.ByteArrayOutputStream()
                            while (true) { val byte = input.read(); check(byte >= 0); if (byte == 10) break; if (byte != 13) output.write(byte) }
                            return output.toString("UTF-8")
                        }
                        check(line().startsWith("POST /personal/v1/cloud/oidc/token "))
                        var size = 0
                        while (true) { val header = line(); if (header.isEmpty()) break
                            if (header.startsWith("Content-Length:", true)) size = header.substringAfter(':').trim().toInt() }
                        val bytes = ByteArray(size); var count = 0
                        while (count < size) { val next = input.read(bytes, count, size - count); check(next > 0); count += next }
                        if (stage == 1) {
                            val form = String(bytes, Charsets.UTF_8).split('&').associate { it.split('=', limit = 2).let { pair ->
                                URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair[1], "UTF-8") } }
                            receivedRefresh.set(form["refresh_token"])
                        }
                        val response = JSONObject().put("access_token", "synthetic-access").put("token_type", "DPoP")
                            .put("refresh_token", if (stage == 0) refreshOne else refreshTwo).put("expires_in", 300).toString().toByteArray()
                        socket.getOutputStream().apply {
                            write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${response.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            write(response); flush()
                        }
                    }
                }
            } catch (error: Throwable) { serverError.set(error) }
        }.apply { start() }
        try {
            val public = keys.get(keyId)
            assertEquals(public.getString("deviceId"), keys.get(keyId).getString("deviceId"))
            assertFalse(public.has("privateKey"))
            assertFalse(public.getJSONObject("publicJwk").has("d"))
            assertNull(keyStore.getKey(cloudKeyAlias(keyId), null).encoded)
            assertEquals(86, keys.sign(keyId, "synthetic.header").getString("signature").length)
            val issuer = "$origin/personal/v1/cloud/oidc"
            secrets.saveAppValue("login", JSONObject().put("host", origin).put("issuer", issuer)
                .put("config", JSONObject().put("issuer", issuer).put("clientId", "weftmate-android").put("hostId", "synthetic-host")).toString())
            val native = CloudAppLogin(secrets, PersonalApi())
            fun token(form: String) = native.request(JSONObject().put("url", "$issuer/token").put("method", "POST")
                .put("headers", JSONObject().put("content-type", "application/x-www-form-urlencoded")).put("body", form)).getJSONObject("body")
            val first = token("grant_type=authorization_code&client_id=weftmate-android&code=synthetic")
            val handle = first.getString("refresh_token")
            assertTrue(handle.startsWith("wm-refresh:")); assertNotEquals(refreshOne, handle)
            assertFalse(first.toString().contains(refreshOne))
            val credentialKey = "app-tokens:$issuer:weftmate-android"
            native.credentials(JSONObject().put("key", credentialKey).put("value", JSONObject().put("refreshToken", handle).put("sub", "synthetic")))
            assertNull(secrets.cloudValue("tokens"))
            val second = token("grant_type=refresh_token&client_id=weftmate-android&refresh_token=$handle")
            val nextHandle = second.getString("refresh_token")
            assertNotEquals(handle, nextHandle); assertNotEquals(refreshTwo, nextHandle)
            assertEquals(refreshOne, receivedRefresh.get())
            assertFalse(native.credentials(JSONObject().put("key", credentialKey)).toString().contains(refreshOne))
            native.credentials(JSONObject().put("key", credentialKey).put("value", JSONObject().put("refreshToken", nextHandle).put("sub", "synthetic")))
            assertEquals(1, native.status().getInt("refreshCount"))
            native.credentials(JSONObject().put("key", credentialKey).put("remove", true))
            assertFalse(native.status().getBoolean("credentialPresent")); assertEquals(0, native.status().getInt("refreshCount"))
            assertTrue(keys.get(keyId, true).getBoolean("cleared"))
            assertFalse(keyStore.containsAlias(cloudKeyAlias(keyId)))
        } finally {
            server.close(); thread.join(10000)
            keys.get(keyId, true)
            if (keyStore.containsAlias(storageAlias)) keyStore.deleteEntry(storageAlias)
            context.deleteSharedPreferences(storageName)
        }
        serverError.get()?.let { throw AssertionError("Isolated native token server failed", it) }
    }
}
