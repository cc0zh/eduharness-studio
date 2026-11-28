export function pnpmScript(script, ...args) {
  // pnpm exposes its launcher through the standard package-script environment variable.
  const launcher = process.env.npm_execpath;
  if (!launcher) return undefined;
  const command = ['--silent', 'run', script, ...args];
  return /\.[cm]?js$/i.test(launcher)
    ? { executable: process.execPath, args: [launcher, ...command] }
    : { executable: launcher, args: command };
}
