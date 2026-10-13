"""Compare the shipped Android palette to the supplied neutral-gray controls specification."""
from pathlib import Path
import json, re

repo=Path(__file__).resolve().parents[2]
root=repo/'tests/evidence/and-7'
source=(repo/'apps/android/app/src/main/java/com/memoweft/weftmate/mobile/DesignTokens.kt').read_text(encoding='utf8')
actual={name:int(value,16) for name,value in re.findall(r'const val (\w+) = 0x([0-9a-f]+)\.toInt\(\)',source)}
reference=json.loads((root/'dark-control-reference.json').read_text(encoding='utf8'))
names={'canvas':'Canvas','surface':'Surface','surface-soft':'Soft','surface-float':'SurfaceFloat',
       'selected-on-soft':'SelectedOnSoft','line':'Line','ink':'Ink','ink-secondary':'Secondary',
       'ink-muted':'Muted','accent':'Accent','accent-hover':'AccentHover','on-accent':'OnAccent',
       'accent-soft':'AccentSoft','danger':'Danger','danger-soft':'DangerSoft'}
def argb(value):
    if value.startswith('#'):return int('ff'+value[1:],16)
    r,g,b,a=[float(x) for x in re.findall(r'[\d.]+',value)]
    return (round(a*255)<<24)|(int(r)<<16)|(int(g)<<8)|int(b)
records=[]
for token,suffix in names.items():
    key='nativeDark'+suffix;expected=argb(reference[token]);found=actual.get(key)
    records.append(dict(token=token,androidToken=key,expected=f'{expected:08x}',
                        actual=f'{found:08x}' if found is not None else None,passed=found==expected))
report={'passed':all(row['passed'] for row in records),'tokens':records}
(root/'dark-token-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'passed':report['passed'],'checked':len(records),'failed':[r['token'] for r in records if not r['passed']]}))
raise SystemExit(0 if report['passed'] else 1)
