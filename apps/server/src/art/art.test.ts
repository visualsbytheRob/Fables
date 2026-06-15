/**
 * Generative-art unit tests (F1861/F1863/F1866/F1870).
 */

import { describe, expect, it } from 'vitest';
import {
  buildCoverPrompt,
  buildPortraitPrompt,
  buildScenePrompt,
  resolveStyle,
  STYLE_PRESETS,
} from './prompts.js';
import { typographicCover, themePalette } from './fallback.js';
import { ComfyAdapter } from './comfy.js';
import { ArtRuntime } from './runtime.js';
import type { ImageAdapter } from './adapter.js';

describe('prompt builders (F1863/F1864/F1865/F1866)', () => {
  it('build cohesive prompts with style modifiers', () => {
    const cover = buildCoverPrompt(
      'The Hollow',
      'A village vanishes.',
      'folk horror',
      STYLE_PRESETS.noir,
    );
    expect(cover.prompt).toContain('The Hollow');
    expect(cover.prompt).toContain('folk horror');
    expect(cover.prompt).toContain('film noir'); // noir modifier
    expect(cover.negative.length).toBeGreaterThan(0);

    const portrait = buildPortraitPrompt({
      name: 'Mira',
      type: 'character',
      fields: { hair: 'silver' },
    });
    expect(portrait.prompt).toContain('Mira');
    expect(portrait.prompt).toContain('hair: silver');

    expect(buildScenePrompt('storm_at_sea').prompt).toContain('storm at sea');
  });

  it('resolveStyle falls back to the default', () => {
    expect(resolveStyle('nope').name).toBe('storybook');
    expect(resolveStyle('inkwash').name).toBe('inkwash');
  });
});

describe('typographic cover fallback (F1863)', () => {
  it('renders a deterministic SVG cover', () => {
    const a = typographicCover('A Long Title That Wraps Across Lines', 'A short blurb.', 'mystery');
    expect(a.startsWith('<svg')).toBe(true);
    expect(a).toContain('</svg>');
    // Deterministic for the same input.
    expect(
      typographicCover('A Long Title That Wraps Across Lines', 'A short blurb.', 'mystery'),
    ).toBe(a);
    // Theme drives a stable palette.
    expect(themePalette('mystery')).toEqual(themePalette('mystery'));
  });

  it('escapes XML-unsafe characters in the title', () => {
    expect(typographicCover('<script> & "quotes"', '', 'x')).not.toContain('<script>');
  });
});

describe('ComfyAdapter availability (F1861/F1862)', () => {
  it('is unavailable with no base URL', async () => {
    const adapter = new ComfyAdapter({ name: 'comfy-local', baseUrl: undefined });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('health-checks the configured server', async () => {
    const adapter = new ComfyAdapter({
      name: 'comfy-local',
      baseUrl: 'http://comfy.local',
      fetchImpl: async (url) =>
        new Response('{}', { status: url.endsWith('/system_stats') ? 200 : 404 }),
    });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('the cloud endpoint requires egress consent (F1862)', async () => {
    const fetchOk = async () => new Response('{}', { status: 200 });
    const noConsent = new ComfyAdapter({
      name: 'comfy-cloud',
      baseUrl: 'http://cloud',
      fetchImpl: fetchOk,
    });
    expect(await noConsent.isAvailable()).toBe(false);
    const consented = new ComfyAdapter({
      name: 'comfy-cloud',
      baseUrl: 'http://cloud',
      fetchImpl: fetchOk,
      cloudConsent: true,
    });
    expect(await consented.isAvailable()).toBe(true);
  });
});

describe('ArtRuntime graceful degradation (F1863)', () => {
  it('reports unavailable with no backend and throws on generate', async () => {
    const rt = new ArtRuntime().register(new ComfyAdapter({ baseUrl: undefined }));
    expect(await rt.isAvailable()).toBe(false);
    await expect(rt.generate({ prompt: 'x' })).rejects.toThrow(/no image backend/);
  });

  it('routes to a mock adapter when available', async () => {
    const mock: ImageAdapter = {
      name: 'mock',
      isAvailable: async () => true,
      generate: async (req) => ({
        image: new Uint8Array([1, 2, 3]),
        format: 'png',
        width: 1,
        height: 1,
        provenance: { adapter: 'mock', prompt: req.prompt, createdAt: 'now' },
      }),
    };
    const rt = new ArtRuntime().register(mock);
    const out = await rt.generate({ prompt: 'a castle' });
    expect(out.provenance.adapter).toBe('mock');
  });
});
