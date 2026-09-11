# Windows 中英互译测试

本版仅支持中文与英文。会话开关开启后直接翻译发送，不提供预览；上下文和流式输出默认关闭，保留接收原文默认开启。未配置 Key 并确认启用前，不会请求翻译服务。

## 获取本地构建

Windows 包必须带代码签名再构建。应用启动时会写开始菜单快捷方式、客户端设置会写自启动注册表键，未签名的 Electron 主程序做这些动作会被 Windows Defender 的行为监控判为持久化木马，直接结束进程并隔离 `xikii-discord-case.exe`（0.1.3 的解包版就是这样丢掉主程序的）。

首次在一台机器上构建前，生成一张自签名代码签名证书并让本机信任它（第二条需要管理员权限）：

```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=XikiiMaker, O=XikiiMaker, C=CN' `
  -KeyUsage DigitalSignature -KeyExportPolicy Exportable -KeyLength 3072 -HashAlgorithm SHA256 `
  -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)
Export-Certificate -Cert $cert -FilePath "$env:TEMP\xikii-codesign.cer"
$cert.Thumbprint
```

```powershell
# 管理员 PowerShell：让本机信任该证书，否则签名链无效
Import-Certificate -FilePath "$env:TEMP\xikii-codesign.cer" -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath "$env:TEMP\xikii-codesign.cer" -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

自签名证书只能让本机把主程序当作可信发布者，分发给别人时首次运行仍会出现 SmartScreen 警告；要消除该警告需要 OV/EV 证书。

在仓库根目录构建，`XIKII_SIGN_THUMBPRINT` 缺失时不会签名：

```powershell
$env:WEBCORD_BUILD='release'
$env:XIKII_SIGN_THUMBPRINT='<上一步输出的证书指纹>'
npm run make -- --platform win32 --arch x64
```

时间戳默认走 `http://timestamp.digicert.com`，可用 `XIKII_SIGN_TIMESTAMP` 覆盖。构建还需要访问 `github.com` 校验 Electron 二进制的 `SHASUMS256.txt`，该地址不通时会报 `ECONNRESET` 或 `ETIMEDOUT`，重试即可。

生成位置：

- ZIP：`out/release-0.1.5/make/zip/win32/x64/XIKII Discord Case-win32-x64-0.1.5.zip`。
- EXE 安装包：`out/release-0.1.5/make/squirrel.windows/x64/xikii-discord-case-squirrel-x64.exe`。
- MSI：同目录的 `xikii-discord-case-squirrel-x64.msi`。
- 已解包客户端：`out/release-0.1.5/XIKII Discord Case-win32-x64/xikii-discord-case.exe`。

用 `signtool verify /pa <文件>` 确认签名有效。日常使用请运行 EXE 安装包，它会装到 `%LOCALAPPDATA%\xikii_discord_case` 并生成跨版本稳定的启动器；不要长期直接运行 `out` 下的解包版，文档目录里的可执行文件是 Defender 容忍度最低的位置之一。

先从托盘彻底退出旧版，再运行新包，否则单实例机制会唤起旧版窗口。登录和设置沿用原配置目录。分发 ZIP 时应完整解压，保留同目录资源。

## 人工验收

1. 登录自己的 Discord 账号，打开自己有权发送测试消息的频道。
2. 在「右键频道 → 翻译设置 → 翻译设置」选择与 Key 一致的地域、可用 Qwen 模型，填写自己的 Key，并阅读启用提示。确认后再打开本频道翻译。
3. 输入明确标记的人工测试文字，例如 `[XIKII TEST] 你好，这是一条中英互译测试。`。开启名称旁的翻译开关，按 Enter 直接发送一条英语译文。核对实际消息及草稿清空，不出现预览或工具栏。
4. 接收人工英语测试消息，检查中文译文、原文显示开关及流式进度。上下文关闭时不携带最近对话；开启后检查语境有帮助且不会出现在输出中。
5. 切换会话翻译开关，开启时一次 Enter 只发一条译文，关闭时普通发送。翻译期间修改草稿、切换频道，旧译文不能误发。检查 Shift+Enter 换行、中文输入法确认和 Ctrl+Enter 原文发送。
6. 检查频道开关、Ctrl+Alt+T、右键菜单、名称旁开关及重启后设置保留。普通频道默认关闭。
7. 在人工测试消息中加入真正的 @提及和自定义表情，检查文字翻译后对象及多段换行仍保留；无法定位编辑节点或标记受损时应保留当前草稿、不自动发送。此项已通过本地 Slate 测试，仍需实际 Discord 复核。

8. 从托盘正常退出、重新打开，确认无需再次输入账号密码。主动退出 Discord 账号后应保持登出。
9. 「右键频道 → 翻译设置 → 客户端设置」勾选开机启动并保存；重开设置核对。Windows 注销/重新登录后客户端应自动进入托盘；取消勾选后不再启动。移动便携版目录后应重新保存启动项，建议日常使用安装版的稳定路径。
10. 将桌面通知权限设为允许，保存并点击系统测试通知；检查横幅、声音及点击恢复窗口。再让测试账号在测试频道提及你或发私信，检查真实通知跳转目标、托盘计数 1→2→已读、后台任务栏闪烁和前台停止闪烁。Discord 通知选项与 Windows 勿扰会影响横幅和声音，单个测试通知不能证明真实消息路径全部通过。

测试记录应注明客户端版本、操作、预期结果和实际结果。不要提交 Key、登录数据或真实聊天记录。API 测试脚本的已授权预算独立记录于本机 `cache/live-qwen-budget.json`，不要删除或重置来增加调用次数。
