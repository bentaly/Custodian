/// <reference types="vite/client" />

// Side-effect CSS imports (`import './styles/globals.css'`). Vite resolves these
// at build time; TypeScript 7 requires an ambient declaration for them.
declare module '*.css' {}
