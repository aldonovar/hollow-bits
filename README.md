<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ETHEREAL STUDIO

Desktop-first DAW project focused on pro-level reliability, workflow speed, and long-term feature depth.

## Local setup

Prerequisites: Node.js LTS

1. Install dependencies
   - `npm install`
2. Configure env
   - set `GEMINI_API_KEY` in `.env.local`
3. Run web dev server
   - `npm run dev`
4. Run desktop app (Electron + Vite)
   - `npm run dev:electron`

## Polyphonic scanner piano engine

- Scanner preview now runs a fully local Concert Grand multi-layer engine (`public/instruments/piano-ultra/splendid-grand-piano`) via `services/proPianoEngine.ts`.
- Polyphonic detection uses Basic Pitch plus postprocessing, and now includes a physical harmonic refinement pass via `workers/note-transcriber.worker.ts`.
- No third-party piano import is required for playback quality.

## Windows x64 packaging

- Development runtime remains Electron while we keep the desktop bridge runtime-agnostic.
- Build Windows x64 installers/artifacts:
  - `npm run dist:win:x64`
  - `npm run dist:win:dir`
- Electron Builder output directory: `release/`

## Build and verification

- Typecheck: `npm exec tsc --noEmit`
- Production build: `npm run build`
- Desktop run: `npm run electron`

## Execution planning docs

- Master roadmap: `docs/MASTER_ROADMAP_DAW.md`
- Foundation backlog (P0): `docs/P0_EXECUTION_BACKLOG.md`
- Quality and release gates: `docs/QUALITY_AND_RELEASE_GATES.md`

## Current strategy

- Stabilize core transport/audio/editing reliability first.
- Convert all surfaced UI operations into fully functional production behavior.
- Scale toward advanced routing, automation, session workflow, and differentiation layers (AI + collaboration).
