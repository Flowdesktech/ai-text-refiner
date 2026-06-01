# Contributing to AI Text Refiner

Thanks for taking the time to contribute! 🎉 This document explains how to get set up and the
conventions we follow.

## Development setup

Prerequisites: **Node.js >= 20** and npm.

```bash
git clone https://github.com/your-username/ai-text-refiner.git
cd ai-text-refiner
npm install
npm run dev
```

`npm install` runs `electron-builder install-app-deps` to rebuild native modules
(`@nut-tree-fork/nut-js`) against your Electron version.

## Useful scripts

| Script                                         | What it does                                          |
| ---------------------------------------------- | ----------------------------------------------------- |
| `npm run dev`                                  | Launch the tray app + settings window with hot reload |
| `npm run build`                                | Production bundle via electron-vite                   |
| `npm run typecheck`                            | Type-check the main and renderer projects             |
| `npm run format`                               | Format the codebase with Prettier                     |
| `npm run pack:win` / `pack:mac` / `pack:linux` | Build a platform installer                            |

## Project layout

- `src/main` — Electron main process (lifecycle, tray, global hotkeys, refine flow).
- `src/main/automation.ts` — clipboard + synthetic keystrokes (nut-js).
- `src/main/providers.ts` — provider HTTP calls (OpenAI / Anthropic / Gemini).
- `src/preload` — typed IPC bridge exposed as `window.refiner`.
- `src/renderer` — React settings UI + status overlay.
- `src/shared` — types shared across processes.

## Before opening a PR

1. `npm run typecheck` passes.
2. `npm run format` has been run (or `npm run format:check` is clean).
3. The app still launches with `npm run dev`.
4. Describe **what** and **why** in the PR, and how you tested it.

## Commit style

Short, imperative subject lines (e.g. `add Gemini streaming`, `fix clipboard restore on Linux`).
Conventional Commit prefixes (`feat:`, `fix:`, `docs:`) are welcome but not required.

## Adding a new provider

1. Add an entry to `PROVIDERS` and `PROVIDER_MODELS` in `src/shared/types.ts`.
2. Implement a `refineX(prompt, apiKey, model)` function and register it in the `dispatch` map in
   `src/main/providers.ts`.
3. Add the `ProviderId` to the union type.

## Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).
