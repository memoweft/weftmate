package com.memoweft.weftmate.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Equal blocks skip recomposition, so a streamed reply only redraws the block that grew. */
@Immutable internal sealed interface MarkdownBlock {
    data class Paragraph(val text: String) : MarkdownBlock
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Item(val marker: String, val depth: Int, val text: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Code(val language: String, val code: String, val closed: Boolean) : MarkdownBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MarkdownBlock
    data object Rule : MarkdownBlock
}

private val fence = Regex("^\\s*(```|~~~)\\s*([\\w+#.-]*)")
private val heading = Regex("^(#{1,6})\\s+(.*)$")
private val rule = Regex("^(-{3,}|\\*{3,}|_{3,})$")
private val item = Regex("^(\\s*)([-*+]|\\d{1,3}[.)])\\s+(.*)$")
private val divider = Regex("^\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?$")

private fun cells(line: String) = line.trim().removePrefix("|").removeSuffix("|").split('|').map { it.trim() }

/** An unclosed fence stays a code block, so streamed code never flips between text and code. */
internal fun parseMarkdown(text: String): List<MarkdownBlock> {
    val lines = text.replace("\r\n", "\n").split('\n')
    val blocks = mutableListOf<MarkdownBlock>()
    val paragraph = mutableListOf<String>()
    fun flush() { if (paragraph.isNotEmpty()) { blocks += MarkdownBlock.Paragraph(paragraph.joinToString("\n")); paragraph.clear() } }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        val open = fence.find(line)
        val listed = item.find(line)
        when {
            open != null -> {
                flush()
                val mark = open.groupValues[1]
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith(mark)) body += lines[i++]
                blocks += MarkdownBlock.Code(open.groupValues[2], body.joinToString("\n"), i < lines.size)
            }
            trimmed.isEmpty() -> flush()
            heading.matches(trimmed) -> { flush(); heading.find(trimmed)!!.let { blocks += MarkdownBlock.Heading(it.groupValues[1].length, it.groupValues[2]) } }
            rule.matches(trimmed) -> { flush(); blocks += MarkdownBlock.Rule }
            '|' in trimmed && i + 1 < lines.size && divider.matches(lines[i + 1].trim()) -> {
                flush()
                val header = cells(trimmed)
                val rows = mutableListOf<List<String>>()
                i += 2
                while (i < lines.size && '|' in lines[i] && lines[i].isNotBlank()) rows += cells(lines[i++]).let { row -> List(header.size) { row.getOrElse(it) { "" } } }
                blocks += MarkdownBlock.Table(header, rows)
                continue
            }
            listed != null -> {
                flush()
                val marker = listed.groupValues[2]
                blocks += MarkdownBlock.Item(if (marker[0].isDigit()) marker else "•", (listed.groupValues[1].length / 2).coerceAtMost(3), listed.groupValues[3])
            }
            trimmed.startsWith('>') -> {
                flush()
                val quote = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith('>')) quote += lines[i++].trim().removePrefix(">").trimStart()
                blocks += MarkdownBlock.Quote(quote.joinToString("\n"))
                continue
            }
            else -> paragraph += trimmed
        }
        i++
    }
    flush()
    return blocks
}

private val inline = Regex(
    "\\*\\*(.+?)\\*\\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\\[([^\\]]+)]\\((https?://[^)\\s]+)\\)" +
    "|(?<![\\w*])\\*(?![\\s*])(.+?)(?<![\\s*])\\*(?![\\w*])|(?<![\\w_])_(?![\\s_])(.+?)(?<![\\s_])_(?![\\w_])"
)

internal fun markdownInline(text: String, code: SpanStyle, link: TextLinkStyles? = null): AnnotatedString = buildAnnotatedString {
    var last = 0
    for (match in inline.findAll(text)) {
        append(text.substring(last, match.range.first))
        val g = match.groups
        when {
            g[1] != null || g[2] != null -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(markdownInline((g[1] ?: g[2])!!.value, code, link)) }
            g[3] != null -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(markdownInline(g[3]!!.value, code, link)) }
            g[4] != null -> withStyle(code) { append(g[4]!!.value) }
            g[5] != null -> withLink(LinkAnnotation.Url(g[6]!!.value, link)) { append(g[5]!!.value) }
            else -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(markdownInline((g[7] ?: g[8])!!.value, code, link)) }
        }
        last = match.range.last + 1
    }
    append(text.substring(last))
}

private fun columnWidth(texts: List<String>, size: Float): Int {
    val ems = texts.maxOf { cell -> cell.sumOf { if (it.code > 0x2e80) 1.1 else 0.62 } }
    return (ems * size).toInt().coerceIn(DesignTokens.space56, DesignTokens.space220) + DesignTokens.space24 + DesignTokens.space8
}

@Composable internal fun NativeMarkdown(text: String, onCopyCode: ((String) -> Unit)? = null) {
    val blocks = remember(text) { parseMarkdown(text) }
    Column(verticalArrangement = Arrangement.spacedBy(DesignTokens.space8.dp)) {
        blocks.forEach { MarkdownBlockView(it, LocalReadingSize.current, LocalCodeSize.current, onCopyCode) }
    }
}

@Composable private fun MarkdownBlockView(block: MarkdownBlock, reading: Float, codeSize: Float, onCopyCode: ((String) -> Unit)?) {
    val c = MaterialTheme.colorScheme
    val code = SpanStyle(fontFamily = FontFamily.Monospace, fontSize = (reading * DesignTokens.fontRelativeInlineCode).sp, background = c.surfaceVariant)
    val link = TextLinkStyles(SpanStyle(color = c.primary, textDecoration = TextDecoration.Underline))
    val body = (reading * 1.65f).sp
    val card = RoundedCornerShape(DesignTokens.radiuscard.dp)
    when (block) {
        is MarkdownBlock.Paragraph -> Text(markdownInline(block.text, code, link), fontSize = reading.sp, lineHeight = body)
        is MarkdownBlock.Heading -> Text(markdownInline(block.text, code, link), Modifier.padding(top = DesignTokens.space4.dp),
            fontSize = (reading * when (block.level) { 1 -> DesignTokens.fontRelativeHeading1; 2 -> DesignTokens.fontRelativeHeading2; else -> DesignTokens.fontRelativeHeading3 }).sp,
            fontWeight = FontWeight.SemiBold)
        is MarkdownBlock.Item -> Row(Modifier.padding(start = (DesignTokens.space16 * block.depth).dp)) {
            Text(block.marker, Modifier.widthIn(min = DesignTokens.space20.dp), fontSize = reading.sp, lineHeight = body, color = c.onSurfaceVariant)
            Text(markdownInline(block.text, code, link), fontSize = reading.sp, lineHeight = body)
        }
        is MarkdownBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(DesignTokens.space3.dp).fillMaxHeight().background(c.outline, RoundedCornerShape(DesignTokens.radius4.dp)))
            Text(markdownInline(block.text, code, link), Modifier.padding(start = DesignTokens.space12.dp), fontSize = reading.sp, lineHeight = body, color = c.onSurfaceVariant)
        }
        is MarkdownBlock.Code -> Column(Modifier.fillMaxWidth().clip(card).background(c.surfaceVariant)) {
            Row(Modifier.fillMaxWidth().padding(start = DesignTokens.space16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(block.language.ifBlank { "代码" }, Modifier.weight(1f), fontSize = DesignTokens.font12.sp, color = c.onSurfaceVariant)
                if (onCopyCode != null && block.closed) NativeIconButton(R.drawable.wm_copy, "复制代码", compact = true) { onCopyCode(block.code) }
                else Spacer(Modifier.height(DesignTokens.space32.dp))
            }
            Text(block.code, Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = DesignTokens.space16.dp, end = DesignTokens.space16.dp, bottom = DesignTokens.space12.dp),
                fontFamily = FontFamily.Monospace, fontSize = codeSize.sp, softWrap = false)
        }
        is MarkdownBlock.Table -> {
            val size = reading * DesignTokens.fontRelativeTable
            val widths = block.header.indices.map { col -> columnWidth(listOf(block.header[col]) + block.rows.map { it[col] }, size) }
            Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                Column(Modifier.clip(card).border(DesignTokens.space1.dp, c.outline, card)) {
                    (listOf(block.header) + block.rows).forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider(color = c.outline)
                        Row(Modifier.background(if (index == 0) c.surfaceVariant else c.surface)) {
                            row.forEachIndexed { col, cell ->
                                Text(markdownInline(cell, code, link), Modifier.width(widths[col].dp).padding(horizontal = DesignTokens.space12.dp, vertical = DesignTokens.space8.dp),
                                    fontSize = size.sp, fontWeight = if (index == 0) FontWeight.SemiBold else null)
                            }
                        }
                    }
                }
            }
        }
        MarkdownBlock.Rule -> HorizontalDivider(color = c.outline)
    }
}
