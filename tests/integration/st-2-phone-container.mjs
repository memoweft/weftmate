// Creates a temporary test activity; Android product source and versions are unchanged.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('.local/st2-phone-container');await mkdir(root,{recursive:true});
const java=join(root,'java/com/memoweft/weftmate/mobile');await mkdir(java,{recursive:true});
await writeFile(join(java,'St2PhoneBrowserActivity.java'),`package com.memoweft.weftmate.mobile;
import android.app.Activity;import android.os.Bundle;import android.graphics.Color;import android.view.View;import android.webkit.*;
public class St2PhoneBrowserActivity extends Activity {
 static boolean webConfigured=false;
 public void onCreate(Bundle state){super.onCreate(state);String url=getIntent().getStringExtra("st4Url");if(url==null||!url.matches("http://127[.]0[.]0[.]1:[0-9]+/personal/v1/ui"))throw new IllegalArgumentException("Synthetic URL required");
 if(!webConfigured){WebView.setDataDirectorySuffix("st2-synthetic");webConfigured=true;}WebView.setWebContentsDebuggingEnabled(true);boolean dark="dark".equals(getIntent().getStringExtra("st4Theme"));palette(dark?"#262723":"#ffffff",dark?"#20221f":"#ffffff",dark);
 WebView browser=new WebView(this);browser.getSettings().setJavaScriptEnabled(true);browser.getSettings().setDomStorageEnabled(true);browser.addJavascriptInterface(new Object(){@JavascriptInterface public void sync(String top,String bottom,boolean dark){runOnUiThread(()->palette(top,bottom,dark));}},"st2Bars");
 browser.setWebViewClient(new WebViewClient(){public void onPageFinished(WebView view,String url){view.evaluateJavascript("(()=>{const colorAt=y=>{let node=document.elementFromPoint(innerWidth/2,y);while(node){const raw=getComputedStyle(node).backgroundColor;const values=raw.replace(/[rgba()]/g,'').split(',').map(Number);if(values.length>=3&&(values.length===3||values[3]>=0.99))return '#'+values.slice(0,3).map(value=>Math.round(value).toString(16).padStart(2,'0')).join('');node=node.parentElement;}return document.querySelector('meta[name=theme-color]').content;};let queued=false;const sync=()=>{queued=false;st2Bars.sync(colorAt(2),colorAt(innerHeight-2),document.documentElement.dataset.theme==='dark');};window.weftSyncSystemBars=()=>{if(!queued){queued=true;requestAnimationFrame(sync);}};new MutationObserver(window.weftSyncSystemBars).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open']});WeftSystemBars.sync();})();",null);}});setContentView(browser);browser.loadUrl(url);}
 String lastTop="",lastBottom=""; boolean lastDark; void palette(String top,String bottom,boolean dark){if(top.equals(lastTop)&&bottom.equals(lastBottom)&&dark==lastDark)return;boolean modeChanged=lastTop.isEmpty()||dark!=lastDark;lastTop=top;lastBottom=bottom;lastDark=dark;getWindow().setStatusBarColor(Color.parseColor(top));getWindow().setNavigationBarColor(Color.parseColor(bottom));if(modeChanged)getWindow().getDecorView().setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);}
}`);
await writeFile(join(root,'AndroidManifest.xml'),`<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="true"><activity android:name="com.memoweft.weftmate.mobile.St2PhoneBrowserActivity" android:exported="true" android:process=":st4remote" android:configChanges="orientation|screenSize|keyboardHidden|uiMode|density" android:theme="@android:style/Theme.Material.Light.NoActionBar" /></application></manifest>`);
await writeFile(join(root,'fixture.gradle'),`gradle.projectsEvaluated { def app = rootProject.project(':app'); app.android.sourceSets.debug.java.srcDir('${root.replaceAll('\\','/')}/java'); app.android.sourceSets.debug.manifest.srcFile('${root.replaceAll('\\','/')}/AndroidManifest.xml') }`);
await writeFile(join(root,'capture.sh'),`#!/usr/bin/env bash
set -euo pipefail
export WEFTMATE_ST2_ADB="$ANDROID_HOME/platform-tools/adb"
export WEFTMATE_ST2_ANDROID_SERIAL="$(adb devices | awk '/^emulator-/ {print $1; exit}')"
export WEFTMATE_ST2_ANDROID_PACKAGE=com.memoweft.weftmate.mobile.st2qa
export WEFTMATE_ST2_ANDROID_ACTIVITY=com.memoweft.weftmate.mobile.St2PhoneBrowserActivity
export WEFTMATE_ST2_ANDROID_APK="$PWD/apps/android/app/build/outputs/apk/debug/app-debug.apk"
export WEFTMATE_ST2_AAPT="$(find "$ANDROID_HOME/build-tools" -name aapt | sort -V | tail -1)"
node tests/integration/st-2-system-bars.mjs
`);
console.log('Generated isolated phone browser fixture');
