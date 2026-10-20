"""Prepare 1200 labelled fixture messages through the real WebView persistence bridge.

Only setup metadata and acknowledgements are written. Never treat seeded replies as
chat/model evidence; require a read-back before attempting the C4 pagination scene.
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
        response = json.loads(connection.makefile('r', encoding='utf-8').readline())
    if not response['ok']:
        raise RuntimeError(response['error'])
    return response['result']


def web(script):
    value = call(action='web', script=script)['value']
    for _ in range(2):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            break
    return value


# The live phone engine owns a cached archive. Detach it before preparing a
# fixture through the persistence bridge, otherwise its next composer/memory
# save can overwrite the fixture with the older archive during cold shutdown.
# clear() closes the active engine without deleting its stored account archive.
web("(()=>{if(!WeftPhone.active)throw Error('ActiveStandalonePhoneRequired');"
    "window.b2HistoryDetached=false;WeftPhone.clear().then(()=>window.b2HistoryDetached=true);return true})()")
detach_deadline = time.monotonic() + 15
while not web('window.b2HistoryDetached === true'):
    if time.monotonic() > detach_deadline:
        raise TimeoutError('Could not detach the active phone engine')
    time.sleep(.1)
time.sleep(.5)
value = call(action='call', method='phone.offline.load')
conversation = str(uuid.uuid4())
turns = [dict(id=str(uuid.uuid4()), conversationId=conversation,
              timestamp=int(time.time() * 1000) - 600000 + i * 1000,
              memoryRefs=[], dependencyComplete=True,
              messages=[dict(role='user', text=f'B2合成历史 USER-{i:04d}'),
                        dict(role='assistant', text=f'B2合成历史 ANSWER-{i:04d}')])
         for i in range(600)]
value['conversations'] = value.get('conversations', []) + [dict(id=conversation, turns=turns)]
value['nativeComposer'] = dict(conversationId=conversation, draft='')
payload = json.dumps(dict(value=value), ensure_ascii=False)
web("(()=>{window.b2HistoryAck={pending:true};androidBridge.call('phone.offline.save',"
    + payload + ").then(()=>window.b2HistoryAck={saved:true})"
    + ".catch(e=>window.b2HistoryAck={failed:true,code:String(e.code||e.name)});return true})()")
deadline = time.monotonic() + 45
while time.monotonic() < deadline:
    ack = web('JSON.stringify(window.b2HistoryAck)')
    if not ack.get('pending'):
        break
    time.sleep(.5)
readback = call(action='call', method='phone.offline.load')
stored = next((c for c in readback.get('conversations', []) if c['id'] == conversation), None)
result = dict(conversationId=conversation, intendedTurns=600, intendedMessages=1200,
              bridgeBytes=len(payload.encode('utf-8')), acknowledgement=ack,
              persistedTurns=len(stored['turns']) if stored else 0,
              kind='explicit synthetic stored history; not model responses')
(args.evidence / 'c4-write-readback.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
