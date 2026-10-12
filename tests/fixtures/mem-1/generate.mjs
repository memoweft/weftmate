import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
const root=import.meta.dirname;
const save=(name,value)=>writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
const gpt=(id,text,time=Date.parse('2025-03-12T09:00:00Z')/1000)=>({id,title:`合成对话 ${id}`,create_time:time,current_node:'a',mapping:{
 root:{parent:null,message:null},u:{parent:'root',message:{author:{role:'user'},content:{content_type:'text',parts:[text]},create_time:time,metadata:{attachments:[{name:'合成旅行计划.pdf'}]}}},
 a:{parent:'u',message:{author:{role:'assistant'},content:{content_type:'text',parts:['收到，我会按你的偏好来。']},create_time:time+1}},
 unused:{parent:'u',message:{author:{role:'assistant'},content:{content_type:'text',parts:['分支废弃内容']},create_time:time+2}},
 sys:{parent:null,message:{author:{role:'system'},content:{content_type:'text',parts:['系统秘密']}}}}});
await mkdir(root,{recursive:true});
const small=Array.from({length:30},(_,i)=>gpt(`synthetic-${i}`,i===0?'我的虚构鹦鹉叫青瓷，最喜欢的零食是荞麦。':`我喜欢第 ${i} 号合成咖啡馆的安静靠窗座位。`,Date.parse(`${i<15?'2024':'2026'}-03-12T09:00:00Z`)/1000+i));
await save('chatgpt-30.json',small);
const name=Buffer.from('conversations.json'),plain=Buffer.from(JSON.stringify(small)),compressed=deflateRawSync(plain),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
local.writeUInt32LE(0x04034b50);local.writeUInt32LE(crc32(plain),14);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(name.length,26);
central.writeUInt32LE(0x02014b50);central.writeUInt32LE(crc32(plain),16);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(plain.length,24);central.writeUInt16LE(name.length,28);
end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
await writeFile(join(root,'chatgpt-30.zip'),Buffer.concat([local,name,compressed,central,name,end]));
await save('chatgpt-overlap.json',[small[0],gpt('new','我的虚构自行车是琥珀色。')]);
await save('chatgpt-edge.json',[gpt('branch','我下周去上海。'),{id:'empty',title:'空对话',current_node:null,mapping:{},create_time:1},gpt('long','超长虚构文字'.repeat(9000))]);
await save('claude.json',[{uuid:'claude-synthetic',name:'合成偏好',created_at:'2024-04-01T12:00:00Z',chat_messages:[{uuid:'u',sender:'human',text:'我不喝含糖饮料。',created_at:'2024-04-01T12:00:00Z',attachments:[{file_name:'合成菜单.pdf',extracted_content:'附件正文秘密'}]},{uuid:'a',sender:'assistant',content:[{type:'thinking',thinking:'推理秘密'},{type:'text',text:'好，我会记住。'}],created_at:'2024-04-01T12:00:01Z'}]}]);
await mkdir(join(root,'codex','2025'),{recursive:true});
await writeFile(join(root,'codex','2025','session.jsonl'),[
 {type:'session_meta',payload:{id:'codex-synthetic',timestamp:'2025-02-01T12:00:00Z',cli_version:'0.100.0'}},
 {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'系统提示秘密'}]}},
 {type:'event_msg',timestamp:'2025-02-01T12:00:00Z',payload:{type:'user_message',message:'我的虚构项目叫蓝鲸。'}},
 {type:'event_msg',payload:{type:'agent_reasoning',text:'推理秘密'}},
 {type:'response_item',payload:{type:'function_call_output',output:'命令输出秘密'}},
 {type:'event_msg',payload:{type:'agent_message',phase:'commentary',message:'正在读取文件秘密'}},
 {type:'event_msg',timestamp:'2025-02-01T12:00:01Z',payload:{type:'agent_message',phase:'final_answer',message:'蓝鲸项目已整理完。'}},
 {type:'event_msg',timestamp:'2025-02-01T12:00:01Z',payload:{type:'task_complete',last_agent_message:'蓝鲸项目已整理完。'}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
await mkdir(join(root,'claude-code','synthetic-project'),{recursive:true});
const cc=(type,message,timestamp='2025-07-01T00:00:00Z')=>({type,message,sessionId:'cc-synthetic',uuid:type+'-synthetic',parentUuid:null,timestamp});
await writeFile(join(root,'claude-code','synthetic-project','session.jsonl'),[
 cc('user',{role:'user',content:'我的虚构测试颜色是海蓝。'}),cc('assistant',{role:'assistant',stop_reason:'tool_use',content:[{type:'text',text:'工具前言秘密'},{type:'tool_use',id:'tool',name:'Read',input:{file_path:'fiction.txt'}}]}),
 cc('user',{role:'user',content:[{type:'tool_result',tool_use_id:'tool',content:'文件内容秘密'}]}),
 cc('assistant',{role:'assistant',stop_reason:'end_turn',content:[{type:'thinking',thinking:'推理秘密'},{type:'text',text:'海蓝配色已完成。'}]}),
 {...cc('user',{role:'user',content:'子任务秘密'}),isSidechain:true}].map(x=>JSON.stringify(x)).join('\n')+'\n');
await save('unknown.json',{version:999,conversations:[]});
await writeFile(join(root,'unknown.jsonl'),JSON.stringify({type:'future_session',version:999})+'\n');
