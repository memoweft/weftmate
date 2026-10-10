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
