import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startFixture} from './integration/ux-4-fixture.mjs';
declare const state:{booted:boolean};

test('bundled phone page boots in real Chromium with shared appearance attributes',{timeout:45000},async()=>{
  const fixture=await startFixture();let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors:string[]=[],calls:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(new URL(request.url()).pathname==='/bridge'&&request.method()==='POST')calls.push(request.postDataJSON().method);});
    await page.goto(fixture.mobileUrl);await page.waitForFunction(()=>state.booted===true);
    assert.ok(calls.includes('app.ready'));assert.equal(calls.includes('app.failed'),false);
    assert.equal(await page.locator('html').getAttribute('data-diff-markers'),'color');
    assert.equal(await page.locator('html').evaluate(el=>el.hasAttribute('data-pointer-cursor')),false);
    await page.evaluate(()=>{const g=globalThis as any;g.WeftAppearanceControls.apply({...g.WeftUiCore.appearanceDefaults,pointerCursor:true,diffMarkers:'sign'},'light');});
    assert.equal(await page.locator('html').getAttribute('data-diff-markers'),'sign');
    assert.equal(await page.locator('html').evaluate(el=>el.hasAttribute('data-pointer-cursor')),true);
    await page.evaluate(()=>{(globalThis as any).page('appearance');});await page.getByRole('group',{name:'颜色模式',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await fixture.close();}
});
