import { execFileSync } from 'node:child_process';

export function assertMainSource(repository) {
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  // Acceptance scripts are the only allowed source difference. This includes build-time
  // scripts and hooks, not just the files copied into the finished application.
  if (git(['diff', '--name-only', 'origin/main', '--', '.', ':(exclude)scripts/acceptance']))
    throw Error('Build input differs from fetched main');
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude)scripts/acceptance']);
  // Also catch ignored files in packaged trees and build-hook trees.
  const ignoredInputs = git(['ls-files', '--others', '--', 'src', 'runtime', 'build', 'patches', 'scripts', ':(exclude)scripts/acceptance']);
  if (untracked || ignoredInputs) throw Error('Untracked build input; use a clean main source checkout');
  return git(['rev-parse', 'origin/main']);
}
