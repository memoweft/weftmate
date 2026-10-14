// PDF.js prerequisites missing from the existing Android Chromium 110 WebView.
// This bootstrap runs before the pinned module in the page and worker realms.
if(typeof globalThis.Promise.withResolvers!=='function')Object.defineProperty(globalThis.Promise,'withResolvers',{
  configurable:true,writable:true,value:function(){
    let resolve,reject;
    const promise=new this((accept,fail)=>{resolve=accept;reject=fail;});
    return {promise,resolve,reject};
  }
});
if(globalThis.ReadableStream&&!globalThis.ReadableStream.prototype[Symbol.asyncIterator]){
  const prototype=globalThis.ReadableStream.prototype;
  if(!prototype.values)Object.defineProperty(prototype,'values',{configurable:true,writable:true,value:function({preventCancel=false}={}){
    const reader=this.getReader();let finished=false;
    const release=()=>{if(!finished){finished=true;reader.releaseLock();}};
    return {
      async next(){
        if(finished)return {value:undefined,done:true};
        try{const result=await reader.read();if(result.done)release();return result;}
        catch(error){release();throw error;}
      },
      async return(value){
        if(finished)return {value,done:true};
        try{if(!preventCancel)await reader.cancel(value);return {value,done:true};}
        finally{release();}
      },
      [Symbol.asyncIterator](){return this;}
    };
  }});
  Object.defineProperty(prototype,Symbol.asyncIterator,{configurable:true,writable:true,value:prototype.values});
}
