# 原生整屏测量

系统主题列为设备的实际全局模式；`Night mode: no` 表示系统浅色，页面仍可显式深色。所有图片为 Android 15 原始整屏。导航区域均隐藏，因此底部系统栏未验收。

| 原图 | 系统 / 页面 | 底部导航 | IME 高度 | 状态栏高度 | ΔRGB | 图标一致 |
|---|---|---|---:|---:|---:|---|
| [local-offline-light.png](local-offline-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [local-offline-dark.png](local-offline-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [local-recovered-light.png](local-recovered-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [local-recovered-dark.png](local-recovered-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-login-light.png](cloud-login-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-login-dark.png](cloud-login-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-main-light.png](cloud-main-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-drawer-status-dots-light.png](cloud-drawer-status-dots-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-fullscreen-search-light.png](cloud-fullscreen-search-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-top-more-menu-light.png](cloud-top-more-menu-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-data-storage-light.png](cloud-data-storage-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-data-storage-toast-light.png](cloud-data-storage-toast-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-composer-focused-without-ime-light.png](cloud-composer-focused-without-ime-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-main-dark.png](cloud-main-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-drawer-status-dots-dark.png](cloud-drawer-status-dots-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-fullscreen-search-dark.png](cloud-fullscreen-search-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-top-more-menu-dark.png](cloud-top-more-menu-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-data-storage-dark.png](cloud-data-storage-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-data-storage-toast-dark.png](cloud-data-storage-toast-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-composer-focused-without-ime-dark.png](cloud-composer-focused-without-ime-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-offline-light.png](cloud-offline-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-offline-dark.png](cloud-offline-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-recovered-light.png](cloud-recovered-light.png) | Night mode: no / light | 隐藏 | 0 | 31 | 0.000 | 是 |
| [cloud-recovered-dark.png](cloud-recovered-dark.png) | Night mode: no / dark | 隐藏 | 0 | 31 | 0.000 | 是 |

`composer-focused-without-ime` 只有输入框聚焦，未出现真实键盘，不计键盘验收。请求与窗口原始值见 `results.json.keyboardGaps`。

## 四种场景

| 登录路径 | 场景 | 登录保持 | 主对话回复 |
|---|---|---|---|
| 本地原生备用页 | fresh-install | 是 | 成功 |
| 本地原生备用页 | host-restart | 是 | 成功 |
| 本地原生备用页 | background-return | 是 | 成功 |
| 本地原生备用页 | process-reopen | 是 | 成功 |
| 云登录 + 设备批准 | fresh-install | 是 | 成功 |
| 云登录 + 设备批准 | host-restart | 是 | 成功 |
| 云登录 + 设备批准 | background-return | 是 | 成功 |
| 云登录 + 设备批准 | process-reopen | 是 | 成功 |
