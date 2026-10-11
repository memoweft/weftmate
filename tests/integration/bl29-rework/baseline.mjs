import { execFileSync } from 'node:child_process';

// First parent of main's PR #208 merge, 375d68ed021c4eca1162d7055e30165c6003021f
// (375d68ed^1, the PR #215 merge). This is the actual pre-BL-29 implementation;
// origin/main moves after merging the fix and can no longer represent "before".
export const BL29_BASELINE_SHA = '8f1b5de54e15720271e49e9b0653cd06ece3b096';

export function createBl29Baseline({ cwd = process.cwd(), git = execFileSync } = {}) {
  const run = args => git('git',args,{cwd,encoding:'utf8',windowsHide:true});
  const files = new Map();
  const tracked = paths => new Set(run(['ls-tree','-r','--name-only','-z',BL29_BASELINE_SHA,'--',...paths]).split('\0').filter(Boolean));
  function read(file) {
    // New files have no "before" source. Determine absence from the fixed
    // tree; never catch git-show errors (missing objects/repository/I/O errors
    // must remain visible and fail the probe).
    if (!files.has(file)) files.set(file,tracked([file]).has(file));
    if (!files.get(file)) return undefined;
    return run(['show',`${BL29_BASELINE_SHA}:${file}`]);
  }
  function changedFiles(paths) {
    // Compare these two trees directly. A merge-base comparison would silently
    // select an earlier "before" tree on branches that lack the pinned commit.
    const changed = run(['diff','--name-only','-z',BL29_BASELINE_SHA,'HEAD','--',...paths]).split('\0').filter(Boolean);
    const existing = tracked(paths);
    for (const file of changed) files.set(file,existing.has(file));
    return changed.filter(file=>files.get(file));
  }
  function changedSources(paths) {
    return Object.fromEntries(changedFiles(paths).map(file=>[file,read(file)]));
  }
  return { read, changedFiles, changedSources };
}
