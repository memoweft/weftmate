/* Backup behavior shared by clients; presentation owns its controls. */
globalThis.WeftUiCore.factories.backup = core => {
    const write = (path, body, method = 'POST') => core.accessApi(path, { method, protectedWrite: true, body });
    return {
        readBackups: () => core.accessApi('/backups'),
        saveBackupSettings: body => write('/backups/settings', body, 'PATCH'),
        createBackup: () => write('/backups', {}),
        importBackup: path => write('/backups/import', { path }),
        restoreBackup: id => write('/backups/restore', { id, confirm: true }),
        readCloudBackups: () => core.accessApi('/backups/cloud'),
        cloudBackupAction: (action, body={}) => write(`/backups/cloud/${action}`, body),
        cloudBackupErrorText: error => {
            const groups=error?.invalidGroups || error?.details?.invalidGroups;
            if(error?.code==='CLOUD_BACKUP_RECOVERY_CODE')return groups?.length?`恢复码第 ${groups.join('、')} 组抄写不对，请检查后重试。`:'恢复码应有 8 组，请完整输入。';
            return ({CLOUD_BACKUP_CONFIRM_GROUP:'这一组不对，请核对保存的恢复码。',CLOUD_BACKUP_CONFIRM_EXPIRED:'这次确认已过期，请重新开启。',
                CLOUD_BACKUP_RECOVERY_MISMATCH:'恢复码不匹配，请使用这个账号当前的恢复码。',CLOUD_BACKUP_RECOVERY_REQUIRED:'请先用恢复码恢复已有备份，再开启这台电脑的备份。',
                CLOUD_BACKUP_RECOVERY_CHANGED:'恢复码已在另一台电脑更换。请使用新码，或在这里更换恢复码并重新保存。',KEY_CHANGED:'恢复码刚刚在另一台电脑更换，请关闭后重试。',
                CLOUD_BACKUP_CORRUPT:'这份备份损坏了，现有数据没有改变。请重试或选择另一份备份。',CLOUD_BACKUP_CHUNKS_MISSING:'备份没有下载完整，请重试；会接着下载。',
                CLOUD_BACKUP_NEWER_VERSION:'这份备份来自更新的 WeftMate，请先更新程序。',
                CLOUD_BACKUP_TOO_LARGE:'备份太大，超过了可用空间。请先做本机备份，并清理不需要的旧聊天。',
                BACKUP_QUOTA_EXCEEDED:'备份超过了可用空间。请删除旧的云端备份，或继续使用本机备份。',BACKUP_GLOBAL_QUOTA_EXCEEDED:'云端备份空间暂时满了。请稍后重试，或先做本机备份。',
                CLOUD_BACKUP_POWER_NETWORK:'已推迟大文件上传。请接上电源，并在自己的私人网络上重试。',
                CLOUD_BACKUP_UNAVAILABLE:'云端备份暂不可用。',INVALID_CREDENTIALS:'账号密码不对，请重新输入。',
                CLOUD_UNAVAILABLE:'网络中断了，请重试；上传和下载会接着进行。',SERVICE_CLOSING:'下次打开程序会接着备份。',
                CLOUD_BACKUP_DELETE_UNVERIFIED:'暂时无法核对删除结果，请重试。'})[error?.code] || core.backupErrorText(error);
        },
        async prepareAccountDeletionBackup() {
            const result = await write('/backups/prepare-account-deletion', {});
            if (!result.ready) throw { code: 'BACKUP_PAUSE_TIMEOUT' };
        },
        backupErrorText: error => ({ SESSION_BUSY: '助手正在处理任务，请等任务完成后重试。',
            BACKUP_PAUSE_TIMEOUT: '本次备份暂停写入超时，程序已继续运行。请稍后重试。',
            BACKUP_CORRUPT: '备份校验失败，无法恢复。请选择另一份备份。', BACKUP_SYMLINK: '数据中有文件链接，无法安全备份。请移除链接后重试。',
            FORBIDDEN: '请用这台电脑的本地账户管理整机备份。', CONFLICT: '已有备份操作正在处理，请稍后刷新。' })[error?.code] || '操作未完成，请检查目录是否可写并重试。',
    };
};
