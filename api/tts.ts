import {GoogleGenAI} from '@google/genai';

type ApiRequest = {
  method?: string;
  body?: unknown;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => ApiResponse;
  json: (payload: Record<string, unknown>) => void;
  end: (chunk?: string) => void;
};

type TtsRequestBody = {
  text?: string;
  gender?: 'male' | 'female';
  voiceId?: string;
  voiceType?: string;
};

export const maxDuration = 60;

const VOICE_GIRL = 'Kore';
const VOICE_BOY = 'Charon';

function setCorsHeaders(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
}

function resolveApiKey(): string | null {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.AI_API_KEY,
  ];
  for (const candidate of candidates) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY') {
      return trimmed;
    }
  }
  return null;
}

function resolveLockedVoiceName(voiceType?: string, gender?: string): 'Kore' | 'Charon' {
  if (
    voiceType === VOICE_GIRL ||
    voiceType === 'female' ||
    voiceType === 'girl' ||
    gender === 'female'
  ) {
    return VOICE_GIRL;
  }
  return VOICE_BOY;
}

function toDarijaServer(input: string): string {
  return input
    .replace(/مرحبا بكم?/g, 'مرحبا بيك')
    .replace(/ف\s*تطبيق/g, 'ف فاهم بلان')
    .replace(/في\s+تطبيق/g, 'ف فاهم بلان')
    .replace(/كيف\s+حالك/g, 'كيداير؟')
    .replace(/كيف\s+الأحوال/g, 'لاباس عليك؟')
    .replace(/أهلا\s+بك/g, 'مرحبا بيك')
    .replace(/من\s+فضلك|الرجاء/g, 'عافاك')
    .replace(/شكرا\s+لك/g, 'بارك الله فيك')
    .replace(/[*#_`~•]/g, ' ')
    .replace(/م²|m²|m2/gi, ' متر مربع ')
    .replace(/م³|m³|m3/gi, ' متر مكعب ')
    .replace(/Ø|Φ/g, ' قطر ')
    .replace(/\bcm\b/gi, ' سنتيم ')
    .replace(/\bmm\b/gi, ' ميليمتر ')
    .replace(/R\+(\d+)/gi, ' سفلي و $1 طوابق ')
    .replace(/%/g, ' في المئة ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 950);
}

function wrapPcm16AsWav(pcmBuffer: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function parseRequestBody(req: ApiRequest): Promise<TtsRequestBody | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as TtsRequestBody;
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8')) as TtsRequestBody;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as TtsRequestBody;
    }
  }

  if (typeof req.on !== 'function') {
    return null;
  }

  const rawText = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on?.('data', (chunk?: unknown) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf8'));
      }
    });
    req.on?.('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on?.('error', () => {
      resolve('');
    });
  });

  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText) as TtsRequestBody;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), ms);
    }),
  ]);
}

function createGenAiClient(apiKey: string, useVertexAi: boolean): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    ...(useVertexAi ? {vertexai: true} : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.status(200).json({ok: true});
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        error: 'الطريقة غير مسموح بها، استعمل POST.',
      });
      return;
    }

    const apiKey = resolveApiKey();
    if (!apiKey) {
      res.status(503).json({
        ok: false,
        quotaExhausted: false,
        errorDetail: 'مفتاح الذكاء الاصطناعي غير مضبوط على الخادم (GEMINI_API_KEY).',
      });
      return;
    }

    const body = await parseRequestBody(req);
    if (!body || typeof body.text !== 'string' || !body.text.trim()) {
      res.status(400).json({
        ok: false,
        error: 'النص خاوي',
      });
      return;
    }

    const voiceName = resolveLockedVoiceName(body.voiceId || body.voiceType, body.gender);
    const darijaText = toDarijaServer(body.text);
    if (!darijaText) {
      res.status(400).json({
        ok: false,
        error: 'النص خاوي',
      });
      return;
    }

    const modelsToTry = [
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-flash-tts',
      'gemini-2.5-flash-preview-tts',
    ];
    const startedAtMs = Date.now();

    const runTtsAttempt = async (
      modelIndex: number,
      useVertexAi: boolean,
      useSpeechMetadata: boolean
    ): Promise<{audioBase64: string; modelName: string}> => {
      const modelName = modelsToTry[modelIndex];
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = Math.max(8000, 26000 - elapsedMs);
      const ai = createGenAiClient(apiKey, useVertexAi);

      const partPayload: Record<string, unknown> = {text: darijaText};
      if (useSpeechMetadata && modelName.startsWith('gemini-3.8-')) {
        partPayload.speechMetadata = {
          style: 'Clear, warm, natural Moroccan Darija speaker',
        };
      }

      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [partPayload as {text: string}],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {voiceName},
                },
              },
            },
          }),
          remainingMs,
          `Timeout after ${remainingMs}ms on ${modelName}`
        );

        const parts = response.candidates?.[0]?.content?.parts || [];
        const audioPart = parts.find((p) => Boolean(p?.inlineData?.data));
        const base64Raw = audioPart?.inlineData?.data;
        if (!base64Raw) {
          throw new Error(`No audio inlineData returned from ${modelName}`);
        }

        const rawBuf = Buffer.from(base64Raw, 'base64');
        const hasRiffHeader =
          rawBuf.length >= 4 && rawBuf.subarray(0, 4).toString('ascii') === 'RIFF';
        const wavBuf = hasRiffHeader ? rawBuf : wrapPcm16AsWav(rawBuf, 24000);

        return {
          audioBase64: wavBuf.toString('base64'),
          modelName,
        };
      } catch (attemptErr) {
        const errMsg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
        const lowerMsg = errMsg.toLowerCase();
        console.error(
          `[tts] model=${modelName} vertex=${useVertexAi} meta=${useSpeechMetadata} failed:`,
          errMsg
        );

        const isAuthScopeError =
          lowerMsg.includes('401') ||
          lowerMsg.includes('403') ||
          lowerMsg.includes('api_key_invalid') ||
          lowerMsg.includes('api key not valid') ||
          lowerMsg.includes('unauthenticated') ||
          lowerMsg.includes('access_token_type_unsupported');

        if (!useVertexAi && isAuthScopeError && apiKey.startsWith('AQ.')) {
          return runTtsAttempt(modelIndex, true, useSpeechMetadata);
        }

        if (useSpeechMetadata && (lowerMsg.includes('speechmetadata') || lowerMsg.includes('400'))) {
          return runTtsAttempt(modelIndex, useVertexAi, false);
        }

        const isSwitchable =
          lowerMsg.includes('503') ||
          lowerMsg.includes('unavailable') ||
          lowerMsg.includes('overloaded') ||
          lowerMsg.includes('high demand') ||
          lowerMsg.includes('timeout') ||
          lowerMsg.includes('429') ||
          lowerMsg.includes('resource_exhausted') ||
          lowerMsg.includes('404') ||
          lowerMsg.includes('not_found') ||
          lowerMsg.includes('400');

        if (isSwitchable && modelIndex + 1 < modelsToTry.length && Date.now() - startedAtMs < 20000) {
          return runTtsAttempt(modelIndex + 1, useVertexAi, true);
        }
        throw attemptErr;
      }
    };

    const ttsResult = await runTtsAttempt(0, false, true);
    res.status(200).json({
      ok: true,
      audioBase64: ttsResult.audioBase64,
      mimeType: 'audio/wav',
      voiceName,
      provider: `${ttsResult.modelName}-${voiceName}`,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'TTS_UNAVAILABLE';
    console.error('[tts] fatal error:', rawMsg);
    const lower = rawMsg.toLowerCase();
    const isQuota =
      rawMsg.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota');
    res.status(isQuota ? 429 : 500).json({
      ok: false,
      quotaExhausted: isQuota,
      errorDetail: rawMsg,
    });
  }
}
