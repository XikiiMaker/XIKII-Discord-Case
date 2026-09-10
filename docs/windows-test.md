# Windows 中英互译测试

本版仅支持中文与英文。可选自动发送默认关闭，上下文和流式输出默认关闭，保留接收原文默认开启。未配置 Key 并确认启用前，不会请求翻译服务。

## 获取本地构建

在仓库根目录执行：

```powershell
$env:WEBCORD_BUILD='release'
npm run make -- --platform win32 --arch x64
```

生成位置：

- ZIP：`out/release/make/zip/win32/x64/XIKII Discord Case-win32-x64-0.1.0.zip`。
- EXE 安装包：`out/release/make/squirrel.windows/x64/xikii-discord-case-squirrel-x64.exe`。
- MSI：同目录的 `xikii-discord-case-squirrel-x64.msi`。
- 已解包客户端：`out/release/XIKII Discord Case-win32-x64/xikii-discord-case.exe`。

测试可直接运行已解包客户端；分发 ZIP 时应完整解压，保留同目录资源。当前包用于联调，安装/卸载及真实 Discord 兼容性还未验收。

## 人工验收

1. 登录自己的 Discord 账号，打开已授权的 [autotrans 测试频道](https://discord.com/channels/644735114240196647/1397651222143434802)。
2. 在「文件 → 设置 → 翻译设置」选择与 Key 一致的地域、可用 Qwen 模型，填写自己的 Key，并阅读启用提示。确认后再打开本频道翻译。
3. 输入明确标记的人工测试文字，例如 `[XIKII TEST] 你好，这是一条中英互译测试。`。默认按 Enter 只生成英语预览，确认后发送一次。核对实际消息及草稿状态。
4. 接收人工英语测试消息，检查中文译文、原文显示开关及流式进度。上下文关闭时不携带最近对话；开启后检查语境有帮助且不会出现在输出中。
5. 切换自动发送，确认一次 Enter 只发一条译文。翻译期间修改草稿、切换频道，旧译文不能误发。检查 Shift+Enter 换行、中文输入法确认和 Ctrl+Enter 原文发送。
6. 检查频道开关、Ctrl+Alt+T、右键菜单、列表标识及重启后设置保留。普通频道默认关闭。
7. Discord 的结构化提及及自定义表情输入块仍须单独适配验证；目前遇到此类输入保留草稿并提示，不进行整框替换。

测试记录应注明客户端版本、操作、预期结果和实际结果。不要提交 Key、登录数据或真实聊天记录。API 测试脚本的已授权预算独立记录于本机 `cache/live-qwen-budget.json`，不要删除或重置来增加调用次数。
