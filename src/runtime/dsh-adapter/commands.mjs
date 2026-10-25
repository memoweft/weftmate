import {unwrap} from './sessions.mjs';

// DSH owns discovery, scope, command admission, lifecycle and skill injection.
export function createNativeCommands({client,lifecycle,getAgent,getCommands}) {
  async function receivingAgent(sessionId) {
    await lifecycle.resume(sessionId);
    const agent=getAgent(sessionId);
    if(!agent || !getCommands()) throw Object.assign(new Error('commands unavailable'),{code:'session-not-found'});
    return agent;
  }
  const use=(sessionId,work)=>lifecycle.use ? lifecycle.use(sessionId,()=>work(getAgent(sessionId))) : receivingAgent(sessionId).then(work);
  return {
    async list(sessionId) {
      return use(sessionId,async agent=>{
      const commands=getCommands().list(agent);
      const {skills}=await unwrap(await client.skills.list({sessionId}),'skill.list');
      return {items:[...commands.map(item=>({...item,kind:'command'})),
        ...skills.filter(skill=>!commands.some(command=>command.name===skill.name)).map(item=>({...item,kind:'skill'}))]};
      });
    },
    async execute(sessionId,line) {
      if(typeof line!=='string' || line.length>32000 || !/^\/[a-z][a-z0-9_-]*(?:\s|$)/.test(line)) throw new TypeError('invalid command');
      return use(sessionId,async agent=>{
      const execution=await getCommands().execute(agent,line,AbortSignal.timeout(120000));
      return execution || {result:{kind:'error',text:'没有找到这个命令，请重新选择。'}};
      });
    },
  };
}
