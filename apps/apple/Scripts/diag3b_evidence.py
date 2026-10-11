#!/usr/bin/env python3
"""Publish only named synthetic DIAG-3b captures, preserving complete native PNGs."""
import argparse
import json
import re
from pathlib import Path
import shutil
import struct
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phone-attachments', required=True, type=Path)
    parser.add_argument('--mac', required=True, type=Path)
    parser.add_argument('--phone-native', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--comparator', required=True, type=Path)
    parser.add_argument('--home-indicator-present', action='store_true',
                        help='Set only after verifying the native bottom indicator in every iPhone capture.')
    args = parser.parse_args()
    pending = {}
    manifest = json.loads((args.phone_attachments / 'manifest.json').read_text())
    for case in manifest:
        for item in case['attachments']:
            name = item['suggestedHumanReadableName']
            if name.startswith('iphone-') and item['exportedFileName'].endswith('.png'):
                stem = re.sub(r'_\d+_[0-9A-Fa-f-]{36}\.png$', '', name).removesuffix('.png')
                if item['isAssociatedWithFailure']:
                    raise RuntimeError('Refuse a failure-associated capture: ' + stem)
                native = args.phone_native / (stem + '.png')
                assert native.exists(), 'Missing real simulator display capture: ' + stem
                pending[stem + '.png'] = native
    for path in args.mac.glob('mac-*.png'):
        pending[path.name] = path
    for theme in ['light', 'dark']:
        for platform in ['iphone', 'mac']:
            for state in ['empty', 'records', 'read-failure']:
                assert f'{platform}-{state}-{theme}.png' in pending
            for state in ['empty', 'records', 'normal']:
                assert f'{platform}-about-{state}-{theme}.png' in pending
            for state in ['banner', 'detail']:
                assert f'{platform}-{state}-{theme}.png' in pending
        for state in ['summary-preview', 'file-preview', 'system-share', 'watch']:
            assert f'iphone-{state}-{theme}.png' in pending
        for state in ['summary-preview-records', 'file-preview-records']:
            assert f'mac-{state}-{theme}.png' in pending
    args.output.mkdir(parents=True, exist_ok=True)
    for path in args.output.glob('*.png'):
        path.unlink()
    for name, source in pending.items():
        shutil.copyfile(source, args.output / name)
    for theme in ['light', 'dark']:
        for platform in ['iphone', 'mac']:
            command = [str(args.comparator.resolve()), str(args.output / f'{platform}-about-records-{theme}.png'),
                       str(args.output / f'{platform}-records-{theme}.png'), str(args.output / f'{platform}-about-and-run-log-{theme}.png')]
            subprocess.run(command, check=True)
    captures = []
    for path in sorted(args.output.glob('*.png')):
        data = path.read_bytes()
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        width, height = struct.unpack('>II', data[16:24])
        captures.append({'name': path.name, 'width': width, 'height': height,
                         'theme': 'dark' if 'dark' in path.name else 'light',
                         'source': 'native side-by-side without resizing' if 'about-and-run-log' in path.name else 'simctl whole-screen display outside XCTest, same App in synthetic scene independently verified by XCTest' if path.name.startswith('iphone') else 'app-owned native Settings window including titlebar and open sheet panels'})
    result = {'package': 'DIAG-3b', 'captures': captures, 'iphoneFullScreen': True,
              'iphoneSystemStatusBar': True, 'iphoneSystemHomeIndicator': args.home_indicator_present,
              'iphoneSystemStatusAndHomeIndicator': args.home_indicator_present,
              'homeIndicatorLimitation': None if args.home_indicator_present else 'The simulator omitted the bottom indicator even outside XCTest. Full native PNGs are preserved; no indicator was drawn or overlaid. This acceptance item remains incomplete.',
              'macOwnWindowsWithTitlebar': True, 'themes': ['light', 'dark'],
              'states': ['empty', 'records', 'normal', 'read_failure', 'previous_unclean_notice',
                         'summary_preview_open', 'file_preview_open', 'system_share_open', 'detail_open', 'watch_records'],
              'syntheticOnly': True, 'realModelRequests': 0,
              'comparison': 'About left, Run Log right. Both original full captures, native resolution, no cropping or masks.'}
    (args.output / 'screenshots.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f"Published {len(captures)} native/comparison captures")


if __name__ == '__main__':
    main()
