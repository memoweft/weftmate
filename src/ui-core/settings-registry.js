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
        ['general', '设置', '常规', 'settings', ['开机', '自启', '通知', '托盘', '语言']],
        ['personalization', '设置', '个性化', 'edit', ['称呼', '昵称', '简介', '语气', '固定说明', '写作风格']],
        ['assistant', '设置', '助手', 'model', ['下一步建议', '补全', '网页搜索', '成文前核对事实', '出处', '回答详细程度', '显示思考过程', '深入思考', '回复进行中时发送的消息', '引导', '排队']],
        ['notifications', '设置', '通知', 'bell', ['声音', '勿扰', '主动', '上限', '待审批', '待回答']],
        ['appearance', '设置', '外观', 'palette', ['主题', '浅色', '深色', '颜色', '字号', '字体', '减少动态效果', '动画']],
        ['account', '设置', '账户', 'account', ['邮箱', '密码', '退出', '注销', '昵称', '头像']],
        ['devices', '设置', '设备', 'desktop', ['连接', '配对', '添加', '待批准', '二维码']],
        ['usage', '设置', '用量', 'chart', ['费用', '账单', '月度', '上限', '排行', 'token']],
        ['data', '设置', '数据与存储', 'archive', ['占用', '空间', '清理', '导出', '删除', '注销']],
        ['archived', '设置', '已归档', 'archive', ['对话', '搜索', '恢复', '删除']],
        ['models', '模型与能力', '模型', 'model', ['主模型', '后台', '档案', '提供方', 'API']],
        ['approvals', '模型与能力', '审批', 'approval', ['默认', '模式', '权限', '自动', '询问']],
        ['memory', '模型与能力', '记忆', 'memory', ['理解', '来源', '纠正', '管理']],
        ['schedules', '模型与能力', '提醒与定时任务', 'clock', ['提醒', '定时', '任务', '暂停', '恢复']],
        ['resources', '模型与能力', '资料访问', 'folder', ['项目', '成果', '网页', '目录']],
        ['system', '此电脑', '系统状态', 'tool', ['服务', '宿主', '重启', '修复'], true],
        ['backups', '此电脑', '备份与恢复', 'archive', ['备份', '恢复', '自动', '保留'], true],
        ['about', '关于', '关于', 'info', ['版本', '条款', '隐私', '更新']],
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
