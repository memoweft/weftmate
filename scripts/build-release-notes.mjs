import {readFile,readdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const directory=new URL('../docs/changelog/',import.meta.url);
export function validateRelease(record){
  if(Object.keys(record).some(key=>!['date','versions','added','improved','fixed'].includes(key)))throw new Error('Invalid release category');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||new Date(record.date).toISOString().slice(0,10)!==record.date)throw new Error('Invalid release date');
  for(const audience of ['desktop','mobile'])if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(record.versions?.[audience]||''))throw new Error('Invalid release version');
  for(const key of ['added','improved','fixed'])if(!Array.isArray(record[key])||record[key].some(text=>typeof text!=='string'||!text.trim()||/\b(?:[A-Z][A-Z0-9]{0,8}(?:-[A-Z0-9]+)?-\d+|DSH|ui-core|DTO|IPC)\b/.test(text)))throw new Error('Invalid user-facing release item');
  return record;
}
export async function buildReleaseNotes(){
  const records=[];for(const name of (await readdir(directory)).filter(name=>name.endsWith('.json')))records.push(validateRelease(JSON.parse(await readFile(new URL(name,directory),'utf8'))));
  const rows=records.flatMap(({versions,...record})=>Object.entries(versions).map(([audience,version])=>({...record,audience,version})));
  const versions=new Set();for(const row of rows){const key=`${row.audience}:${row.version}`;if(versions.has(key))throw new Error('Duplicate release version');versions.add(key);}
  rows.sort((a,b)=>{const aa=a.version.split(/[.-]/).map(Number),bb=b.version.split(/[.-]/).map(Number);return bb[0]-aa[0]||bb[1]-aa[1]||bb[2]-aa[2];});
  await writeFile(new URL('../src/ui-core/release-notes.js',import.meta.url),`/* Generated from docs/changelog/*.json. Run node scripts/build-release-notes.mjs. */\nglobalThis.WeftUiCore.releaseNotes = ${JSON.stringify(rows,null,2)};\n`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildReleaseNotes();
