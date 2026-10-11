// Creates a temporary test activity; Android product source and versions are unchanged.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('.local/st2-phone-container');await mkdir(root,{recursive:true});
const java=join(root,'java/com/memoweft/weftmate/mobile');await mkdir(java,{recursive:true});
await writeFile(join(java,'St2PhoneBrowserActivity.java'),`package com.memoweft.weftmate.mobile;
import android.app.Activity;import android.os.Bundle;import android.graphics.Color;import android.view.View;import android.webkit.*;
public class St2PhoneBrowserActivity extends Activity {
 public void onCreate(Bundle state){super.onCreate(state);String url=getIntent().getStringExtra("st4Url");if(url==null||!url.matches("http://127[.]0[.]0[.]1:[0-9]+/personal/v1/ui"))throw new IllegalArgumentException("Synthetic URL required");
 WebView.setDataDirectorySuffix("st2-synthetic");WebView.setWebContentsDebuggingEnabled(true);boolean dark="dark".equals(getIntent().getStringExtra("st4Theme"));palette(dark?"#262723":"#ffffff",dark);
 WebView browser=new WebView(this);browser.getSettings().setJavaScriptEnabled(true);browser.getSettings().setDomStorageEnabled(true);browser.addJavascriptInterface(new Object(){@JavascriptInterface public void sync(String color,boolean dark){runOnUiThread(()->palette(color,dark));}},"st2Bars");
 browser.setWebViewClient(new WebViewClient(){public void onPageFinished(WebView view,String url){view.evaluateJavascript("window.weftSyncSystemBars=dark=>st2Bars.sync(document.querySelector('meta[name=theme-color]').content,dark);WeftSystemBars.sync();",null);}});setContentView(browser);browser.loadUrl(url);}
 void palette(String color,boolean dark){getWindow().setStatusBarColor(Color.parseColor(color));getWindow().setNavigationBarColor(Color.parseColor(color));getWindow().getDecorView().setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);}
}`);
await writeFile(join(root,'AndroidManifest.xml'),`<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="true"><activity android:name="com.memoweft.weftmate.mobile.St2PhoneBrowserActivity" android:exported="true" android:process=":st4remote" android:theme="@android:style/Theme.Material.Light.NoActionBar" /></application></manifest>`);
await writeFile(join(root,'fixture.gradle'),`gradle.projectsEvaluated { def app = rootProject.project(':app'); app.android.sourceSets.debug.java.srcDir('${root.replaceAll('\\','/')}/java'); app.android.sourceSets.debug.manifest.srcFile('${root.replaceAll('\\','/')}/AndroidManifest.xml') }`);
console.log('Generated isolated phone browser fixture');
