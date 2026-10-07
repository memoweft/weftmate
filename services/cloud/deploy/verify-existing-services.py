"""Private server baseline and comparison; output may contain private configuration."""
import subprocess, pathlib, re, json, sys, hashlib, datetime
def run(args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=45)
    return p.returncode, p.stdout, p.stderr
base = pathlib.Path('/root/weftmate-deploy')
base.mkdir(mode=0o700, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
out = base / (sys.argv[1] + '-' + stamp)
out.mkdir(mode=0o700)
code, config, err = run(['nginx', '-T'])
(out/'nginx.txt').write_text(config+err)
if sys.argv[1] == 'baseline':
    domains = sorted(set(d for line in re.findall(r'^\s*server_name\s+([^;]+);',config,re.M) for d in line.split() if d != '_'))
    (base/'domains.json').write_text(json.dumps(domains))
else:
    domains = json.loads((base/'domains.json').read_text())
sites = {}
keys = ['location','content-type','strict-transport-security','x-content-type-options','x-frame-options','referrer-policy','permissions-policy','content-security-policy','x-robots-tag','server']
for domain in domains:
    for scheme in ['http','https']:
        url = scheme+'://'+domain+'/'
        record = {}
        for method in ['HEAD','GET']:
            f = out / (domain+'-'+scheme+'-'+method)
            args = ['curl','-sS','--noproxy','*','--max-time','20','-D',str(f)+'.headers','-o',str(f)+'.body']
            if method == 'HEAD': args += ['-I']
            c, stdout, stderr = run(args+[url])
            record[method+'Exit'] = c
            (pathlib.Path(str(f)+'.error')).write_text(stderr)
            headers = pathlib.Path(str(f)+'.headers').read_text()
            status = re.findall(r'^HTTP/[^ ]+\s+(\d+)',headers,re.M)
            record[method+'Status'] = status[-1] if status else None
            parsed = {k.lower():v.strip() for k,v in re.findall(r'^([^:\r\n]+):\s*([^\r\n]*)',headers,re.M)}
            record[method+'Headers'] = {k:parsed[k] for k in keys if k in parsed}
            if method == 'GET' and domain in ['weftmate.com','www.weftmate.com']:
                record['bodySha256'] = hashlib.sha256(pathlib.Path(str(f)+'.body').read_bytes()).hexdigest()
        if scheme == 'https':
            p = subprocess.run(['openssl','s_client','-connect',domain+':443','-servername',domain],input='',capture_output=True,text=True,timeout=25)
            cert = re.search(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',p.stdout,re.S)
            record['certSha256'] = hashlib.sha256(cert.group().encode()).hexdigest() if cert else None
        sites[url] = record
commands = {'listeners':['ss','-ltnp'],'udp':['ss','-lunp'],'services':['systemctl','list-units','--type=service','--state=running','--no-legend','--no-pager'],'memory':['free','-m'],'disk':['df','-h','/'],'fail2ban':['fail2ban-client','status']}
for name,args in commands.items():
    c,s,e = run(args); (out/(name+'.txt')).write_text(s+e)
(out/'sites.json').write_text(json.dumps(sites,indent=2))
if sys.argv[1]=='baseline':
    (base/'baseline-path').write_text(str(out))
    print(out)
else:
    baseline = pathlib.Path((base/'baseline-path').read_text())
    before = json.loads((baseline/'sites.json').read_text())
    mismatches = [url for url in sites if sites[url] != before[url]]
    old_services = set(line.split()[0] for line in (baseline/'services.txt').read_text().splitlines() if line.strip())
    new_services = set(line.split()[0] for line in (out/'services.txt').read_text().splitlines() if line.strip())
    mismatches += sorted(old_services-new_services)
    # Original non-nginx listeners must retain their addresses and processes.
    # Queue lengths vary; nginx workers intentionally change on reload.
    def listeners(file):
        records = set()
        for line in file.read_text().splitlines()[1:]:
            fields = line.split(None, 5)
            if len(fields) == 6 and '"nginx"' not in fields[5]:
                records.add((fields[3], fields[5].strip()))
        return records
    # UDP UNCONN output also contains outgoing, ephemeral application sockets;
    # retain it as evidence, without treating normal socket churn as a restart.
    for name in ['listeners']:
        missing = listeners(baseline/(name+'.txt')) - listeners(out/(name+'.txt'))
        mismatches += [name+': '+address for address,process in sorted(missing)]
    result = {'path':str(out),'sitesCompared':len(sites),'mismatches':mismatches}
    (out/'comparison.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
    sys.exit(1 if mismatches else 0)
