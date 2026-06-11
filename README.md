# Orion

Personal macOS desktop app for running local LLMs via [MLX](https://github.com/ml-explore/mlx).
Electron + React + TypeScript shell with two uv-managed Python sidecars:
an OpenAI-compatible inference server ([oMLX](https://github.com/jundot/omlx)) and a
FastAPI tools service (model downloads, document extraction, RAG, web search, news).
Agentic coding tabs are powered by an embedded [opencode](https://opencode.ai) instance.

> Built for a single user on Apple Silicon. No auth, no telemetry — everything runs
> on-device; model weights live in the shared Hugging Face cache
> (`~/.cache/huggingface/hub`).

## Requirements

- macOS on Apple Silicon (developed on an M4 Pro with 24 GB unified memory)
- Node 22+ and npm
- [uv](https://docs.astral.sh/uv/) (Python 3.12+ sidecar venvs are synced with it)

## Development

```sh
npm install
uv sync --project sidecars/engine
uv sync --project sidecars/tools
npm run dev        # electron-vite dev: renderer HMR, main rebuilt on change
```

Other commands:

- `npm run typecheck` — `tsc --noEmit`
- `npm run rebuild` — rebuild native modules (node-pty) after Electron upgrades
- `npm run dist` — package a DMG (arm64)

## Architecture

- `src/shared/ipc.ts` — typed (zod) IPC contract between renderer and main;
  the renderer never talks to the sidecars directly
- `src/main/services/` — orchestration: sidecar supervision, model tiers,
  chat pipeline, SQLite (via `node:sqlite`) with versioned migrations
- `sidecars/engine` — oMLX OpenAI-compatible multi-model server (dynamic port)
- `sidecars/tools` — FastAPI: downloads, extraction, RAG (LanceDB), search, news
- `resources/skills/` — bundled skill packs copied into app data on first run

App data lives in `~/Library/Application Support/Orion/`.

## License

[MIT](LICENSE)
