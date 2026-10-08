import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function withoutJavaScriptComments(source) {
  let output = '', quote = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (quote) {
      output += char;
      if (char === '\\') output += source[++i] ?? '';
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') { quote = char; output += char; }
    else if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        output += source[i] === '\n' ? '\n' : ' '; i++;
      }
      i++; output += ' ';
    } else output += char;
  }
  return output;
}

// Resolve common generated Node scripts without running any of their code.
// Unknown expressions stay unknown; in particular cwd is not a blanket grant.
export function staticWriteTarget(expression, source, cwd, scriptPath, scriptArgs) {
  const bindings = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)[;\n]/g)) bindings.set(match[1], match[2]);
  const resolving = new Set();
  function value(text) {
    text = text.trim();
    // A literal script launch provides argv[2..]. Select only the branch that
    // Node would take; unresolved shell arguments must not grant a write.
    const conditional = /^process\.argv\[(\d+)\]\s*\?\s*([^?]+?)\s*:\s*(.+)$/.exec(text);
    if (conditional && scriptArgs && Number(conditional[1]) >= 2)
      return value(scriptArgs[Number(conditional[1]) - 2] ? conditional[2] : conditional[3]);
    const argument = /^process\.argv\[(\d+)\](?:\s*(?:\?\?|\|\|)\s*([\s\S]+))?$/.exec(text);
    if (argument && scriptArgs) return scriptArgs[Number(argument[1]) - 2] ?? (argument[2] ? value(argument[2]) : undefined);
    if (/^"(?:[^"\\]|\\.)*"$/.test(text)) { try { return JSON.parse(text); } catch { return; } }
    if (/^'(?:[^'\\]|\\.)*'$/.test(text)) return text.slice(1, -1).replace(/\\(['\\])/g, '$1');
    if (scriptPath && text === '__dirname') return dirname(scriptPath);
    if (scriptPath && text === '__filename') return scriptPath;
    if (scriptPath && text === 'import.meta.url') return pathToFileURL(scriptPath).href;
    if (bindings.has(text) && !resolving.has(text)) {
      resolving.add(text); const result = value(bindings.get(text)); resolving.delete(text); return result;
    }
    const call = /^(?:path\.)?(join|resolve|dirname|fileURLToPath)\((.*)\)$/.exec(text);
    if (!call) return;
    const parts = []; let start = 0, depth = 0, quote = null;
    for (let i = 0; i < call[2].length; i++) {
      const c = call[2][i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && !depth) { parts.push(call[2].slice(start, i)); start = i + 1; }
    }
    parts.push(call[2].slice(start));
    const args = parts.map(value);
    if (args.some(arg => typeof arg !== 'string')) return;
    try {
      if (call[1] === 'join') return join(...args);
      if (call[1] === 'resolve') return resolve(cwd, ...args);
      if (args.length !== 1) return;
      return call[1] === 'dirname' ? dirname(args[0]) : fileURLToPath(args[0]);
    } catch { /* Unresolved, never execute an expression. */ }
  }
  return value(expression);
}
