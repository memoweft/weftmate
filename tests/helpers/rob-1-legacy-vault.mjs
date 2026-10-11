// Seed the actual pre-ROB-1 on-disk format with real Electron safeStorage.
import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
const file=()=>join(app.getPath('userData'),'weftmate-model.enc');
export function saveCredential(id,key){writeFileSync(file(),safeStorage.encryptString(JSON.stringify({schemaVersion:2,credentials:{[id]:key}})));}
export function preflightVault(){JSON.parse(safeStorage.decryptString(readFileSync(file())));}
export function getCredential(id){return JSON.parse(safeStorage.decryptString(readFileSync(file()))).credentials[id]??null;}
