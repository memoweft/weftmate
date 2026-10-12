package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ClientRouteInventoryUnitTest {
    @Test fun allDiscoveredClientBusinessRoutesPassTheRealNativeAllowlist() {
        var root = File(System.getProperty("user.dir")).canonicalFile
        while (!File(root, "scripts/android-route-inventory.mjs").isFile) {
            root = root.parentFile ?: error("Repository root missing")
        }
        val process = ProcessBuilder("node", "scripts/android-route-inventory.mjs")
            .directory(root).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText()
        assertEquals(output, 0, process.waitFor())
        val rows = JSONArray(output)
        val failures = mutableListOf<String>()
        var businessCount = 0
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            assertNotEquals(row.toString(), "unclassified", row.getString("transport"))
            if (row.getString("transport") == "cloud-account") {
                val path = row.getString("path"); val method = row.getString("method")
                if (!cloudAppRouteAllowed("https://cloud.example.com$path", method,
                        "https://host.example.com", "https://cloud.example.com/personal/v1/cloud/oidc"))
                    failures.add("cloud $method $path (${row.getJSONArray("sources")})")
                continue
            }
            if (row.getString("transport") != "business") continue
            businessCount++
            val path = row.getString("path"); val method = row.getString("method")
            if (!validBusinessPath(path) || !validBusinessMethod(path, method)) failures.add("$method $path (${row.getJSONArray("sources")})")
        }
        assertTrue("Expected complete client inventory, got $businessCount", businessCount > 60)
        assertTrue("Client routes missing from Network.kt:\n" + failures.joinToString("\n"), failures.isEmpty())
    }
}
