#!/usr/bin/env python3
"""Verify synthetic records and acknowledged backfill batches without printing health bodies."""
import json,math,sys
from pathlib import Path
p=Path(sys.argv[1]);r=json.loads(p.read_text());records=r['records']
assert len(records)==90
assert all(x['health']['version']==3 for x in records)
seen={2:set(),3:set()}
for request in r['requests']:
    for day,version in zip(request['days'],request['versions']):
        assert day not in seen[version], 'Acknowledged date resent within same version'
        seen[version].add(day)
assert len(seen[2])==90 and len(seen[3])==90
full=[x['health'] for x in records if x['health']['steps']==1234 and x['health']['workouts']]
assert len(full)>=87
for h in full:
    assert h['sleepMinutes']==450 and h['sleep']['inBedMinutes']==480
    assert h['sleep']['deepMinutes']==60 and h['sleep']['remMinutes']==60 and h['sleep']['coreMinutes']==330 and h['sleep']['awakeMinutes']==30
    assert h['hrvSdnnMs']==50 and h['respiratoryRateBrpm']==16 and h['spo2Pct']==98
    assert h['activeEnergyKcal']==200 and h['restingHeartRateBpm']==60 and h['vo2Max']==42
    assert len(h['heartRateHourly'])==24 and len(h['heartRateQuarterHourly'])==96
    w=h['workouts'][0]
    assert w['minutes']==5 and all(abs(v-1)<0.00001 for v in w['zoneMinutes'])
    assert abs(w['avgHeartRateBpm']-140)<0.00001 and w['maxHeartRateBpm']==180
    derived=[v for v in h['hrvSamples'] if v['stressIndex'] is not None]
    assert len(derived)==1
    assert abs(derived[0]['rmssdMs']-100)<0.0001
    assert abs(derived[0]['stressIndex']-243.90243902439)<0.0001
    assert all(set(v)=={'time','sdnnMs','rmssdMs','stressIndex','meanHeartRateBpm'} for v in h['hrvSamples'])
assert all(set(p)=={'version','birthYear','sex','heightCm','weightKg'} for p in r['profiles'])
assert r['reminders']>=1 and 'overview' not in r['analysisScopes']
summary={'syntheticOnly':True,'v2Days':len(seen[2]),'v3Days':len(seen[3]),'completeDaysVerified':len(full),'acknowledgedDuplicateDates':0,'sleepStages':True,'workoutZones':True,'knownBeatSequence':True,'rawBeatsAbsent':True,'profileBirthYearOnly':True}
print(json.dumps(summary))
