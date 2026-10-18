"""Append explicitly synthetic stored history. Restart the disposable APK afterward.

This prepares C4 data only; seeded replies are never model or chat acceptance evidence.
"""
import argparse
import json
import socket
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--evidence', type=Path, required=True)
args = parser.parse_args()
session = json.loads((args.evidence / 'session.json').read_text(encoding='utf-8-sig'))


def call(**request):
    with socket.create_connection(('127.0.0.1', session['forwardPort']), timeout=45) as connection:
        connection.sendall((json.dumps(request, ensure_ascii=False) + '\n').encode())
        result = json.loads(connection.makefile('r', encoding='utf-8').readline())
    if not result['ok']:
        raise RuntimeError(result['error'])
    return result['result']


value = call(action='call', method='phone.offline.load')
conversation = str(uuid.uuid4())
turns = [dict(id=str(uuid.uuid4()), conversationId=conversation, timestamp=int(time.time() * 1000) - 600000 + index * 1000,
              memoryRefs=[], dependencyComplete=True,
              messages=[dict(role='user', text=f'B2合成历史 USER-{index:04d}'), dict(role='assistant', text=f'B2合成历史 ANSWER-{index:04d}')])
         for index in range(600)]
# Top-level turns is the pending sync outbox; fixtures belong only to stored conversations.
value['conversations'] = value.get('conversations', []) + [dict(id=conversation, turns=turns)]
value['nativeComposer'] = dict(conversationId=conversation, draft='')
call(action='call', method='phone.offline.save', params=dict(value=value))
(args.evidence / 'c4-fixture.json').write_text(json.dumps(dict(conversationId=conversation, turns=600, messages=1200, kind='explicit synthetic stored history')), encoding='utf-8')
print('Prepared 1200 synthetic messages; restart before observation.')
