package com.memoweft.weftmate.mobile

import java.util.Locale

/** SAF uses the media type without parameters; legacy records derive it from the text artifact name. */
internal fun artifactSaveMimeType(fileName: String, contentType: String? = null): String {
    val mediaType = contentType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
    if (!mediaType.isNullOrEmpty()) return mediaType
    return when {
        fileName.endsWith(".csv", ignoreCase = true) -> "text/csv"
        fileName.endsWith(".tsv", ignoreCase = true) -> "text/tab-separated-values"
        else -> "text/plain"
    }
}
