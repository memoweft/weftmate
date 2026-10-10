/* The binding table is also the sole source of the desktop shortcut panel. */
(() => {
  const definitions = [
    ['new','全局','新建旁聊','n',true],['search','全局','搜索','k',true],
    ['settings','全局','打开设置',',',true],['shortcuts','全局','快捷键一览','/',true],
    ['sidebar','侧栏','展开或收起侧栏','b',true],['escape','对话','关闭当前浮层，或停止回复','Escape'],
    ['send','输入框','发送消息','Enter'],['queue','输入框','排队发送下一条','Enter',true],
    ['newline','输入框','换行','Enter',false,true],['complete','输入框','接受灰色补全','Tab'],
    ['dismiss','输入框','收起下一步建议','Escape'],
    ['searchUp','搜索面板','上一项','ArrowUp'],['searchDown','搜索面板','下一项','ArrowDown'],
    ['searchFirst','搜索面板','第一项（结果或类型标签聚焦时）','Home'],['searchLast','搜索面板','最后一项（结果或类型标签聚焦时）','End'],
    ['searchLeft','搜索面板','上一个类型','ArrowLeft'],['searchRight','搜索面板','下一个类型','ArrowRight'],
    ['searchOpen','搜索面板','打开选中项','Enter'],['searchMenu','搜索面板','选中项的操作','Enter',false,false,true],
    ['searchClose','搜索面板','关闭搜索','Escape'],
  ];
  const names={Escape:'Esc',Enter:'↵',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'};
  const rows=Object.freeze(definitions.map(([id,group,label,key,mod=false,shift=false,alt=false])=>Object.freeze({id,group,label,key,mod,shift,alt,
    keys:Object.freeze([...(mod?['Ctrl / ⌘']:[]),...(shift?['Shift']:[]),...(alt?['Alt']:[]),names[key]||key.toUpperCase()])})).sort((a,b)=>['全局','对话','输入框','侧栏','搜索面板'].indexOf(a.group)-['全局','对话','输入框','侧栏','搜索面板'].indexOf(b.group)));
  function matches(row,event){return !event.isComposing && event.keyCode!==229 && row.key.toLowerCase()===String(event.key).toLowerCase()
    && row.mod===!!(event.ctrlKey||event.metaKey) && row.shift===!!event.shiftKey && row.alt===!!event.altKey;}
  function find(event,ids){return rows.find(row=>(!ids||ids.includes(row.id))&&matches(row,event));}
  function dispatch(event,actions){const row=find(event,Object.keys(actions));if(!row)return false;const handled=actions[row.id](event,row);if(handled===false)return false;event.preventDefault?.();return true;}
  globalThis.WeftShortcuts=Object.freeze({rows,matches,find,dispatch});
})();
