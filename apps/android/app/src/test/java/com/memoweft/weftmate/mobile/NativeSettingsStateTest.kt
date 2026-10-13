package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeSettingsStateTest {
    @Test fun catalogDistinguishesWrongKeyAndNoDirectory() {
        assertTrue(serviceCatalogMessage("authentication_failed").contains("密钥"))
        assertTrue(serviceCatalogMessage("unsupported").contains("不提供"))
        assertTrue(serviceCatalogMessage("unsupported").contains("手填"))
        assertNotEquals(serviceCatalogMessage("unsupported"),serviceCatalogMessage("authentication_failed"))
    }
    @Test fun oldProfileAliasesKeepTheCurrentCheck() {
        val row=JSONObject().put("profileId","new-id").put("profileIds",JSONArray(listOf("old-a","old-b")))
        assertTrue(serviceModelMatches(row,"old-b"));assertTrue(serviceModelMatches(row,"new-id"));assertFalse(serviceModelMatches(row,"service-id"))
    }
    @Test fun longDirectoryKeepsCurrentAndMostRecentVisible() {
        val rows=(0..30).map{JSONObject().put("modelId","m-$it").put("name","型号 $it").put("profileId","p-$it").put("lastUsedAt",if(it==10)"2026-10-13T18:00:00Z" else "")}
        val service=JSONObject().put("models",JSONArray(rows))
        val visible=serviceVisibleModels(service,false,current="p-30")
        assertEquals(8,visible.size);assertEquals("m-30",visible[0].getString("modelId"));assertTrue(visible.any{it.getString("modelId")=="m-10"})
        assertEquals(31,serviceVisibleModels(service,true).size)
    }
    @Test fun hiddenModelsStayHiddenAndSearchMatchesNameOrId() {
        val service=JSONObject().put("models",JSONArray().put(JSONObject().put("modelId","flash-v2").put("name","快速模型")).put(JSONObject().put("modelId","private").put("enabled",false)))
        assertEquals(1,serviceVisibleModels(service,true,"FLASH").size);assertEquals(1,serviceVisibleModels(service,true,"快速").size);assertTrue(serviceVisibleModels(service,true,"private").isEmpty())
    }
    @Test fun singleModelRemainsASelectableItem() {
        val service=JSONObject().put("models",JSONArray().put(JSONObject().put("modelId","only")))
        assertEquals("only",serviceVisibleModels(service,false).single().getString("modelId"))
    }
    @Test fun unknownProfileDoesNotBecomeSelected() {assertFalse(serviceModelMatches(JSONObject().put("modelId","new"),""))}
    @Test fun existingConversationImagesIncludeOriginalAttachments() {
        val event=JSONObject().put("data",JSONObject().put("originalAttachments",JSONArray().put(JSONObject().put("contentType","image/jpeg"))))
        assertTrue(serviceRequiresVision(emptyList(),listOf(event)))
        assertFalse(serviceRequiresVision(emptyList(),listOf(JSONObject().put("data",JSONObject().put("text","图片")))))
        assertTrue(serviceRequiresVision(listOf(JSONObject().put("kind","image")),emptyList()))
    }
}
