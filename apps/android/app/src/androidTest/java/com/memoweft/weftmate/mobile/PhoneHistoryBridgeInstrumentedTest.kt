package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Uses the installed WebMessageListener and encrypted vault, not nativeRequest for writes. */
class PhoneHistoryBridgeInstrumentedTest {
    @Test fun longHistoryGetsASaveReceiptAndHardLimitKeepsThePreviousHistory() {
        val inst = InstrumentationRegistry.getInstrumentation()
        assertEquals("com.memoweft.weftmate.mobile.a2513qa", inst.targetContext.packageName)
        val activity = inst.startActivitySync(Intent(inst.targetContext, NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        fun read() = runBlocking(Dispatchers.Main) { activity.model.call("phone.offline.load") }
        fun bridge(expression: String): JSONObject {
            inst.runOnMainSync { activity.embeddedWeb.evaluateJavascript("window.historyBridgeResult=null;Promise.resolve($expression).then(value=>window.historyBridgeResult=value).catch(e=>window.historyBridgeResult={unexpected:e.code||e.message});", null) }
            val deadline = System.currentTimeMillis() + 15000
            while (System.currentTimeMillis() < deadline) {
                var result: String? = null
                inst.runOnMainSync { activity.embeddedWeb.evaluateJavascript("JSON.stringify(window.historyBridgeResult)") { result = it } }
                val callbackDeadline = System.currentTimeMillis() + 2000
                while (result == null && System.currentTimeMillis() < callbackDeadline) Thread.sleep(10)
                val value = runCatching { JSONObject(org.json.JSONArray("[$result]").getString(0)) }.getOrNull()
                if (value != null) return value
                Thread.sleep(25)
            }
            throw AssertionError("The webpage bridge did not return a receipt")
        }
        var original: JSONObject? = null
        try {
            val deadline = System.currentTimeMillis() + 30000
            var ready = false
            while (!ready && System.currentTimeMillis() < deadline) {
                inst.runOnMainSync { ready = activity.model.loggedIn && !activity.model.loading }
                if (!ready) Thread.sleep(50)
            }
            assertTrue("Normal local account bootstrap is ready", ready)
            original = read()
            val saved = bridge("""(async()=>{
                const turns=Array.from({length:600},(_,i)=>({id:'bridge-turn-'+i,conversationId:'bridge-history',timestamp:Date.now()+i,
                  messages:[{role:'user',text:'USER-'+i+'：'+'合成历史'.repeat(30)},{role:'assistant',text:'ANSWER-'+i+'：'+'合成回复'.repeat(30)}]}));
                const value={snapshot:null,turns,conversations:[{id:'bridge-history',turns}]};
                const chars=JSON.stringify({id:'r1',method:'phone.offline.save',params:{value}}).length;
                const receipt=await androidBridge.call('phone.offline.save',{value},10000);return{...receipt,chars};})()""")
            assertTrue(saved.toString(), saved.optBoolean("saved"))
            assertTrue(saved.getInt("chars") > 128 * 1024)
            val before = read()
            assertEquals(600, before.getJSONArray("turns").length())
            val oversized = bridge("""(async()=>{try{
                await androidBridge.call('phone.offline.save',{value:{padding:'x'.repeat(8*1024*1024)}},10000);return{saved:true};
                }catch(e){return{code:e.code||e.message,status:e.status,copy:WeftOffline.phoneHistoryFailure(e)};}})()""")
            assertEquals("OFFLINE_STORAGE_TOO_LARGE", oversized.getString("code"))
            assertEquals(413, oversized.getInt("status"))
            assertTrue(oversized.getString("copy").contains("更多"))
            assertTrue(oversized.getString("copy").contains("删除对话"))
            assertEquals(before.toString(), read().toString())
        } finally {
            original?.let { value -> runBlocking(Dispatchers.Main) { activity.model.call("phone.offline.save", JSONObject().put("value",value)) } }
            inst.runOnMainSync { activity.finishAndRemoveTask() }
        }
    }
}
