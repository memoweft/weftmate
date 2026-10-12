import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [executable,entry,profile,pidFile]=process.argv.slice(2);
const env={...process.env,DATA2_PARENT_PID:String(process.pid)};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[entry,'--user-data-dir='+profile,'--personal-host','--access-port=0','--start-in-tray'],{env,detached:true,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.once('spawn',()=>{
  writeFileSync(pidFile,String(child.pid));
  child.stdout.destroy();child.stderr.destroy();child.unref();
  // The GUI outlives this parent and retains now-closed console handles.
  process.exit(0);
});
child.once('error',()=>process.exit(1));
