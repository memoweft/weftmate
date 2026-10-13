/* Transport only: cookies are never used or exposed. Every content request
 * carries a bearer capability from the existing account + DPoP exchange. */
(() => {
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'weft-computer-channel' || !event.ports[0]) return;
    const port = event.ports[0];
    port.onmessage = async ({data}) => {
      try {
        const url = new URL(data.path, location.origin);
        if (url.origin !== location.origin || !url.pathname.startsWith('/personal/v1/') || url.hash || /%2f|%5c/i.test(url.pathname)) throw {code:'INVALID_REQUEST'};
        const auth = ['/personal/v1/auth/cloud-nonce','/personal/v1/auth/cloud-channel'].includes(url.pathname);
        const headers = new Headers(data.options?.headers);
        if (!auth && !/^Bearer [A-Za-z0-9_-]{40,128}$/.test(headers.get('authorization') || '')) throw {code:'UNAUTHORIZED'};
        if (url.pathname.startsWith('/personal/v1/auth/') && !auth && !(url.pathname==='/personal/v1/auth/me'&&(!data.options?.method||data.options.method==='GET'))) throw {code:'FORBIDDEN'};
        const response = await fetch(url, {...data.options, headers, credentials:'omit',redirect:'error',cache:'no-store'});
        if(data.options?.binary&&response.ok) {
          const bytes=await response.arrayBuffer();port.postMessage({id:data.id,status:response.status,body:{bytes,contentType:response.headers.get('content-type')}},[bytes]);
        } else port.postMessage({id:data.id,status:response.status,body:await response.json()});
      } catch (error) { port.postMessage({id:data.id,status:503,body:{error:{code:error.code || 'NETWORK'}}}); }
    };
    port.start(); port.postMessage({ready:true});
  });
})();
