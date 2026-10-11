#!/usr/bin/env python3
"""Capture the real simulator display outside XCTest's system-overlay suppression."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import uuid

BUNDLE = 'com.weftmate.apple.weftmatephone'


def run(*command):
    return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    subprocess.run(['xcrun', 'simctl', 'shutdown', 'all'], check=True)
    subprocess.run(['xcrun', 'simctl', 'boot', args.device], check=True)
    subprocess.run(['xcrun', 'simctl', 'bootstatus', args.device, '-b'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['xcrun', 'simctl', 'install', args.device, str(args.app)], check=True)
    container = Path(run('xcrun', 'simctl', 'get_app_container', args.device, BUNDLE, 'data'))
    captures = []

    def launch(scene, theme, namespace, extra=()):
        command = ['xcrun', 'simctl', 'launch', '--console-pty', args.device, BUNDLE,
                   '--ui-testing', '--apple-contract-fixture', '--diag3-fixture',
                   '--ui-testing-namespace', namespace, '--a5-theme', theme,
                   '--diag3-native-scene', scene, *extra]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        app_pid = None
        for line in process.stdout:
            match = re.search(re.escape(BUNDLE) + r': (\d+)', line)
            if match:
                app_pid = int(match.group(1))
            if 'DIAG3_NATIVE_READY' in line:
                return process, app_pid
        raise RuntimeError('Native fixture did not become ready: ' + scene)

    def stop(process, app_pid):
        # The simulator reports the actual host PID; this is only our isolated fixture app.
        if app_pid:
            try:
                os.kill(app_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            subprocess.run(['xcrun', 'simctl', 'terminate', args.device, BUNDLE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process.wait(timeout=15)

    def snapshot(scene, name, theme, source=None, extra=()):
        namespace = 'diag3b-native-' + str(uuid.uuid4())
        if source:
            shutil.copytree(source, container / 'tmp' / ('diag3-' + namespace))
        process, app_pid = launch(scene, theme, namespace, extra)
        try:
            subprocess.run(['xcrun', 'simctl', 'io', args.device, 'screenshot', str(args.output / (name + '-' + theme + '.png'))],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            captures.append(name + '-' + theme + '.png')
            print('Native display: ' + name + '-' + theme, flush=True)
        finally:
            stop(process, app_pid)
        return container / 'tmp' / ('diag3-' + namespace)

    try:
        for theme in ['light', 'dark']:
            forced = snapshot('about-empty', 'iphone-about-empty', theme)
            snapshot('empty', 'iphone-empty', theme)
            for scene, name, extra in [
                ('about-banner', 'iphone-banner', ()),
                ('about-records', 'iphone-about-records', ('--diag3-dismiss-notice',)),
                ('records', 'iphone-records', ()),
                ('detail', 'iphone-detail', ()),
                ('detail-raw', 'iphone-detail-raw', ()),
                ('summary', 'iphone-summary-preview', ()),
                ('summary-raw', 'iphone-summary-raw', ()),
                ('file', 'iphone-file-preview', ()),
                ('file-raw', 'iphone-file-raw', ()),
                ('system-share', 'iphone-system-share', ()),
                ('about-dismissed', 'iphone-banner-dismissed', ('--diag3-dismiss-notice',)),
            ]:
                snapshot(scene, name, theme, forced, extra)
            normal_ns = 'diag3b-native-' + str(uuid.uuid4())
            shutil.copytree(forced, container / 'tmp' / ('diag3-' + normal_ns))
            process, app_pid = launch('about-normal', theme, normal_ns, ('--diag3-clean-exit', '--diag3-dismiss-notice'))
            stop(process, app_pid)
            normal = container / 'tmp' / ('diag3-' + normal_ns)
            snapshot('about-normal', 'iphone-about-normal', theme, normal)
            snapshot('normal', 'iphone-normal', theme, normal)
            snapshot('about-read-failure', 'iphone-about-read-failure', theme, extra=('--diag3-read-failure',))
            snapshot('read-failure', 'iphone-read-failure', theme, extra=('--diag3-read-failure',))
            snapshot('file', 'iphone-empty-file-preview', theme)
            snapshot('watch', 'iphone-watch', theme, extra=('--diag3-watch-fixture',))
            snapshot('watch-detail', 'iphone-watch-detail', theme, extra=('--diag3-watch-fixture',))
        result = {'source': 'actual native simulator display outside XCTest; same final App and shared settings/preview views',
                  'captures': captures, 'syntheticOnly': True, 'realModelRequests': 0,
                  'seed': 'Copies only the isolated synthetic run-log directory after actual SIGKILL / durable synthetic clean exit; logging behavior unchanged.'}
        (args.output / 'native-display-captures.json').write_text(json.dumps(result, indent=2) + '\n')
    finally:
        subprocess.run(['xcrun', 'simctl', 'shutdown', 'all'], check=True)


if __name__ == '__main__':
    main()
