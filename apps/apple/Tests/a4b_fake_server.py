#!/usr/bin/env python3
"""A4b synthetic HTTP fixture: loopback only; no real commands, accounts or files."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import argparse
import json

TIME = '2026-10-07T00:00:00Z'
IDS = [f'{i:08d}-1111-4111-8111-111111111111' for i in range(1, 4)]
RISKS = [['execute'], ['delete', 'overwrite'], ['external', 'spend']]
REASONS = ['运行合成脚本 · 不读取真实文件', '删除并覆盖合成文件 · 可能无法撤销', '发布合成内容并付款 · 不会实际发送或付费']

def reset():
    return {'modes': {'session-fixture': 'auto', 'session-other': 'auto'}, 'default': 'auto',
            'decisions': {}, 'allowedCategories': [], 'requests': []}
state = reset()

def approval(index):
    row = {'approvalId': IDS[index], 'sessionId': 'session-fixture', 'taskId': 'cmd-fixture',
           'sourceCommandId': 'cmd-fixture', 'sourceReceiptId': 'receipt-fixture', 'turn': 1,
           'callId': f'call-{index}', 'toolName': 'shell', 'reason': REASONS[index],
           'riskCategories': RISKS[index], 'createdAt': TIME, 'status': 'pending'}
    if IDS[index] in state['decisions']:
        body = state['decisions'][IDS[index]]
        row.update(status='resolved', decisionOutcome=body['outcome'], decisionScope=body.get('scope', 'once'),
                   decisionRequestId=body['requestId'], answeredAt=TIME, outcome=body['outcome'], resolvedAt=TIME)
    return row

BYTES = 'A4b 最新成果\n重复写出只在输出列表显示最新版本。\n'.encode()
def artifact():
    import hashlib
    return {'commandId':'cmd-artifact','requestId':'request-artifact','targetDeviceId':'host-fixture','sessionId':'session-fixture',
            'kind':'desktop.write_artifact','state':'observed','taskId':'cmd-fixture','artifactId':'artifact-new','fileName':'result.txt',
            'contentType':'text/plain','size':len(BYTES),'sha256':hashlib.sha256(BYTES).hexdigest(),
            'createdAt':TIME,'updatedAt':TIME,'verification':{'status':'observed','method':'sha256_readback','observedAt':TIME}}
def events(session):
    if session != 'session-fixture': return [{'seq':0,'type':'assistant.message','at':TIME,'data':{'text':'另一对话 · 没有记忆'}}]
    return [{'seq':0,'type':'assistant.message','at':TIME,'data':{'text':'旧宿主回复 · 无记忆字段'}},
            {'seq':1,'type':'assistant.message','at':TIME,'data':{'text':'没有使用记忆的回复','memoryUsed':[]}},
            {'seq':2,'type':'artifact.created','at':TIME,'data':{'taskId':'cmd-fixture','artifactId':'artifact-new','fileName':'result.txt','contentType':'text/plain','size':len(BYTES)}},
            {'seq':3,'type':'assistant.message','at':TIME,'data':{'text':'我会用中文和买菜例子解释。','memoryUsed':[
                {'id':'memory-fixture','kind':'cognition','summary':'偏好中文与买菜例子'},
                {'id':'memory-forgotten','kind':'entity','summary':'曾经提到的朋友 · 当前已忘掉'}]}}]
def resource_use(call, seq, summary):
    return {'id':call,'callId':call,'seq':seq,'at':TIME,'summary':summary,'path':f'/sessions/session-fixture/events/{seq}/detail'}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self): self.route()
    def do_POST(self): self.route()
    def do_PATCH(self): self.route()
    def route(self):
        global state
        url = urlparse(self.path)
        path = url.path.removeprefix('/personal/v1')
        query = parse_qs(url.query)
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        state['requests'].append({'method': self.command, 'path': path, 'body': body})
        auth = {'account': {'ownerId': 'owner-fixture', 'username': 'a4b-tester', 'displayName': 'A4b 合成测试'},
                'device': {'id': 'device-fixture', 'name': '合成设备'}, 'csrfToken': 'b' * 43}
        status, headers = 200, {}
        if path == '/test/reset': state = reset(); result = {'reset': True}
        elif path == '/test/report': result = state
        elif path in ['/auth/login', '/auth/me']:
            result = auth
            if path == '/auth/login': headers['Set-Cookie'] = 'wm_personal_session=' + 'a' * 43
        elif path == '/status': result = {'ownerId': 'owner-fixture', 'hostId': 'host-fixture'}
        elif path == '/sync/capabilities': result = {'deviceId': 'device-fixture', 'platform': body.get('platform', 'ios'), 'sharedConversations': 1}
        elif path == '/sync/events': result = {'events': [], 'nextSeq': 0, 'hasMore': False}
        elif path == '/sessions': result = {'sessions': [{'sessionId': session, 'title': title, 'running': False, 'sendAvailable': True, 'modelProfileId': 'fixture'}
                                                         for session, title in [('session-fixture', 'A4b 输出与记忆'), ('session-other', '另一对话')]]}
        elif path == '/models': result = {'models': [{'id': 'fixture', 'name': '合成模型', 'model': 'fixture', 'configured': True}]}
        elif path == '/commands': result = {'commands': [], 'hasMore': False}
        elif path == '/settings/approvals':
            if self.command == 'PATCH': state['default'] = body['mode']
            result = {'mode': state['default']}
        elif path.endswith('/approval-mode'):
            session = path.split('/')[2]
            if self.command == 'PATCH': state['modes'][session] = body['mode']
            result = {'mode': state['modes'][session], 'allowedCategories': state['allowedCategories'] if session == 'session-fixture' else []}
        elif path.endswith('/resources'):
            after = int(query.get('afterSeq', ['-1'])[0])
            if 'session-other' in path: result = {'outputs': [], 'sources': [], 'nextSeq': max(after, 0), 'hasMore': False}
            else:
                uses = [resource_use('call-read-a', 10, '读取文件：notes.txt')] if after < 10 else [resource_use('call-read-a', 11, '读取文件：notes.txt'), resource_use('call-read-b', 12, '再次读取文件：notes.txt')]
                result = {'outputs':[artifact()], 'sources':[{'key':'tool:read','kind':'tool','name':'read','uses':uses}], 'nextSeq':10 if after < 10 else max(after, 12), 'hasMore':after < 10}
        elif '/events/' in path and path.endswith('/detail'):
            seq = int(path.split('/')[-2])
            result = {'seq':seq, 'text':'{\"arguments\": {\"path\": \"notes.txt\"}, \"output\": \"合成原始内容\"}', 'truncated': True}
        elif path == '/memory/items/cognition/memory-fixture/sources':
            result = {'worldRevision':1,'sources':[{'evidenceId':'evidence-fixture','relation':'supports','currentnessState':'current',
                'permissions':{'allowLocalRead':True,'allowCloudRead':False,'allowInference':True},'contentAvailable':True,
                'summary':'测试偏好','rawContent':'请以后用中文回答，技术问题用买菜的例子解释。','rawContentTruncated':False,'recordedAt':TIME}]}
        elif path == '/artifacts/artifact-new': result = {'artifact': artifact()}
        elif path == '/artifacts/artifact-new/download': result = BYTES
        elif path.endswith('/events'):
            rows = events(path.split('/')[2]); after = int(query.get('afterSeq', ['-1'])[0])
            result = {'events': [row for row in rows if row['seq'] > after], 'nextSeq': max(after, rows[-1]['seq']), 'hasMore': False, 'hasOlder': False}
        elif path.endswith('/approvals'):
            result = {'approvals': [approval(i) for i in range(min(3, len(state['decisions']) + 1))][::-1] if 'session-fixture' in path else [], 'hasMore': False}
        elif '/approvals/' in path and self.command == 'POST':
            aid = path.split('/')[-1]; index = IDS.index(aid)
            if body['outcome'] == 'rejected' and 'scope' in body: status = 400
            elif aid in state['decisions'] and state['decisions'][aid] != body: status = 409
            else:
                state['decisions'][aid] = body
                if body.get('scope') == 'conversation-category': state['allowedCategories'] = RISKS[index]
            result = {'approval': {**approval(index), 'status': 'answered'}, 'requestId': body['requestId']} if status == 200 else {'error': {'code': 'REQUEST_CONFLICT'}}
        elif path.endswith('/questions'): result = {'questions': [], 'hasMore': False}
        else: status, result = 404, {'error': {'code': 'NOT_FOUND'}}
        encoded = result if isinstance(result, bytes) else json.dumps(result, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        for key, value in headers.items(): self.send_header(key, value)
        self.end_headers(); self.wfile.write(encoded)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=18765)
    args = parser.parse_args()
    print(f'A4b synthetic fixture on localhost:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
