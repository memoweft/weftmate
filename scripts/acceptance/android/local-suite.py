"""Drive an already configured disposable APK. Save observations, never infer a pass from an issued action."""
import argparse
import json
import socket
import subprocess
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--adb', required=True)
    parser.add_argument('--phase', choices=['pages', 'chat', 'memory'], required=True)
    args = parser.parse_args()
    session = json.loads((args.evidence / 'session.json').read_text(encoding='utf-8-sig'))
    adb = [args.adb, '-s', session['serial']]

    def call(action, **params):
        with socket.create_connection(('127.0.0.1', session['forwardPort']), timeout=45) as connection:
            connection.sendall((json.dumps(dict(action=action, **params), ensure_ascii=False) + '\n').encode())
            response = json.loads(connection.makefile('r', encoding='utf-8').readline())
        if not response.get('ok'):
            raise RuntimeError(response.get('error', 'driver error'))
        return response['result']

    def save(name, value):
        (args.evidence / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

    def state(name):
        value = call('state')
        save(name, value)
        return value

    def idle(name, timeout=120):
        deadline = time.monotonic() + timeout
        time.sleep(1)
        while time.monotonic() < deadline:
            value = call('state')
            if not value['running']:
                save(name, value)
                return value
            time.sleep(.3)
        save(name, value)
        raise TimeoutError(name)

    def shot(name):
        call('shot', name=name)
        output = subprocess.check_output(adb + ['exec-out', 'run-as', session['package'], 'cat', f'files/{name}.png'], timeout=20)
        (args.evidence / f'{name}.png').write_bytes(output)

    def new():
        call('new')
        time.sleep(.5)

    # The instrumentation port exists before account bootstrap finishes.
    # Do not issue conversation mutations until the ordinary app is ready.
    ready_deadline = time.monotonic() + 60
    while time.monotonic() < ready_deadline:
        initial = call('state')
        if initial['loggedIn'] and not initial['loading']:
            break
        time.sleep(.2)
    else:
        save('suite-startup-blocked', initial)
        raise TimeoutError('Application bootstrap is not ready')

    if args.phase == 'pages':
        for theme in ['light', 'dark']:
            call('theme', value=theme)
            for page, label in [('chat', '聊天'), ('activity', '动态'), ('health', '健康'), ('goals', '目标'), ('library', '成果库')]:
                call('page', name='chat')
                call('clickLabel', label=label)
                time.sleep(.5)
                save(f'u1-{page}-{theme}-tree', call('tree'))
                shot(f'u1-{page}-{theme}')
            call('page', name='chat')
            call('clickLabel', label='打开侧栏')
            shot(f'u1-sidebar-{theme}')
            call('clickLabel', label='关闭侧栏')
            call('settings', name='')
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if '搜索设置' in call('tree')['tree']:
                    break
                time.sleep(.2)
            save(f'u1-settings-{theme}-tree', call('tree'))
            shot(f'u1-settings-{theme}')
        call('page', name='chat')

    if args.phase == 'chat':
        call('page', name='chat')
        new()
        call('send', text='请从1开始逐行输出到1000，每行一个数，不要省略。')
        time.sleep(2)
        state('c3-running')
        call('send', text='B2排队第二条：只回答QUEUE-OK。')
        state('c3-queued')
        started = time.monotonic()
        call('stop')
        idle('c3-stopped', 10)
        save('c3-stop-time', {'seconds': time.monotonic() - started})
        shot('c3-stopped')
        new()
        for text in ['第一条B2：用300字说明水循环，结尾写FIRST。', '第二条B2：只回答SECOND。', '第三条B2：只回答THIRD。']:
            call('send', text=text)
            time.sleep(1.5)
        idle('c7-final')
        shot('c7-final')
        new()
        call('send', text='请写一篇1200字中文文章，说明海洋形成过程。')
        time.sleep(2)
        state('c6-streaming')
        call('clickLabel', label='健康')
        time.sleep(2)
        call('clickLabel', label='聊天')
        idle('c6-complete')
        shot('c6-complete')

    if args.phase == 'memory':
        call('page', name='chat')
        new()
        call('send', text='记住我喜欢喝红茶。')
        idle('m1-stated')
        time.sleep(25)
        save('m1-vault', call('call', method='phone.offline.load'))
        new()
        call('send', text='我喜欢喝什么？')
        idle('m1-new-chat')
        shot('m1-new-chat')
        call('send', text='我其实更喜欢绿茶，请记住这个纠正。')
        idle('m2-stated')
        time.sleep(25)
        new()
        call('send', text='我喜欢喝什么？')
        idle('m2-new-chat')
        call('send', text='请忘掉我的饮品偏好。')
        idle('m7-forget-reply')
        save('m7-vault', call('call', method='phone.offline.load'))
        shot('m7-forget-reply')


if __name__ == '__main__':
    main()
