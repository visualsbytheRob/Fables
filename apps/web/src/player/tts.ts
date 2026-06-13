/**
 * Read-aloud via the Web Speech API (F597/F598). Pure-ish wrapper: feature
 * detection, voice listing, and a paragraph queue that reports which index
 * is being spoken so the player can highlight it.
 */

export interface TtsVoice {
  readonly uri: string;
  readonly name: string;
  readonly lang: string;
}

export const ttsSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

export function listVoices(): TtsVoice[] {
  if (!ttsSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
}

export interface SpeakOptions {
  readonly voiceUri: string | null;
  readonly rate: number;
  /** Called as each paragraph starts (per-paragraph highlight). */
  readonly onParagraph: (index: number) => void;
  readonly onEnd: () => void;
}

export interface TtsHandle {
  stop(): void;
}

/** Speak paragraphs in order; resolves the handle immediately. */
export function speakParagraphs(paragraphs: readonly string[], options: SpeakOptions): TtsHandle {
  if (!ttsSupported() || paragraphs.length === 0) {
    options.onEnd();
    return { stop: () => undefined };
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  let stopped = false;
  const voice = synth.getVoices().find((v) => v.voiceURI === options.voiceUri);

  const speakAt = (index: number): void => {
    if (stopped || index >= paragraphs.length) {
      if (!stopped) options.onEnd();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(paragraphs[index] ?? '');
    if (voice !== undefined) utterance.voice = voice;
    utterance.rate = options.rate;
    utterance.onstart = () => {
      if (!stopped) options.onParagraph(index);
    };
    utterance.onend = () => speakAt(index + 1);
    utterance.onerror = () => speakAt(index + 1);
    synth.speak(utterance);
  };
  speakAt(0);

  return {
    stop() {
      stopped = true;
      synth.cancel();
      options.onEnd();
    },
  };
}
