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

export const maxDuration = 60;

type TranscribeRequestBody = {
  audioBase64?: string;
  mimeType?: string;
};

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

async function parseRequestBody(req: ApiRequest): Promise<TranscribeRequestBody | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as TranscribeRequestBody;
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8')) as TranscribeRequestBody;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as TranscribeRequestBody;
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
    return JSON.parse(rawText) as TranscribeRequestBody;
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

function cleanTranscriptText(raw: string): string {
  const cleaned = raw
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    !cleaned ||
    cleaned === '__EMPTY__' ||
    /^\[(صمت|لا يوجد كلام|silence|no speech|inaudible)\]$/i.test(cleaned) ||
    /^(صمت|لا يوجد صوت|لا يوجد كلام)$/i.test(cleaned)
  ) {
    return '';
  }

  return cleaned;
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
        success: false,
        error: 'الطريقة غير مسموح بها، استعمل POST.',
      });
      return;
    }

    const apiKey = resolveApiKey();
    if (!apiKey) {
      res.status(503).json({
        success: false,
        error: 'مفتاح الذكاء الاصطناعي غير مضبوط في إعدادات الخادم (GEMINI_API_KEY).',
      });
      return;
    }

    const body = await parseRequestBody(req);
    if (!body) {
      res.status(400).json({
        success: false,
        error: 'تعذر قراءة الملف الصوتي المرسل.',
      });
      return;
    }

    const {audioBase64, mimeType} = body;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({
        success: false,
        error: 'ما وصلنيش الصوت من الميكروفون، عاود جرب.',
      });
      return;
    }

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
    if (!cleanBase64) {
      res.status(400).json({
        success: false,
        error: 'التسجيل الصوتي خاوي، عاود هضر فالميكرو.',
      });
      return;
    }

    const baseMime =
      typeof mimeType === 'string' && mimeType.trim().startsWith('audio/')
        ? mimeType.split(';')[0].trim()
        : 'audio/webm';

    const promptText = [
      'سمع هاد التسجيل الصوتي مزيان واكتب بالحرف شنو قال المتكلم بالدارجة المغربية (أو العربية/مصطلحات البناء بحال الحديد، السواري، الضالة، البار، السوميلة، السيما، الرملة، السنتيم).',
      'القواعد:',
      '1. رجع غير النص المنطوق بوحدو بحروف عربية واضحة وبلا علامات تنصيص وبلا أي شرح أو جواب على السؤال.',
      '2. إلى كان التسجيل فيه غير صمت أو ضجيج بلا كلام بشري مفهوم، رجع بالضبط: __EMPTY__',
    ].join('\n');

    const modelsToTry = [
      'gemini-3.5-transcribe',
      'gemini-3.8-flash',
      'gemini-4-hydrogen',
      'gemini-3.1-flash-lite',
    ];
    const startedAtMs = Date.now();

    const runAttempt = async (modelIndex: number, useVertexAi: boolean): Promise<string> => {
      const modelName = modelsToTry[modelIndex];
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = Math.max(7000, 24000 - elapsedMs);
      const ai = createGenAiClient(apiKey, useVertexAi);

      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: baseMime,
                    data: cleanBase64,
                  },
                },
                {text: promptText},
              ],
            },
          }),
          remainingMs,
          `Timeout after ${remainingMs}ms on ${modelName}`
        );

        return response.text || '';
      } catch (attemptErr) {
        const errMsg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
        const lowerMsg = errMsg.toLowerCase();
        console.error(
          `[transcribe] model=${modelName} vertex=${useVertexAi} failed:`,
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
          return runAttempt(modelIndex, true);
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
          return runAttempt(modelIndex + 1, useVertexAi);
        }

        throw attemptErr;
      }
    };

    const rawTranscript = await runAttempt(0, false);
    const cleaned = cleanTranscriptText(rawTranscript);

    res.status(200).json({
      success: true,
      text: cleaned,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'تعذر تحويل الصوت لكتابة، عاود حاول.';
    console.error('[transcribe] fatal error:', rawMsg);
    res.status(500).json({
      success: false,
      error: 'تعذر تحويل الصوت لكتابة دابا، عاود جرب أو كتب سؤالك بيديك.',
    });
  }
}
