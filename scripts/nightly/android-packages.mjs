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
export function androidBusyReason(packages, processes, instrumentation, hostCommands = []) {
  if (androidPackages(packages).packages.some(p => p === nightlyPackage || p === nightlyPackage+'.test')) return '夜间独立包仍已安装，无法证明它未被其它批次使用';
  const running = processes.split(/\r?\n/).map(line => line.trim().split(/\s+/).at(-1)).filter(p => p.startsWith('com.memoweft.weftmate.') || /uiautomator/i.test(p));
  if (running.length) return `设备上有运行中的 WeftMate / UI 测试进程：${running.join(', ')}`;
  if (/Unknown command|Bad activity command|^error:|device offline/i.test(processes + '\n' + instrumentation)) throw Error('无法核实安卓占用状态');
  if (/Active instrumentation[\s\S]*InstrumentationRecord|mActiveInstrumentation[^\n]*InstrumentationRecord/i.test(instrumentation)) return '设备上有活动仪器测试';
  if (hostCommands.some(command => /review-capture-mobile[^\r\n]*--android|weftmateApplicationId|NightlyWebViewProbeTest|adb[^\r\n]*\bam\s+instrument|weftmate[^\r\n]*android[^\r\n]*(?:test|probe)/i.test(command))) return 'Windows 上有正在运行的安卓构建 / WeftMate 测试命令';
  return '';
}
