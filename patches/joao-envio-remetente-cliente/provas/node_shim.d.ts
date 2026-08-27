declare module 'node:fs' { export function readFileSync(p: any, enc: any): string; }
declare const process: { exit(code: number): void; argv: string[] };
