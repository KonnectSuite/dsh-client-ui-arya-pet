---
description: "Built-in full-body Arya pet shared by the AryaAI WebUI and desktop workspace."
kind: "package-bundle"
---

# @deepseek-ai/dsh-client-ui-arya-pet

English | [中文](README.zh.md)

## Summary

AryaAI's built-in full-body pet follows live session activity and supports dragging, pinning, scaling, mouse tracking, progress bubbles, optional sounds, and periodic summaries. WebUI and Electron share the same overlay.

Users can override the 8-column by 11-row v2 `arya` atlas from `$DSH_HOME/pets`.

It adapts Signalight's MIT-licensed `@signalight/dsh-codex-pet` 0.3.1; `LICENSE` retains the notice.

It ships in `@deepseek-ai/dsh-web-app` without a profile-installed bundle.

No invariant companion is published because this browser presentation and its optional auxiliary summary route do not validate host request invariants.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Activity animation

#### What the model sees

Nothing. The overlay reads existing `sessions` state to choose Arya's animation without changing the main agent's prompt, messages, tools, or results.

#### Token effect

None. Rendering and animation run only in the browser.

#### KV Cache effect

None. Reading the browser projection does not alter a request or its cache key.

### Periodic pet summaries

#### What the model sees

Only when the user enables periodic summaries, the plugin sends a bounded JSON record of completed requests to the provider and model selected in Arya pet settings. The summary model receives an English system instruction to report the work briefly in Arya's first-person voice.

#### Token effect

Each configured interval creates one separate, capped summary request. The result is shown in Arya's speech bubble and is not appended to the main chat.

#### KV Cache effect

No effect on the main agent cache. Summary requests use their own short context.

## Known Limitations and Deferred Work

- Imported pets must use the supported 1536 x 1872 v1 or 1536 x 2288 v2 atlas layout.
- Browsers may block event sounds until the user first interacts with the page.
- Periodic summaries require an explicitly selected provider and model and may add usage charges for that route.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Maintainer context</summary>

Retain the LICENSE attribution when changing the atlas.

</details>

Optional Arya product bundles are selected in the profile and managed through Plugin Market. Disabling or removing a shipped bundle changes the profile selection; it does not erase installer-owned package files. The same pinned package remains available for restoration. Core runtime and plugin management services remain protected.
