/* Pure human-facing formats, also imported by health templates on the server. */
globalThis.WeftHumanFormat = Object.freeze({
    formatDuration(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
        const minutes = Math.round(value), hours = Math.floor(minutes / 60), rest = minutes % 60;
        return hours ? `${hours} 小时${rest ? ` ${rest} 分` : ''}` : `${rest} 分`;
    },
    formatMoney(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '费用未知';
        if (value > 0 && value < .01) return '不到 1 分钱';
        return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    formatTextUsage(value) {
        return `约 ${(value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 千字`;
    },
});
