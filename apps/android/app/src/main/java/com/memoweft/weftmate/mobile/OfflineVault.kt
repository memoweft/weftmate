package com.memoweft.weftmate.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import java.security.KeyPairGenerator
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.interfaces.RSAPublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Replica and outbox never enter LocalStore, WebView storage, logs or Android backups. */
internal class OfflineVault(context: Context, private val host: HostIdentity) {
    companion object { private val locks = ConcurrentHashMap<String, Any>() }
    private val scope = MessageDigest.getInstance("SHA-256").digest("${host.origin}:${host.ownerId}".toByteArray()).joinToString("") { "%02x".format(it) }
    private val prefix = "weftmate-offline-$scope"
    private val file = File(context.noBackupFilesDir, "$prefix.bin")
    private fun <T> locked(action: () -> T): T = synchronized(locks.getOrPut(scope) { Any() }, action)
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun decode(text: String) = Base64.decode(text, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun empty() = JSONObject().put("snapshot", JSONObject.NULL).put("turns", JSONArray()).put("conversations", JSONArray())

    fun key(): JSONObject = locked { deviceKey() }
    private fun deviceKey(): JSONObject {
        val value = read()
        val saved = value.optJSONObject("_deviceKey")
        if (saved != null) return saved.getJSONObject("publicJwk")
        // A non-exportable Keystore AES key protects the RSA private key on every
        // supported Android version; OAEP SHA-256/MGF1 SHA-256 stays interoperable.
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val public = pair.public as RSAPublicKey
        val bytes = public.modulus.toByteArray().let { if (it.size == 257) it.copyOfRange(1, 257) else it }
        val jwk = JSONObject().put("kty", "RSA").put("n", encode(bytes)).put("e", "AQAB")
        value.put("_deviceKey", JSONObject().put("privateKey", encode(pair.private.encoded)).put("publicJwk", jwk))
        write(value); return jwk
    }
    private fun read(): JSONObject {
        if (!file.exists()) return empty()
        val envelope = JSONObject(file.readText())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, store().getKey(envelope.getString("alias"), null), GCMParameterSpec(128, decode(envelope.getString("iv"))))
        cipher.updateAAD(scope.toByteArray())
        return JSONObject(String(cipher.doFinal(decode(envelope.getString("ciphertext"))), Charsets.UTF_8))
    }
    private fun publicView(value: JSONObject): JSONObject = JSONObject(value.toString()).apply {
        remove("_deviceKey")
        optJSONObject("snapshot")?.optJSONObject("model")?.remove("apiKey")
    }
    fun load() = locked { publicView(read()) }
    private fun write(value: JSONObject) {
        val alias = "$prefix-data-${UUID.randomUUID()}"
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, generator.generateKey()); cipher.updateAAD(scope.toByteArray())
        val envelope = JSONObject().put("alias", alias).put("iv", encode(cipher.iv))
            .put("ciphertext", encode(cipher.doFinal(value.toString().toByteArray())))
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.outputStream().use { stream -> stream.write(envelope.toString().toByteArray()); stream.fd.sync() }
        check(temporary.renameTo(file))
        val keys = store()
        for (old in keys.aliases().toList()) if (old.startsWith("$prefix-data-") && old != alias) keys.deleteEntry(old)
    }
    fun save(value: JSONObject): JSONObject = locked { saveLocked(value) }
    private fun saveLocked(value: JSONObject): JSONObject {
        require(value.toString().toByteArray().size <= 8 * 1024 * 1024)
        val snapshot = value.optJSONObject("snapshot")
        val previous = read()
        previous.optJSONObject("_deviceKey")?.let { value.put("_deviceKey", it) }
        val prior = previous.optJSONObject("snapshot")
        if (snapshot != null && prior != null) {
            require(snapshot.getLong("generation") == prior.getLong("generation"))
            // Credential selection only comes from the authenticated host envelope.
            snapshot.put("model", prior.getJSONObject("model"))
        }
        write(value); return JSONObject().put("saved", true)
    }
    fun open(envelope: JSONObject, identity: JSONObject): JSONObject = locked { openLocked(envelope, identity) }
    private fun openLocked(envelope: JSONObject, identity: JSONObject): JSONObject {
        key()
        val aad = decode(envelope.getString("aad"))
        val header = JSONObject(String(aad))
        for ((name, expected) in listOf("ownerId" to host.ownerId, "hostId" to host.hostId, "deviceId" to host.deviceId))
            require(header.getString(name) == expected && identity.getString(name) == expected)
        require(header.getInt("version") == 1)
        val unwrap = Cipher.getInstance("RSA/ECB/OAEPPadding")
        val privateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(decode(read().getJSONObject("_deviceKey").getString("privateKey"))))
        unwrap.init(Cipher.DECRYPT_MODE, privateKey,
            OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
        val rawKey = unwrap.doFinal(decode(envelope.getString("wrappedKey")))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(rawKey, "AES"), GCMParameterSpec(128, decode(envelope.getString("iv"))))
        cipher.updateAAD(aad)
        val payload = JSONObject(String(cipher.doFinal(decode(envelope.getString("ciphertext"))), Charsets.UTF_8)); rawKey.fill(0)
        val previous = read()
        val value = if (payload.optBoolean("reset")) empty() else previous
        previous.optJSONObject("_deviceKey")?.let { value.put("_deviceKey", it) }
        // JS applies the item delta; preserve the secret in native encrypted storage only.
        val persisted = JSONObject(payload.toString())
        val items = linkedMapOf<String, JSONObject>()
        if (!payload.optBoolean("reset")) previous.optJSONObject("snapshot")?.optJSONArray("items")?.let { rows ->
            for (i in 0 until rows.length()) rows.getJSONObject(i).let { items[it.getString("id")] = it }
        }
        payload.getJSONArray("remove").let { rows -> for (i in 0 until rows.length()) items.remove(rows.getString(i)) }
        payload.getJSONArray("items").let { rows -> for (i in 0 until rows.length()) rows.getJSONObject(i).let { items[it.getString("id")] = it } }
        persisted.put("items", JSONArray(items.values.toList()))
        value.put("snapshot", persisted); write(value)
        return publicView(JSONObject().put("snapshot", payload)).getJSONObject("snapshot")
    }
    fun complete(body: JSONObject): JSONObject {
        val model = locked { read().getJSONObject("snapshot").getJSONObject("model") }
        require(body.getString("model") == model.getString("modelId") && !body.has("tools") && !body.has("tool_choice"))
        val endpoint = Endpoints.modelUrl(model.getString("baseUrl").trimEnd('/') + "/chat/completions")
        return JsonHttp().request(endpoint, "POST", body,
            mapOf("Authorization" to "Bearer ${model.getString("apiKey")}"), readTimeoutMs = 180_000).body
    }
    fun clear(): JSONObject = locked { clearLocked() }
    private fun clearLocked(): JSONObject {
        val keys = store()
        for (alias in keys.aliases().toList()) if (alias.startsWith(prefix)) keys.deleteEntry(alias)
        check(!file.exists() || file.delete())
        File(file.parentFile, file.name + ".tmp").delete()
        return JSONObject().put("cleared", true)
    }
}
