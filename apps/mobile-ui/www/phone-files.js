/* Phone file viewing uses existing previews and downloads; no composer in this page. */
(() => {
    const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text)el.textContent=text;return el;};
    let active=null;
    async function fromBlob(blob,name){
        if(blob.type==='application/pdf'||/\.pdf$/i.test(name))return {kind:'pdf',blob};
        if(blob.type.startsWith('image/'))return {kind:'image-blob',blob};
        if(blob.type.startsWith('text/')||/\.(md|txt|csv|json|js|ts|py|log)$/i.test(name))return {kind:/\.md$/i.test(name)?'markdown':'text',text:await blob.text()};
        return {kind:'unsupported'};
    }
    async function readBlob(url){const response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw new Error('文件暂时无法读取');return response.blob();}
    function saveBlob(blob,name){const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
    function attach({menu,name,getBlob,save,library,versions=[]}){
        menu.hidden=false;menu.setAttribute('aria-label','文件操作');menu.setAttribute('aria-haspopup','menu');
        menu.onclick=()=>WeftPopover.menu(menu,[
            {name:'分享',icon:'share',disabled:!navigator.share||!getBlob,description:!navigator.share||!getBlob?'这台设备暂不支持分享文件':undefined,action:async()=>{const blob=await getBlob(),file=new File([blob],name,{type:blob.type});await navigator.share({files:[file],title:name});}},
            {name:'保存到本机',icon:'download',disabled:!save&&!getBlob,action:()=>save?save():getBlob().then(blob=>saveBlob(blob,name))},
            ...(library?[{name:'在成果库里看',icon:'folder',action:library}]:[]),
            // Callers supply older versions; the file being viewed is the current one.
            ...(versions.length?[{name:'版本历史',icon:'history',action:()=>WeftPopover.menu(menu,versions.map(version=>({name:version.name||version.fileName||'较早版本',icon:'file',action:version.open})))}]:[])
        ]);
    }
    function close(restore=true){if(!active)return false;active.restore=restore;active.dialog.close();return true;}
    function open({name,trigger=document.activeElement,read,getBlob,save,library,versions=[],current=()=>true,autoLoad=true}){
        close(false);const dialog=node('dialog','dialog phone-file-page');dialog.setAttribute('aria-label',`查看文件 ${name}`);
        const header=node('header','phone-file-topbar'),back=node('button','icon-button'),title=node('strong','',name),menu=node('button','icon-button');
        back.type=menu.type='button';back.setAttribute('aria-label','关闭文件');back.append(WeftIcons.create('close',20));menu.append(WeftIcons.create('more',20));
        const content=node('div','phone-file-content');header.append(back,title,menu);dialog.append(header,content);document.body.append(dialog);
        const view=active={dialog,content,trigger,restore:true};back.onclick=()=>close();attach({menu,name,getBlob,save,library,versions});
        dialog.addEventListener('close',()=>{WeftPopover.closeMenu();dialog.remove();if(active===view)active=null;if(view.restore&&trigger?.isConnected)trigger.focus({preventScroll:true});});
        dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}});
        const load=async()=>{content.replaceChildren(node('p','render-status','正在读取…'));try{const data=await(read?read():getBlob().then(blob=>fromBlob(blob,name)));if(active!==view||!current())return;content.replaceChildren();
            if(data.kind==='image-blob'){const image=node('img','preview-image'),url=URL.createObjectURL(data.blob);image.src=url;image.alt=name;content.append(image);dialog.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});}
            else WeftContent.preview(content,data,{name});
        }catch{if(active!==view)return;const retry=node('button','button secondary','重试');retry.onclick=load;content.replaceChildren(node('p','render-status','暂时无法读取，请重试。'),retry);}};
        dialog.showModal();back.focus({preventScroll:true});if(autoLoad)void load();return {panel:dialog,content};
    }
    function mount(core,ui){if(!globalThis.WeftPhoneUnify?.isPhone())return;
        const original=WeftDesktop.openPreview;
        const originalClose=WeftDesktop.closePreview;WeftDesktop.closePreview=(restore=true)=>{if(active)close(restore);return originalClose(restore);};
        WeftDesktop.openPreview=(name,trigger,key=name,kind='file')=>{if(kind!=='file')return original(name,trigger,key,kind);
            const artifact=String(key).match(/\/(?:artifacts|library)\/([^/]+)\/preview$/)?.[1];
            const url=artifact?core.artifactDownloadUrl(artifact):null;
            return open({name,trigger,autoLoad:false,getBlob:url?()=>readBlob(url):undefined,library:artifact?()=>{close(false);ui.openLibrary();}:undefined});};
        document.addEventListener('click',event=>{const link=event.target.closest('a.synced-file');if(!link)return;event.preventDefault();const name=link.querySelector('strong')?.textContent||link.download||'文件';open({name,trigger:link,getBlob:()=>readBlob(link.href)});});
    }
    globalThis.WeftPhoneFiles={attach,open,close,fromBlob,readBlob,saveBlob,mount,isOpen:()=>!!active};
})();
