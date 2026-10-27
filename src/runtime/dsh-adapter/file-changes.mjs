/** Applied DSH diff metadata only. Call arguments describe intent, not a change. */
const validDiff = diff => diff && typeof diff.path === 'string' && diff.path &&
  (diff.oldText === null || typeof diff.oldText === 'string') && typeof diff.newText === 'string';
export function fileChangeDetails(meta) {
  if (!Array.isArray(meta?.diffs)) return [];
  let remaining=64_000;
  return meta.diffs.slice(0,100).filter(validDiff).map(diff=>{
    const oldLimit=Math.min(diff.oldText?.length || 0, Math.floor(remaining/2));
    const oldText=diff.oldText===null?null:diff.oldText.slice(0,oldLimit);
    const newText=diff.newText.slice(0,remaining-oldLimit);
    remaining-=(oldText?.length || 0)+newText.length;
    return {path:diff.path,oldText,newText,truncated:oldText!==diff.oldText || newText!==diff.newText};
  });
}
export function appliedFileChanges(part, args = {}) {
  if (part?.isError) return [];
  const unknown=()=>typeof args.file_path==='string' && args.file_path ? [{path:args.file_path,added:null,removed:null}] : [];
  if (!Array.isArray(part?.meta?.diffs)) return unknown();
  const files = new Map();
  for (const diff of part.meta.diffs) {
    if (!validDiff(diff)) continue;
    const counts = changedLines(diff.oldText, diff.newText);
    const row = files.get(diff.path) || { path: diff.path, added: 0, removed: 0 };
    if (!counts || row.added === null) { row.added = null; row.removed = null; }
    else { row.added += counts.added; row.removed += counts.removed; }
    files.set(diff.path, row);
  }
  return files.size ? [...files.values()] : unknown();
}

function changedLines(before, after) {
  // DSH stores joined hunk lines, not whole-file text: a trailing newline can
  // be a real blank context/change line. Empty newText after a deletion is
  // ambiguous (zero lines or one blank line), so do not invent an exact count.
  if(before!==null && after==='')return null;
  const lines = text => text === null ? [] : text.replace(/\r\n/g, '\n').split('\n');
  let left = lines(before), right = lines(after), start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  left = left.slice(start); right = right.slice(start);
  while (left.length && right.length && left.at(-1) === right.at(-1)) { left.pop(); right.pop(); }
  // A malformed or enormous external hunk must not stall history reads. Unknown
  // counts stay unknown; they are never replaced by zero or argument lengths.
  if (left.length * right.length > 2_000_000) return null;
  let previous = new Uint32Array(right.length + 1), current = new Uint32Array(right.length + 1);
  for (const line of left) {
    for (let j = 1; j <= right.length; j++) current[j] = line === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    [previous, current] = [current, previous]; current.fill(0);
  }
  return {added: right.length - previous[right.length], removed: left.length - previous[right.length]};
}
