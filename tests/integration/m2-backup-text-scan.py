"""Read every SQLite table/column; decode JSON escapes before matching text."""
import json
from pathlib import Path
import sqlite3
import sys


def searchable(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace') + value.decode('utf-16le', errors='replace')
    text = str(value)
    if isinstance(value, str):
        try:
            text += json.dumps(json.loads(value), ensure_ascii=False)
        except (ValueError, TypeError):
            pass
    return text


def scan(path: str, needles: list[str]) -> dict[str, object]:
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        tables = []
        hits = []
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
            quoted = '"' + table.replace('"', '""') + '"'
            cursor = db.execute('SELECT * FROM ' + quoted)
            columns = [column[0] for column in cursor.description]
            rows = 0
            for index, row in enumerate(cursor):
                rows += 1
                for column, value in zip(columns, row):
                    matches = [needle for needle in needles if needle in searchable(value)]
                    if matches:
                        hits.append({'table': table, 'column': column, 'rowIndex': index, 'needles': matches})
            tables.append({'table': table, 'columns': columns, 'rows': rows})
        return {'tables': tables, 'tableCount': len(tables), 'hits': hits, 'hitCount': len(hits), 'needles': needles}
    finally:
        db.close()


if __name__ == '__main__':
    print(json.dumps(scan(sys.argv[1], sys.argv[2:]), ensure_ascii=True))
