// Fault injection only. Production modules still construct boundaries and own
// durable queues; the test changes availability, never stored memory content.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const repo = process.env.MEM_D_REPOSITORY;
registerHooks({ load(url, context, next) {
  if (url === pathToFileURL(resolve(repo, 'src/main.mjs')).href) {
    const source = readFileSync(new URL(url), 'utf8')
      .replace('function memoryProcessingRouteForSession(ownerId, sessionId) {',
        'function memoryProcessingRouteForSession(ownerId, sessionId) { if (globalThis.memDNoRoute) return null;')
      .replace("if (request.action === 'ingest') {", "if (request.action === 'ingest') { if (globalThis.memDDropIngest) throw new Error('synthetic IPC outage');");
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repo, 'src/personal-access/memory-ingestion.mjs')).href) {
    return { format: 'module', shortCircuit: true, source: readFileSync(new URL(url), 'utf8')
      .replace('export function createMemoryIngestion(context) {', 'export function createMemoryIngestion(context) { globalThis.memDIngestionContext=context;')
      .replace('if (flight || context.closing', 'if (globalThis.memDNoCapture || flight || context.closing') };
  }
  const result = next(url, context);
  if (url === pathToFileURL(resolve(repo, 'src/personal-memory/rpc.mjs')).href) {
    return { ...result, source: String(result.source).replace('request(method, params = {}, timeoutMs = this.requestTimeoutMs) {',
      "request(method, params = {}, timeoutMs = this.requestTimeoutMs) { if (method === 'ingest_boundary' && globalThis.memDBusy) return Promise.reject(failed('MEMORY_BUSY'));") };
  }
  return result;
} });
await import(pathToFileURL(resolve(repo, 'tests/integration/m2-exit-bootstrap.mjs')).href);
