#!/usr/bin/env python3
"""A4c appearance fixture extends A4b, with a short running/completed timeline."""
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse
import argparse
import json
import a4b_fake_server as base

original_events = base.events
scenario = 'completed'

def events(session):
    if session != 'session-fixture': return original_events(session)
    if scenario == 'completed':
        return original_events(session) + [
            {'seq': 4, 'type': 'step.started', 'at': base.TIME, 'data': {
                'taskId': 'turn-visual', 'stepId': 'read-visual', 'callId': 'read-visual',
                'state': 'running', 'summary': '读取项目资料', 'toolName': 'read'}},
            {'seq': 5, 'type': 'step.completed', 'at': '2026-10-07T00:00:03Z', 'data': {
                'taskId': 'turn-visual', 'stepId': 'read-visual', 'callId': 'read-visual',
                'state': 'completed', 'summary': '读取项目资料', 'toolName': 'read'}},
            {'seq': 6, 'type': 'task.ended', 'at': base.TIME, 'data': {'taskId': 'turn-visual', 'reason': 'completed'}}]

    def event(seq, kind, data): return {'seq': seq, 'type': kind, 'at': base.TIME, 'data': data}
    return [event(0, 'user.message', {'text': '整理项目资料，列出接下来要做的事。'}),
            event(1, 'assistant.message', {'text': '先查看资料，再整理下一步。'}),
            event(2, 'task.started', {'taskId': 'turn-visual'}),
            event(3, 'step.started', {'taskId': 'turn-visual', 'stepId': 'read-visual', 'callId': 'read-visual',
                'state': 'running', 'summary': '读取项目资料', 'toolName': 'read'})]
base.events = events

class Handler(base.Handler):
    def route(self):
        global scenario
        if urlparse(self.path).path == '/personal/v1/sessions':
            data = json.dumps({'sessions': [
                {'sessionId': 'session-fixture', 'title': '整理项目资料', 'running': scenario == 'running',
                 'sendAvailable': True, 'modelProfileId': 'fixture'},
                {'sessionId': 'session-other', 'title': '准备下周的安排', 'running': False,
                 'sendAvailable': True, 'modelProfileId': 'fixture'}]}, ensure_ascii=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        elif urlparse(self.path).path == '/personal/v1/test/scenario':
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            scenario = body['scenario']
            base.state['modes']['session-fixture'] = body.get('mode', 'auto')
            self.send_response(200); self.send_header('Content-Length', '2'); self.end_headers(); self.wfile.write(b'{}')
        else: super().route()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=18766)
    args = parser.parse_args()
    print(f'A4c synthetic fixture on localhost:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
