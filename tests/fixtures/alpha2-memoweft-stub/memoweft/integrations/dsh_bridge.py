import json
import sys

METHODS = ['capabilities', 'initialize', 'ingest_boundary', 'preview_recall', 'shutdown']
for line in sys.stdin:
    try:
        request = json.loads(line)
        method = request.get('method')
        if method == 'capabilities': result = {'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'methods': METHODS}
        elif method == 'initialize': result = {'capabilities': {'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'methods': METHODS}}
        elif method == 'ingest_boundary': result = {'job_state': 'synthetic_accepted', 'eligible': True}
        elif method == 'preview_recall': result = {'world_revision': 0, 'preview': {'selected_item_ids': [], 'rendered_recall': '', 'recall_snapshot_token': 'alpha2-smoke-empty', 'model_call_count': 0, 'world_write_count': 0}}
        elif method == 'shutdown': result = {'closed': True}
        else: raise ValueError('unknown_method')
        print(json.dumps({'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'request_id': request.get('request_id'), 'ok': True, 'result': result}), flush=True)
        if method == 'shutdown': break
    except Exception:
        print(json.dumps({'protocol': 'memoweft.dsh_rpc', 'protocol_version': 2, 'schema_version': 1, 'request_id': request.get('request_id') if 'request' in locals() else None, 'ok': False, 'error': {'code': 'stub_error'}}), flush=True)
