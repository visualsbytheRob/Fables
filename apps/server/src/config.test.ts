import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const noFile = { configFile: '/nonexistent/fables.config.json' };

describe('config precedence', () => {
  it('applies defaults when nothing is set', () => {
    const c = loadConfig({ ...noFile, env: {}, argv: [] });
    expect(c.port).toBe(4870);
    expect(c.host).toBe('127.0.0.1');
    expect(c.dataDir).toContain('.fables');
    expect(c.open).toBe(false);
  });

  it('env overrides file, flags override env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-cfg-'));
    const file = path.join(dir, 'fables.config.json');
    fs.writeFileSync(file, JSON.stringify({ port: 1111, host: 'file-host' }));

    const c = loadConfig({
      configFile: file,
      env: { PORT: '2222' },
      argv: ['--port=3333', '--open'],
    });
    expect(c.port).toBe(3333); // flag beats env beats file
    expect(c.host).toBe('file-host'); // file value survives when nothing overrides
    expect(c.open).toBe(true);
  });

  it('supports both --flag=value and --flag value forms', () => {
    const c = loadConfig({ ...noFile, env: {}, argv: ['--port', '9999', '--data-dir=/tmp/x'] });
    expect(c.port).toBe(9999);
    expect(c.dataDir).toBe('/tmp/x');
  });

  it('rejects invalid values with the offending source named', () => {
    expect(() => loadConfig({ ...noFile, env: { PORT: 'abc' }, argv: [] })).toThrow(/environment/);
    expect(() => loadConfig({ ...noFile, env: {}, argv: ['--log-level=loud'] })).toThrow(/flags/);
  });

  it('treats a plain object as env (back-compat shorthand)', () => {
    const c = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
    expect(c.env).toBe('test');
    expect(c.logLevel).toBe('fatal');
  });
});
