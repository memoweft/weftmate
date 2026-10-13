# 实际钥匙串结论

真实Electron 43.7.8 `safeStorage`，没有`--use-mock-keychain`，没有保管算法替身，最终包请求的服务名实测为 **`weftmate Safe Storage`**。`keychain.json`记录4个串行打包进程：初次加密/读取、同构建重开、改变资源并重新ad-hoc签名、丢失旧钥匙后明确重填。密钥为父进程随机值，不输出，普通设置/密文均不含该值。

为了不接触本人login钥匙串，测试动态库只把Security API的查询/新增限定在可丢弃文件钥匙串；不改默认钥匙串、搜索列表、用户权限设置或ACL。Crypto仍由真实safeStorage和macOS Security执行。系统交互在测试进程里关闭，避免任何权限弹窗。这验证OS实现/拒绝分支，不能代替本人login钥匙串实际点击允许。

| 情况 | encryptionAvailable | 旧密文可读 | 结果 |
|---|---|---|---|
| 初次构建 | true | true | OS创建加密钥匙，safeStorage加密/解密 |
| 同一构建重开 | true | true | 成功实际读取临时钥匙串条目 |
| ad-hoc构建CDHash变化 | false | false | 在禁止交互的隔离测试中访问失败，缺失凭据返回；进程正常关闭 |
| 一个新的临时钥匙串 | true | false | 旧密文完整保留，getCredential返回null |
| 明确调用模型表单提交用的saveSubmittedCredential | true | true | 新密钥恢复，原密文保留为replaced文件；没有启动时静默清空 |

原CDHash `a30f18b14742bdb88fba224ca0bc0b3fa176a0ff`，重签后 `795446549342005f6fc9cffad6d850924bc4cbd7`；最终正式交付又包含小量后续Mac配置/提示修改，因此不把这些哈希称为最终包签名哈希。跨构建结论适用于本次ad-hoc身份变化的实测样本，不保证所有升级都同样。本人以后换包可能被系统要求重新允许钥匙串访问；旧密钥读不出则需重填，若加密存储未准备好，先允许系统访问再退出重开。已写入旁边`先读我.txt`。

生产实现仍拒绝无加密后端的保存，不退成明文。此前已有的保险库保留/重填回归通过，Mac包本次未改保险库格式与Windows保管逻辑。[Electron官方safeStorage文档](https://www.electronjs.org/docs/latest/api/safe-storage)也要求macOS使用稳定签名以获得一致行为；未来Developer ID升级需单独真实授权验收。

失败证据：第一次隔离库在加载constructor里过早使用Security框架，两个窗口前启动以SIGSEGV退出，后来改为首次Security API调用才初始化；另一次测试eval不支持dynamic import，改为Node同步模块加载。没有把这些失败当作通过，也没有使用会主动触发系统崩溃的native断言。
