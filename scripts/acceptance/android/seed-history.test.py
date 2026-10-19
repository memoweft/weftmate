"""Exercise the actual fixture writer against a disposable driver transport."""
import copy
import json
import socketserver
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path


class SeedHistoryTest(unittest.TestCase):
    def test_seeds_stored_history_without_enqueuing_or_changing_pending_turns(self):
        for pending in [[], [dict(id='pending-synthetic-request', messages=[])]]:
            with self.subTest(pending=bool(pending)), tempfile.TemporaryDirectory(prefix='history-fixture-') as folder:
                original = dict(turns=pending, conversations=[dict(id='existing', turns=[])])
                saved = []

                class Driver(socketserver.StreamRequestHandler):
                    def handle(self):
                        request = json.loads(self.rfile.readline())
                        if request['method'] == 'phone.offline.load':
                            result = copy.deepcopy(original)
                        else:
                            saved.append(request['params']['value'])
                            result = {}
                        self.wfile.write((json.dumps(dict(ok=True, result=result)) + '\n').encode())

                with socketserver.TCPServer(('127.0.0.1', 0), Driver) as server:
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    try:
                        Path(folder, 'session.json').write_text(json.dumps(dict(forwardPort=server.server_address[1])))
                        subprocess.run(['python', str(Path(__file__).with_name('seed-history.py')), '--evidence', folder],
                                       check=True, capture_output=True, timeout=10)
                    finally:
                        server.shutdown()
                        thread.join(2)
                self.assertEqual(saved[0]['turns'], original['turns'])
                self.assertEqual(saved[0]['conversations'][0], original['conversations'][0])
                self.assertEqual(len(saved[0]['conversations'][-1]['turns']), 600)
                self.assertEqual(sum(len(t['messages']) for t in saved[0]['conversations'][-1]['turns']), 1200)


if __name__ == '__main__':
    unittest.main()
