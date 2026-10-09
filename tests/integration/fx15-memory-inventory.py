import argparse, json, shutil, sqlite3, tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description="Inventory an explicitly authorized backup using a disposable copy; no private text is exported.")
parser.add_argument('backup')
parser.add_argument('--output', required=True)
args = parser.parse_args()
source = Path(args.backup).resolve()

root = Path(tempfile.mkdtemp(prefix='weftmate-fx15-backup-'))
report = {'backupReadOnly': True, 'databases': [], 'accounts': []}
try:
    # Inspect only copies; never open a key vault. Dependencies are irrelevant to storage inventory.
    shutil.copytree(source, root/'profile', symlinks=True, ignore=lambda _directory, names: [
        name for name in names if name.lower() in ('node_modules', '.git')
        or any(part in name.lower() for part in ('vault', 'keychain', 'credential'))])
    profile = root/'profile'
    store = json.loads((profile/'personal-access/store.json').read_text(encoding='utf-8-sig'))
    accounts = store.get('accounts', {})
    if not accounts: accounts = {'legacy': store}
    owner_keys = list(accounts)
    for i, (owner, value) in enumerate(accounts.items()):
        report['accounts'].append({'index': i, 'localPassword': bool(value.get('account', {}).get('password')), 'legacyOwner': owner == store.get('legacyOwnerId'), 'executionOwner': owner == store.get('executionOwnerId',store.get('legacyOwnerId')), 'activePrivateModels': sum(m.get('status')=='active' for m in value.get('accountModels',{}).values()), 'sharedModelCount': len(store.get('sharedModelProfiles',[])),
                                   'memoryHomeExists': (profile/'personal-access/accounts'/owner/'memory-home').exists()})
    for p in profile.rglob('*'):
        if p.is_symlink() or not p.is_file() or p.suffix.lower() not in ('.sqlite', '.sqlite3', '.db'): continue
        if any(x in str(p).lower() for x in ('vault', 'keychain', 'credential')): continue
        db = None
        try:
            db = sqlite3.connect(p.as_uri()+'?mode=ro', uri=True)
            tables = [r[0] for r in db.execute("select name from sqlite_master where type='table'")]
            counts = {t: db.execute('select count(*) from "'+t.replace('"','""')+'"').fetchone()[0] for t in tables}
            rel = p.relative_to(profile)
            account_index = next((i for i, key in enumerate(owner_keys) if key in rel.parts), None)
            report['databases'].append({'index': len(report['databases']), 'accountIndex': account_index,
                'accountMemoryHome': 'memory-home' in rel.parts, 'legacyDshHome': 'dsh-home' in rel.parts,
                'canonicalAccountDatabase': account_index is not None and p == profile/'personal-access/accounts'/owner_keys[account_index]/'memory-home/memoweft/memoweft.sqlite3', 'bindingMatchesAccount': account_index is not None and ('evidence' not in tables or db.execute('select count(*) from evidence where subject_id != ?', (owner_keys[account_index],)).fetchone()[0] == 0), 'userVersion': db.execute('pragma user_version').fetchone()[0], 'tables': counts})
        except sqlite3.DatabaseError: report['databases'].append({'readable': False})
        finally:
            if db is not None: db.close()
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2))
    print(json.dumps({'databases':len(report['databases']), 'accounts':report['accounts']}))
finally:
    assert root.resolve().parent == Path(tempfile.gettempdir()).resolve() and root.name.startswith('weftmate-fx15-backup-')
    shutil.rmtree(root)
    report['backupCopyDeleted'] = not root.exists()
    Path(args.output).write_text(json.dumps(report, indent=2))
    print(json.dumps({'backupCopyDeleted': not root.exists()}))
