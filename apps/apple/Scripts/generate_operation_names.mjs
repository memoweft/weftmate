import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const source=readFileSync(resolve(root,'src/ui-core/timeline-model.js'),'utf8');
const table=name=>Object.fromEntries([...source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`))[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*'([^']*)'/g)].map(m=>[m[1],m[2]]));
const swift=table=>Object.entries(table).map(([key,value])=>`        ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n');
const output=`// Generated from src/ui-core/timeline-model.js. Run Scripts/generate_operation_names.mjs.\nimport Foundation\n\npublic enum OperationNames {\n    public static let tools: [String: String] = [\n${swift(table('toolLabels'))}\n    ]\n    public static let fields: [String: String] = [\n${swift(table('fieldLabels'))}\n    ]\n}\n`;
const path=resolve(root,'apps/apple/Packages/WeftMateCore/Sources/WeftMateCore/OperationNames.swift');
if(process.argv.includes('--check')) {if(readFileSync(path,'utf8')!==output)throw Error('Apple operation names differ from ui-core');console.log('Apple operation names match ui-core');}else writeFileSync(path,output);
