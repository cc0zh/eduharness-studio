const systemKeys = new Set([
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LOCALAPPDATA',
  'APPDATA',
]);

export function offlineServerEnv(envFile) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => systemKeys.has(name.toUpperCase())),
    ),
    STUDIO_ENV_FILE: envFile,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}
