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
        ['appearance', '设置', '外观', 'palette', ['主题', '浅色', '深色', '颜色', '字号', '字体', '密度']],
        ['account', '设置', '账户', 'account', ['邮箱', '密码', '退出', '注销', '昵称', '头像']],
        ['devices', '设置', '设备', 'desktop', ['连接', '配对', '添加', '待批准', '二维码']],
        ['usage', '设置', '用量', 'chart', ['费用', '账单', '月度', '上限', '排行', 'token']],
        ['models', '助手', '模型', 'model', ['主模型', '后台', '档案', '提供方', 'API']],
        ['approvals', '助手', '审批', 'approval', ['默认', '模式', '权限', '自动', '询问']],
        ['memory', '助手', '记忆', 'memory', ['理解', '来源', '纠正', '管理']],
        ['resources', '助手', '资料访问', 'folder', ['项目', '成果', '网页', '目录']],
        ['system', '此电脑', '系统状态', 'tool', ['服务', '宿主', '重启', '修复'], true],
        ['about', '关于', '关于', 'info', ['版本', '条款', '隐私']],
    ];
    function settingsRegistry(mounts = {}) {
        return createSettingsRegistry(definitions.map(([id, group, name, icon, keywords, desktopOnly]) =>
            ({ id, group, name, icon, keywords, desktopOnly, mount: (...args) => mounts[id]?.(...args) })));
    }
    Object.assign(globalThis.WeftUiCore, { createSettingsRegistry, settingsRegistry });
})();
