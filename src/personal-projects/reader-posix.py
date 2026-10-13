"""macOS project reader: stdlib, handle-relative traversal, no writes.

The caller sends one JSON request on stdin. No path or source text is logged.
This deliberately mirrors the Windows reader's identity and bounded UTF-8 DTO.
"""
import hashlib
import json
import os
import stat
import sys
import time


class Issue(Exception):
    pass


def fail(code):
    raise Issue(code)


def parts(value, root=False):
    if not isinstance(value, str) or len(value) > (4096 if root else 1024):
        fail("PROJECT_UNSAFE_PATH")
    if root != value.startswith("/"):
        fail("PROJECT_UNSAFE_PATH")
    result = value[1:].split("/") if root else value.split("/")
    if root and value == "/":
        return []
    if len(result) > (24 if root else 9) or any(
        item in ("", ".", "..") or "\\" in item or any(ord(c) < 32 for c in item)
        for item in result
    ):
        fail("PROJECT_UNSAFE_PATH")
    return result


def identity(info):
    return "%08X:%016X" % (info.st_dev, info.st_ino)


def open_checked(name, directory, parent=None):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    if directory:
        flags |= os.O_DIRECTORY
    fd = os.open(name, flags, dir_fd=parent)
    try:
        info = os.fstat(fd)
        if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
            fail("PROJECT_UNSAFE_PATH")
        if not directory and info.st_nlink != 1:
            fail("PROJECT_UNSAFE_PATH")
        return fd
    except Exception:
        os.close(fd)
        raise


def root_chain(value):
    chain = [open_checked("/", True)]
    try:
        for item in parts(value, True):
            chain.append(open_checked(item, True, chain[-1]))
        return chain
    except Exception:
        for fd in reversed(chain):
            os.close(fd)
        raise


def check_root(request):
    chain = root_chain(request["rootPath"])
    if request.get("expectedFinal") is not None and (
        request["rootPath"] != request["expectedFinal"]
        or identity(os.fstat(chain[-1])) != request.get("expectedIdentity")
    ):
        for fd in reversed(chain):
            os.close(fd)
        fail("PROJECT_ROOT_CHANGED")
    return chain


def row(relative, info):
    return {"RelativePath": relative, "Size": info.st_size, "Identity": identity(info),
            "LastWriteTime": str(info.st_mtime_ns)}


def listing(fd, query):
    result = {"Files": [], "ScannedCount": 0, "SkippedCount": 0, "Truncated": False}
    deadline = time.monotonic() + 5

    def walk(parent, prefix, depth):
        # scandir(fd) avoids materializing an unbounded directory listing.
        with os.scandir(parent) as entries:
            for entry in entries:
                if result["ScannedCount"] >= 2000 or len(result["Files"]) >= 100 or time.monotonic() > deadline:
                    result["Truncated"] = True
                    return
                result["ScannedCount"] += 1
                relative = prefix + entry.name
                child = None
                try:
                    parts(relative)
                    if entry.is_symlink():
                        result["SkippedCount"] += 1
                        continue
                    directory = entry.is_dir(follow_symlinks=False)
                    if directory and depth >= 8:
                        result["Truncated"] = True
                        continue
                    if not directory and not entry.name.lower().endswith((".md", ".txt")):
                        continue
                    child = open_checked(entry.name, directory, parent)
                    if directory:
                        walk(child, relative + "/", depth + 1)
                    else:
                        info = os.fstat(child)
                        if info.st_size > 8 * 1024 * 1024:
                            result["SkippedCount"] += 1
                        elif not query or query.casefold() in relative.casefold():
                            result["Files"].append(row(relative, info))
                except (OSError, Issue):
                    result["SkippedCount"] += 1
                finally:
                    if child is not None:
                        os.close(child)
                if result["Truncated"]:
                    return

    walk(fd, "", 0)
    return result


def read(request, chain):
    relative = request["relativePath"]
    names = parts(relative)
    if not relative.lower().endswith((".md", ".txt")):
        fail("PROJECT_UNSAFE_PATH")
    for name in names[:-1]:
        chain.append(open_checked(name, True, chain[-1]))
    fd = open_checked(names[-1], False, chain[-1])
    try:
        before = os.fstat(fd)
        if (before.st_size > 8 * 1024 * 1024 or before.st_size != request["expectedSize"]
                or identity(before) != request["fileIdentity"]
                or str(before.st_mtime_ns) != request["expectedWriteTime"]):
            fail("PROJECT_FILE_CHANGED")
        with os.fdopen(os.dup(fd), "rb") as stream:
            content = stream.read(before.st_size + 1)
        after = os.fstat(fd)
        if len(content) != before.st_size or row(relative, before) != row(relative, after) or before.st_ctime_ns != after.st_ctime_ns:
            fail("PROJECT_FILE_CHANGED")
        try:
            text = content.decode("utf-8")
        except UnicodeError:
            fail("PROJECT_INVALID_UTF8")
        if "\0" in text:
            fail("PROJECT_INVALID_UTF8")
        lines = text.split("\n")
        start = request["startLine"]
        if start > len(lines):
            fail("PROJECT_LINE_OUT_OF_RANGE")
        page, size, end = [], 0, start - 1
        for index in range(start - 1, len(lines)):
            line = lines[index] + ("\n" if index < len(lines) - 1 else "")
            needed = len(line.encode("utf-8"))
            if size + needed > 32 * 1024:
                if end < start:
                    fail("PROJECT_LINE_TOO_LONG")
                break
            page.append(line)
            size += needed
            end = index + 1
        return {**row(relative, after), "LineStart": start, "LineEnd": end,
                "TotalLines": len(lines), "FileSha256": hashlib.sha256(content).hexdigest(),
                "Text": "".join(page), "HasMore": end < len(lines)}
    finally:
        os.close(fd)


def run(request):
    chain = check_root(request)
    try:
        action = request["action"]
        if action == "inspect":
            return {"FinalPath": request["rootPath"], "Identity": identity(os.fstat(chain[-1]))}
        result = listing(chain[-1], request.get("query", "")) if action == "list" else read(request, chain)
        # A renamed/replaced root must not publish a snapshot under its old name.
        recheck = check_root(request)
        for fd in reversed(recheck):
            os.close(fd)
        return result
    finally:
        for fd in reversed(chain):
            os.close(fd)


try:
    result = {"ok": True, "value": run(json.load(sys.stdin))}
except Issue as error:
    result = {"ok": False, "code": str(error)}
except (OSError, ValueError, KeyError, TypeError):
    result = {"ok": False, "code": "PROJECT_FILE_UNAVAILABLE"}
sys.stdout.write(json.dumps(result, ensure_ascii=True))
