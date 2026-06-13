import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  logLevel: (typeof LOG_LEVELS)[number];
  env: 'development' | 'test' | 'production';
  /** Open a browser after listen (set via --open). */
  open: boolean;
}

const DEFAULTS: AppConfig = {
  port: 4870,
  host: '127.0.0.1',
  dataDir: path.join(os.homedir(), '.fables'),
  logLevel: 'info',
  env: 'development',
  open: false,
};

const partialSchema = z
  .object({
    port: z.coerce.number().int().min(1).max(65535),
    host: z.string().min(1),
    dataDir: z.string().min(1),
    logLevel: z.enum(LOG_LEVELS),
    env: z.enum(['development', 'test', 'production']),
    open: z.coerce.boolean(),
  })
  .partial();

type PartialConfig = z.infer<typeof partialSchema>;

function fromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (env.PORT !== undefined) out.port = env.PORT;
  if (env.HOST !== undefined) out.host = env.HOST;
  if (env.DATA_DIR !== undefined) out.dataDir = env.DATA_DIR;
  if (env.LOG_LEVEL !== undefined) out.logLevel = env.LOG_LEVEL;
  if (env.NODE_ENV !== undefined) out.env = env.NODE_ENV;
  return out;
}

/** Optional ./fables.config.json — committed defaults for a machine, never secrets. */
function fromFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  return raw;
}

function fromFlags(argv: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const flagMap: Record<string, keyof AppConfig> = {
    '--port': 'port',
    '--host': 'host',
    '--data-dir': 'dataDir',
    '--log-level': 'logLevel',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--open') {
      out.open = true;
      continue;
    }
    const [name, inlineValue] = arg.split('=', 2);
    const key = flagMap[name!];
    if (!key) continue;
    const value = inlineValue ?? argv[++i];
    if (value === undefined) throw new Error(`flag ${name} requires a value`);
    out[key] = value;
  }
  return out;
}

function validate(layer: Record<string, unknown>, source: string): Partial<AppConfig> {
  const parsed = partialSchema.safeParse(layer);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration (${source}): ${issues}`);
  }
  // Drop undefined keys so spreading never clobbers an earlier layer.
  const clean = Object.fromEntries(
    Object.entries(parsed.data as PartialConfig).filter(([, v]) => v !== undefined),
  );
  return clean as Partial<AppConfig>;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  configFile?: string;
}

/** Precedence: CLI flags > environment > fables.config.json > defaults. */
export function loadConfig(options: LoadConfigOptions | NodeJS.ProcessEnv = {}): AppConfig {
  // Back-compat: loadConfig(processEnvLike) treats a non-empty plain object as
  // env. A bare loadConfig() must fall through to process.env — wrapping the
  // default {} as the env silently disabled all environment configuration.
  const opts: LoadConfigOptions =
    'env' in options || 'argv' in options || 'configFile' in options
      ? (options as LoadConfigOptions)
      : Object.keys(options).length === 0
        ? {}
        : { env: options as NodeJS.ProcessEnv };

  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv.slice(2);
  const filePath = opts.configFile ?? path.resolve('fables.config.json');

  return {
    ...DEFAULTS,
    ...validate(fromFile(filePath), 'fables.config.json'),
    ...validate(fromEnv(env), 'environment'),
    ...validate(fromFlags(argv), 'flags'),
  };
}
