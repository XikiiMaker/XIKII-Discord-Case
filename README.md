# XIKII Discord Case

基于 [WebCord](https://github.com/SpacingBat3/WebCord)（Electron + TypeScript）的 Discord 双向实时翻译客户端项目，计划接入阿里云通义千问（Qwen / DashScope）。

## 项目目标

- 收到外语消息时，异步翻译为中文，在原文下方显示译文。
- 发送中文消息时，翻译为用户选择的目标语言。
- 私信默认开启翻译；频道默认关闭，支持独立开启。
- 参考 xikii 会员系统已验证的翻译实现，复用 Prompt、语言判断、缓存和上下文管理。

## 当前状态

项目初始化：已整理需求，尚未导入 WebCord 源码或实现翻译功能。xikii 内部参考模块尚未提供，不能将计划复用的能力视为已完成。

详细范围和优先级见 [项目需求书](docs/requirements.md)。

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

本仓库尚无可运行应用；构建、启动及测试命令将在导入上游后补充。
