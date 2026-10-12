/** Test-only transport: keep the saved official MiMo route and its normal authorization proof. */
const proxy=process.env.WEFTMATE_MEM1_PROXY;
if(proxy){
  const original=globalThis.fetch;
  globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.origin!=='https://api.xiaomimimo.com')return original(input,options);
    const target=new URL(url.pathname+url.search,proxy);
    return original(input instanceof Request?new Request(target,input):target,options);
  };
}
