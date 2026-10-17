---
description: "AryaAI WebUI 与桌面工作区共用的内置全身 Arya 宠物。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-arya-pet

[English](README.md) | 中文

## 概述

AryaAI 的内置全身宠物会跟随实时会话活动，并支持拖动、固定、缩放、 鼠标跟踪、进度气泡、可选提示音和定期摘要。WebUI 和 Electron 共用此浮层。

用户可以从 `$DSH_HOME/pets` 覆盖 8 列 11 行的 v2 `arya` 图集。

本实现改编自 Signalight 以 MIT 许可证发布的 `@signalight/dsh-codex-pet` 0.3.1；`LICENSE` 保留了上游声明。

它随 `@deepseek-ai/dsh-web-app` 提供，无需安装到配置文件中的外部包。

本包不会发布 invariant 配套插件，因为此浏览器展示及其可选辅助摘要路由 不会验证主机请求 invariant。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 活动动画

#### 模型看到的内容

无。此浮层读取现有 `sessions` 状态来选择 Arya 的动画，不会更改主 agent 的 提示词、消息、工具或结果。

#### Token 影响

无。渲染和动画仅在浏览器中运行。

#### KV Cache 影响

无。读取浏览器投影不会更改请求或其缓存键。

### 定期宠物摘要

#### 模型看到的内容

仅当用户启用定期摘要时，插件才会把已完成请求的有界 JSON 记录发送给 Arya 宠物设置中选择的提供商和模型。摘要模型会收到一条英文系统指令， 要求以 Arya 的第一人称口吻简短报告工作。

#### Token 影响

每个配置的间隔都会创建一次独立且有上限的摘要请求。结果显示在 Arya 的 对话气泡中，不会追加到主聊天。

#### KV Cache 影响

不影响主 agent 缓存。摘要请求使用自己的短上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 导入的宠物必须使用受支持的 1536 x 1872 v1 或 1536 x 2288 v2 图集布局。
- 浏览器可能会在用户首次与页面交互之前阻止事件提示音。
- 定期摘要需要明确选择提供商和模型，并可能为该路由增加使用费用。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者上下文</summary>

修改图集时保留 LICENSE 中的授权声明。

</details>

可选 Arya 产品 bundle 由 profile 选择并通过插件市场管理。禁用或移除随安装包提供的 bundle 会改变 profile 选择，不会删除安装包拥有的文件；同一固定版本仍可恢复。核心运行时与插件管理服务仍受保护。
