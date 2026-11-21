import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';

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

type ChatHistoryItem = {
  role: 'user' | 'assistant';
  text: string;
};

type ChatRequestBody = {
  imageBase64?: string;
  mimeType?: string;
  history?: ChatHistoryItem[];
  message?: string;
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

function cleanJsonString(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function parseRequestBody(req: ApiRequest): Promise<ChatRequestBody | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as ChatRequestBody;
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8')) as ChatRequestBody;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as ChatRequestBody;
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
    return JSON.parse(rawText) as ChatRequestBody;
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
        error: 'تعذر قراءة بيانات السؤال المرسل.',
      });
      return;
    }

    const {imageBase64, mimeType, history, message} = body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({
        success: false,
        error: 'كتب ولا قول سؤالك على البلان أولا.',
      });
      return;
    }

    const parts: Array<{inlineData?: {mimeType: string; data: string}; text?: string}> = [];
    if (imageBase64 && typeof imageBase64 === 'string') {
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      if (cleanBase64) {
        const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
        parts.push({inlineData: {mimeType: safeMime, data: cleanBase64}});
      }
    }

    const historyText = Array.isArray(history)
      ? history
          .slice(-8)
          .map((h) => `${h.role === 'user' ? 'مول الدار' : 'المعلم فاهم بلان'}: ${h.text}`)
          .join('\n')
      : '';

    const promptText = [
      historyText ? `المحادثة اللي فاتت:\n${historyText}` : '',
      `سؤال المستخدم الجديد: ${message.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    parts.push({text: promptText});

    const systemInstructionText =
      'أنت المعلم ومهندس مغربي في تطبيق فاهم بلان. جاوب المستخدم في الدردشة على سؤالو حول البلان ديالو بـ 100% دارجة مغربية حقيقية وساهلة ومفهومة، بلا حتى كلمة فرنسية أو إنجليزية أو رموز غريبة. ركز مزيان على تفاصيل الحديد (فين كاين الحديد، شحال من بار، المسافات بين القضبان، السواري، الضالة، الكمرة)، المساحات والسلعة. وإلى كانت الصورة ماشي ديال البلان قول ليه: هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك.';

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
    const startedAtMs = Date.now();

    const runAttempt = async (
      modelIndex: number,
      useVertexAi: boolean,
      useLowThinking: boolean
    ): Promise<string> => {
      const modelName = modelsToTry[modelIndex];
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = Math.max(8000, 26000 - elapsedMs);
      const ai = createGenAiClient(apiKey, useVertexAi);

      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: modelName,
            contents: {parts},
            config: {
              systemInstruction: systemInstructionText,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  reply: {
                    type: Type.STRING,
                    description: 'الجواب الكامل بالدارجة المغربية 100% بدون كلمات فرنسية',
                  },
                  audioScript: {
                    type: Type.STRING,
                    description: 'نص نقي للقراءة الصوتية بالدارجة المغربية',
                  },
                },
                required: ['reply', 'audioScript'],
              },
              ...(useLowThinking ? {thinkingConfig: {thinkingLevel: ThinkingLevel.LOW}} : {}),
            },
          }),
          remainingMs,
          `Timeout after ${remainingMs}ms on ${modelName}`
        );

        const text = response.text;
        if (!text) {
          throw new Error('رد فارغ من الذكاء الاصطناعي، عاود حاول.');
        }
        return text;
      } catch (attemptErr) {
        const errMsg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
        const lowerMsg = errMsg.toLowerCase();
        console.error(
          `[chat-plan] model=${modelName} vertex=${useVertexAi} lowThink=${useLowThinking} failed:`,
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
          return runAttempt(modelIndex, true, useLowThinking);
        }

        if (useLowThinking && lowerMsg.includes('think')) {
          return runAttempt(modelIndex, useVertexAi, false);
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
          return runAttempt(modelIndex + 1, useVertexAi, true);
        }
        throw attemptErr;
      }
    };

    const text = await runAttempt(0, false, true);
    const parsed = JSON.parse(cleanJsonString(text)) as Record<string, unknown>;
    res.status(200).json({success: true, ...parsed});
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'ما قدرناش نجاوبو دابا، جرب عاود صيفط السؤال.';
    console.error('[chat-plan] fatal error:', rawMsg);
    res.status(500).json({
      success: false,
      error: rawMsg,
    });
  }
}
