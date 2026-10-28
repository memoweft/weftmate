/* Settings taxonomy only. Each renderer supplies its own named mount functions. */
(() => {
    function createSettingsRegistry(entries = []) {
        const categories = new Map();
        const register = entry => {
            if (!entry.id || typeof entry.mount !== 'function') throw new TypeError('A settings category needs an id and mount function');
            categories.set(entry.id, Object.freeze({ keywords: [], ...entry }));
        };
        entries.forEach(register);
        const list = ({ desktop = false, query = '' } = {}) => {
            const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
            return [...categories.values()].filter(entry => (!entry.desktopOnly || desktop) &&
                terms.every(term => [entry.name, entry.group, ...entry.keywords].join(' ').toLocaleLowerCase().includes(term)));
        };
        return { register, list, get: id => categories.get(id) };
    }
    const definitions = [
        ['general', '设置', '常规', 'settings', ['开机自启', '启动', '通知', '关闭窗口时最小化到托盘', '语言', '运行日志', '发送到 WeftMate']],
        ['personalization', '设置', '个性化', 'edit', ['怎么称呼你', '昵称', '你的简介', '回复语气', '自定义语气说明', '固定说明', '参考我的写作风格', '提炼结果', '重新提炼', '清除提炼结果']],
        ['assistant', '设置', '助手', 'model', ['下一步建议', '输入时补全', '灰色补全', 'Tab', '补全', '网页搜索', '成文前核对事实', '出处', '回答详细程度', '显示思考过程', '新对话默认深入思考', '回复进行中时发送的消息', '引导', '排队']],
        ['notifications', '设置', '通知', 'bell', ['通知声音', '勿扰', '启用勿扰', '开始时间', '结束时间', '主动', '每日主动打扰上限', '待审批', '待回答', '任务完成', '记忆状态', '每周记忆小结', '每周生成记忆周报', '每周哪一天', '生成时间', '系统', '需要我批准的事仍然通知', '发送测试通知', '检查系统通知权限']],
        ['reviewHealth', '设置', '回顾与健康', 'health', ['回顾', '洞察', '摘要', '健康数据', '睡眠目标', '保留多久', '清空', '今日解读', '各项 AI 分析', '用模型解读', '记录这台电脑的使用时段', '恢复', '压力', '电能', '体能年龄']],
        ['appearance', '设置', '外观', 'palette', ['主题', '浅色', '深色', '颜色模式', '强调色', '背景色', '前景色', '主题预设', '界面字号', '内容字号', '代码字号', '字体', '减少动态效果', '动画', '对比度', '半透明侧边栏', '页面全宽显示', '分别设置浅色和深色', '高级', '指针光标', '差异标记', '+/-']],
        ['account', '设置', '账户', 'account', ['邮箱', '换绑邮箱', '修改密码', '退出登录', '退出所有其他设备', '注销账号', '显示昵称', '头像', '选择图片', '移除头像', '账户名', '本机账户', '登录以使用远程访问']],
        ['devices', '设置', '设备', 'desktop', ['连接', '配对', '添加', '待批准', '二维码', '手机', '原话与记忆', '同步', '最近收到', '副本最近更新', '修改名称', '移除设备']],
        ['usage', '设置', '用量', 'chart', ['费用', '账单', '月度上限（元）', '仅本月临时上限（元）', '模型单价', '排行', 'token']],
        ['data', '设置', '数据与存储', 'archive', ['占用', '空间', '清理缓存', '导出全部数据', '删除本账户的全部数据', '注销账号', '缩略图', '临时文件', '旧日志', '过期副本']],
        ['archived', '设置', '已归档', 'archive', ['对话', '搜索', '恢复', '删除']],
        ['models', '模型与能力', '模型', 'model', ['主模型', '对话默认模型', '后台模型', '模型服务', '服务地址', '密钥', '显示模型', '隐藏模型', '添加模型', '测试连接', '位置', '模型 ID', 'API']],
        ['approvals', '模型与能力', '权限', 'approval', ['默认', '模式', '权限', '自动', '询问', '动手前多看一眼', '读文件', '写文件', '删除', '运行命令', '联网', '对外发送', '花钱', '安装软件', '改系统设置', '恢复默认']],
        ['connectors', '模型与能力', '能力', 'tool', ['连接器', '工具', '连接', '凭据', '邮件', '日历', '技能', 'DSH', '已安装', '已启用', '已配置', '搜索能力', '筛选能力']],
        ['executionRecords', '模型与能力', '执行记录', 'clock', ['操作', '审批', '记录', '历史', '项目']],
        ['memory', '模型与能力', '记忆', 'memory', ['理解', '来源', '纠正', '管理']],
        ['schedules', '模型与能力', '提醒与定时任务', 'clock', ['提醒', '定时', '任务', '暂停', '恢复']],
        ['resources', '模型与能力', '资料访问', 'folder', ['项目', '成果', '网页资料', '项目名称', '资料目录', '公共网页链接', '希望整理什么', '电脑模型', '登记项目']],
        ['system', '此电脑', '系统状态', 'tool', ['服务', '宿主', '重启', '修复', '诊断包', '运行表现', '启动用时', '回复首字', '当前内存', '运行记录']],
        ['backups', '此电脑', '备份与恢复', 'archive', ['每日自动备份', '备份目录', '最近保留天数', '每周保留份数', '立即备份', '恢复', '刷新备份列表'], true],
        ['about', '关于', '关于', 'info', ['版本', '条款', '隐私', '更新通道', '检查更新', '更新内容', '帮助与反馈', '帮助与小技巧']],
    ];
    function settingsRegistry(mounts = {}) {
        return createSettingsRegistry(definitions.map(([id, group, name, icon, keywords, desktopOnly]) =>
            ({ id, group, name, icon, keywords, desktopOnly, mount: (...args) => mounts[id]?.(...args) })));
    }
    const messageModeSetting = {
        name: '回复进行中时发送的消息',
        options: [['queue', '排队', '等当前回复结束后作为下一条处理。'], ['steer', '引导', '插入当前回复，引导它调整方向。']],
    };
    Object.assign(globalThis.WeftUiCore, { createSettingsRegistry, settingsRegistry, messageModeSetting });
})();
