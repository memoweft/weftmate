// Run under Electron; exercises the actual public-page reader without any model.
import assert from 'node:assert/strict';
import { app, BrowserWindow, session } from 'electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPersonalBrowserReader } from '../../src/personal-browser/index.mjs';
const root=mkdtempSync('C:/Temp/weftmate-fact1-anchor-');
app.setPath('userData',root);app.on('window-all-closed',()=>{});
app.whenReady().then(async () => {
const reader=createPersonalBrowserReader({BrowserWindow,session}),results=[];
try {
  for(const [fragment,url,phrase] of [
    ['section-15.4','https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4','MUST NOT change the request method'],
    ['implications-of-abi-stability','https://nodejs.org/api/n-api.html#implications-of-abi-stability','external libraries'],
  ]) {
    const start=Date.now(),value=await reader.read({ownerId:'fact1-owner',taskId:'fact1-task',sessionId:'fact1-session',receiptId:'fact1-receipt',callId:'fact1-'+results.length,url});
    assert.equal(value.capturedFragment,fragment);assert.ok(value.capturedText.includes(phrase));
    assert.equal(value.captureTruncated,true);assert.ok(value.totalCapturedBytes<=256*1024);
    results.push({url,capturedFragment:value.capturedFragment,durationMs:Date.now()-start,bytes:value.totalCapturedBytes,
      requiredPhrase:phrase,phrasePresent:true,partialPage:true,firstParagraph:value.capturedText.slice(0,300)});
  }
  writeFileSync(resolve('tests/evidence/fact-1/anchor-reader.json'),JSON.stringify({realElectron:true,results},null,2));
} finally {await reader.close();app.quit();}

}).catch(error => { writeFileSync(resolve('tests/evidence/fact-1/anchor-reader-failure.json'),JSON.stringify({code:error.code||error.name,message:error.message})); app.exit(1); });
