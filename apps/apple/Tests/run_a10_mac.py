#!/usr/bin/env python3
"""One isolated native Mac process per theme: login, all settings, send, approval bar.
Uses the app's own accessibility objects and window capture; no global permissions.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--capture', type=Path, required=True)
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--theme', choices=['light', 'dark'])
parser.add_argument('--keychain', action='store_true', help='Use the existing signed app Keychain session instead of ephemeral capture credentials.')
args = parser.parse_args()
args.evidence.mkdir(parents=True, exist_ok=True)
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
source = subprocess.check_output(['git', 'diff', '--', 'apps/apple'], cwd=ROOT)
for theme in ([args.theme] if args.theme else ['light', 'dark']):
    with open('/private/tmp/a10-mac-fixture.log', 'w') as log:
        fixture = subprocess.Popen(['node', 'apps/apple/Tests/a5_cloud_fixture.mjs'], cwd=ROOT, stdout=subprocess.PIPE, stderr=log, text=True, env=os.environ | {'TMPDIR': '/private/tmp'})
        meta = None
        try:
            meta = json.loads(fixture.stdout.readline())
            def get(path):
                with urllib.request.urlopen(meta['driver'] + path, timeout=30) as response:
                    return json.load(response)
            get('/a5/setup'); get('/bootstrap'); get('/a8/prepare'); get('/a7/seed-archived')
            get('/a8/tools'); get('/a8/approvals')
            ready = get('/ready')
            destination = args.evidence / ('mac-' + theme)
            flags = ['a8'] + ([] if args.keychain else ['ephemeral'])
            capture = subprocess.Popen([str(args.capture.resolve()), str(args.app.resolve()), str(destination.resolve()), 'a10-all', theme, ready['host'], ready['cloud'], *flags], start_new_session=True)
            try:
                status = capture.wait(timeout=240)
                if status:
                    raise RuntimeError('Native Mac flow failed (exit ' + str(status) + ')')
            finally:
                if capture.poll() is None:
                    os.killpg(capture.pid, signal.SIGTERM)
                    try:
                        capture.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(capture.pid, signal.SIGKILL); capture.wait()
            native = json.loads((destination / 'native-report.json').read_text())
            expected = ['general', 'appearance', 'account', 'devices', 'usage', 'models', 'approvals', 'memory', 'schedules', 'archived', 'system', 'backups', 'about']
            assert set(native['categories']) == set(expected) and len(native['categories']) == 13
            report = get('/a5/report')
            sent = [row for row in report['operations'] if row.get('kind') == 'send' and row.get('text') == 'A10 合成排队消息']
            assert len(sent) == 1 and sent[0]['mode'] == 'queue', 'Native send must reach the real host exactly once'
            assert native['authenticated'] and native['sendPressed'] and native['approvalBar']
            screenshots = sorted(destination.glob('*.png'))
            assert len(screenshots) == 16
            validation = dict(native, platform='mac', theme=theme, commit=commit, workingDiffSHA256=hashlib.sha256(source).hexdigest(), generatedAt=datetime.now(timezone.utc).isoformat(), synthetic=True, realPersonalHost=True, realCloudMain=True, compiledDshEngine=False, credentialStorage='keychain' if args.keychain else 'ephemeral capture only', hostSendCount=len(sent), hostSendMode=sent[0]['mode'], screenshots=[{'file': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in screenshots])
            (destination / 'validation.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n')
            print('PASS Mac', theme, 'login; 13 native settings; native send with host acknowledgement; approval bar; 16 own-window screenshots', flush=True)
        finally:
            fixture.terminate()
            try:
                fixture.wait(timeout=20)
            except subprocess.TimeoutExpired:
                fixture.kill(); fixture.wait()
            if meta:
                shutil.rmtree(meta['root'], ignore_errors=True)
