/* The phone viewer paints PDF pages locally; desktop keeps its existing preview. */
(() => {
  const script=document.currentScript?.src,base=new URL('./render-vendor/pdfjs/',script||location.href);
  let library;
  async function pdfLibrary(){if(!library)library=Promise.all([import(new URL('pdf.js',base).href),...['cmaps','standard_fonts','wasm'].map(folder=>import(new URL(folder+'-data.js',base).href))]).then(([module,...data])=>{module.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.js',base).href;
    const tables=Object.fromEntries(['cMapUrl','standardFontDataUrl','wasmUrl'].map((key,i)=>[key,data[i].default]));
    class BinaryDataFactory{async fetch({kind,filename}){const encoded=tables[kind]?.[filename];if(!encoded)throw new Error('PDF resource unavailable');return Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));}}
    return {module,BinaryDataFactory};});return library;}
  function render(content,data,name){
    const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
    const viewer=node('section','phone-pdf-view'),toolbar=node('div','phone-pdf-toolbar'),pages=node('div','phone-pdf-pages'),status=node('p','render-status','正在读取文档…');
    viewer.setAttribute('aria-label',name);viewer.dataset.pdfState='loading';status.setAttribute('role','status');
    const controls=[];let zoom=1,pdf,task,epoch=0,observer;
    for(const [label,icon,action]of [['缩小文档','minus',()=>zoom=Math.max(.5,zoom-.25)],['适应页面','expand',()=>zoom=1],['放大文档','plus',()=>zoom=Math.min(4,zoom+.25)]]){const button=node('button','render-action');button.type='button';button.setAttribute('aria-label',label);button.append(WeftIcons.create(icon,20));button.onclick=()=>{action();void paint().catch(showError);};toolbar.append(button);controls.push(button);}
    viewer.append(toolbar,status,pages);content.append(viewer);
    const rows=[];
    async function draw(row,generation){if(!viewer.isConnected||row.painted===zoom)return;row.render?.cancel();const page=await pdf.getPage(row.number);if(generation!==epoch||!viewer.isConnected)return;
      const plain=page.getViewport({scale:1}),width=Math.max(1,pages.clientWidth||content.clientWidth),scale=width/plain.width*zoom,viewport=page.getViewport({scale}),ratio=window.devicePixelRatio||1;
      const canvas=row.canvas;canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${name}，第 ${row.number} 页`);
      row.render=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0],background:'white'});await row.render.promise;row.painted=zoom;row.box.dataset.pdfRendered='true';
    }
    async function paint(){if(!pdf)return;const generation=++epoch;viewer.dataset.pdfState='loading';controls[0].disabled=zoom<=.5;controls[2].disabled=zoom>=4;controls[1].setAttribute('aria-label',`适应页面，当前 ${Math.round(zoom*100)}%`);
      for(const row of rows){row.render?.cancel();row.painted=null;row.box.style.width='';}
      await draw(rows[0],generation);if(generation!==epoch||!viewer.isConnected)return;viewer.dataset.pdfState='ready';status.hidden=true;
      observer?.disconnect();observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)void draw(entry.target.pdfRow,epoch).catch(showError);},{root:content,rootMargin:'100px'});for(const row of rows)observer.observe(row.box);
    }
    function showError(error){if(!viewer.isConnected||error?.name==='RenderingCancelledException')return;viewer.dataset.pdfState='error';status.hidden=false;status.textContent='这份文档暂时无法读取，请关闭后重试。';}
    void(async()=>{try{const {module,BinaryDataFactory}=await pdfLibrary(),bytes=data.blob?new Uint8Array(await data.blob.arrayBuffer()):Uint8Array.from(atob(data.data),char=>char.charCodeAt(0));
      if(!viewer.isConnected)return;task=module.getDocument({data:bytes,BinaryDataFactory,useWorkerFetch:false,useWasm:false,cMapUrl:base.href,cMapPacked:true,standardFontDataUrl:base.href,wasmUrl:base.href,disableFontFace:true});pdf=await task.promise;
      if(!viewer.isConnected){await task.destroy();return;}for(let number=1;number<=pdf.numPages;number++){const box=node('div','phone-pdf-page'),canvas=node('canvas');box.append(canvas);const row={number,box,canvas};box.pdfRow=row;rows.push(row);pages.append(box);}await paint();
    }catch(error){showError(error);}})();
    const cleanup=new MutationObserver(()=>{if(!viewer.isConnected){epoch++;observer?.disconnect();for(const row of rows)row.render?.cancel();void task?.destroy();cleanup.disconnect();}});cleanup.observe(document.body,{subtree:true,childList:true});
    return viewer;
  }
  globalThis.WeftPhonePdf={render};
})();
