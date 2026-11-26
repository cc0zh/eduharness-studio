import { appendFileSync } from 'node:fs';

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

export function offlineNetworkEnv(log) {
  appendFileSync(log, '');
  return {
    STUDIO_TEST_NETWORK_LOG: log,
    NODE_OPTIONS: `--import=${new URL('./network-fence.mjs', import.meta.url).href}`,
  };
}

export function offlineServerEnv(envFile) {
  const networkLog = process.env.STUDIO_TEST_NETWORK_LOG;
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => systemKeys.has(name.toUpperCase())),
    ),
    STUDIO_ENV_FILE: envFile,
    ...(networkLog && offlineNetworkEnv(networkLog)),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}
