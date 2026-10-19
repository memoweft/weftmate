// Read-only Windows Runtime API access, using the Windows PowerShell .NET projection.
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const [appId,output,pattern='B1',minimum='2']=process.argv.slice(2);
if(!appId||!output)throw Error('Usage: native-notifications.mjs APP_ID OUTPUT [TEXT_PATTERN] [MINIMUM]');
const code=String.raw`$ErrorActionPreference='Stop';
$null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];
$null=[Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime];
$null=[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime];
$items=@();$seen=0;
foreach($toast in [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($env:B1_NOTIFY_APP_ID)){
 if($null-eq $toast-or $null-eq $toast.Content){continue};$seen++;$xml=$toast.Content.GetXml();
 if($xml-match $env:B1_NOTIFY_PATTERN){$document=[xml]$xml;$items+=@{tag=$toast.Tag;text=@($document.SelectNodes('//text')|ForEach-Object InnerText)}}
};
[Console]::Out.Write((@{appId=$env:B1_NOTIFY_APP_ID;readAt=(Get-Date -Format o);systemHistoryItems=$seen;matchedTestNotifications=$items.Count;items=$items;settingsChanged=$false}|ConvertTo-Json -Depth 5))`;
const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,B1_NOTIFY_APP_ID:appId,B1_NOTIFY_PATTERN:pattern},encoding:'utf8',windowsHide:true,timeout:15000});
if(r.status!==0)throw Error('Native notification history read failed');
const report=JSON.parse(r.stdout.trim());await writeFile(output,JSON.stringify(report,null,2));
if(report.matchedTestNotifications<Number(minimum))throw Error('Expected test notifications are absent from native Windows history');
console.log(JSON.stringify({nativeHistoryMatches:report.matchedTestNotifications,settingsChanged:false}));
