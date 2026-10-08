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
    const url = /^new\s+URL\(\s*('[^']*'|"[^"]*")\s*,\s*import\.meta\.url\s*\)$/.exec(text);
    if (url && scriptPath) {
      try { return fileURLToPath(new URL(value(url[1]), pathToFileURL(scriptPath))); }
      catch { return; }
    }
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

// A deliberately small shell interpreter: it evaluates strings and locations,
// never commands. Every write has a result, including an undefined target when
// its expression or control flow cannot be proved from this invocation.
export function shellWriteTargets(source, cwd, powershell = true) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const start = i, c = source[i];
    if (/[ \t\r]/.test(c)) { i++; continue; }
    if (c === '#') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (';\n|{}(),=+<>'.includes(c)) {
      i++; if ((c === '>' || c === '|' || c === '<') && source[i] === c) i++;
    } else {
      while (i < source.length && !/[\s;|{}(),=+<>]/.test(source[i])) {
        if (source[i] === '"' || source[i] === "'") {
          const quote = source[i++];
          while (i < source.length) {
            if (source[i] === (powershell ? '`' : '\\') && quote !== "'") { i += 2; continue; }
            if (source[i++] === quote) {
              if (powershell && source[i] === quote) { i++; continue; }
              break;
            }
          }
        } else if (source[i] === '$' && source[i + 1] === '(') {
          i += 2; let depth = 1;
          while (i < source.length && depth) { if (source[i] === '(') depth++; if (source[i++] === ')') depth--; }
        } else if (source[i] === '$' && source[i + 1] === '{') {
          i += 2; while (i < source.length && source[i++] !== '}') {}
        } else i++;
      }
    }
    tokens.push(source.slice(start, i));
  }
  let location = cwd;
  const stack = [], bindings = new Map(), environment = new Map(Object.entries(process.env));
  const writes = [];
  const key = name => powershell ? name.toLowerCase() : name;
  const env = name => [...environment].find(([k]) => key(k) === key(name))?.[1];
  const variable = name => {
    if (powershell && /^env:/i.test(name)) return env(name.slice(4));
    if (!powershell && bindings.has(key(name))) return bindings.get(key(name));
    if (key(name) === key('PWD') || powershell && /^pwd\.path$/i.test(name)) return location;
    return bindings.has(key(name)) ? bindings.get(key(name)) : powershell ? undefined : env(name);
  };
  function string(text) {
    if (!text) return;
    if (text[0] === "'" && text.at(-1) === "'")
      return powershell ? text.slice(1, -1).replaceAll("''", "'") : text.slice(1, -1);
    const quoted = text[0] === '"' && text.at(-1) === '"';
    const expanded = text.includes('$');
    if (quoted) text = text.slice(1, -1);
    else if (powershell && /[\s'"`]/.test(text)) return;
    if (!powershell && /[\\*?~]/.test(text)) return;
    // Only pwd is a known command substitution; all other substitutions fail.
    text = text.replace(/\$\(pwd\)/g, () => !powershell && location !== undefined ? location : '\0');
    let unknown = false;
    text = text.replace(/\$(?:\{([^}]+)\}|([\w:]+(?:\.Path)?))/gi, (_, braced, plain) => {
      const value = variable(braced ?? plain);
      if (value === undefined) unknown = true;
      return value ?? '';
    });
    if (unknown || /[\0$`]/.test(text) || !powershell && !quoted && expanded && /\s/.test(text)) return;
    return text;
  }
  function value(parts, bare = true) {
    if (!parts.length) return;
    let depth = 0, plus = -1, outerEnd = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '(') depth++;
      else if (parts[i] === ')') { depth--; if (!depth && outerEnd < 0) outerEnd = i; }
      else if (parts[i] === '+' && !depth && plus < 0) plus = i;
    }
    if (depth) return;
    if (parts[0] === '(' && outerEnd === parts.length - 1) return value(parts.slice(1, -1), false);
    if (powershell && plus !== -1) {
      const left = value(parts.slice(0, plus), false), right = value(parts.slice(plus + 1), false);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (powershell && /^Join-Path$/i.test(parts[0])) {
      const positional = [], named = new Map();
      for (let i = 1; i < parts.length; i++) {
        let name;
        if (/^-/.test(parts[i])) {
          if (!/^-(?:Path|ChildPath)$/i.test(parts[i])) return;
          name = parts[i++].toLowerCase();
        }
        const start = i;
        if (parts[i] === '(') {
          let depth = 1;
          while (++i < parts.length && depth) { if (parts[i] === '(') depth++; if (parts[i] === ')') depth--; }
          i--;
        }
        const argument = parts.slice(start, i + 1);
        if (name) { if (named.has(name)) return; named.set(name, argument); }
        else positional.push(argument);
      }
      const parent = value(named.get('-path') ?? positional.shift() ?? []);
      const child = value(named.get('-childpath') ?? positional.shift() ?? []);
      if (positional.length) return;
      return parent === undefined || child === undefined ? undefined : join(parent, child);
    }
    if (parts.length !== 1) return;
    const variableName = /^\$(?:\{([^}]+)\}|([\w:]+(?:\.Path)?))$/i.exec(parts[0]);
    if (variableName) {
      const result = variable(variableName[1] ?? variableName[2]);
      return !powershell && result !== undefined && /\s/.test(result) ? undefined : result;
    }
    if (powershell && !bare && !/^['"]/.test(parts[0])) return;
    return string(parts[0]);
  }
  const absolute = target => {
    if (target === undefined || /[*?\[\]]/.test(target)) return;
    // resolve needs a known current directory even for a relative Join-Path.
    if (location === undefined && !/^(?:[A-Za-z]:[\\/]|\/)/.test(target)) return;
    try { return resolve(location ?? cwd, target); } catch { return; }
  };
  const invalidate = () => { bindings.clear(); environment.clear(); location = undefined; stack.length = 0; };
  function statement(parts, uncertain = false) {
    if (!parts.length) return;
    const assignment = parts[1] === '=' ? (powershell ? /^\$([\w:]+)$/.exec(parts[0]) : /^(?:[A-Za-z_]\w*)$/.exec(parts[0])) : null;
    if (assignment && parts[1] === '=') {
      const name = powershell ? assignment[1] : parts[0], result = uncertain ? undefined : value(parts.slice(2), !powershell);
      if (powershell && result === undefined && !/^(?:\$[\w:]+(?:\.\w+)*|Join-Path|Invoke-WebRequest|Invoke-RestMethod|Get-Content|Get-ChildItem|Get-Item|Test-Path|Write-Output|Write-Host|\[(?:System\.)?IO\.File\]::(?:WriteAllText|WriteAllBytes|AppendAllText))$/i.test(parts[2] ?? '')) invalidate();
      if (powershell && /^env:/i.test(name)) {
        const existing = [...environment.keys()].find(k => key(k) === key(name.slice(4)));
        environment.set(existing ?? name.slice(4), result);
      }
      else bindings.set(key(name), result);
    }
    if (/^(?:Set-Variable|Set-Item|Invoke-Expression|iex|source|eval|\.)$/i.test(parts[0]) || /^(?:\$|&)/.test(parts[0]) && !assignment) invalidate();
    const command = parts[0].toLowerCase();
    // Unknown commands/functions can mutate the shell scope or location. A
    // known literal assignment afterwards can establish fresh evidence again.
    if (!assignment && /^[\w.-]+$/.test(parts[0]) && !/^(?:set-location|push-location|pop-location|cd|pushd|popd|get-location|pwd|new-item|set-content|add-content|out-file|invoke-webrequest|invoke-restmethod|curl(?:\.exe)?|move-item|copy-item|mv|cp|out-null|write-output|write-host|get-content|get-childitem|get-item|test-path|echo|printf|cat|ls|mkdir|node|python3?|pwsh|powershell|bash|sh|script-source)$/i.test(command)) invalidate();
    if (['set-location', 'push-location', 'pop-location', 'cd', 'pushd', 'popd'].includes(command)) {
      if (command === 'pop-location' || command === 'popd') location = uncertain ? undefined : stack.pop();
      else {
        if (command === 'push-location' || command === 'pushd') stack.push(location);
        location = uncertain ? undefined : absolute(value(parts.slice(1).filter(p => !/^-LiteralPath$|^-Path$/i.test(p))));
      }
    }
    const add = (expression, kind = 'write', from) => writes.push({ target: uncertain ? undefined : absolute(value(expression)), kind, from });
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes('$(') && /(?:WriteAll(?:Text|Bytes|Lines)|AppendAll(?:Text|Lines)|Set-Content|Add-Content|Out-File|New-Item|\s>>?)/i.test(parts[i])) {
        writes.push({ target: undefined, kind: 'write' }); invalidate();
      }
      if (/^(?:\[(?:System\.)?IO\.File\]|(?:System\.)?IO\.File)::(?:WriteAllText|WriteAllBytes|WriteAllLines|AppendAllText|AppendAllLines)$/i.test(parts[i]) && parts[i + 1] === '(') {
        let end = i + 2, depth = 0;
        for (; end < parts.length; end++) { if (parts[end] === '(') depth++; if (parts[end] === ')') { if (!depth) break; depth--; } if (parts[end] === ',' && !depth) break; }
        add(parts.slice(i + 2, end));
      }
      if (parts[i] === '>' || parts[i] === '>>') {
        // Descriptor duplication (2>&1) has no filesystem destination.
        if (!/^&\d+$/.test(parts[i + 1] ?? '')) add(parts.slice(i + 1, i + 2));
      }
      const cmd = parts[i].toLowerCase();
      if (!['set-content', 'add-content', 'out-file', 'new-item', 'invoke-webrequest', 'invoke-restmethod', 'curl', 'curl.exe', 'move-item', 'copy-item', 'mv', 'cp'].includes(cmd)) continue;
      const tail = parts.slice(i + 1);
      if (tail.includes(',')) { add([]); continue; }
      const argumentAt = at => {
        if (at < 0 || at >= tail.length) return;
        if (tail[at] !== '(') return [tail[at]];
        let end = at, depth = 0;
        do { if (tail[end] === '(') depth++; if (tail[end++] === ')') depth--; } while (end < tail.length && depth);
        return tail.slice(at, end);
      };
      const option = names => {
        const at = tail.findIndex(p => names.test(p));
        if (at < 0) return;
        if (tail[at + 1] === '=') return tail[at] === '--output' ? argumentAt(at + 2) : [];
        return argumentAt(at + 1);
      };
      if (/^(?:invoke-webrequest|invoke-restmethod|curl(?:\.exe)?)$/.test(cmd)) {
        const curl = /^curl/.test(cmd);
        const outputOption = curl ? /^(?:-o|--output)$/ : /^-OutFile$/i;
        const target = option(outputOption);
        if (tail.some(p => outputOption.test(p))) add(target ?? []);
        for (const token of tail) {
          const attached = curl ? /^(?:--output=|-o)(.+)$/.exec(token) : /^-OutFile:(.+)$/i.exec(token);
          if (attached) add([attached[1]]);
          if (curl && /^(?:-O|--remote-name)$/.test(token)) add([]);
        }
        continue;
      }
      const positional = [];
      for (let n = 0; n < tail.length; n++) {
        if (/^-/.test(tail[n])) { if (!/^-(?:Force|Append|NoClobber|PassThru|Verbose|Confirm)$/i.test(tail[n])) n++; }
        else if (!['|', '>', '>>'].includes(tail[n])) {
          const argument = argumentAt(n); positional.push(argument); n += argument.length - 1;
        }
      }
      if (/^(?:move-item|copy-item|mv|cp)$/.test(cmd)) {
        add(option(/^-Destination$/i) ?? positional[1] ?? [], 'move', absolute(value(option(/^-(?:LiteralPath|Path)$/i) ?? positional[0] ?? [])));
      } else add(option(/^-(?:LiteralPath|Path|FilePath)$/i) ?? positional[0] ?? [],
        cmd === 'new-item' && /^Directory$/i.test(value(option(/^-ItemType$/i) ?? []) ?? '') ? 'directory' : 'write');
    }
  }
  function block(input, uncertain = false) {
    let start = 0, conditional = false;
    for (let i = 0; i <= input.length; i++) {
      if (input[i] === '{') {
        let end = i + 1, depth = 1;
        for (; end < input.length && depth; end++) { if (input[end] === '{') depth++; if (input[end] === '}') depth--; }
        const header = input.slice(start, i), body = input.slice(i + 1, end - 1);
        // A fixed literal foreach list can be fully evaluated. General loops,
        // branches and functions do not establish any subsequent bindings.
        const literalLoop = powershell && /^foreach$/i.test(header[0] ?? '') && header[1] === '(' && /^\$\w+$/.test(header[2] ?? '') && /^in$/i.test(header[3] ?? '') && header.at(-1) === ')';
        let list = literalLoop ? header.slice(4, -1) : [];
        if (list[0] === '@' && list[1] === '(' && list.at(-1) === ')') list = list.slice(2, -1);
        list = list.filter(p => p !== ',');
        const values = list.map(p => /^'(?:[^']|'')*'$|^"[^$`"]*"$/.test(p) ? value([p]) : undefined);
        if (!uncertain && list.length && values.every(v => v !== undefined)) {
          for (const item of values) { bindings.set(key(header[2].slice(1)), item); block(body); }
          bindings.delete(key(header[2].slice(1)));
        } else if (!uncertain && /^if$/i.test(header[0] ?? '') && header.slice(1).every(p =>
          /^(?:[()]|-not|-and|-or|-eq|-ne|-LiteralPath|-Path|-ChildPath|Test-Path|Join-Path|\$[\w:]+(?:\.Path)?|'[^']*'|"[^$`"]*")$/i.test(p))) {
          const beforeBindings = new Map(bindings), beforeEnvironment = new Map(environment), beforeLocation = location, beforeStack = [...stack];
          block(body);
          // The branch may not execute. Keep only facts identical on both paths.
          for (const name of new Set([...beforeBindings.keys(), ...bindings.keys()]))
            if (beforeBindings.get(name) !== bindings.get(name)) bindings.set(name, undefined);
          for (const name of new Set([...beforeEnvironment.keys(), ...environment.keys()]))
            if (beforeEnvironment.get(name) !== environment.get(name)) environment.set(name, undefined);
          if (beforeLocation !== location) location = undefined;
          if (JSON.stringify(beforeStack) !== JSON.stringify(stack)) stack.length = 0;
        } else { invalidate(); statement(header, true); block(body, true); invalidate(); }
        i = end - 1; start = end;
      } else if (i === input.length || [';', '\n', '|', '||', '&&'].includes(input[i])) {
        statement(input.slice(start, i), uncertain || conditional);
        conditional = input[i] === '&&' || input[i] === '||'; start = i + 1;
      }
    }
  }
  if (/\b(?:pwsh|powershell|bash|sh)\b[^\n]*\s(?:-Command|-c)\s/i.test(source) && /(?:WriteAll(?:Text|Bytes|Lines)|AppendAll(?:Text|Lines)|Set-Content|Add-Content|Out-File|New-Item|\s>>?)/i.test(source)) writes.push({ target: undefined, kind: 'write' });
  block(tokens);
  return writes;
}
