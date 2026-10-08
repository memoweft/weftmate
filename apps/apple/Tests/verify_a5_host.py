#!/usr/bin/env python3
"""Verify real cloud/host routes with synthetic native events, receipts and memory manager."""
import subprocess,json,urllib.request,urllib.error,os,shutil,time,uuid
p=subprocess.Popen(['node','apps/apple/Tests/a5_cloud_fixture.mjs'],stdout=subprocess.PIPE,stderr=open('/private/tmp/a5-control-fixture.log','w'),text=True,env=os.environ|{'TMPDIR':'/private/tmp'})
meta=json.loads(p.stdout.readline())
def get(path):return json.load(urllib.request.urlopen(meta['driver']+path))
try:
 get('/a5/setup');get('/bootstrap');ready=get('/ready');ids=get('/a5/ids');origin=ready['host'];auth={}
 def api(path,body=None,method=None):
  request=urllib.request.Request(origin+'/personal/v1'+path,data=json.dumps(body).encode() if body is not None else None,method=method or ('POST' if body is not None else 'GET'),headers={'Origin':origin,'Content-Type':'application/json',**auth})
  try:
   response=urllib.request.urlopen(request);value=json.load(response)
   if path=='/auth/login':auth.update({'Cookie':response.headers['Set-Cookie'].split(';')[0],'X-WeftMate-CSRF':value['csrfToken']})
   return response.status,value
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 assert api('/auth/login',{'username':'a5-tester','password':'synthetic-test-only','deviceName':'合成控制核对'})[0]==200
 def send(text,intent='steer'):
  status,value=api('/commands',{'requestId':'smoke-'+uuid.uuid4().hex,'kind':'session.message','targetDeviceId':ready['hostId'],'sessionId':ids['queue'],'text':text,'intent':intent});assert status==202,(status,value)
  for _ in range(100):
   command=api('/commands/'+value['command']['commandId'])[1]['command']
   if command['state']=='accepted_by_dsh':return command
   time.sleep(.03)
  raise Exception(command)
 root=send('A5_HOLD original');steer=send('A5_STEER supplement');assert steer['rootTaskId']==root['commandId']
 first=send('A5_QUEUE_1','queue');second=send('A5_QUEUE_2','queue');cancel=send('A5_CANCEL','queue')
 status,value=api('/tasks/'+cancel['commandId']+'/cancel',{'requestId':'cancel-smoke'});assert status==202,(status,value);assert value['task']['control']['stopStatus']=='stopped',value['task']['control']
 status,value=api('/tasks/'+root['commandId']+'/cancel',{'requestId':'cancel-race'});assert status==409,(status,value)
 status,value=api('/tasks/'+root['commandId']+'/stop',{'requestId':'stop-smoke'});assert status==202,(status,value)
 for _ in range(100):
  report=get('/a5/report');starts=[row['text'] for row in report['operations'] if row['kind']=='started']
  if 'A5_QUEUE_2' in starts:break
  time.sleep(.1)
 assert [v for v in starts if v.startswith('A5_QUEUE_')]==['A5_QUEUE_1','A5_QUEUE_2'],starts
 assert 'A5_CANCEL' not in starts and 'A5_STEER supplement' not in starts
 assert api('/sessions/'+ids['deletion']+'/archive',{})[0]==200
 assert api('/sessions/'+ids['deletion']+'/unarchive',{})[0]==200
 assert api('/sessions/'+ids['deletion'],{'forgetMemories':False},'DELETE')[0]==200
 status,value=api('/sessions/'+ids['forget'],{'forgetMemories':True},'DELETE');assert status==200,(status,value);assert value['forgottenEvidenceCount']==1,value
 report=get('/a5/report');assert len(report['memoryDeletes'])==1
 assert report['workspaceExists']['deletion']==False and report['workspaceExists']['forget']==False
 evidence={'realCloudMain':True,'realPersonalHost':True,'compiledDshEngine':False,'syntheticRuntimeAndModel':True,'steerRootMatches':True,'queueStartedInOrder':True,'cancelHTTP':202,'cancelRaceHTTP':409,'canceledNeverStarted':True,'stopRetainsQueue':True,'archiveRestore':True,'defaultDeleteDoesNotForget':True,'checkedDeleteCallsDeleteEvidence':True,'deletedWorkspacesAbsent':True}
 os.makedirs('apps/apple/Tests/Evidence/A5',exist_ok=True);open('apps/apple/Tests/Evidence/A5/validation-host.json','w').write(json.dumps(evidence,indent=2)+'\n');print('Synthetic control + real cloud/host contract smoke passed')
finally:
 p.terminate();p.wait(timeout=25);shutil.rmtree(meta['root'],ignore_errors=True)
