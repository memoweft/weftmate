/* Backup behavior shared by clients; presentation owns its controls. */
globalThis.WeftUiCore.factories.backup = core => {
    const write = (path, body, method = 'POST') => core.accessApi(path, { method, protectedWrite: true, body });
    return {
        readBackups: () => core.accessApi('/backups'),
        saveBackupSettings: body => write('/backups/settings', body, 'PATCH'),
        createBackup: () => write('/backups', {}),
        importBackup: path => write('/backups/import', { path }),
        restoreBackup: id => write('/backups/restore', { id, confirm: true }),
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
