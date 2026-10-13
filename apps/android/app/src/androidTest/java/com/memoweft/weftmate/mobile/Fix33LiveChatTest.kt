package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import java.io.File

/** Uses only the already logged-in authorized test account and harmless greetings. */
class Fix33LiveChatTest {
 @Test fun fourGreetingsOnTheConnectedComputer() {
  val i=InstrumentationRegistry.getInstrumentation()
  org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("fix33LiveAccount")=="authorized")
  check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.debug")
  val a=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
  val trace=JSONArray();val traceLock=Any()
  val observed=PersonalApi(object:JsonTransport {
   override fun request(url:String,method:String,body:JSONObject?,headers:Map<String,String>,active:java.util.concurrent.atomic.AtomicReference<java.net.HttpURLConnection?>?,readTimeoutMs:Int):HttpReply {
    val u=java.net.URL(url);val entry=JSONObject().put("method",method).put("path",u.path.replace(Regex("[A-Za-z]+-[0-9a-fA-F-]{36}"),"<id>")).put("queryFields",JSONArray(u.query.orEmpty().split('&').filter{it.isNotEmpty()}.map{it.substringBefore('=')})).put("requestFields",JSONArray(body?.keys()?.asSequence()?.toList().orEmpty()));val start=System.currentTimeMillis()
    synchronized(traceLock){trace.put(entry)}
    try{return JsonHttp().request(url,method,body,headers,active,readTimeoutMs).also{entry.put("status",it.status).put("responseFields",JSONArray(it.body.keys().asSequence().toList()))}}
    catch(e:Exception){entry.put("failure",if(e is ApiFailure)e.safeCode else e.javaClass.simpleName);throw e}
    finally{synchronized(traceLock){entry.put("ms",System.currentTimeMillis()-start);File(a.filesDir,"fix33-live-trace.json").writeText(trace.toString(2))}}
   }
  })
  HybridActivity::class.java.getDeclaredField("api").apply{isAccessible=true}.set(a,observed)
  val shared=HybridActivity::class.java.getDeclaredField("sharedChat").apply{isAccessible=true}.get(a)
  SharedChat::class.java.getDeclaredField("api").apply{isAccessible=true}.set(shared,observed)
  fun main(action:()->Unit)=i.runOnMainSync(action)
  fun await(label:String,read:()->Boolean){val end=System.currentTimeMillis()+60000;while(System.currentTimeMillis()<end){var ok=false;main{ok=read()};if(ok)return;Thread.sleep(100)};error("Timed out: $label")}
  val report=JSONObject().put("loggedInAccountReused",true).put("greetings",JSONArray())
  try {
   val boot=System.currentTimeMillis();await("computer bootstrap"){a.model.loggedIn && !a.model.loading && a.model.modelId.isNotBlank()}
   report.put("bootstrapMs",System.currentTimeMillis()-boot)
   val old=a.model.chatId;val created=System.currentTimeMillis();main{a.model.newChat()}
   await("new conversation on computer"){a.model.chatId!=old && !a.model.phone && !a.model.standalone && a.model.sessionId.isNotBlank()}
   report.put("newChatRunsOnComputer",true).put("newChatMs",System.currentTimeMillis()-created).put("model",if(a.model.modelLabel.contains("MiMo",ignoreCase=true))"MiMo" else "existing computer model")
   val starts=mutableListOf<Long>()
   for(n in 1..4){val users=a.model.rows.count{it.optString("type")=="user.message"};val start=System.currentTimeMillis();starts.add(start)
    main{a.model.edit("Hello");a.model.send()}
    await("submission $n"){!a.model.submitting && a.model.draft.isEmpty()}
    if(n==1){await("first user message"){a.model.rows.count{it.optString("type")=="user.message"}>users};report.put("firstUserVisibleMs",System.currentTimeMillis()-start)
     await("computer reply 1"){a.model.rows.count{it.optString("type")=="assistant.message"}>=1}
     report.getJSONArray("greetings").put(JSONObject().put("index",1).put("replyVisibleMs",System.currentTimeMillis()-start))
    }
   }
   for(n in 2..4){await("computer queued reply $n"){a.model.rows.count{it.optString("type")=="assistant.message"}>=n};report.getJSONArray("greetings").put(JSONObject().put("index",n).put("replyVisibleMs",System.currentTimeMillis()-starts[n-1]))}
   report.put("firstThenThreeQueued",true)
  }catch(e:Exception){report.put("failure",e.message?.takeIf{it.startsWith("Timed out:") }?:"NATIVE_FLOW_FAILED");throw e}
  finally {
   main { report.put("error",a.model.error).put("submitting",a.model.submitting).put("running",a.model.running).put("sendAvailable",a.model.sendAvailable).put("draftRetained",a.model.draft=="Hello").put("tab",a.model.tab).put("foreground",a.nativeForeground).put("refreshPhase",a.model.refreshPhase).put("computerChatCount",a.model.chats.count{it.has("chatId") && !it.optBoolean("phoneHistory")})
    .put("rowTypes",JSONArray(a.model.rows.map{it.optString("type")}.distinct())).put("delivery",JSONArray(a.model.uncertain.map{JSONObject().put("state",it.optString("state")).put("commandState",it.optJSONObject("command")?.optString("state")).put("errorCode",it.optJSONObject("command")?.optString("errorCode"))})) }
   for(name in listOf("refreshing","generation","poll")){val field=NativeChatModel::class.java.getDeclaredField(name).apply{isAccessible=true};val value=field.get(a.model);report.put(name,if(value is kotlinx.coroutines.Job)value.isActive else value)}
   report.put("workerStacks",JSONArray(Thread.getAllStackTraces().entries.filter{it.key.name.startsWith("pool-")}.map{JSONObject().put("name",it.key.name).put("state",it.key.state.name).put("stack",JSONArray(it.value.map{frame->frame.toString()}))}))
   File(a.filesDir,"fix33-live-chat.json").writeText(report.toString(2))
  }
 }
}
