package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject
import org.json.JSONArray
import java.net.URLEncoder
import java.time.Instant

internal class NativeLibraryModel(private val chat:NativeChatModel, private val activity:NativeActivity) {
    var rows by mutableStateOf(emptyList<JSONObject>())
    var projects by mutableStateOf(emptyList<JSONObject>())
    var search by mutableStateOf("")
    var type by mutableStateOf("")
    var project by mutableStateOf("")
    var days by mutableStateOf(0)
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var noComputer by mutableStateOf(false)
    var next by mutableStateOf("")
    var total by mutableIntStateOf(0)
    private var generation=0
    private val owner=chat.owner
    private val prefs=activity.getSharedPreferences("native-library-cache",0)
    private var after=""
    private var flight:Job?=null
    init { rows=runCatching { JSONArray(prefs.getString(owner,"[]")).objects() }.getOrDefault(emptyList()) }
    fun refresh(more:Boolean=false) {
        flight?.cancel(); val g=++generation
        if(!more) after=if(days==0)"" else Instant.now().minusSeconds(days*86400L).toString()
        flight=chat.scope.launch {
            loading=true;error=""
            try {
                // New phone-only identities report no attached computer. Do not turn that into a failure.
                val b=chat.call("app.bootstrap")
                if(libraryHasNoComputer(b)) {
                    if(g==generation && owner==chat.owner){noComputer=true;rows=emptyList();next=""}
                    return@launch
                }
                val query=linkedMapOf("limit" to "50")
                if(search.isNotBlank())query["search"]=search
                if(type.isNotBlank())query["type"]=type
                if(project.isNotBlank())query["projectId"]=project
                if(after.isNotBlank())query["after"]=after
                if(more && next.isNotBlank())query["cursor"]=next
                val page=chat.business("/library?"+query.entries.joinToString("&"){it.key+"="+URLEncoder.encode(it.value,"UTF-8")})
                if(g!=generation || owner!=chat.owner)return@launch
                rows=mergeLibraryRows(if(more)rows else emptyList(),page.optJSONArray("items")?.objects().orEmpty())
                projects=page.optJSONArray("projects")?.objects().orEmpty()
                total=page.optInt("total",rows.size)
                next=page.optString("nextCursor").takeUnless{it=="null"}.orEmpty();noComputer=false
                if(search.isBlank() && type.isBlank() && project.isBlank() && days==0)prefs.edit().putString(owner,JSONArray(rows).toString()).apply()
            }catch(e:CancellationException){throw e}catch(e:Exception){
                if(g==generation && owner==chat.owner) {
                    error=if(e is ApiFailure && e.status==409)"成果已更新，请重试。" else nativeFileFailure(e)
                }
            }finally{if(g==generation)loading=false}
        }
    }
    fun close(){generation++;flight?.cancel()}
    suspend fun source(row:JSONObject) {
        val id=row.optString("libraryId",row.optString("id",row.optString("artifactId")))
        val detail=chat.business("/library/$id").getJSONObject("item").getJSONObject("source")
        if(owner!=chat.owner)return
        chat.locateFile(detail)
    }
}
