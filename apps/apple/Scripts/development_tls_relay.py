#!/usr/bin/env python3
"""Temporary, loopback-only CONNECT relay for the existing HTTPS test origin.

TLS is negotiated end to end by the client; this script never decrypts it.
The only allowed authority is home.weftmate.com:8443, forwarded to the existing
LAN HTTPS listener. It logs no request headers, payloads, cookies, or credentials.
Ctrl-C or the bounded TTL closes the listener and every active connection.
"""
import argparse
import json
import os
import select
import socket
import socketserver
import threading
import time

AUTHORITY = "home.weftmate.com:8443"
UPSTREAM = ("192.168.31.91", 443)
HEADER_LIMIT = 16 * 1024
BUFFER_LIMIT = 256 * 1024


class RelayServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, ttl):
        super().__init__(address, ConnectHandler)
        self.deadline = time.monotonic() + ttl
        self.lock = threading.Lock()
        self.active = set()
        self.counts = {"accepted": 0, "denied": 0, "completed": 0, "failed": 0}

    def track(self, sock):
        with self.lock:
            self.active.add(sock)

    def untrack(self, sock):
        with self.lock:
            self.active.discard(sock)

    def count(self, name):
        with self.lock:
            self.counts[name] += 1

    def close_active(self):
        with self.lock:
            active = list(self.active)
        for sock in active:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()

    def handle_error(self, request, client_address):
        # Deliberately do not print request data or exception diagnostics.
        self.count("failed")


class ConnectHandler(socketserver.BaseRequestHandler):
    def reply(self, status):
        self.request.sendall(("HTTP/1.1 " + status + "\r\nConnection: close\r\n"
                              "Content-Length: 0\r\n\r\n").encode("ascii"))

    def read_header(self):
        data = bytearray()
        deadline = min(self.server.deadline, time.monotonic() + 5)
        while b"\r\n\r\n" not in data:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            self.request.settimeout(remaining)
            chunk = self.request.recv(min(4096, HEADER_LIMIT + 1 - len(data)))
            if not chunk:
                raise ConnectionError()
            data.extend(chunk)
            if len(data) > HEADER_LIMIT:
                raise ValueError()
        header, remainder = bytes(data).split(b"\r\n\r\n", 1)
        lines = header.decode("ascii").split("\r\n")
        if lines[0].split(" ") not in [
                ["CONNECT", AUTHORITY, "HTTP/1.1"],
                ["CONNECT", AUTHORITY, "HTTP/1.0"]]:
            return None
        if any(not line or line.startswith((" ", "\t")) or ":" not in line
               for line in lines[1:]):
            raise ValueError()
        return remainder

    def forward(self, upstream, initial):
        client = self.request
        client.setblocking(False)
        upstream.setblocking(False)
        peers = {client: upstream, upstream: client}
        pending = {client: bytearray(), upstream: bytearray(initial)}
        readable = set(peers)
        connection_deadline = min(self.server.deadline, time.monotonic() + 120)
        idle_deadline = time.monotonic() + 45
        while readable or any(pending.values()):
            remaining = min(connection_deadline, idle_deadline) - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            reads = [sock for sock in readable if len(pending[peers[sock]]) < BUFFER_LIMIT]
            writes = [sock for sock in peers if pending[sock]]
            incoming, outgoing, exceptional = select.select(reads, writes, list(peers), min(remaining, 1))
            if exceptional:
                raise ConnectionError()
            for sock in incoming:
                try:
                    chunk = sock.recv(min(65536, BUFFER_LIMIT - len(pending[peers[sock]])))
                except BlockingIOError:
                    continue
                if chunk:
                    pending[peers[sock]].extend(chunk)
                    idle_deadline = time.monotonic() + 45
                else:
                    readable.discard(sock)
                    if not pending[peers[sock]]:
                        try:
                            peers[sock].shutdown(socket.SHUT_WR)
                        except OSError:
                            pass
            for sock in outgoing:
                try:
                    sent = sock.send(pending[sock])
                except BlockingIOError:
                    continue
                if sent <= 0:
                    raise ConnectionError()
                del pending[sock][:sent]
                idle_deadline = time.monotonic() + 45
                if not pending[sock] and peers[sock] not in readable:
                    try:
                        sock.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass

    def handle(self):
        upstream = None
        self.server.track(self.request)
        try:
            remainder = self.read_header()
            if remainder is None:
                self.server.count("denied")
                self.reply("403 Forbidden")
                return
            upstream = socket.create_connection(UPSTREAM, timeout=8)
            self.server.track(upstream)
            self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            self.server.count("accepted")
            self.forward(upstream, remainder)
            self.server.count("completed")
        except (OSError, ValueError, UnicodeError):
            self.server.count("failed")
            if upstream is None:
                try:
                    self.reply("502 Bad Gateway")
                except OSError:
                    pass
        finally:
            if upstream is not None:
                self.server.untrack(upstream)
                upstream.close()
            self.server.untrack(self.request)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ttl-seconds", type=int, default=900,
                        help="Stop after 1–900 seconds (default: 900).")
    parser.add_argument("--listen-port", type=int, default=0,
                        help="Loopback port; 0 chooses a temporary port (default).")
    args = parser.parse_args()
    if not 1 <= args.ttl_seconds <= 900:
        parser.error("TTL must be between 1 and 900 seconds.")
    if args.listen_port != 0 and not 1024 <= args.listen_port <= 65535:
        parser.error("Listen port must be 0 or between 1024 and 65535.")
    with RelayServer(("127.0.0.1", args.listen_port), args.ttl_seconds) as server:
        server.timeout = 0.5
        print(json.dumps({"ready": True, "proxyPort": server.server_address[1],
                          "pid": os.getpid(), "ttlSeconds": args.ttl_seconds}), flush=True)
        try:
            while time.monotonic() < server.deadline:
                server.handle_request()
        except KeyboardInterrupt:
            pass
        finally:
            server.close_active()
            print(json.dumps({"stopped": True, "counts": server.counts}), flush=True)


if __name__ == "__main__":
    main()
