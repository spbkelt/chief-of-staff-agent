export function notImplemented(command: string, targetPhase: string): never {
  console.error(`[${command}] Not yet implemented — planned for ${targetPhase}`);
  console.error(`Run \`pnpm demo\` for an end-to-end demonstration using fixture data.`);
  process.exit(1);
}
