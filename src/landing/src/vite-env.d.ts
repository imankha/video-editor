/// <reference types="vite/client" />

// The @editor/* alias points at the editor app's untyped .js/.jsx sources
// (shared player leaves). Treat them as `any` at the app boundary — the editor
// keeps its own type discipline; we only consume a few store-free modules.
declare module '@editor/*';
