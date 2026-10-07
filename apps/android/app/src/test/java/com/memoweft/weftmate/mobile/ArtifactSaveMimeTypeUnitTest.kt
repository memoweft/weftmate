package com.memoweft.weftmate.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class ArtifactSaveMimeTypeUnitTest {
    @Test fun markdownAndTextRemainCompatibleWithTheCommonPlainTextContract() {
        for (fileName in listOf("notes.md", "notes.MD", "notes.txt", "notes.TXT")) {
            assertEquals("text/plain", artifactSaveMimeType(fileName, "text/plain; charset=utf-8"))
            assertEquals("text/plain", artifactSaveMimeType(fileName))
        }
    }

    @Test fun csvAndTsvHaveTheirOwnMediaTypesWithOrWithoutMetadata() {
        for (fileName in listOf("table.csv", "表格.CSV")) {
            assertEquals("text/csv", artifactSaveMimeType(fileName, "text/csv; charset=utf-8"))
            assertEquals("text/csv", artifactSaveMimeType(fileName))
        }
        for (fileName in listOf("table.tsv", "表格.TSV")) {
            assertEquals("text/tab-separated-values",
                artifactSaveMimeType(fileName, "text/tab-separated-values; charset=utf-8"))
            assertEquals("text/tab-separated-values", artifactSaveMimeType(fileName))
        }
    }

    @Test fun ordinaryTextSuffixesAndMissingMetadataUsePlainText() {
        for (fileName in listOf("trace.log", "配置.json", "settings.conf")) {
            for (contentType in listOf(null, "", " ", "text/plain; charset=utf-8")) {
                assertEquals("text/plain", artifactSaveMimeType(fileName, contentType))
            }
        }
    }

    @Test fun providedMetadataSuppliesTheMediaTypeWithoutCharsetParameters() {
        assertEquals("text/csv", artifactSaveMimeType("data.csv", " text/csv; charset=utf-8 "))
        assertEquals("text/csv", artifactSaveMimeType("data.csv", " TEXT/CSV; charset=UTF-8 "))
        assertEquals("text/tab-separated-values",
            artifactSaveMimeType("data.tsv", "text/tab-separated-values"))
        assertEquals("text/plain", artifactSaveMimeType("data.csv", "text/plain; charset=utf-8"))
    }
}
