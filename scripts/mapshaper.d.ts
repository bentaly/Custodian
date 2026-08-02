// mapshaper ships no types. Only `applyCommands` is used, and only by
// scripts/build-geo.ts — a build-time script that never enters the bundle.
declare module 'mapshaper' {
  /** Runs a mapshaper command string; resolves to { filename: contents }. */
  export function applyCommands(commands: string): Promise<Record<string, string>>
}
