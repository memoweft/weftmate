package com.memoweft.weftmate.mobile

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.text.style.URLSpan
import android.widget.TextView
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

internal data class FileTextBlock(val text:String,val heading:Int=0,val code:Boolean=false,val table:Boolean=false)
internal fun fileMarkdownBlocks(source:String):List<FileTextBlock> {
    val blocks=mutableListOf<FileTextBlock>();val lines=source.lines();var i=0
    while(i<lines.size) {
        val line=lines[i]
        when {
            line.isBlank()->i++
            line.trimStart().startsWith("```")-> {i++;val code=mutableListOf<String>();while(i<lines.size && !lines[i].trimStart().startsWith("```")){code+=lines[i++]} ;if(i<lines.size)i++;blocks+=FileTextBlock(code.joinToString("\n"),code=true)}
            Regex("^#{1,6} ").containsMatchIn(line)->{val heading=line.takeWhile{it=='#'}.length;blocks+=FileTextBlock(line.drop(heading+1),heading=heading);i++}
            line.contains('|') && i+1<lines.size && Regex("^\\s*\\|?\\s*:?-{3,}").containsMatchIn(lines[i+1])-> {
                val rows=mutableListOf(line);i+=2;while(i<lines.size && lines[i].contains('|') && lines[i].isNotBlank())rows+=lines[i++]
                val cells=rows.map{it.trim().trim('|').split('|').map(String::trim)};val cols=cells.maxOf{it.size}
                val widths=(0 until cols).map{c->cells.maxOf{it.getOrElse(c){""}.length}}
                blocks+=FileTextBlock(cells.joinToString("\n"){r->(0 until cols).joinToString("  │  "){c->r.getOrElse(c){""}.padEnd(widths[c])}},table=true)
            }
            else -> {val paragraph=mutableListOf<String>();do {paragraph+=lines[i++].replace(Regex("^\\s*[-*+] "),"• ").replace(Regex("^> ?"),"│ ")}while(i<lines.size && lines[i].isNotBlank() && !lines[i].startsWith('#') && !lines[i].trimStart().startsWith("```"));blocks+=FileTextBlock(paragraph.joinToString("\n"))}
        }
    }
    return blocks
}
/** Ordinary HTTPS/HTTP links, emphasis and inline code. Unsupported formula/diagram source stays readable. */
internal fun fileInlineMarkdown(text:String):SpannableStringBuilder {
    val out=SpannableStringBuilder();var last=0
    Regex("\\*\\*(.+?)\\*\\*|__(.+?)__|`([^`]+)`|\\[([^]]+)]\\((https?://[^ )]+|mailto:[^ )]+)\\)|\\*([^*]+)\\*|_([^_]+)_").findAll(text).forEach{m->
        out.append(text.substring(last,m.range.first));val start=out.length
        val bold=m.groups[1]?.value ?: m.groups[2]?.value;val code=m.groups[3]?.value;val link=m.groups[4]?.value
        out.append(bold ?: code ?: link ?: m.groups[6]?.value ?: m.groups[7]!!.value)
        val span=when{bold!=null->StyleSpan(Typeface.BOLD);code!=null->TypefaceSpan("monospace");link!=null->URLSpan(m.groups[5]!!.value);else->StyleSpan(Typeface.ITALIC)}
        out.setSpan(span,start,out.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);last=m.range.last+1
    };out.append(text.substring(last));return out
}
@Composable internal fun NativeTextFile(file:File,kind:NativeFileKind,modifier:Modifier,onRetry:()->Unit) {
    var text by remember(file){mutableStateOf<String?>(null)}
    var error by remember(file){mutableStateOf("")}
    LaunchedEffect(file){try{text=withContext(Dispatchers.IO){if(file.length()>1024*1024)throw ApiFailure(413,"FILE_TOO_LARGE");file.readText()}}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(e:Exception){error=nativeFileFailure(e)}}
    if(error.isNotBlank()){Box(modifier){NativeFileState(error,R.drawable.wm_file,onRetry)};return}
    if(text==null){Box(modifier){NativeFileLoading()};return}
    val blocks=remember(text,kind){if(kind==NativeFileKind.MARKDOWN)fileMarkdownBlocks(text!!) else listOf(FileTextBlock(text!!,code=kind==NativeFileKind.CODE))}
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(DesignTokens.space16.dp),verticalArrangement=Arrangement.spacedBy(DesignTokens.space12.dp)) {
        blocks.forEach { block ->
            val color=MaterialTheme.colorScheme.onSurface.toArgb();val link=MaterialTheme.colorScheme.primary.toArgb();val selection=MaterialTheme.colorScheme.surfaceVariant.toArgb()
            val size=if(block.heading==1)DesignTokens.font24 else if(block.heading>0)DesignTokens.font18 else if(block.code||block.table)DesignTokens.font13 else DesignTokens.font14
            AndroidView(factory={context->TextView(context).apply{setTextIsSelectable(true);setPadding(0,0,0,0)}},modifier=if(block.code||block.table)Modifier.horizontalScroll(rememberScrollState()) else Modifier.fillMaxWidth(),update={view->
                view.text=if(block.code||block.table)block.text else fileInlineMarkdown(block.text)
                view.setTextColor(color);view.setLinkTextColor(link);view.textSize=size
                view.highlightColor=selection
                androidx.core.widget.TextViewCompat.setLineHeight(view,((if(block.heading>0)DesignTokens.space32 else DesignTokens.space24)*view.resources.displayMetrics.scaledDensity).toInt())
                view.typeface=if(block.code||block.table)Typeface.MONOSPACE else if(block.heading>0)Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                view.movementMethod=LinkMovementMethod.getInstance()
            })
        }
    }
}
