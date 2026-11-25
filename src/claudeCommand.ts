/**
 * How to run the `claude` command on this OS.
 * On Windows an npm install puts a `claude.cmd` shim on PATH, which Node can only start through a shell,
 * so each argument is quoted for cmd.exe. The arguments are this app's own constants; anything cmd would expand is refused.
 */
export function claudeInvocation(args: string[], platform: NodeJS.Platform = process.platform): { file: string; args: string[]; shell: boolean } {
  if (platform !== 'win32') return { file: 'claude', args, shell: false };
  return { file: 'claude', args: args.map(cmdQuote), shell: true };
}

function cmdQuote(arg: string): string {
  if (/[%"!\r\n]/.test(arg)) throw new Error('Argument cannot be passed through cmd.exe.');
  return `"${arg}"`;
}

/** True when the failure means `claude` is not installed or not on PATH. */
export function claudeNotFound(err: unknown, stderr = ''): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT' || /is not recognized as an internal or external command/i.test(stderr);
}
