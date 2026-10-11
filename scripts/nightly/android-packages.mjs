/** Read-only inventory: classification never authorizes an uninstall. */
export function androidPackages(output) {
  const packages = [...new Set(output.split(/\r?\n/).map(line => /^package:([\w.]+)$/.exec(line.trim())?.[1])
    .filter(name => name?.startsWith('com.memoweft.weftmate.')))].sort();
  return { packages, testPackages: packages.filter(name =>
    /^com\.memoweft\.weftmate\.mobile\.(?:[a-z0-9_]+qa(?:\.test)?|debug\.test)$/.test(name)) };
}

export function androidPackageReason(output) {
  const { packages, testPackages } = androidPackages(output);
  return packages.length ? `；遗留测试包：${testPackages.join(', ') || '无可明确识别的测试包'}；全部 WeftMate 包：${packages.join(', ')}` : '';
}

export const nightlyPackage = 'com.memoweft.weftmate.mobile.nightly';
export function androidHostUsesDevice(command) {
  const first = /^(?:"([^"\r\n]+)"|(\S+))/.exec(command.trim());
  const executable = (first?.[1] || first?.[2] || '').split(/[\\/]/).at(-1).toLowerCase();
  // Inspect executable arguments, not source text inside a PowerShell controller.
  // Independent APK compilation is protected by heavy slots, not the device lock.
  if (/^adb(?:\.exe)?$/.test(executable)) return /\bam\s+instrument\b/i.test(command);
  if (/^(?:java|gradle)(?:\.exe|\.bat|\.cmd)?$/.test(executable)) return /connected[A-Za-z]*AndroidTest|connectedCheck/i.test(command);
  if (/^node(?:\.exe)?$/.test(executable)) return /review-capture-mobile[^\r\n]*--android/i.test(command);
  return false;
}
export function androidBusyReason(packages, processes, instrumentation, hostCommands = []) {
  if (androidPackages(packages).packages.some(p => p === nightlyPackage || p === nightlyPackage+'.test')) return '夜间独立包仍已安装，无法证明它未被其它批次使用';
  const running = processes.split(/\r?\n/).map(line => line.trim().split(/\s+/).at(-1)).filter(p => p.startsWith('com.memoweft.weftmate.') || /uiautomator/i.test(p));
  if (running.length) return `设备上有运行中的 WeftMate / UI 测试进程：${running.join(', ')}`;
  if (/Unknown command|Bad activity command|^error:|device offline/i.test(processes + '\n' + instrumentation)) throw Error('无法核实安卓占用状态');
  if (/Active instrumentation[\s\S]*InstrumentationRecord|mActiveInstrumentation[^\n]*InstrumentationRecord/i.test(instrumentation)) return '设备上有活动仪器测试';
  if (hostCommands.some(androidHostUsesDevice)) return 'Windows 上有正在使用安卓设备的 WeftMate 测试命令';
  return '';
}
