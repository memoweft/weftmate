import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { report } from './report.mjs';

export async function launchEngine(context, args, execute) {
  const entry = join(context.worktree, 'scripts/nightly/run.mjs');
  const source = await readFile(entry, 'utf8').catch(() => '');
  if (!source.includes('NIGHTLY_HANDOFF_V1')) throw Error('被测提交没有 NIGHTLY_HANDOFF_V1 入口；不能使用旧编排少跑阶段，请选择包含新入口的提交');
  const file = join(context.out, 'engine-context.json');
  await writeFile(file, JSON.stringify(context));
  return execute(process.execPath, [entry, ...args, '--nightly-engine', file], { cwd: context.worktree, name: 'engine', engine: true });
}

export async function bootstrap(args, { execute: injectedExecute } = {}) {
  const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const repository = resolve(value('--repository', join(import.meta.dirname, '../..')));
  const worktree = resolve(value('--worktree', 'D:/AIProjects/WeftMate/Worktrees/nightly'));
  const reports = resolve(value('--reports', 'D:/AIProjects/WeftMate/Runtime/Nightly'));
  const minutes = Number(value('--minutes', 90)), threshold = Number(value('--threshold', 0.08));
  if (!(minutes > 0 && minutes <= 240 && threshold >= 0 && threshold <= 1) || repository === worktree || !/[\\/]nightly$/.test(worktree)) throw Error('Use a dedicated worktree named nightly and a valid deadline');
  const startedAt = new Date().toISOString(), now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const runId = startedAt.replace(/[-:.]/g, '') + '-' + randomUUID().slice(0,8);
  const out = join(reports, date, runId), lock = join(reports, 'nightly.lock');
  const context = { bootstrapPid:process.pid, repository, worktree, reports, out, runId, date, startedAt, deadline: Date.now()+minutes*60000 };
  await mkdir(reports, { recursive: true });
  try { const h = await open(lock, 'wx'); await h.writeFile(JSON.stringify({ runId, startedAt, pid: process.pid })); await h.close(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; console.error('Nightly is already running (nightly.lock); no resources taken.'); return 2; }
  let child, delegated = false;
  const stop = () => { if (delegated) void writeFile(join(out,'cancel.request'),'stop'); else child?.kill('SIGTERM'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const execute = injectedExecute || (async (command, commandArgs, { cwd = worktree, name, engine = false } = {}) => {
    const log = await open(join(out, 'logs', name + '.log'), 'a'); let output = '';
    const p = spawn(command, commandArgs, { cwd, windowsHide: true, stdio: ['ignore','pipe','pipe'] }); child = p;
    const consume = data => { output += data; void log.write(data); if (engine) process.stdout.write(data); };
    p.stdout.on('data', consume); p.stderr.on('data', consume);
    // The delegated engine applies the shared deadline and owns all cleanup.
    const timer = engine ? null : setTimeout(() => p.kill(), Math.max(1, context.deadline-Date.now()));
    try {
      const code = await new Promise((done,reject) => { p.once('error',reject); p.once('close',done); });
      if (!engine && code !== 0) throw Error(`${name} 失败（退出 ${code}；见 logs/${name}.log）`);
      return { code, output };
    } finally { clearTimeout(timer); child = null; await log.close(); }
  });
  try {
    await mkdir(join(out,'logs'), { recursive: true }); await mkdir(join(out,'gallery'));
    console.log(`Nightly ${runId}; reports: ${out.replace(/[A-Z]:[\\/]Users[\\/][^\\/]+/gi, 'C:/Users/<user>')}`);
    context.bootstrapCommit = (await execute('git',['rev-parse','HEAD'],{cwd:repository,name:'bootstrap-commit'})).output.trim();
    await execute('git',['fetch','origin','main'],{cwd:repository,name:'fetch'});
    context.sourceCommit = (await execute('git',['rev-parse',args.includes('--candidate')?'HEAD':'origin/main'],{cwd:repository,name:'source-commit'})).output.trim();
    try { await readFile(join(worktree,'.git')); }
    catch { await execute('git',['worktree','add','--detach',worktree,context.sourceCommit],{cwd:repository,name:'worktree-create'}); }
    if ((await execute('git',['status','--porcelain'],{name:'worktree-status'})).output.trim()) throw Error('专用回归工作树存在未提交修改，保留并退出');
    await execute('git',['checkout','--detach',context.sourceCommit],{name:'checkout'});
    const result = await launchEngine(context,args,(command,commandArgs,options)=>{ delegated=true; return execute(command,commandArgs,options); });
    await readFile(join(out,'nightly-status.json')).catch(() => { throw Error(`被测编排未生成报告（退出 ${result.code}；见 logs/engine.log）`); });
    return result.code ?? 1;
  } catch (error) {
    await report(out,{ phases:[{name:'prepare',status:'failed',reason:error.message}], commit:context.sourceCommit||'unknown', bootstrapCommit:context.bootstrapCommit||'unknown', startedAt, cleanup:{ bootstrap:delegated ? '被测编排未交回报告；只释放总锁，设备与临时数据清理状态未知，请查看编排日志' : '未转交成功，没有设备或临时数据资源' } });
    console.error(error.message); return 1;
  } finally {
    // Bootstrap alone owns the global lock; it never cleans engine resources.
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
    await rm(lock,{force:true});
  }
}
