import DOMPurify from 'dompurify';
let sequence = 0;
let loading;
async function library() {
  loading ||= new Promise((resolve,reject) => {
    const script=document.createElement('script');script.src=new URL('./mermaid.tiny.js',import.meta.url).href;
    script.onload=()=>resolve(globalThis.mermaid);script.onerror=()=>reject(new Error('Diagram library unavailable'));document.head.append(script);
  }).catch(error=>{loading=null;throw error;});
  return loading;
}
export async function render(source, colors) {
  if (/%%\{|^\s*---|\b(?:click|href|callback|classDef|style)\b|<|javascript:|data:|https?:/im.test(source)) throw new Error('Unsafe diagram');
  const mermaid=await library();
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    htmlLabels: false, theme: 'base', themeVariables: { primaryColor: colors.surface, primaryTextColor: colors.ink,
      primaryBorderColor: colors.line, lineColor: colors.ink, secondaryColor: colors.surface,
      tertiaryColor: colors.surface, background: colors.surface, fontFamily: colors.font },
    flowchart: {htmlLabels: false}, sequence: {useMaxWidth: true} });
  const {svg} = await mermaid.render(`wm-mermaid-${++sequence}`, source);
  return DOMPurify.sanitize(svg, {USE_PROFILES: {svg: true, svgFilters: true}, FORBID_TAGS: ['foreignObject','script','a','image'], FORBID_ATTR: ['href','xlink:href']});
}
