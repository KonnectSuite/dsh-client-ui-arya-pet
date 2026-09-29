---
description: "Built-in full-body Arya pet shared by the AryaAI WebUI and desktop workspace."
kind: "package-reference"
---
<!-- MIRROR NOTICE - added by the mirror, not part of the package. -->

> ### This repository is a mirror, not a standalone build
>
> `@deepseek-ai/dsh-client-ui-arya-pet` is a plugin for **AryaAI**, a DeepSeek Harness fork. Its source
> depends on `@deepseek-ai/dsh-*` core packages at workspace version `0.1.7-rc.2`
> through `workspace:*`, and those versions are not published. The releases on npm
> are older (`0.0.1-rc.1`), so `pnpm install` and a build **will not work** in a
> fresh clone of this repository.
>
> To work on it, place this package into an AryaAI checkout at `packages/client/ui-arya-pet`.
> This mirror exists so the source and its built output are versioned and reviewable
> in one place.
>
> The built output under `lib/` is committed for reference. It was produced inside
> the AryaAI workspace at `0.1.7-rc.2`.

---

# @deepseek-ai/dsh-client-ui-arya-pet

English | [中文](README.zh.md)

## Summary

AryaAI's built-in full-body pet follows live session activity and supports
dragging, pinning, scaling, mouse tracking, progress bubbles, optional sounds,
and periodic summaries. WebUI and Electron share the same overlay.

Users can override the 8-column by 11-row v2 `arya` atlas from `$DSH_HOME/pets`.

It adapts Signalight's MIT-licensed `@signalight/dsh-codex-pet` 0.3.1;
`LICENSE` retains the notice.

It ships in `@deepseek-ai/dsh-web-app` without a profile-installed bundle.

No invariant companion is published because this browser presentation and its
optional auxiliary summary route do not validate host request invariants.

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

- Imported pets must use the supported 1536 x 1872 v1 or 1536 x 2288 v2 atlas
  layout.
- Browsers may block event sounds until the user first interacts with the page.
- Periodic summaries require an explicitly selected provider and model and may
  add usage charges for that route.
