import { join } from 'node:path';
import { homedir } from 'node:os';

export const BASE_DIR = join(homedir(), '.wp-playground-mcp');
export const INSTANCES_DIR = join(BASE_DIR, 'instances');
export const BLUEPRINTS_DIR = join(BASE_DIR, 'blueprints');
export const LOGS_DIR = join(BASE_DIR, 'logs');
export const STATE_FILE = join(INSTANCES_DIR, 'active.json');
export const LAST_BLUEPRINT_FILE = join(BLUEPRINTS_DIR, 'last-used.json');
export const LOG_FILE = join(LOGS_DIR, 'playground.log');

export const DEFAULT_PORT = 9400;
export const MAX_PORT = 9410;
export const STARTUP_TIMEOUT_MS = 120_000;
export const SHUTDOWN_TIMEOUT_MS = 5_000;
export const HEALTH_CHECK_INTERVAL_MS = 500;

export const DEFAULT_CREDENTIALS = {
  username: 'admin',
  password: 'password',
};

export const SUPPORTED_PHP_VERSIONS = ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4', 'latest'];

export const VALID_STEP_TYPES = [
  'activatePlugin',
  'activateTheme',
  'cp',
  'defineWpConfigConsts',
  'defineSiteUrl',
  'enableMultisite',
  'importWxr',
  'importThemeStarterContent',
  'importWordPressFiles',
  'installPlugin',
  'installTheme',
  'login',
  'mkdir',
  'mv',
  'resetData',
  'request',
  'rm',
  'rmdir',
  'runPHP',
  'runPHPWithOptions',
  'runSql',
  'setSiteOptions',
  'unzip',
  'wp-cli',
  'writeFile',
  'writeFiles',
];

export const VALID_RESOURCE_TYPES = [
  'wordpress.org/plugins',
  'wordpress.org/themes',
  'url',
  'literal',
  'vfs',
  'bundled',
  'git:directory',
  'literal:directory',
  'zip',
];

export const STEP_REQUIRED_PARAMS = {
  activatePlugin: ['pluginPath'],
  activateTheme: ['themeFolderName'],
  cp: ['fromPath', 'toPath'],
  defineWpConfigConsts: ['consts'],
  defineSiteUrl: ['siteUrl'],
  enableMultisite: [],
  importWxr: ['file'],
  importThemeStarterContent: [],
  importWordPressFiles: ['wordPressFilesZip'],
  installPlugin: ['pluginData'],
  installTheme: ['themeData'],
  login: [],
  mkdir: ['path'],
  mv: ['fromPath', 'toPath'],
  resetData: [],
  request: ['request'],
  rm: ['path'],
  rmdir: ['path'],
  runPHP: ['code'],
  runPHPWithOptions: ['options'],
  runSql: ['sql'],
  setSiteOptions: ['options'],
  unzip: ['zipPath', 'extractToPath'],
  'wp-cli': ['command'],
  writeFile: ['path', 'data'],
  writeFiles: ['filesTree'],
};
