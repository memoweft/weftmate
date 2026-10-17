import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

// A real child process with the Core stdio protocol, never a Python/Core install.
const mode = process.argv[2];
if (mode === 'exit') process.exit(2);
if (mode === 'exit-75') process.exit(75);
let owner, home;
const methods = ['initialize', 'capabilities', 'health', 'shutdown', 'ingest_boundary',
  'preview_recall', 'query_interactions', 'query_world', 'query_evidence', 'query_provenance',
  'submit_command', 'query_command_receipt', 'retry_delete_storage_cleanup'];
for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  if (mode === 'timeout' && frame.method === 'capabilities') continue;
  if (mode === 'disconnect' && frame.method === 'ingest_boundary') process.exit(2);
  if (mode === 'initialize-disconnect' && frame.method === 'initialize') process.exit(2);
  const envelope = { protocol: 'memoweft.dsh_rpc', protocol_version: 2,
    schema_version: 1, request_id: frame.request_id };
  if (frame.method === 'initialize') { owner = frame.params.subject_id; home = frame.params.dsh_home; }
  const [, failedMethod, failureCode] = mode.split(':');
  if (mode.startsWith('reply-error:') && frame.method === failedMethod) {
    process.stdout.write(JSON.stringify({ ...envelope, ok: false, error: { code: failureCode } }) + '\n');
    continue;
  }
  if (mode === 'commands' && frame.method === 'query_command_receipt') {
    process.stdout.write(JSON.stringify({ ...envelope, ok: false, error: { code: 'command_receipt_not_found' } }) + '\n');
    continue;
  }
  if (frame.method === 'ingest_boundary') appendFileSync(join(home, 'synthetic-delivered.jsonl'), JSON.stringify(frame.params.boundary) + '\n');
  const result = frame.method === 'capabilities'
    ? { protocol: 'memoweft.dsh_rpc', protocol_version: 2, schema_version: 1, methods }
    : frame.method === 'initialize' ? { runtime: { subject_id: owner, db_path: join(home, 'memoweft/memoweft.sqlite3') },
      capabilities: { subject_id: owner, methods, services: { command: { operations: [] } } } }
    : frame.method === 'health' ? { runtime: { subject_id: owner, route_ready: true } }
    : frame.method === 'query_world' ? { world_revision: 0 }
    : frame.method === 'erase_conversation_context' ? { result_state: 'applied', affected_ids: ['synthetic-forgotten-item'], storage_cleanup: { state: 'complete' } }
    : frame.method === 'submit_command' ? { receipt: { command_id: frame.params.command.command_id, result_state: 'applied', affected_ids: [frame.params.command.target_id], storage_cleanup: { state: 'complete' } } }
    : frame.method === 'ingest_boundary' ? { job_state: 'pending' } : {};
  const initError = mode === 'initialize-error' ? 'internal_error' : mode.startsWith('initialize-code:') ? mode.slice('initialize-code:'.length) : null;
  const reply = frame.method === 'initialize' && initError !== null
    ? { ...envelope, ok: false, error: initError ? { code: initError } : {} }
    : { ...envelope, ok: true, result };
  process.stdout.write(JSON.stringify(reply) + '\n');
  if (mode === 'idle-disconnect' && frame.method === 'health') setTimeout(() => process.exit(2), 20);
  if (frame.method === 'shutdown') break;
}
