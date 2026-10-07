#!/usr/bin/env python3
"""Isolated loopback /personal/v1 fixture. No real accounts, model, files or host commands."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import argparse, json, hashlib

TIME='2026-10-07T00:00:00Z'
APPROVAL='11111111-1111-4111-8111-111111111111'
QUESTION='22222222-2222-4222-8222-222222222222'
BYTES='A3 合成成果\n长会话与时间线验证通过。\n'.encode()
state={'allowed':False,'answer':False,'stopped':False,'approval_request':None,'question_request':None,'requests':[]}
def event(seq, kind, data, seconds=0):
 return {'seq':seq,'type':kind,'at':f'2026-10-07T00:00:{seconds:02d}Z','data':data}
def step(name, status='running'):
 return {'taskId':'turn-1','stepId':name,'callId':name,'toolName':'shell','groupHint':'shell','summary':'列出测试目录' if name=='call-a' else '生成成果文件','detailRef':{'seq':22004 if name=='call-a' else 22008},'state':status,'turn':1}
def events():
 data=[event(i,'assistant.message',{'text':f'旧记录 {i}'}) for i in range(22000)]
 data += [event(22000,'turn.started',{'turn':1}),event(22001,'user.message',{'text':'整理合成目录并生成说明','receiptId':'receipt-fixture'}),
 event(22002,'task.started',{'taskId':'turn-1','turn':1}),event(22003,'assistant.message',{'text':'最新记录 · 已打开长会话尾页'}),
 event(22004,'step.started',step('call-a')),event(22005,'approval.requested',{'taskId':'turn-1','approvalId':APPROVAL,'summary':'在合成目录写入说明；可删除文件撤销','detailRef':{'seq':22005}})]
 if state['allowed']:
  data += [event(22006,'approval.resolved',{'taskId':'turn-1','approvalId':APPROVAL,'outcome':'allowed-once','summary':'已允许本次'}),
   event(22007,'step.completed',step('call-a','completed'),3),event(22008,'question.asked',{'taskId':'turn-1','turn':1,'callId':'call-q','stepId':'call-q','summary':'选择成果格式','questions':[{'question':'成果用什么格式？'}]})]
 if state['answer']:
  data += [event(22009,'question.answered',{'taskId':'turn-1','turn':1,'callId':'call-q','stepId':'call-q','summary':'已回答'}),
   event(22010,'step.started',step('call-b'),5),event(22011,'artifact.created',{'taskId':'cmd-fixture','artifactId':'artifact-fixture','fileName':'A3-成果.txt','contentType':'text/plain','size':len(BYTES),'completedStep':step('call-b','completed')},10),
   event(22012,'task.ended',{'taskId':'turn-1','turn':1,'reason':'completed'},12),event(22013,'turn.ended',{'turn':1,'reason':'completed'},12),
   event(22014,'assistant.message',{'text':'已完成 · 成果可预览、保存和分享'},12)]
 return data

def command():
 return {'commandId':'cmd-fixture','requestId':'request-fixture','targetDeviceId':'host-fixture','sessionId':'session-fixture','kind':'session.message','state':'accepted_by_dsh','receiptId':'receipt-fixture','createdAt':TIME,'updatedAt':TIME}
def artifact():
 return {**command(),'commandId':'cmd-artifact','requestId':'request-artifact','kind':'desktop.write_artifact','state':'observed','taskId':'cmd-fixture','artifactId':'artifact-fixture','fileName':'A3-成果.txt','contentType':'text/plain','size':len(BYTES),'sha256':hashlib.sha256(BYTES).hexdigest(),'verification':{'status':'observed','method':'sha256_readback','observedAt':TIME}}
def approval():
 value={'approvalId':APPROVAL,'sessionId':'session-fixture','taskId':'cmd-fixture','sourceCommandId':'cmd-fixture','sourceReceiptId':'receipt-fixture','turn':1,'callId':'call-a','toolName':'shell','reason':'在合成目录写入说明；可删除文件撤销','status':'resolved' if state['allowed'] else 'pending','createdAt':TIME}
 if state['allowed']:value.update(decisionOutcome='allowed-once',decisionRequestId=state['approval_request'],answeredAt=TIME,outcome='allowed-once',resolvedAt=TIME)
 return value

def question():
 value={'questionRpcId':QUESTION,'sessionId':'session-fixture','taskId':'cmd-fixture','sourceCommandId':'cmd-fixture','sourceReceiptId':'receipt-fixture','turn':1,'observedSeq':22008,'questions':[{'id':'format','question':'成果用什么格式？','options':[{'label':'纯文本','description':'方便预览'}]}],'createdAt':TIME,'status':'resolved' if state['answer'] else 'pending'}
 if state['answer']:value.update(answer={'answers':[{'id':'format','selected':['纯文本']}]},answerRequestId=state['question_request'],answeredAt=TIME,answerAcceptedAt=TIME,outcome='answered',resolvedAt=TIME)
 return value

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.route()
 def do_POST(self):self.route()
 def route(self):
  parsed=urlparse(self.path); path=parsed.path.removeprefix('/personal/v1');query=parse_qs(parsed.query)
  state['requests'].append({'method':self.command,'path':path,'query':query})
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}')
  auth={'account':{'ownerId':'owner-fixture','username':'a3-tester','displayName':'A3 合成测试'},'device':{'id':'device-fixture','name':'合成测试设备'},'csrfToken':'b'*43}
  status=200;headers={};result={}
  if path=='/auth/login':result=auth;headers['Set-Cookie']='wm_personal_session='+'a'*43
  elif path=='/auth/me':result=auth
  elif path=='/auth/devices':result={'devices':[{'id':'device-fixture','name':'合成测试设备','current':True}]}
  elif path=='/status':result={'ownerId':'owner-fixture','hostId':'host-fixture','backend':{'capabilities':{'desktopOpenApp':{'available':True}}}}
  elif path=='/sync/capabilities':result={'deviceId':'device-fixture','platform':body.get('platform','ios'),'sharedConversations':1}
  elif path=='/sync/events':result={'events':[],'nextSeq':0,'hasMore':False}
  elif path=='/sessions':result={'sessions':[{'sessionId':'session-fixture','title':'A3 合成长会话','running':not state['answer'],'sendAvailable':True,'modelProfileId':'fixture'}]}
  elif path=='/models':result={'models':[{'id':'fixture','name':'合成模型','model':'fixture','configured':True}]}
  elif path=='/commands':result={'commands':[command()],'hasMore':False}
  elif path.startswith('/commands/by-request/'):result={'command':command()}
  elif path=='/sessions/session-fixture/events':
   all_events=events(); limit=int(query.get('limit',['100'])[0]);latest=all_events[-1]['seq'];older=False;more=False
   if 'beforeSeq' in query:
    boundary=int(query['beforeSeq'][0]); eligible=[e for e in all_events if e['seq']<boundary];data=eligible[-limit:];older=len(eligible)>len(data);next_seq=latest
   elif 'afterSeq' in query:
    boundary=int(query['afterSeq'][0]);eligible=[e for e in all_events if e['seq']>boundary];data=eligible[:limit];more=len(eligible)>len(data);next_seq=data[-1]['seq'] if more else latest
   else:data=all_events[-limit:];older=len(all_events)>len(data);next_seq=latest
   result={'events':data,'nextSeq':next_seq,'latestSeq':latest,'hasMore':more,'hasOlder':older,'nextBeforeSeq':data[0]['seq'] if data else None}
  elif path.endswith('/detail'):
   seq=int(path.split('/')[-2]);result={'seq':seq,'text':'{"command":"echo synthetic","output":"合成输出 · 按需读取"}'}
  elif path=='/sessions/session-fixture/approvals':result={'approvals':[approval()],'hasMore':False}
  elif path.endswith('/approvals/'+APPROVAL):state.update(allowed=True,approval_request=body['requestId']);result={'approval':{**approval(),'status':'answered'},'requestId':body['requestId']}
  elif path=='/sessions/session-fixture/questions':result={'questions':[question()] if state['allowed'] else [],'hasMore':False}
  elif path.endswith('/questions/'+QUESTION):state.update(answer=True,question_request=body['requestId']);result={'question':{**question(),'status':'answered'},'requestId':body['requestId']}
  elif path=='/tasks/cmd-fixture':
   result={'taskId':'cmd-fixture','hostId':'host-fixture','sessionId':'session-fixture','source':command(),'sourceText':'整理合成目录并生成说明','supplements':[],'resumes':[],'steps':[],'artifacts':[artifact()] if state['answer'] else [],'sources':[],
    'control':{'state':'active','canSupplement':False,'canStop':not state['answer'],'canResume':False,'updatedAt':TIME},
    'replyEvidence':{'status':'completed' if state['answer'] else 'waiting','assistantChunks':0,'textChunks':0,'reasoningChunks':0,'assistantMessages':1,'toolSaveObserved':state['answer']}}
  elif path=='/artifacts/artifact-fixture':result={'artifact':artifact()}
  elif path=='/artifacts/artifact-fixture/preview':result={'artifact':artifact(),'text':BYTES.decode()}
  elif path=='/artifacts/artifact-fixture/download':result=BYTES
  elif path=='/test/report':result={'requests':state['requests'],'allowed':state['allowed'],'answer':state['answer']}
  else:status=404;result={'error':{'code':'NOT_FOUND'}}
  encoded=result if isinstance(result,bytes) else json.dumps(result,ensure_ascii=False).encode()
  self.send_response(status);self.send_header('Content-Type','text/plain' if isinstance(result,bytes) else 'application/json');self.send_header('Content-Length',str(len(encoded)))
  for k,v in headers.items():self.send_header(k,v)
  self.end_headers();self.wfile.write(encoded)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=18763);args=parser.parse_args()
 print(f'A3 isolated loopback fixture on localhost:{args.port}',flush=True)
 ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
