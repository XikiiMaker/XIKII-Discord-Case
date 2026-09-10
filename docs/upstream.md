# 上游来源

- 仓库：https://github.com/SpacingBat3/WebCord
- 导入分支：master
- 提交：fb7dc4905fe7a3774187ecc183ab0b8279dd67bd
- 导入版本：4.14.0
- 日期：2026-09-11
- 许可证：MIT，原版权声明完整保留在根目录 LICENSE。

本项目是在独立私有仓库导入上游快照，GitHub 上没有建立公开 fork 关系。Git remote `upstream` 指向官方仓库。后续升级应对照此提交审查差异。

上游工作流存档于 `docs/upstream-workflows/*.txt`，避免继承未经本项目配置的自动打包、发布和 issue 自动化。XIKII CI 模板保存在 `docs/ci.yml.example`，只执行编译、测试和 lint。当前 GitHub CLI 授权没有 workflow 写入权限，因此未启用远端 CI；本地验证已完成。正式发布另行配置。

上游的说明文档保留在本目录中，可能描述 WebCord 原产品。XIKII 当前范围以根 README 和 implementation-plan.md 为准。
