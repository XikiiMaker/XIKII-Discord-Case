# XIKII Discord Case

基于 [WebCord](https://github.com/SpacingBat3/WebCord)（Electron + TypeScript）的 Discord 中英双向实时翻译客户端，使用阿里云通义千问（Qwen / DashScope）。本版语言范围仅中文、英文。

## 项目目标

- 收到英文消息时，异步翻译为中文，可选择保留原文。
- 发送消息时，支持中译英、英译中；默认发送目标为英语。
- 私信默认开启翻译；频道默认关闭，支持独立开启。
- 参考 xikii 会员系统的聊天 Prompt 与语言判断，新增缓存和上下文管理。

## 当前状态

已导入 WebCord，完成翻译代码、22 项自动测试和 14 项 Electron 模拟联调。真实 Qwen 中英测试已通过，包含格式保留、上下文、流式输出和缓存命中。真实 Discord 的 Slate 输入框和消息发送仍待联调；模拟通过不代表真实页面兼容性已经通过。

详细范围见 [项目需求书](docs/requirements.md)、[已确认需求与进度](docs/implementation-plan.md)、[验证记录](docs/validation.md) 和 [上游来源](docs/upstream.md)。

## 计划架构

```text
Discord 页面 / preload
        │ 窄接口 IPC
Electron 主进程
        ├── 翻译设置与 safeStorage 密钥管理
        ├── 队列、并发控制、缓存与上下文
        └── Qwen / DashScope 调用
```

API Key 仅供主进程使用，不向 Discord 页面暴露，不提交到 Git。接入 WebCord 源码时保留上游许可证及版权声明，并核实二次开发和分发要求。

## 开发阶段

1. 基础设施：导入并验证 WebCord，核对 xikii 参考实现，封装 Qwen 调用。
2. 翻译核心：完成接收与发送翻译、语言判断、缓存和调度。
3. UI 与设置：完成密钥配置、目标语言、私信默认行为及频道开关。
4. 增强与优化：上下文、预览、快捷键、流式响应、降级和性能验证。

## 本地开发

建议 Node.js 24，首次安装：

```powershell
npm ci
# 若 Electron 二进制尚未安装：
node node_modules/electron/install.js
npm test
npm start
```

从客户端「文件 → 设置 → 翻译设置」选择地域、模型，保存本机 API Key 并确认启用。自动发送默认关闭；开启后翻译完成自动发送。上下文、流式输出默认关闭。输入区域支持本会话开关、中英目标语言选择和译文预览。Ctrl+Alt+T 切换本会话翻译，Ctrl+Enter 发送原文；频道列表显示翻译标识，右键可控制会话设置。

`npm run test:electron` 运行完全本地的模拟联调，不发送真实消息。当前保留上游图标，尚未制作 XIKII 品牌图标和正式安装包。
