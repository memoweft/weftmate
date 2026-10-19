package com.memoweft.weftmate.mobile

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeTrue
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPublicKey
import java.util.Base64
import java.util.UUID

class OfflineTaskVaultTest {
    private fun recipient():JSONObject {
        val pair=KeyPairGenerator.getInstance("RSA").apply{initialize(2048)}.generateKeyPair()
        val bytes=(pair.public as RSAPublicKey).modulus.toByteArray().let{if(it.size==257)it.copyOfRange(1,257) else it}
        return JSONObject().put("kty","RSA").put("n",Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)).put("e","AQAB")
    }
    private fun install(vault:OfflineVault,host:HostIdentity,account:String,key:JSONObject,generation:Int=1) {
        val identity=JSONObject().put("ownerId",host.ownerId).put("hostId",host.hostId).put("deviceId",host.deviceId)
        val snapshot=JSONObject().put("generation",generation).put("reset",true).put("remove",JSONArray()).put("items",JSONArray()).put("recent",JSONArray())
            .put("model",JSONObject.NULL).put("taskRecipient",key)
            .put("control",JSONObject().put("accountId",account).put("hostId",host.hostId).put("capabilities",JSONObject().put("offlineTasks",1)))
        vault.open(sealOfflineTask(snapshot,vault.key(),identity),identity)
    }
    @Test fun authenticatedRecipientsStayNativeAndAccountErasureKeepsUnrelatedAccounts(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue(context.packageName=="com.memoweft.weftmate.mobile.w9offlineqa")
        val suffix=UUID.randomUUID().toString()
        fun host(id:String)=HostIdentity("https://$id.invalid","synthetic","owner-$suffix-$id",id,"cookie-$id","synthetic","synthetic","cloud")
        val a=host("a");val b=host("b");val c=host("c");val account="account-$suffix"
        val va=OfflineVault(context,a);val vb=OfflineVault(context,b);val vc=OfflineVault(context,c)
        val key=recipient();val other=recipient()
        try{
            install(va,a,account,key);install(vb,b,account,other);install(vc,c,"other-$suffix",other)
            assertEquals(2,va.targets(account).length())
            val changed=va.load();changed.getJSONObject("snapshot").put("taskRecipient",other).getJSONObject("control").put("accountId","forged")
            va.save(changed)
            assertEquals(account,va.load().getJSONObject("snapshot").getJSONObject("control").getString("accountId"))
            assertEquals(key.toString(),va.load().getJSONObject("snapshot").getJSONObject("taskRecipient").toString())
            val identity=JSONObject().put("purpose","offline-task").put("accountId",account).put("hostId","a").put("deviceId","physical-phone").put("generation",1).put("id",UUID.randomUUID().toString())
            val payload=JSONObject().put("text","W9_PRIVATE_NATIVE_说明").put("createdAt",System.currentTimeMillis())
            assertFalse(va.seal(payload,key,identity).toString().contains(payload.getString("text")))
            assertThrows(IllegalArgumentException::class.java){va.seal(payload,other,identity)}
            assertThrows(IllegalArgumentException::class.java){va.targets("other-$suffix")}
            assertThrows(IllegalArgumentException::class.java){va.clearAccount("other-$suffix")}
            va.clearAccount(account,"b",1L);assertFalse(vb.load().isNull("snapshot"))
            va.clearAccount(account,"b",2L);assertTrue(vb.load().isNull("snapshot"));assertFalse(va.load().isNull("snapshot"))
            va.clearAccount(account);assertTrue(va.load().isNull("snapshot"));assertFalse(vc.load().isNull("snapshot"))
            for(file in context.noBackupFilesDir.listFiles().orEmpty().filter{it.name.startsWith("weftmate-offline-")})assertFalse(String(file.readBytes()).contains(payload.getString("text")))
        }finally{va.clear();vb.clear();vc.clear()}
    }
    @Test fun clearingComputerReplicasPreservesPhoneOriginals(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue(context.packageName=="com.memoweft.weftmate.mobile.w9offlineqa")
        val suffix=UUID.randomUUID().toString();val account="phone-$suffix"
        val remote=HostIdentity("https://computer.invalid","synthetic","remote-$suffix","host-$suffix","cookie","synthetic","synthetic","cloud")
        val phone=HostIdentity("https://cloud.invalid","synthetic",account,"unconnected","physical-phone","","","phone")
        val vault=OfflineVault(context,phone,remote);val key=recipient()
        try{
            vault.save(JSONObject().put("snapshot",JSONObject.NULL).put("conversations",JSONArray().put(JSONObject().put("id","original").put("sourceSessionId",JSONObject.NULL)).put(JSONObject().put("id","original-empty").put("sourceSessionId",""))).put("turns",JSONArray().put(JSONObject().put("id","pending").put("conversationId","original"))))
            install(vault,remote,account,key)
            vault.clearAccount(account)
            val after=vault.load();assertTrue(after.isNull("snapshot"));assertEquals(2,after.getJSONArray("conversations").length());assertEquals("original",after.getJSONArray("conversations").getJSONObject(0).getString("id"));assertEquals("pending",after.getJSONArray("turns").getJSONObject(0).getString("id"))
        }finally{vault.clear()}
    }
}
