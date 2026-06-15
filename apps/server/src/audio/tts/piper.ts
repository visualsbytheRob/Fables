/**
 * Piper engine adapter (F1601) — a local, offline neural TTS binary
 * (https://github.com/rhasspy/piper). Mirrors OllamaAdapter: it shells out to a
 * locally installed engine and is gracefully unavailable when that engine isn't
 * present, so no part of the app hard-depends on it.
 *
 * Configuration (all optional; absence ⇒ unavailable):
 *   FABLES_PIPER_BIN     path to the piper executable
 *   FABLES_PIPER_VOICES  directory of `*.onnx` + `*.onnx.json` voice models
 *
 * Voice ids are the model file stems (e.g. "en_US-amy-medium"). Piper writes a
 * 22.05 kHz mono WAV to stdout when fed text on stdin.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SynthesisRequest, SynthesisResult, TtsAdapter, Voice } from './adapter.js';

const PIPER_SAMPLE_RATE = 22_050;

export interface PiperOptions {
  /** Path to the piper binary. Defaults to FABLES_PIPER_BIN. */
  bin?: string;
  /** Directory of voice models. Defaults to FABLES_PIPER_VOICES. */
  voicesDir?: string;
}

export class PiperAdapter implements TtsAdapter {
  readonly name = 'piper';
  private readonly bin: string | undefined;
  private readonly voicesDir: string | undefined;

  constructor(opts: PiperOptions = {}) {
    this.bin = opts.bin ?? process.env['FABLES_PIPER_BIN'];
    this.voicesDir = opts.voicesDir ?? process.env['FABLES_PIPER_VOICES'];
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.bin !== undefined &&
      this.bin.length > 0 &&
      existsSync(this.bin) &&
      this.voicesDir !== undefined &&
      existsSync(this.voicesDir) &&
      this.listVoiceModels().length > 0
    );
  }

  async listVoices(): Promise<Voice[]> {
    return this.listVoiceModels().map((id) => {
      const parts = id.split('-');
      const lang = (parts[0] ?? 'en_US').replace('_', '-');
      const quality = parts[2];
      return {
        id,
        name: id,
        lang,
        ...(quality === 'low' || quality === 'medium' || quality === 'high' ? { quality } : {}),
      };
    });
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    if (!(await this.isAvailable())) {
      throw new Error('piper is not available');
    }
    const voiceId = req.voiceId ?? this.listVoiceModels()[0]!;
    const modelPath = path.join(this.voicesDir!, `${voiceId}.onnx`);
    if (!existsSync(modelPath)) {
      throw new Error(`piper voice not found: ${voiceId}`);
    }

    const args = ['--model', modelPath, '--output_file', '-'];
    if (req.rate !== undefined && req.rate > 0) {
      // Piper expresses tempo as length scale: slower speech ⇒ longer length.
      args.push('--length_scale', String(1 / req.rate));
    }

    const audio = await this.run(args, req.text, req.signal);
    return {
      audio,
      format: 'wav',
      sampleRate: PIPER_SAMPLE_RATE,
      voiceId,
    };
  }

  /** Voice model stems present in the voices directory. */
  private listVoiceModels(): string[] {
    if (this.voicesDir === undefined || !existsSync(this.voicesDir)) return [];
    if (!statSync(this.voicesDir).isDirectory()) return [];
    return readdirSync(this.voicesDir)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.slice(0, -'.onnx'.length))
      .sort();
  }

  /** Spawn piper, feed `text` on stdin, collect the WAV from stdout. */
  private run(args: string[], text: string, signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin!, args, { signal });
      const chunks: Buffer[] = [];
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(new Uint8Array(Buffer.concat(chunks)));
        } else {
          reject(new Error(`piper exited ${code ?? 'null'}: ${stderr.trim()}`));
        }
      });
      child.stdin.write(text);
      child.stdin.end();
    });
  }
}
