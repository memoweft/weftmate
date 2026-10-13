/** Bundle the pinned, offline PDF renderer without changing the DSH vendor. */
import {copyFile,cp,mkdir,readFile,readdir,writeFile,rm,unlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildPhonePdf(){
  const source=join(root,'node_modules/pdfjs-dist'),desktop=join(root,'src/personal-access-ui'),mobile=join(root,'apps/mobile-ui/www'),target=join(desktop,'render-vendor/pdfjs');
  // These two generated directories are owned by this builder, never runtime caches.
  for(const directory of [target,join(mobile,'render-vendor/pdfjs')]){
    if(!resolve(directory).startsWith(resolve(root)))throw new Error('PDF assets must stay inside the repository');
    async function unlinkLinks(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isSymbolicLink())await unlink(file);else if(entry.isDirectory())await unlinkLinks(file);}}
    try{await unlinkLinks(directory);await rm(directory,{recursive:true,force:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await mkdir(target,{recursive:true});
  await copyFile(join(source,'legacy/build/pdf.mjs'),join(target,'pdf.js'));
  await copyFile(join(source,'legacy/build/pdf.worker.mjs'),join(target,'pdf.worker.js'));
  const tables={};
  for(const [folder,key]of [['cmaps','cMapUrl'],['standard_fonts','standardFontDataUrl'],['wasm','wasmUrl']]){
    const data={};for(const name of await readdir(join(source,folder))){const bytes=await readFile(join(source,folder,name));
      if(/^LICENSE/i.test(name)){for(const dir of [desktop,mobile]){await mkdir(join(dir,'licenses/rendering'),{recursive:true});await writeFile(join(dir,'licenses/rendering',`pdfjs-${folder}-${name}.txt`),bytes);}continue;}
      if(name.endsWith('.js'))await writeFile(join(target,name),bytes);else data[name]=bytes.toString('base64');
    }
    tables[key]=`${folder}-data.js`;await writeFile(join(target,tables[key]),'/* Generated PDF.js resource data; see licenses/rendering/pdfjs-*.txt. */\nexport default '+JSON.stringify(data)+';\n');
  }
  const files=[];async function list(dir,prefix){for(const entry of await readdir(dir,{withFileTypes:true})){const relative=prefix+'/'+entry.name;if(entry.isDirectory())await list(join(dir,entry.name),relative);else files.push(relative);}}
  await list(target,'render-vendor/pdfjs');
  const manifest=join(desktop,'render-assets.json'),assets=JSON.parse(await readFile(manifest,'utf8'));
  await writeFile(manifest,JSON.stringify([...new Set([...assets.filter(name=>!name.startsWith('render-vendor/pdfjs/')), ...files.sort()])],null,2)+'\n');
  await cp(target,join(mobile,'render-vendor/pdfjs'),{recursive:true});await copyFile(manifest,join(mobile,'render-assets.json'));
  for(const dir of [desktop,mobile]){await mkdir(join(dir,'licenses/rendering'),{recursive:true});await copyFile(join(source,'LICENSE'),join(dir,'licenses/rendering/pdfjs-LICENSE.txt'));}
  return files.length;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(`[phone-pdf] ${await buildPhonePdf()} offline assets`);
