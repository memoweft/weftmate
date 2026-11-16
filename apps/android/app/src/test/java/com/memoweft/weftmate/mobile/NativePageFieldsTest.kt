package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

// Protects existing form values when only one field is edited in a native form.
class NativePageFieldsTest {
    @Test fun unchangedInputsAreSubmittedAndInvisibleDraftsAreExcluded() {
        val page=JSONObject("""{"sections":[{"rows":[{"type":"input","key":"origin","value":"https://example.test"},{"type":"input","key":"deviceName","value":"这台手机"},{"type":"choice","key":"model","value":"model-a","options":[]},{"type":"toggle","key":"sound","value":true,"action":"set"}]}]}""")
        val result=nativePageFields(page,mapOf("deviceName" to "测试手机","hiddenSecret" to "never-submit"))
        assertEquals("https://example.test",result.getString("origin"))
        assertEquals("测试手机",result.getString("deviceName"))
        assertEquals("model-a",result.getString("model"))
        assertFalse(result.has("sound"));assertFalse(result.has("hiddenSecret"))
    }
    @Test fun aNullSelectionAndAnExplicitEmptyInputSurviveSerialization() {
        val page=JSONObject("""{"sections":[{"rows":[{"type":"input","key":"name","value":"old"},{"type":"choice","key":"limit","value":null}]}]}""")
        val result=nativePageFields(page,mapOf("name" to ""))
        assertEquals("",result.getString("name"));assertTrue(result.isNull("limit"))
    }
}
