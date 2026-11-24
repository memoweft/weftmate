/** Native DSH SenseVoice offline speech-to-text adapter for WeftMate desktop. */
import { resolve } from 'node:path';

export const SPEECH_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const SPEECH_MAX_DURATION_SECONDS = 120;
export const SPEECH_TRANSCRIBE_TIMEOUT_MS = 130_000;
export const SPEECH_REQUEST_BODY_LIMIT = 6 * 1024 * 1024;

const LANGUAGES = new Set(['auto', 'zh', 'en', 'yue', 'ja', 'ko']);
const SAFE_PROVIDER_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Validate a canonical 16 kHz mono PCM16 WAV buffer (matches @deepseek-ai/dsh-experimental-speech-to-text/wave).
 * @param {Uint8Array | Buffer} audio
 * @param {number} maxDurationSeconds
 * @returns {number} Duration in seconds
 */
export function validateWaveBuffer(audio, maxDurationSeconds = SPEECH_MAX_DURATION_SECONDS) {
  const data = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (
    data.length < 46 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WAVE' ||
    data.toString('ascii', 12, 16) !== 'fmt ' ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt32LE(24) !== 16000 ||
    data.readUInt32LE(28) !== 32000 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt16LE(34) !== 16 ||
    data.toString('ascii', 36, 40) !== 'data' ||
    data.readUInt32LE(4) !== data.length - 8 ||
    data.readUInt32LE(40) !== data.length - 44 ||
    (data.length - 44) % 2 !== 0
  ) {
    const error = new Error('Audio must be a canonical 16 kHz mono PCM16 WAV recording');
    error.code = 'INVALID_AUDIO';
    throw error;
  }
  const seconds = (data.length - 44) / 32000;
  if (seconds > maxDurationSeconds) {
    const error = new Error(`Audio exceeds ${maxDurationSeconds} seconds`);
    error.code = 'INVALID_AUDIO';
    throw error;
  }
  return seconds;
}

/**
 * Mount DSH's bundled offline SenseVoice speech-to-text plugins inside the Cordis runtime.
 * Gracefully no-ops if experimental speech packages are not present (e.g. older DSH fixtures).
 */
export function mountNativeSpeech(ctx, { dshHome, loadModules } = {}) {
  if (!dshHome || typeof dshHome !== 'string') return;
  const dataRoot = resolve(dshHome, 'speech-to-text', 'sensevoice');
  ctx.inject(['subprocess'], (subprocessCtx) => {
    let disposed = false;
    subprocessCtx.effect(() => () => { disposed = true; }, 'weftmate-speech: lifecycle');
    void (async () => {
      try {
        const [sttMod, svMod] = loadModules
          ? await loadModules()
          : await Promise.all([
            import('@deepseek-ai/dsh-experimental-speech-to-text'),
            import('@deepseek-ai/dsh-experimental-speech-to-text-sensevoice'),
          ]);
        if (disposed) return;
        const SpeechToText = sttMod.default ?? sttMod.SpeechToText ?? sttMod;
        const SenseVoice = svMod.default ?? svMod;
        if (!subprocessCtx.get('speechToText')) {
          subprocessCtx.plugin(SpeechToText, {
            defaultProvider: 'sensevoice-local',
            language: 'auto',
          });
        }
        subprocessCtx.plugin(SenseVoice, { dataRoot });
      } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND') return;
        ctx.logger?.warn?.(`weftmate-speech: unable to mount local SenseVoice: ${String(error)}`);
      }
    })();
  });
}

function summarizeProgress(preparation) {
  if (!preparation || typeof preparation !== 'object') return null;
  const steps = Array.isArray(preparation.steps) ? preparation.steps : [];
  const active = steps.find((step) => step.status === 'active') ?? null;
  const downloadedBytes = Number.isFinite(preparation.downloadedBytes)
    ? preparation.downloadedBytes
    : Number.isFinite(active?.downloadedBytes) ? active.downloadedBytes : null;
  const totalBytes = Number.isFinite(preparation.totalBytes)
    ? preparation.totalBytes
    : Number.isFinite(active?.totalBytes) ? active.totalBytes : null;
  const percent = downloadedBytes !== null && totalBytes !== null && totalBytes > 0
    ? Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)))
    : null;
  return {
    step: preparation.step ?? active?.kind ?? null,
    downloadedBytes,
    totalBytes,
    percent,
  };
}

export function createNativeSpeech({ getSpeech } = {}) {
  const readSnapshot = () => {
    const speech = getSpeech?.();
    if (!speech || typeof speech.snapshot !== 'function') return null;
    return speech.snapshot();
  };

  function status() {
    const snapshot = readSnapshot();
    const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
    const selectedId = snapshot?.selection?.providerId ?? providers[0]?.id ?? null;
    const provider = providers.find((item) => item.id === selectedId) ?? providers[0] ?? null;
    if (!provider) {
      return {
        available: false,
        providerId: null,
        providerName: null,
        location: null,
        phase: 'unavailable',
        steps: [],
        progress: null,
        detail: null,
        language: 'auto',
        languages: [],
        maxDurationSeconds: SPEECH_MAX_DURATION_SECONDS,
        maxAudioBytes: SPEECH_MAX_AUDIO_BYTES,
      };
    }
    const preparation = provider.preparation ?? { phase: 'ready' };
    return {
      available: true,
      providerId: provider.id,
      providerName: provider.name,
      location: provider.location ?? 'host-local',
      phase: preparation.phase ?? 'ready',
      steps: Array.isArray(preparation.steps) ? preparation.steps : [],
      progress: summarizeProgress(preparation),
      detail: typeof preparation.detail === 'string' ? preparation.detail
        : typeof preparation.error === 'string' ? preparation.error : null,
      language: snapshot?.selection?.language ?? 'auto',
      languages: Array.isArray(provider.languages) ? provider.languages : [],
      maxDurationSeconds: SPEECH_MAX_DURATION_SECONDS,
      maxAudioBytes: SPEECH_MAX_AUDIO_BYTES,
    };
  }

  async function prepare({ action, providerId } = {}) {
    const speech = getSpeech?.();
    if (!speech) {
      const error = new Error('Local speech service is unavailable');
      error.code = 'SPEECH_UNAVAILABLE';
      throw error;
    }
    const current = status();
    const targetId = typeof providerId === 'string' && SAFE_PROVIDER_ID.test(providerId)
      ? providerId
      : current.providerId;
    if (!targetId) {
      const error = new Error('No speech provider is registered');
      error.code = 'SPEECH_UNAVAILABLE';
      throw error;
    }
    if (action === 'cancel') {
      await speech.cancelPreparation(targetId);
    } else {
      speech.prepare(targetId);
    }
    return status();
  }

  async function transcribe({ audioBase64, language, providerId } = {}, signal) {
    const speech = getSpeech?.();
    if (!speech) {
      const error = new Error('Local speech service is unavailable');
      error.code = 'SPEECH_UNAVAILABLE';
      throw error;
    }
    if (typeof audioBase64 !== 'string' || !audioBase64.length) {
      const error = new Error('Missing audio payload');
      error.code = 'INVALID_AUDIO';
      throw error;
    }
    if (audioBase64.length > Math.ceil(SPEECH_MAX_AUDIO_BYTES / 3) * 4 + 4) {
      const error = new Error('Audio exceeds maximum allowed size');
      error.code = 'INVALID_AUDIO';
      throw error;
    }
    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.length > SPEECH_MAX_AUDIO_BYTES) {
      const error = new Error('Audio exceeds maximum allowed size');
      error.code = 'INVALID_AUDIO';
      throw error;
    }
    const durationSeconds = validateWaveBuffer(audio, SPEECH_MAX_DURATION_SECONDS);
    const chosenLanguage = typeof language === 'string' && LANGUAGES.has(language) ? language : undefined;
    const chosenProvider = typeof providerId === 'string' && SAFE_PROVIDER_ID.test(providerId) ? providerId : undefined;
    const spec = speech.resolve({
      audio,
      ...(chosenProvider ? { providerId: chosenProvider } : {}),
      ...(chosenLanguage ? { language: chosenLanguage } : {}),
    });
    const controller = new AbortController();
    const activeSignal = signal ?? controller.signal;
    const result = await speech.transcribe(spec, activeSignal);
    return {
      text: String(result?.text ?? '').trim(),
      language: result?.language ?? spec.language,
      durationSeconds,
    };
  }

  return { status, prepare, transcribe };
}
