/** Windows shell output boundary. Keep UTF-8 output; decode legacy native lines
 * using the machine's console/OEM code page before any model/UI sees the text. */
import { execFileSync } from 'node:child_process';

const labels = { 936:'gbk', 950:'big5', 932:'shift_jis', 949:'euc-kr', 65001:'utf-8', 437:'ibm437' };
export function commandEncodingLabel(codePage) {
  const label=labels[codePage] || `windows-${codePage}`;
  // Unsupported pages must not turn a successful command into a failure.
  try { new TextDecoder(label); return label; } catch { return 'utf-8'; }
}
export function windowsConsoleCodePage() {
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$cp=[Console]::OutputEncoding.CodePage; if ($cp -eq 65001) {$cp=[Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage}; [Console]::Write($cp)'],
    {windowsHide:true,encoding:'ascii',timeout:5000});
  return Number(output.trim());
}

// Reads use raw-byte coordinates, including when the collector drops its head.
// Non-ASCII partial lines wait for newline/exit: a GBK prefix can itself be valid
// UTF-8 (e.g. C2 A3). Choosing early would make later output impossible to repair.
export function decodeCommandBytes(bytes, codePage, final=true) {
  let text='', consumed=0;
  for(let start=0;start<bytes.length;) {
    const newline=bytes.indexOf(10,start), end=newline<0?bytes.length:newline+1;
    const part=bytes.subarray(start,end), complete=final || newline>=0;
    if(!complete && part.some(byte=>byte>=128))break;
    let label='utf-8';
    try { new TextDecoder(label,{fatal:true}).decode(part); }
    catch { label=commandEncodingLabel(codePage); }
    text+=new TextDecoder(label).decode(part);consumed=end;
    start=end;
  }
  return {text,consumed};
}

/** Adapt the pinned DSH collector without replacing its spill, truncation,
 * process lifecycle, sandbox or byte offsets. DSH currently exposes no raw read
 * method; the pinned collector retains raw `chunks`, `bytes` and `total` here. */
export function adaptCommandCollector(reader, codePage) {
  const read=reader.readFrom.bind(reader), finalize=reader.finalize.bind(reader), seal=reader.seal.bind(reader);
  let ended=false;
  reader.seal=()=>{ended=true;return seal();};
  reader.readFrom=fromByte=>{
    const result=read(fromByte), windowStart=reader.total-reader.bytes;
    const start=Math.max(fromByte,windowStart);
    const decoded=decodeCommandBytes(Buffer.concat(reader.chunks).subarray(start-windowStart),codePage,ended);
    return {...result,text:decoded.text,nextOffset:start+decoded.consumed};
  };
  reader.finalize=()=>{
    const result=finalize();
    return {...result,text:decodeCommandBytes(Buffer.concat(reader.chunks),codePage).text};
  };
}

export function installCommandEncoding(service, {platform=process.platform, codePage}={}) {
  if(platform!=='win32')return ()=>{};
  if(codePage===undefined) {try {codePage=windowsConsoleCodePage();}catch{return ()=>{};}}
  const original=service.spawn;
  service.spawn=function(spec) {
    const handle=original.call(this,spec);
    // Only shell collectors: protocol pipes (memory bridge/MCP/etc.) remain UTF-8.
    if(spec.argv.some(value=>/(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(value))) {
      for(const reader of Object.values(handle.collected || {}))adaptCommandCollector(reader,codePage);
    }
    return handle;
  };
  return ()=>{service.spawn=original;};
}
