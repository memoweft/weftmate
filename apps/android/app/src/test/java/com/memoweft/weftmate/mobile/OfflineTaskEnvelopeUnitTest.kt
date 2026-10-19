package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.interfaces.RSAPublicKey
import java.security.spec.MGF1ParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

class OfflineTaskEnvelopeUnitTest {
    private val encoder=Base64.getUrlEncoder().withoutPadding()
    private val decoder=Base64.getUrlDecoder()
    private fun pair()=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair()
    private fun public(pair:KeyPair):JSONObject {
        val modulus=(pair.public as RSAPublicKey).modulus.toByteArray().let{if(it.size==257)it.copyOfRange(1,257) else it}
        return JSONObject().put("kty","RSA").put("n",encoder.encodeToString(modulus)).put("e","AQAB")
    }
    private fun identity()=JSONObject().put("purpose","offline-task").put("accountId","synthetic-account").put("hostId","synthetic-host")
        .put("deviceId","synthetic-phone").put("generation",2).put("id","synthetic-task")
    private fun open(envelope:JSONObject,pair:KeyPair,expected:JSONObject):JSONObject {
        val aad=decoder.decode(envelope.getString("aad"));val header=JSONObject(String(aad,Charsets.UTF_8))
        for(key in expected.keys())require(header.get(key)==expected.get(key))
        val jwk=public(pair);val canonical="{\"kty\":\"RSA\",\"n\":\"${jwk.getString("n")}\",\"e\":\"AQAB\"}"
        val hash=MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray()).joinToString(""){"%02x".format(it)}
        require(header.getString("keyId")==hash)
        val rsa=Cipher.getInstance("RSA/ECB/OAEPPadding")
        rsa.init(Cipher.DECRYPT_MODE,pair.private,OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT))
        val raw=rsa.doFinal(decoder.decode(envelope.getString("wrappedKey")))
        try{
            val aes=Cipher.getInstance("AES/GCM/NoPadding")
            aes.init(Cipher.DECRYPT_MODE,SecretKeySpec(raw,"AES"),GCMParameterSpec(128,decoder.decode(envelope.getString("iv"))));aes.updateAAD(aad)
            return JSONObject(String(aes.doFinal(decoder.decode(envelope.getString("ciphertext"))),Charsets.UTF_8))
        }finally{raw.fill(0)}
    }
    @Test fun nativeEnvelopeUsesExistingFormatAndDoesNotExposeTaskText(){
        val pair=pair();val text="读取合成说明 W9_PRIVATE_TASK"
        val envelope=sealOfflineTask(JSONObject().put("text",text),public(pair),identity())
        assertEquals("RSA-OAEP-256+A256GCM",envelope.getString("algorithm"));assertEquals(1,envelope.getInt("version"))
        assertFalse(envelope.toString().contains(text));assertEquals(12,decoder.decode(envelope.getString("iv")).size)
        assertEquals(text,open(envelope,pair,identity()).getString("text"))
        val another=sealOfflineTask(JSONObject().put("text",text),public(pair),identity())
        assertNotEquals(envelope.getString("iv"),another.getString("iv"));assertNotEquals(envelope.getString("ciphertext"),another.getString("ciphertext"))
    }
    @Test fun alteredHostAccountDeviceGenerationOrCiphertextCannotOpen(){
        val pair=pair();val envelope=sealOfflineTask(JSONObject().put("text","synthetic"),public(pair),identity())
        for(key in listOf("hostId","accountId","deviceId","generation")){
            val other=JSONObject(identity().toString()).put(key,if(key=="generation")3 else "other")
            assertThrows(IllegalArgumentException::class.java){open(envelope,pair,other)}
        }
        val bytes=decoder.decode(envelope.getString("ciphertext"));bytes[0]=(bytes[0].toInt() xor 1).toByte()
        val altered=JSONObject(envelope.toString()).put("ciphertext",encoder.encodeToString(bytes))
        assertThrows(Exception::class.java){open(altered,pair,identity())}
    }
}
