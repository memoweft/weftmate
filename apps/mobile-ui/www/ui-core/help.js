/* Local help and account-scoped update notices work without a connected host. */
(() => {
  const topics=[
    {id:'chats',group:'对话',title:'主对话与旁聊怎么分工',text:'主对话适合接着聊日常的事；旁聊适合专心处理一个题目。需要用电脑文件做事时，可以把旁聊放进项目。',action:'main',tryLabel:'打开主对话'},
    {id:'temporary',group:'对话',title:'临时对话',text:'有些话只想这次聊，就新建临时对话。这里的内容不会形成长期记忆，也不会出现在跨对话搜索里。',action:'temporary',tryLabel:'新建临时对话'},
    {id:'remember',group:'记忆',title:'让助手记住或忘掉',text:'直接说“请记住我喜欢……”或“请忘掉……”。想确认保存了什么，可以到记忆里查看。',action:'memory',tryLabel:'查看记忆'},
    {id:'correct',group:'记忆',title:'记错了，怎么纠正',text:'直接告诉助手哪里不对，也可以打开那条记忆修改或忘掉它。纠正后，新对话会用更新后的内容。',action:'memory',tryLabel:'整理记忆'},
    {id:'goals',group:'安排事情',title:'定时任务与目标',text:'定时任务适合“每天早上提醒我”；目标适合需要多次推进的事情。去目标页可以查看进度、暂停安排或回到原对话。',action:'goals',tryLabel:'打开目标'},
    {id:'folders',group:'电脑与手机',title:'选择文件夹与审批模式',text:'在电脑侧栏新建项目并选择文件夹，就能围绕这里的文件工作。输入框的审批模式决定助手动手前要不要先问你。',action:'approvals',tryLabel:'查看审批设置'},
    {id:'continue',group:'电脑与手机',title:'手机上接着电脑的任务',text:'登录同一个账户，在设置的设备页连接自己的电脑。打开原对话，就能继续交代事情、查看结果或批准操作。',action:'devices',tryLabel:'连接设备'},
    {id:'offline',group:'电脑与手机',title:'离线时能做什么',text:'电脑不在线时，手机可以用已配置的模型聊天和已保存的记忆；电脑文件暂时无法操作。需要电脑执行的事，请等连接恢复后再发送。',action:'devices',tryLabel:'查看连接状态'},
    {id:'data',group:'数据',title:'数据在哪里，怎么导出',text:'对话、记忆和文件保存在自己的设备上。对话菜单可以导出这段对话；电脑设置里的备份与恢复可以备份或恢复本机数据。',action:'backups',tryLabel:'打开备份设置'},
  ];
  const filterHelp=query=>{const words=String(query||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return topics.filter(row=>words.every(word=>`${row.group} ${row.title} ${row.text}`.toLocaleLowerCase().includes(word)));};
  globalThis.WeftUiCore.helpTopics=Object.freeze(topics.map(Object.freeze));
  globalThis.WeftUiCore.filterHelp=filterHelp;
  globalThis.WeftUiCore.factories.help=(core,effects,env)=>{
    const scope=()=>{core.syncMobileIdentity?.();return core.state.ownerId;};
    function observeRelease(version,layer='ui'){
      const owner=scope();if(!owner||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version||''))return false;
      const key=`weftmate-release-seen:${encodeURIComponent(owner)}:${layer}`;
      try {const saved=JSON.parse(env.storage.getItem(key)||'null');
        // A first installation establishes a baseline. Changes are recorded when shown,
        // so a reload cannot repeatedly interrupt someone who has not dismissed it yet.
        const show=!!saved?.current&&saved.current!==version&&!saved.seen.includes(version);
        env.storage.setItem(key,JSON.stringify({current:version,seen:[...new Set([...(saved?.seen||[]),version])]}));return show;
      }catch{return false;}
    }
    async function currentRelease(){const mobile=!!env.mobileState;
      if(!mobile&&!env.desktop&&!globalThis.weftmateDesktop)return {version:globalThis.WeftUiCore.releaseNotes?.find(row=>row.audience==='desktop')?.version||null,layer:'ui',audience:'desktop'};
      const value=await core.readUpdateState();
      const row=value.layers.find(row=>row.layer===(mobile?'mobile-ui':'ui')&&row.currentVersion)||value.layers.find(row=>row.layer==='app'&&row.currentVersion);
      return {version:row?.currentVersion||env.mobileState?.ui?.activeVersion||core.state.system?.host?.version||null,layer:row?.layer||(mobile?'mobile-ui':'ui'),audience:mobile?'mobile':'desktop',pending:row?.status==='starting',
        versions:value.layers.filter(row=>row.currentVersion&&row.scope!=='host-published'&&(mobile?row.layer==='mobile-ui':['app','ui'].includes(row.layer))).map(row=>({version:row.currentVersion,layer:row.layer}))};}
    return {filterHelp,observeRelease,currentRelease};
  };
})();
