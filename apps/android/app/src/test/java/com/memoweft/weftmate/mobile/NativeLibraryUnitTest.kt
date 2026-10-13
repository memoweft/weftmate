package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneId

class NativeLibraryUnitTest {
    @Test fun markdownAndCodeKeepExistingWebActionsWhileOtherFilesStayNative() {
        NativeFileKind.entries.forEach { kind -> assertEquals(kind in setOf(NativeFileKind.MARKDOWN,NativeFileKind.CODE),useOriginalFileViewer(kind)) }
    }
    @Test fun phoneOnlyIdentityIsNormalEmptyState() {
        assertTrue(libraryHasNoComputer(JSONObject().put("authSource","phone")))
        assertTrue(libraryHasNoComputer(JSONObject().put("hostAttached",false)))
        assertFalse(libraryHasNoComputer(JSONObject().put("authSource","local")))
    }
    @Test fun sharingProviderExposesOnlyDedicatedPrivateCacheAndNoStoragePermission() {
        var root=File(System.getProperty("user.dir")).canonicalFile
        while(!File(root,"app/src/main/AndroidManifest.xml").exists())root=root.parentFile ?: error("Android root missing")
        val paths=File(root,"app/src/main/res/xml/native_file_share_paths.xml").readText()
        assertEquals(1,Regex("<cache-path ").findAll(paths).count());assertTrue(paths.contains("path=\"native-file-share/\""))
        assertFalse(paths.contains("files-path"));assertFalse(paths.contains("external-path"));assertFalse(paths.contains("path=\".\""))
        val manifest=File(root,"app/src/main/AndroidManifest.xml").readText()
        assertFalse(manifest.contains("READ_EXTERNAL_STORAGE"));assertFalse(manifest.contains("WRITE_EXTERNAL_STORAGE"));assertFalse(manifest.contains("MANAGE_EXTERNAL_STORAGE"))
    }
    @Test fun mergeKeepsServerRecentOrderAndReplacesRepeatedPageIds() {
        fun row(id:String,at:String)=JSONObject().put("id",id).put("createdAt",at)
        val first=row("a","2026-10-12T09:00:00Z");val replacement=row("a","2026-10-13T09:00:00Z").put("exists",false)
        val merged=mergeLibraryRows(listOf(first,row("b","2026-10-11T09:00:00Z")),listOf(replacement,row("c","2026-10-12T09:00:00Z")))
        assertEquals(listOf("a","b","c"),merged.map{it.getString("id")});assertFalse(merged[0].getBoolean("exists"))
    }
    @Test fun fileTypesIncludeOriginalPdfTextCodeAndBinary() {
        val kinds=mapOf("photo.PNG" to NativeFileKind.IMAGE,"plan.md" to NativeFileKind.MARKDOWN,"plan.txt" to NativeFileKind.TEXT,"data.csv" to NativeFileKind.TEXT,"script.py" to NativeFileKind.CODE,"art.svg" to NativeFileKind.CODE,"report.pdf" to NativeFileKind.PDF,"report.docx" to NativeFileKind.OTHER,"data.xlsx" to NativeFileKind.OTHER,"archive.zip" to NativeFileKind.OTHER)
        kinds.forEach{(name,kind)->assertEquals(name,kind,nativeFileKind(name))}
        assertEquals(NativeFileKind.PDF,nativeFileKind("download","application/pdf; charset=binary"))
        assertEquals("application/octet-stream",nativeFileMime("opaque"))
        assertEquals("text/markdown",nativeFileMime("plan.md"))
    }
    @Test fun fileNamesNeverEscapeProviderDirectoryAndMiddleTruncationRetainsExtension() {
        assertEquals("report.md",nativeFileName("../../report.md"));assertEquals("report.md",nativeFileName("folder\\report.md"))
        assertEquals("文件",nativeFileName("\u0000"))
        val shortened=middleFileName("这是一份足够长的虚构成果文件名称仅用于检验中间省略并保留最后扩展名.pdf",24)
        assertTrue(shortened.contains('…'));assertTrue(shortened.endsWith(".pdf"));assertEquals(24,shortened.codePointCount(0,shortened.length))
    }
    @Test fun sizeAndTimeUseHumanUnitsAndLocalDay() {
        assertEquals("1.2 MB",nativeFileSize(1258291));assertEquals("1.0 KB",nativeFileSize(1024));assertEquals("0 字节",nativeFileSize(0))
        val now=Instant.parse("2026-10-13T05:00:00Z");val zone=ZoneId.of("Asia/Shanghai")
        assertEquals("今天 9:00",nativeFileTime("2026-10-13T01:00:00Z",now,zone))
        assertEquals("昨天 9:00",nativeFileTime("2026-10-12T01:00:00Z",now,zone));assertEquals("时间未知",nativeFileTime("bad",now,zone))
    }
    @Test fun cacheIsAccountScopedAndLogoutRemovesOnlyItsOwnRoot() {
        val parent=Files.createTempDirectory("and7-cache-").toFile()
        try {
            val unrelated=File(parent,"other.txt").apply{writeText("unrelated")};val cache=NativeFileCache(File(parent,"native-file-share"))
            val a=cache.create("a","../../sample.txt").apply{writeText("synthetic A")};val b=cache.create("b","sample.txt").apply{writeText("synthetic B")}
            assertNotEquals(a.parentFile.parentFile,b.parentFile.parentFile);assertTrue(a.canonicalPath.startsWith(File(parent,"native-file-share").canonicalPath))
            cache.clear();assertFalse(a.exists());assertFalse(b.exists());assertTrue(unrelated.exists())
        }finally{parent.deleteRecursively()}
    }
    @Test fun onlyActualDistinctVersionsExposeHistory() {
        fun v(id:String)=JSONObject().put("artifactId",id)
        assertTrue(realFileVersions(JSONObject()).isEmpty());assertTrue(realFileVersions(JSONObject().put("versions",JSONArray(listOf(v("a"),v("a"))))).isEmpty())
        assertEquals(2,realFileVersions(JSONObject().put("versions",JSONArray(listOf(v("a"),v("b"))))).size)
    }
    @Test fun markdownKeepsHeadingListTableCodeAndDiagramSourceReadable() {
        val blocks=fileMarkdownBlocks("# 虚构计划\n\n- 第一项\n- 第二项\n\n| 项目 | 时间 |\n| --- | --- |\n| 阅读 | 9:00 |\n\n```kt\nprintln(\"synthetic\")\n```\n\n**粗体**与*斜体*和[链接](https://example.com)")
        assertEquals(1,blocks[0].heading);assertTrue(blocks.any{it.text.contains("• 第一项")});assertTrue(blocks.any{it.table&&it.text.contains("9:00")});assertTrue(blocks.any{it.code&&it.text.contains("println")})
    }
    @Test fun errorsDistinguishMissingComputerOfflineAndUnsupportedDownload() {
        assertTrue(nativeFileFailure(ApiFailure(404,"FILE_MISSING")).contains("已不在"))
        assertTrue(nativeFileFailure(java.net.ConnectException()).contains("不在线"))
        assertTrue(nativeFileFailure(ApiFailure(415,"FILE_DOWNLOAD_UNAVAILABLE")).contains("电脑上打开"))
    }
}
