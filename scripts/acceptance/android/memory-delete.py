"""Isolate memory deletion from automatic formation, using the real memory editor."""
import argparse
import json
import socket
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--adb', required=True)
args = parser.parse_args()
session = json.loads((args.evidence / 'session.json').read_text(encoding='utf-8-sig'))


def call(action, **params):
    with socket.create_connection(('127.0.0.1', session['forwardPort']), timeout=45) as connection:
        connection.sendall((json.dumps(dict(action=action, **params), ensure_ascii=False) + '\n').encode())
        response = json.loads(connection.makefile('r', encoding='utf-8').readline())
    if not response['ok']:
        raise RuntimeError(response['error'])
    return response['result']


def web(script):
    value = call('web', script=script)['value']
    for _ in range(2):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            break
    return value


def save(name, value):
    (args.evidence / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def click(text):
    result = web(f'(()=>{{const b=[...document.querySelectorAll("button")].find(e=>e.innerText.trim()==={json.dumps(text)});if(!b)return false;b.click();return true}})()')
    if result is not True:
        raise RuntimeError('Missing visible button: ' + text)
    time.sleep(.3)


def add():
    call('settings', name='memory')
    time.sleep(.5)
    click('添加记忆')
    web('(()=>{const e=document.querySelector("textarea[aria-label=值得记住的事]");e.value="我喜欢喝红茶。";e.dispatchEvent(new Event("input",{bubbles:true}));return true})()')
    click('保存')
    time.sleep(.5)


def idle(name):
    deadline = time.monotonic() + 120
    time.sleep(1)
    while time.monotonic() < deadline:
        state = call('state')
        if not state['running']:
            save(name, state)
            return state
        time.sleep(.3)
    raise TimeoutError(name)


add()
before = web('JSON.stringify(WeftPhone.memory)')
save('m3-manual-item-before', before)
assert any('红茶' in row['text'] for row in before['items'])
web('document.querySelector("button[aria-label^=记忆的更多操作]").click();true')
click('忘掉')
click('确认忘掉')
after = web('JSON.stringify(WeftPhone.memory)')
save('m3-page-forgot', after)
call('page', name='chat')
call('new')
time.sleep(.5)
call('send', text='我喜欢喝什么？')
idle('m3-new-chat')
save('m3-retained-original', call('call', method='phone.offline.load'))
add()
save('m7-manual-item-before', web('JSON.stringify(WeftPhone.memory)'))
call('page', name='chat')
call('new')
time.sleep(.5)
call('send', text='请忘掉我喜欢喝红茶这个饮品偏好。')
idle('m7-with-item-reply')
time.sleep(25)
save('m7-with-item-vault', call('call', method='phone.offline.load'))
call('settings', name='memory')
time.sleep(.5)
save('m7-with-item-page', web('JSON.stringify({memory:WeftPhone.memory,text:document.getElementById("page-content").innerText})'))
call('shot', name='m7-with-item-page')
image = subprocess.check_output([args.adb, '-s', session['serial'], 'exec-out', 'run-as', session['package'], 'cat', 'files/m7-with-item-page.png'], timeout=20)
(args.evidence / 'm7-with-item-page.png').write_bytes(image)
call('page', name='chat')
call('new')
time.sleep(.5)
call('send', text='我喜欢喝什么？')
idle('m7-after-forget-new-chat')
