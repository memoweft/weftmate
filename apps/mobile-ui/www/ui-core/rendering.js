/* Shared content presentation. The host alone resolves file identities and provenance. */
(() => {
  const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); el.className = cls; el.textContent = text; return el; };
  const action = (name, callback, icon) => {
    const el = node('button', 'render-action', name); el.type = 'button'; el.setAttribute('aria-label', name);
    if (icon && globalThis.WeftIcons) el.prepend(WeftIcons.create(icon, 16));
    el.addEventListener('click', callback); return el;
  };
  let id = 0, diagramModule, diagramQueue = Promise.resolve(), gallery;
  const diagramViews = new Set();
  const pendingDiagrams = new Map();
  const script = globalThis.document?.currentScript?.src || globalThis.location?.href;
  const lazyUrl = script ? new URL(script.startsWith('file:')?'../personal-access-ui/render-vendor/mermaid.js':'../render-vendor/mermaid.js', script).href : null;
  const lineCount = text => String(text).replace(/\n$/, '').split('\n').length;
  const collapsed = text => lineCount(text) > 30;
  function tableCopy(rows, format = 'markdown', alignments = []) {
    if (format === 'csv') return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const line = row => '| ' + row.map(cell => String(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')).join(' | ') + ' |';
    return rows.length ? [line(rows[0]), line(rows[0].map((_,i) => ({left:':---',center:':---:',right:'---:'})[alignments[i]] || '---')), ...rows.slice(1).map(line)].join('\n') : '';
  }
  async function copy(button, text, options) {
    const before = button.textContent;
    try { await (options.copy ? options.copy(text) : navigator.clipboard.writeText(text)); button.textContent = '已复制'; }
    catch { button.textContent = '复制失败，请选择文字'; }
    clearTimeout(button._feedback); button._feedback = setTimeout(() => { if (button.isConnected) button.textContent = before; }, 1800);
  }
  function codeBlock(pre, options) {
    const code = pre.querySelector('code'); if (!code) return;
    const source = code.textContent, language = pre.dataset.language || 'text';
    const block = node('section', 'render-code'), head = node('div', 'render-code-head'), controls = node('div', 'render-code-actions');
    block.dataset.language = language; pre.replaceWith(block); block.append(head, pre);
    head.append(node('span', 'render-language', language), controls);
    const wrap = action('自动换行', () => { const enabled = block.classList.toggle('is-wrapped'); wrap.setAttribute('aria-pressed', String(enabled)); });
    wrap.setAttribute('aria-pressed', 'false');
    const button = action('复制代码', () => void copy(button, code.textContent, options), 'copy'); controls.append(wrap, button);
    const fold = action(`展开全部（${lineCount(source)} 行）`, () => { const closed = block.classList.toggle('is-collapsed'); fold.textContent = closed ? `展开全部（${lineCount(code.textContent)} 行）` : '收起代码'; fold.setAttribute('aria-label',fold.textContent); fold.setAttribute('aria-expanded', String(!closed)); });
    fold.classList.add('render-code-fold'); fold.setAttribute('aria-expanded', 'false'); fold.hidden = !collapsed(source); block.classList.toggle('is-collapsed', collapsed(source)); block.append(fold);
    block._update = fresh => {
      const next = fresh.querySelector('code'); if (code.innerHTML !== next.innerHTML) { const before=code.textContent; code.innerHTML = next.innerHTML; if(block.closest('.reply-streaming')) globalThis.WeftReplyMotion?.fragment(code,before); }
      fold.hidden = !collapsed(next.textContent); if (!collapsed(next.textContent)) block.classList.remove('is-collapsed');
      if (block.classList.contains('is-collapsed')) fold.textContent = `展开全部（${lineCount(next.textContent)} 行）`;
    };
    if (language === 'mermaid') diagram(block, code, options);
    return block;
  }
  function diagram(block, code) {
    const view = node('div', 'render-diagram'), status = node('p', 'render-status', '图表正在准备…'); status.setAttribute('role', 'status');
    block.classList.add('render-mermaid'); view.append(status); block.append(view); block.querySelector('pre').hidden = true;
    let userSource=false;
    const toggle = action('看源码', () => { const source = !block.classList.contains('is-source');userSource=source; block.classList.toggle('is-source', source); block.querySelector('pre').hidden = !source; view.hidden = source; toggle.textContent = source ? '看图' : '看源码'; toggle.setAttribute('aria-label',toggle.textContent); toggle.setAttribute('aria-pressed', String(source)); });
    toggle.setAttribute('aria-pressed', 'false'); toggle.classList.add('render-diagram-toggle'); block.querySelector('.render-code-actions').append(toggle);
    const updateCode = block._update;
    let revision = 0, visible = false;
    const paint = () => {
      const ticket = ++revision, source = code.textContent;
      diagramQueue = diagramQueue.catch(() => {}).then(async () => {
        if (!block.isConnected || ticket !== revision) return;
        try {
          diagramModule ||= import(lazyUrl);
          const module = await diagramModule, css = getComputedStyle(block);
          const colors = {surface: css.getPropertyValue('--surface').trim(), ink: css.getPropertyValue('--ink').trim(), line: css.getPropertyValue('--line').trim(), font: css.fontFamily};
          const svg = await module.render(source, colors);
          if (block.isConnected && ticket === revision) {
            if(view._url)URL.revokeObjectURL(view._url);
            view._url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));diagramViews.add(view);
            const image=node('img');image.alt='Mermaid 图表';image.src=view._url;view.replaceChildren(image);block.classList.remove('diagram-failed');
            block.classList.toggle('is-source',userSource);block.querySelector('pre').hidden=!userSource;view.hidden=userSource;toggle.textContent=userSource?'看图':'看源码';toggle.setAttribute('aria-label',toggle.textContent);toggle.setAttribute('aria-pressed',String(userSource));
          }
        } catch {
          diagramModule=null;
          if (ticket !== revision) return;
          block.classList.add('diagram-failed', 'is-source'); block.querySelector('pre').hidden = false;
          view.hidden = false; view.replaceChildren(node('p', 'render-status', '图表暂时无法绘制，已保留源码。')); toggle.textContent = '重试看图';toggle.setAttribute('aria-label',toggle.textContent);
        }
      });
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { visible = true; observer.disconnect(); pendingDiagrams.delete(block); paint(); }
      else if (!block.isConnected) {observer.disconnect();pendingDiagrams.delete(block);}
    }) : null;
    if (observer) {pendingDiagrams.set(block,observer);observer.observe(block);} else { visible = true; requestAnimationFrame(paint); }
    block._update = fresh => { updateCode(fresh); if (visible) paint(); };
    block._theme = paint;
    toggle.addEventListener('click', () => { if (block.classList.contains('diagram-failed')) paint(); });
  }
  function enhance(content, options = {}) {
    for (const pre of content.querySelectorAll('pre')) if (!pre.closest('.render-code')) codeBlock(pre, options);
    for (const scroll of content.querySelectorAll('.table-scroll')) {
      if (scroll.dataset.enhanced) continue; scroll.dataset.enhanced = 'true'; scroll.tabIndex = 0;
      scroll.setAttribute('role','region'); scroll.setAttribute('aria-label','表格，可横向滚动');
      const controls = node('div','render-table-actions');
      for (const [format,label] of [['markdown','复制为 Markdown'],['csv','复制为 CSV']]) {
        const button = action(label, () => void copy(button, tableCopy([...scroll.querySelectorAll('tr')].map(row => [...row.cells].map(cell => cell.innerText)), format, [...scroll.querySelectorAll('thead th')].map(cell=>cell.style.textAlign)), options), 'copy'); controls.append(button);
      }
      scroll.before(controls);
    }
    for (const link of content.querySelectorAll('a')) {
      const known = options.pages?.find(page => page.url === link.href && page.title);
      if(known&&!link.classList.contains('render-link-card')){link.classList.add('render-link-card');link.replaceChildren(node('strong','',known.title),node('small','',new URL(link.href).hostname));}
      if (link.dataset.enhanced) continue; link.dataset.enhanced = 'true';
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#')) {
        link.addEventListener('click', event => { event.preventDefault(); const target = content.querySelector(`[id="${href.slice(1).replace(/[^\w:.-]/g,'')}"]`); target?.scrollIntoView({block:'nearest'}); }); continue;
      }
      const url = globalThis.WeftFormat?.safeLink(href); if (!url) { link.removeAttribute('href'); continue; }
      link.addEventListener('click', async event => {
        const captured=globalThis.WeftOpenCapturedSource;
        if(captured||globalThis.weftmateDesktop?.openExternal||options.openExternal){
          event.preventDefault();
          if(captured){const children=[...link.childNodes];let consumed;try{consumed=await captured(url,link);}finally{if(link.isConnected)link.replaceChildren(...children);}if(consumed)return;}
          if(options.openExternal){await options.openExternal(url);return;}
          if(globalThis.weftmateDesktop?.openExternal){await weftmateDesktop.openExternal(url);return;}
          const external=node('a');external.href=url;external.target='_blank';external.rel='noopener noreferrer';external.click();
        }
      });
      const page = options.pages?.find(page => page.url === url && page.title);
      if (page) { link.classList.add('render-link-card'); link.replaceChildren(node('strong','',page.title),node('small','',new URL(url).hostname)); }
    }
    for (const image of content.querySelectorAll('img')) {
      if (image.dataset.enhanced) continue; image.dataset.enhanced = 'true'; image.tabIndex = 0; image.setAttribute('role','button'); image.setAttribute('aria-label',`查看图片 ${image.alt || '图片'}`);
      const images=()=>[...content.querySelectorAll('img')].filter(img=>!img.hidden&&!img.closest('.render-diagram'));
      const open = () => openGallery(images().map(img => ({url:img.src,name:img.alt || '图片'})), images().indexOf(image), image, options);
      image.addEventListener('click',open); image.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
      image.addEventListener('error',()=>{image.hidden=true;image.after(node('span','image-unavailable',`图片加载失败 · ${image.alt || '图片'}`));});
    }
    return content;
  }
  function create(text, cls = 'markdown-body', options = {}) {
    const content = node('div', cls); content._renderId = `wm-${++id}`; update(content,text,options); return content;
  }
  function update(content, text, options = {}) {
    if (content._renderText === text) { if(options.streaming!==undefined)globalThis.WeftReplyMotion?.indicator(content,options.streaming); return content; }
    const previousText=content._renderText;
    // A completed prefix followed by the same plain paragraph needs no reparse of
    // earlier code/table blocks. Prove both boundaries with the rendered paragraph;
    // Markdown, references, open fences and new blocks keep the full parser path.
    const boundary=text.lastIndexOf('\n\n'), previousBoundary=previousText?.lastIndexOf('\n\n');
    if(globalThis.WeftFormat?.render && boundary>=0 && previousBoundary===boundary && text.slice(0,boundary)===previousText.slice(0,boundary)) {
      const last=[...content.children].filter(el=>!el.classList.contains('reply-indicator')).at(-1), tail=text.slice(boundary+2), before=previousText.slice(boundary+2);
      if(last?.tagName==='P' && last.textContent===before) {
        const template=node('div');template.innerHTML=WeftFormat.render(tail,{prefix:content._renderId,highlightCache:content._highlightCache});
        const next=template.firstElementChild;
        if(template.children.length===1 && next.tagName==='P' && next.children.length===0 && next.textContent===tail) {
          next._sourceHTML=next.outerHTML;last.replaceWith(next);content._renderText=text;
          const streaming=options.streaming===true || options.streaming!==false && content.classList.contains('reply-streaming');
          if(streaming)globalThis.WeftReplyMotion?.fragment(next,before);
          if(options.streaming!==undefined || streaming)globalThis.WeftReplyMotion?.indicator(content,options.streaming ?? streaming);
          return content;
        }
      }
    }
    content._renderId ||= `wm-${++id}`; content._renderText = text;
    if (!globalThis.WeftFormat?.render) { content.textContent = text; return content; }
    content._highlightCache ||= new Map();
    const template = node('div'); template.innerHTML = WeftFormat.render(text, {prefix:content._renderId,highlightCache:content._highlightCache});
    const streaming = options.streaming === true || content.classList.contains('reply-streaming');
    const fresh = [...template.children], old = [...content.children].filter(el=>!el.classList.contains('render-table-actions') && !el.classList.contains('reply-indicator'));
    // Preserve unchanged blocks, live code controls, horizontal offsets and diagram views.
    for (let i=0;i<fresh.length;i++) {
      const next=fresh[i], previous=old[i], html=next.outerHTML;
      if (previous?._sourceHTML===html) continue;
      if (previous?.classList.contains('render-code') && next.tagName==='PRE' && previous.dataset.language===next.dataset.language) { previous._update(next); previous._sourceHTML=html; continue; }
      next._sourceHTML=html; const beforeText=previous?.textContent || '';
      if(previous) { if(previous.previousElementSibling?.classList.contains('render-table-actions'))previous.previousElementSibling.remove(); previous.replaceWith(next); }
      else content.append(next);
      if(streaming) globalThis.WeftReplyMotion?.fragment(next,beforeText);
    }
    for (const previous of old.slice(fresh.length)) { if(previous.previousElementSibling?.classList.contains('render-table-actions'))previous.previousElementSibling.remove(); previous.remove(); }
    enhance(content,options);
    if (options.streaming !== undefined || streaming) globalThis.WeftReplyMotion?.indicator(content,options.streaming ?? streaming);
    for(const block of content.querySelectorAll('.render-code')) if(!block._sourceHTML) block._sourceHTML=block.querySelector('pre')._sourceHTML;
    return content;
  }
  function openGallery(items, index = 0, trigger, options = {}) {
    gallery?.close();
    const dialog = node('dialog','message-action-dialog render-gallery'); dialog.setAttribute('aria-label','图片画廊');
    const head=node('div','render-gallery-head'), title=node('h2'), stage=node('div','render-gallery-stage'), image=node('img');
    const close=action('关闭图片画廊',()=>dialog.close(),'deny'), controls=node('div','render-gallery-controls'), info=node('p','render-status');
    let zoom=1;
    const previous=action('上一张',()=>{index--;paint();},'back'), next=action('下一张',()=>{index++;paint();},'right');
    const out=action('缩小',()=>{zoom=Math.max(.5,zoom-.25);scale();}), into=action('放大',()=>{zoom=Math.min(4,zoom+.25);scale();}), reset=action('适应窗口',()=>{zoom=1;scale();});
    const download=node(options.downloadImage?'button':'a','render-action','下载图片'); download.setAttribute('download','图片');
    if(options.downloadImage){download.type='button';download.textContent='保存 PNG';download.addEventListener('click',async event=>{event.preventDefault();download.disabled=true;download.setAttribute('aria-busy','true');try{await options.downloadImage(items[index].url,items[index].name);}catch{info.textContent='图片保存未完成，请重试。';}finally{download.disabled=false;download.removeAttribute('aria-busy');}});}
    const show=action('在文件夹中显示',()=>{const item=items[index];if(item.artifactId)void weftmateDesktop.artifact(item.artifactId,item.library?'library-show':'show');},'folder');
    function scale(){image.style.transform=`scale(${zoom})`;reset.title=`${Math.round(zoom*100)}% · 适应窗口`;out.disabled=zoom<=.5;into.disabled=zoom>=4;}
    function paint(){const item=items[index];zoom=1;scale();info.textContent='正在加载图片…';image.src=item.url;image.alt=item.alt||item.name;title.textContent=`${item.name} · ${index+1} / ${items.length}`;download.href=item.url;download.download=item.name;previous.disabled=index===0;next.disabled=index===items.length-1;show.hidden=!globalThis.weftmateDesktop||!item.artifactId;}
    image.addEventListener('load',()=>{info.textContent='';});
    image.addEventListener('error',()=>{info.textContent='图片加载失败，可关闭后重试。';});
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();if(e.key==='ArrowLeft'&&index>0){e.preventDefault();index--;paint();}if(e.key==='ArrowRight'&&index<items.length-1){e.preventDefault();index++;paint();}});
    const caption=node('p','render-status render-gallery-note',options.note||'');caption.hidden=!options.note;
    for(const [button,icon,label] of [[close,'deny','关闭图片画廊'],[previous,'back','上一张'],[next,'right','下一张'],[out,'minus','缩小'],[into,'plus','放大'],[reset,'expand','适应窗口'],[download,'download',options.downloadImage?'保存 PNG':'下载图片'],[show,'folder','在文件夹中显示']]) {button.classList.add('render-icon-action');button.setAttribute('aria-label',label);button.title=label;button.replaceChildren(WeftIcons.create(icon,20));}
    head.append(title,close);stage.append(image);controls.append(previous,next,out,into,reset,download,show);dialog.append(head,stage,caption,info,controls);document.body.append(dialog);
    dialog.addEventListener('close',()=>{image.removeAttribute('src');dialog.remove();if(gallery===dialog)gallery=null;options.onClose?.();if(dialog._restoreFocus!==false&&trigger?.isConnected)trigger.focus({preventScroll:true});},{once:true});
    gallery=dialog;dialog._trigger=trigger;paint();dialog.showModal();close.focus();return dialog;
  }
  function fileCard(file, open) {
    const ext=(file.fileName||file.name).split('.').pop().toLowerCase(),icon=/^(png|jpg|jpeg|webp|gif)$/.test(ext)?'image':/^(xlsx|xls|csv)$/.test(ext)?'chart':/^(js|ts|py|rs|go|swift|kt|ps1|json|html|css)$/.test(ext)?'code':ext==='pdf'?'book':'file';
    const button=action('',()=>open(button),icon);button.classList.add('render-file-card');button.setAttribute('aria-label',`预览文件 ${file.fileName || file.name}`);
    const size=Number.isFinite(file.size)&&file.size>=0?(file.size<1024?file.size+' B':file.size<1048576?(file.size/1024).toFixed(1)+' KB':(file.size/1048576).toFixed(1)+' MB'):'大小未记录';
    const text=node('span');text.append(node('strong','',file.fileName || file.name),node('small','',`${ext.toUpperCase()} · ${size}`));button.append(text);return button;
  }
  function preview(content,data,{name='文件',artifactId,desktop=false}={}) {
    if(data.kind==='markdown'){content.append(create(data.text));return;}
    if(data.text!==undefined){const language=({py:'python',js:'javascript',ts:'typescript',ps1:'powershell',kt:'kotlin',sh:'bash',rs:'rust',html:'xml',cs:'csharp'})[name.split('.').pop()]||name.split('.').pop();const fence='`'.repeat(Math.max(3,...[...data.text.matchAll(/`+/g)].map(m=>m[0].length+1)));content.append(create(fence+language+'\n'+data.text+'\n'+fence));return;}
    if(data.kind==='image'){const image=node('img','preview-image');image.src=`data:${data.contentType};base64,${data.data}`;image.alt=name;image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label',`查看图片 ${name}`);const open=()=>openGallery([{url:image.src,name,artifactId,library:true}],0,image);image.onclick=open;image.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();open();}};content.append(image);return;}
    if(data.kind==='pdf'){const frame=node('iframe','library-pdf');frame.title=`预览 ${name}`;const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(data.data),c=>c.charCodeAt(0))],{type:'application/pdf'}));frame.src=url+'#toolbar=0&navpanes=0&scrollbar=0&view=FitH';content.append(frame);const watcher=new MutationObserver(()=>{if(!frame.isConnected){URL.revokeObjectURL(url);watcher.disconnect();}});watcher.observe(document.body,{childList:true,subtree:true});return;}
    const office=/\.(docx|xlsx|pptx)$/i.test(name),message=data.kind==='missing'?'已不在原位置。文件可能已移动或删除。':office?'Office 文件请在电脑上用默认程序打开。':'这个文件暂时无法预览，请在电脑上打开。';
    content.append(node('p','render-status',message));
    if(desktop&&artifactId){const open=action('用默认程序打开',()=>void weftmateDesktop.artifact(artifactId,'library-open'),'open');open.disabled=data.kind==='missing';content.append(open);}
  }
  async function exportCanvas(text, theme) {
    const host=node('div','render-export');host.dataset.theme=theme;
    const body=create(text,'markdown-body');host.append(body);document.body.append(host);
    try {
      for(const block of body.querySelectorAll('.render-code')){block.classList.remove('is-collapsed');block.classList.add('is-wrapped');block._theme?.();}
      await diagramQueue;await document.fonts?.ready;
      for(const image of body.querySelectorAll('img'))if(!image.complete)await new Promise(resolve=>{image.onload=image.onerror=resolve;});
      if(host.scrollHeight>30000)throw new Error('这段对话超过单张长图尺寸，请导出完整文字文件');
      return await WeftFormat.toCanvas(host,{pixelRatio:1,cacheBust:false,style:{position:'static',left:'auto',top:'auto'}});
    } finally {host.remove();}
  }
  globalThis.WeftContent={create,update,enhance,lineCount,collapsed,tableCopy,openGallery,fileCard,preview,exportCanvas,isGalleryOpen:()=>!!gallery?.open,closeGallery:(restoreFocus=true)=>{if(gallery){gallery._restoreFocus=restoreFocus;gallery.close();return true;}return false;}};
  if(globalThis.document&&typeof MutationObserver==='function')new MutationObserver(()=>{for(const view of diagramViews)if(!view.isConnected){URL.revokeObjectURL(view._url);diagramViews.delete(view);}for(const [block,observer]of pendingDiagrams)if(!block.isConnected){observer.disconnect();pendingDiagrams.delete(block);}if(gallery?._trigger&&!gallery._trigger.isConnected){gallery._restoreFocus=false;gallery.close();}}).observe(document.body||document.documentElement,{childList:true,subtree:true});
  if(globalThis.document&&typeof MutationObserver==='function')new MutationObserver(()=>{for(const block of document.querySelectorAll('.render-mermaid'))block._theme?.();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-accent']});
})();
