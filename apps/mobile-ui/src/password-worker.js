import * as opaque from '@serenity-kit/opaque';
self.onmessage=async({data})=>{
 try{
  await opaque.ready;
  if(!['startLogin','finishLogin','startRegistration','finishRegistration'].includes(data.method))throw Error();
  const value=opaque.client[data.method]({...data.args,keyStretching:'memory-constrained'});
  self.postMessage({value});
 }catch{self.postMessage({error:'INVALID_CREDENTIALS'});}
};
