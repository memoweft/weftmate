#!/usr/bin/env python3
"""Windows-invoked, synthetic native Apple captures in a dedicated checkout."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import time
import urllib.request
from datetime import datetime, timezone


def iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def booted():
    data = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'booted', '-j']))
    return [d['udid'] for devices in data['devices'].values() for d in devices if d['state'] == 'Booted']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--seconds', type=int, default=4500)
    parser.add_argument('--candidate', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9-]+', args.run_id) or not re.fullmatch(r'[a-f0-9]{40}', args.commit):
        parser.error('Invalid run identity')
    control = Path.home() / '.weftmate-orchestrator'
    root = control / ('nightly-' + args.run_id)
    root.mkdir(parents=True, exist_ok=True)
    gallery = root / 'gallery'
    gallery.mkdir(exist_ok=True)
    lock = control / 'nightly.lock'
    status = {'status': 'passed', 'reason': '', 'platformResults': {name: {'status': 'not-run'} for name in ['mac', 'iphone', 'watch']}}
    cleanup = {'createdDevices': [], 'deletedDevices': [], 'processesStopped': 0, 'bootedOwnedRemaining': []}
    tree = Path.home() / 'Desktop/WeftMate/weftmate-nightly'
    origin = Path.home() / 'Desktop/WeftMate/weftmate'
    owned_lock = False
    processes = []
    devices = []
    started = time.time()
    deadline = started + args.seconds
    env = {k: v for k, v in os.environ.items() if not re.match(r'^(WEFTMATE_|MEMOWEFT_|MIMO_|MODEL_SWITCH_|CLOUD_)', k)}
    temp = root / 'temporary'
    temp.mkdir(exist_ok=True)
    env['PATH'] = os.pathsep.join(['/opt/homebrew/bin', '/usr/local/bin', str(Path.home() / '.local/bin'), env.get('PATH', '/usr/bin:/bin:/usr/sbin:/sbin')])
    env['WEFTMATE_TEST_HOST_NAME'] = 'synthetic-host'
    env['TMPDIR'] = str(temp) + '/'

    def remaining():
        return max(1, deadline - time.time())

    def run(command, name='command', cwd=None, check=True, extra_env=None):
        if time.time() >= deadline:
            raise TimeoutError('整晚总时长超时')
        print('Start ' + name, flush=True)
        with (root / (name + '.log')).open('a') as log:
            child = subprocess.Popen([str(c) for c in command], cwd=cwd or tree,
                                     env={**env, **(extra_env or {})}, stdout=subprocess.PIPE,
                                     stderr=log, text=True)
            processes.append(child)
            output, _ = child.communicate(timeout=remaining())
            log.write(output)
            if check and child.returncode:
                raise RuntimeError(name + ' failed (exit ' + str(child.returncode) + ')')
            return output

    def fixture(file, name):
        log = (root / (name + '-fixture.log')).open('a')
        child = subprocess.Popen(['node', str(tree / file)], cwd=tree, env=env, stdout=subprocess.PIPE, stderr=log, text=True)
        processes.append(child)
        # Alarm/watchdog also bounds readiness before the first JSON line.
        for line in child.stdout:
            if line.startswith('{'):
                row = json.loads(line)
                if row.get('driver'):
                    return child, row
        raise RuntimeError('Fixture did not become ready')

    def stop(child):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            cleanup['processesStopped'] += 1

    def get(driver, path):
        with urllib.request.urlopen(driver + path, timeout=min(30, remaining())) as response:
            return json.load(response)

    def save(image, platform, scene, theme, captured_at, source):
        name = 'review-' + platform + '-' + scene + '-' + theme
        shutil.copyfile(image, gallery / (name + '.png'))
        (gallery / (name + '.json')).write_text(json.dumps({
            'platform': platform, 'scene': scene, 'theme': theme, 'file': name + '.png',
            'commit': args.commit, 'generatedAt': captured_at, 'synthetic': True, 'source': source,
        }, ensure_ascii=False, indent=2))

    def test(scheme, device, test_name, driver_env, name):
        products = root / ('Derived-' + scheme) / 'Build/Products'
        candidates = [p for p in products.glob('*.xctestrun') if 'nightly-private' not in p.name]
        if not candidates:
            raise RuntimeError('Missing built xctestrun')
        original = sorted(candidates, key=lambda p: p.stat().st_mtime)[-1]
        data = plistlib.loads(original.read_bytes())
        targets = ([target for conf in data.get('TestConfigurations', []) for target in conf.get('TestTargets', [])]
                   if 'TestConfigurations' in data else [v for k, v in data.items() if not k.startswith('__') and isinstance(v, dict)])
        for target in targets:
            target.setdefault('EnvironmentVariables', {}).update(driver_env)
        private = products / (name + '-nightly-private.xctestrun')
        private.write_bytes(plistlib.dumps(data))
        private.chmod(0o600)
        result = root / (name + '.xcresult')
        error = None
        try:
            run(['xcodebuild', 'test-without-building', '-xctestrun', private,
                 '-destination', 'platform=' + ('iOS Simulator' if scheme == 'WeftMatePhone' else 'watchOS Simulator') + ',id=' + device,
                 '-resultBundlePath', result, '-jobs', '2', '-parallel-testing-enabled', 'NO',
                 '-maximum-concurrent-test-simulator-destinations', '1', '-only-testing:' + scheme + 'UITests/' + test_name], name)
        except RuntimeError as exc:
            error = exc
        exported = root / (name + '-attachments')
        run(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', result, '--output-path', exported], name + '-export')
        manifest = json.loads((exported / 'manifest.json').read_text())
        attachments = []

        def walk(value):
            if isinstance(value, dict):
                if 'exportedFileName' in value:
                    attachments.append(value)
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(manifest)
        for item in attachments:
            label = item.get('suggestedHumanReadableName', item.get('name', ''))
            match = re.search(r'review-(iphone|watch)-(.+)-(light|dark)', label)
            if not match or not item['exportedFileName'].endswith('.png'):
                continue
            platform, scene, theme = match.groups()
            timestamp_label = 'nightly-time-' + platform + '-' + scene + '-' + theme
            timestamp = next((a for a in attachments if timestamp_label in a.get('suggestedHumanReadableName', a.get('name', ''))), None)
            if not timestamp:
                raise RuntimeError('Screenshot lacks actual capture timestamp')
            captured_at = (exported / timestamp['exportedFileName']).read_text().strip()
            save(exported / item['exportedFileName'], platform, scene, theme, captured_at,
                 'native XCUITest + isolated synthetic host' if platform == 'iphone' else 'paired Watch XCUITest + isolated synthetic host')
        if error:
            raise error

    def platform_started(platform):
        if status['platformResults'][platform]['status'] == 'not-run':
            status['platformResults'][platform] = {'status': 'passed'}

    def platform_failed(platform, reason):
        status.update(status='failed')
        status.setdefault('failures', []).append(reason)
        status['reason'] = '; '.join(status['failures'])
        result = status['platformResults'][platform]
        result.update(status='failed', reason='; '.join(filter(None, [result.get('reason'), reason])))

    def capture_failure(platform, scene, theme, exc):
        reason = str(exc)
        platform_failed(platform, platform + '/' + scene + '/' + theme + ': ' + reason)
        name = 'review-' + platform + '-' + scene + '-' + theme
        (gallery / (name + '.json')).write_text(json.dumps({
            'platform': platform, 'scene': scene, 'theme': theme,
            'status': 'failed', 'reason': reason, 'commit': args.commit,
            'generatedAt': iso(), 'synthetic': True,
        }, ensure_ascii=False))

    def alarm(signum, frame):
        raise TimeoutError('整晚总时长超时或控制端已停止')
    for signum in [signal.SIGALRM, signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
        signal.signal(signum, alarm)
    signal.alarm(max(1, args.seconds))
    try:
        # A development package is using the Mac when a Codex session or a build is running.
        developing = any(subprocess.run(['pgrep', *flags, name], capture_output=True).returncode == 0
                         for flags, name in ((['-f'], 'codex -m'), (['-x'], 'xcodebuild')))
        if developing or booted():
            status.update(status='skipped', reason='被占用，未拍（开发包或 Apple 模拟器）')
            return
        try:
            lock.mkdir()
            owned_lock = True
            (lock / 'owner.json').write_text(json.dumps({'runId': args.run_id, 'startedAt': iso()}))
        except FileExistsError:
            status.update(status='skipped', reason='被占用，未拍（Mac 夜间锁）')
            return
        # Repeat after acquiring the lock, never take an already booted simulator.
        if booted():
            status.update(status='skipped', reason='被占用，未拍（Apple 模拟器）')
            return
        missing = [tool for tool in ['node', 'npm', 'git', 'python3', 'xcrun', 'xcodebuild', 'swiftc'] if not shutil.which(tool, path=env['PATH'])]
        if missing:
            raise FileNotFoundError('所需工具找不到：' + ', '.join(missing))
        run(['git', 'fetch', 'origin', 'main'], 'fetch', origin)
        if args.candidate:
            run(['git', 'fetch', root / 'candidate.bundle', 'HEAD'], 'candidate-fetch', origin)
        if not tree.exists():
            run(['git', 'worktree', 'add', '--detach', tree, args.commit], 'worktree', origin)
        if run(['git', 'status', '--porcelain'], 'tree-status').strip():
            raise RuntimeError('专用 Mac 回归工作树存在未提交修改')
        run(['git', 'checkout', '--detach', args.commit], 'checkout')
        run(['npm', 'ci'], 'npm')
        run(['npm', 'ci'], 'cloud-npm', tree / 'services/cloud')
        run(['python3', 'Scripts/generate_project.py'], 'project', tree / 'apps/apple')
        runtimes = json.loads(run(['xcrun', 'simctl', 'list', 'runtimes', '-j'], 'runtimes'))['runtimes']
        types = json.loads(run(['xcrun', 'simctl', 'list', 'devicetypes', '-j'], 'types'))['devicetypes']
        phone_runtime = next(r['identifier'] for r in reversed(runtimes) if r.get('isAvailable') and r['name'].startswith('iOS'))
        watch_runtime = next(r['identifier'] for r in reversed(runtimes) if r.get('isAvailable') and r['name'].startswith('watchOS'))
        phone_type = next(t['identifier'] for t in types if t['name'].startswith('iPhone 17') and 'Pro' not in t['name'])
        watch_type = next(t['identifier'] for t in types if t['name'].startswith('Apple Watch Series 11'))
        phone = run(['xcrun', 'simctl', 'create', 'Nightly-' + args.run_id + '-Phone', phone_type, phone_runtime], 'phone-create').strip()
        devices.append(phone)
        watch = run(['xcrun', 'simctl', 'create', 'Nightly-' + args.run_id + '-Watch', watch_type, watch_runtime], 'watch-create').strip()
        devices.append(watch)
        cleanup['createdDevices'] = devices[:]
        for scheme, destination in [('WeftMateMac', 'platform=macOS'), ('WeftMatePhone', 'platform=iOS Simulator,id=' + phone), ('WeftMateWatch', 'platform=watchOS Simulator,id=' + watch)]:
            run(['xcodebuild', '-project', 'apps/apple/WeftMate.xcodeproj', '-scheme', scheme,
                 '-configuration', 'Debug', '-destination', destination, '-derivedDataPath', root / ('Derived-' + scheme),
                 '-jobs', '2', 'build' if scheme == 'WeftMateMac' else 'build-for-testing'], 'build-' + scheme)
        capture = root / 'mac-capture'
        run(['swiftc', '-parse-as-library', 'apps/apple/Tests/A5MacCapture.swift', '-o', capture], 'capture-build')
        executable = root / 'Derived-WeftMateMac/Build/Products/Debug/WeftMateMac.app/Contents/MacOS/WeftMateMac'
        native_scenes = ['login', 'sessions', 'conversation', 'approval', 'question', 'outputs-sources', 'memory', 'appearance', 'composer-context', 'session-menu', 'usage', 'general', 'onboarding']
        for theme in ['light', 'dark']:
            child, info = fixture('apps/apple/Tests/a5_cloud_fixture.mjs', 'a5-' + theme)
            try:
                driver = info['driver']
                get(driver, '/a5/setup')
                get(driver, '/bootstrap')
                ready = get(driver, '/ready')
                platform_started('mac')
                for scene in native_scenes:
                    image = root / ('mac-' + scene + '-' + theme + '.png')
                    native_scene = {'general': 'settings-general', 'onboarding': 'settings-devices'}.get(scene, scene)
                    try:
                        run([capture, executable, image, native_scene, theme, ready['host'], ready['cloud'], 'ephemeral'], 'mac-' + scene + '-' + theme)
                        captured_at = datetime.fromtimestamp(image.stat().st_mtime, timezone.utc).isoformat().replace('+00:00', 'Z')
                        save(image, 'mac', scene, theme, captured_at, 'native own-window AX (A10/A15 runner) + synthetic host')
                    except RuntimeError as exc:
                        capture_failure('mac', scene, theme, exc)
                platform_started('iphone')
                run(['xcrun', 'simctl', 'boot', phone], 'phone-boot')
                run(['xcrun', 'simctl', 'bootstatus', phone, '-b'], 'phone-ready')
                try:
                    test('WeftMatePhone', phone, 'A5ParityUITests/testNightly' + theme.title() + 'Gallery', {'WEFTMATE_A5_DRIVER': driver}, 'iphone-' + theme)
                except RuntimeError as exc:
                    platform_failed('iphone', str(exc))
                finally:
                    run(['xcrun', 'simctl', 'shutdown', phone], 'phone-shutdown', check=False)
            finally:
                stop(child)
            child, info = fixture('apps/apple/Tests/a15_fixture.mjs', 'a15-' + theme)
            try:
                ready = get(info['driver'], '/ready')
                folder = root / ('a15-' + theme)
                run([capture, executable, folder, 'a15-all', theme, ready['host'], ready['host'], 'ephemeral', 'a15-driver=' + info['driver']], 'mac-a15-' + theme)
                captured_at = datetime.fromtimestamp((folder / 'plus-menu.png').stat().st_mtime, timezone.utc).isoformat().replace('+00:00', 'Z')
                save(folder / 'plus-menu.png', 'mac', 'composer-menu', theme, captured_at, 'A15 native own-window AX + synthetic host')
            except RuntimeError as exc:
                capture_failure('mac', 'composer-menu', theme, exc)
            finally:
                stop(child)
        pair = run(['xcrun', 'simctl', 'pair', watch, phone], 'pair').strip()
        for theme in ['light', 'dark']:
            child, info = fixture('apps/apple/Tests/a12_fixture.mjs', 'a12-' + theme)
            try:
                ready = get(info['driver'], '/ready')
                platform_started('watch')
                run(['xcrun', 'simctl', 'boot', phone], 'paired-phone-boot')
                run(['xcrun', 'simctl', 'bootstatus', phone, '-b'], 'paired-phone-ready')
                app = root / 'Derived-WeftMatePhone/Build/Products/Debug-iphonesimulator/WeftMatePhone.app'
                run(['xcrun', 'simctl', 'install', phone, app], 'paired-phone-install')
                run(['xcrun', 'simctl', 'launch', phone, 'com.weftmate.apple.weftmatephone', '--ui-testing', '--ui-testing-namespace', 'nightly-' + args.run_id + '-' + theme, '--a5-local-server', '--a10-ephemeral-credentials', '--server-url', ready['host'], '--a12-live-session', ready['sessionID']], 'paired-phone-launch')
                # A paired Watch needs its companion iPhone booted; never another pair.
                run(['xcrun', 'simctl', 'boot', watch], 'watch-boot')
                run(['xcrun', 'simctl', 'bootstatus', watch, '-b'], 'watch-ready')
                test('WeftMateWatch', watch, 'A13WatchUITests/testNightly' + theme.title() + 'Approval', {'WEFTMATE_A12_DRIVER': info['driver']}, 'watch-' + theme)
            except RuntimeError as exc:
                platform_failed('watch', str(exc))
            finally:
                for device in [watch, phone]:
                    if device in booted():
                        run(['xcrun', 'simctl', 'shutdown', device], 'paired-shutdown', check=False)
                stop(child)
        run(['xcrun', 'simctl', 'unpair', pair], 'unpair', check=False)
    except Exception as exc:
        # Public gallery metadata must never include a machine path from OSError.
        reason = re.sub(r'/(?:Users|private|var|tmp)/[^\s\x27\x22]+', '[local artifact]', str(exc))
        status.update(status='environment' if isinstance(exc, FileNotFoundError) else 'failed', reason=reason)
    finally:
        signal.alarm(0)
        for signum in [signal.SIGTERM, signal.SIGHUP, signal.SIGINT]:
            signal.signal(signum, signal.SIG_IGN)
        for child in reversed(processes):
            stop(child)
        # Interrupted Swift capture helpers may leave their native app alive.
        # 4c requires start time + executable + this run's command path, not PPID.
        rows = subprocess.check_output(['ps', '-axo', 'pid=,lstart=,comm=,args='], text=True)
        for line in rows.splitlines():
            parts = line.strip().split(None, 7)
            if len(parts) != 8:
                continue
            pid, date_parts, executable, command = parts[0], parts[1:6], parts[6], parts[7]
            try:
                created = datetime.strptime(' '.join(date_parts), '%a %b %d %H:%M:%S %Y').timestamp()
            except ValueError:
                continue
            if created < int(started) or Path(executable).name not in ['WeftMateMac', 'node', 'xcodebuild', 'swift-frontend', 'swiftc']:
                continue
            if not any(re.search(re.escape(str(path)) + r'(?=[/\s\x22\x27]|$)', command) for path in [root, tree]):
                continue
            # Re-read the complete identity immediately before sending SIGTERM.
            current = subprocess.run(['ps', '-p', pid, '-o', 'pid=,lstart=,comm=,args='], capture_output=True, text=True)
            if current.stdout.strip() != line.strip():
                continue
            try:
                os.kill(int(pid), signal.SIGTERM)
                cleanup['processesStopped'] += 1
            except ProcessLookupError:
                pass
        if owned_lock:
            active = booted()
            # Global shutdown only while every booted device belongs to this run.
            if active and set(active).issubset(set(devices)):
                subprocess.run(['xcrun', 'simctl', 'shutdown', 'all'], timeout=30, capture_output=True)
            else:
                for device in devices:
                    if device in active:
                        subprocess.run(['xcrun', 'simctl', 'shutdown', device], timeout=30, capture_output=True)
            for device in reversed(devices):
                result = subprocess.run(['xcrun', 'simctl', 'delete', device], timeout=30, capture_output=True)
                if result.returncode == 0:
                    cleanup['deletedDevices'].append(device)
            cleanup['bootedOwnedRemaining'] = [d for d in booted() if d in devices]
            shutil.rmtree(lock)
        shutil.rmtree(temp, ignore_errors=True)
        cleanup['elapsedSeconds'] = round(time.time() - started, 3)
        (root / 'cleanup.json').write_text(json.dumps(cleanup, indent=2))
        (root / 'status.json').write_text(json.dumps(status, ensure_ascii=False))
        print(json.dumps(status, ensure_ascii=False), flush=True)
        # Status is collected even on native test failure, preserving partial PNGs.


if __name__ == '__main__':
    main()
