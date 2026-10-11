#!/usr/bin/env python3
"""Capture only synthetic, app-owned Mac windows through the existing in-app AX runner."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for theme in ['light', 'dark']:
        namespace = 'diag3b-mac-' + str(uuid.uuid4())
        for state in ['empty', 'records', 'normal', 'read-failure']:
            command = [str(args.app.resolve() / 'Contents/MacOS/WeftMateMac'),
                       '-NSTreatUnknownArgumentsAsOpen', 'NO', '--ui-testing', '--apple-contract-fixture',
                       '--diag3-fixture', '--diag3-capture', '--ui-testing-namespace',
                       namespace if state != 'read-failure' else namespace + '-failure',
                       '--a5-theme', theme, '--diag3-expect', state]
            if state == 'read-failure':
                command += ['--diag3-read-failure']
            if state == 'empty':
                command += ['--diag3-hold']
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            row = {'state': state, 'theme': theme, 'captures': [], 'passed': False}
            try:
                for line in process.stdout:
                    if line.startswith('A10_CAPTURE:'):
                        _, scene, encoded = line.strip().split(':', 2)
                        name = f'mac-{scene}-{theme}.png'
                        (args.output / name).write_bytes(base64.b64decode(encoded))
                        row['captures'].append(name)
                    elif line.startswith('DIAG3_REPORT:'):
                        row.update(json.loads(line.split(':', 1)[1]))
                        if state == 'empty':
                            process.kill()  # Actual forced end, followed by same-namespace restart.
                    elif line.startswith('DIAG3_FAILURE:'):
                        row['failure'] = line.strip().split(':', 1)[1]
                row['exitCode'] = process.wait(timeout=30)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            rows.append(row)
            (args.output / 'mac-e2e.json').write_text(json.dumps({'checks': rows}, ensure_ascii=False, indent=2) + '\n')
            print(f"Mac {state} {theme}: {'PASS' if row['passed'] else 'FAIL'}; exit={row['exitCode']}", flush=True)
            if not row['passed'] or row['exitCode'] != (-9 if state == 'empty' else 0):
                return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
