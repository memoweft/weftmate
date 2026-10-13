import {setTimeout as pause} from 'node:timers/promises';

function containsText(value,text){
  if(!value||typeof value!=='object')return false;
  if(value.text===text)return true;
  return Object.values(value).some(child=>containsText(child,text));
}

// A synthetic native append is synchronous, but its conversation projection
// is not. Begin foreground latency only once the reply is available to read.
export async function waitForPublishedText(read,text,{signal}={}){
  for(;;){
    signal?.throwIfAborted();
    const page=await read();
    if(containsText(page,text))return page;
    await pause(10,undefined,{signal});
  }
}
