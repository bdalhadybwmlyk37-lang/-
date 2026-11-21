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

const PLAN_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isBlueprint: {
      type: Type.BOOLEAN,
      description:
        'true فقط إذا كانت الصورة مخطط بناء أو بلان هندسي أو بلان ديال الحديد والتسليح، و false إذا كانت صورة عادية ما عندهاش علاقة بالبلانات.',
    },
    title: {
      type: Type.STRING,
      description: 'عنوان قصير للبلان بالدارجة المغربية الصافية بلا فرنسية',
    },
    buildingType: {
      type: Type.STRING,
      description: 'نوع البناء بالدارجة (دار سكنية، فيلا، شقة، بلان ديال الحديد، محل تجاري...)',
    },
    totalAreaSqm: {
      type: Type.STRING,
      description: 'المساحة الإجمالية التقديرية بالمتر مربع (مثلا: 120 متر مربع)',
    },
    roomsCount: {
      type: Type.INTEGER,
      description: 'العدد الإجمالي للغرف والمرافق الرئيسية',
    },
    darijaSummary: {
      type: Type.STRING,
      description:
        'شرح كامل بالدارجة المغربية 100% بلا حتى كلمة فرنسية. إلا ما كانتش صورة بلان، حط بالضبط: هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك',
    },
    rebarDetailsDarija: {
      type: Type.STRING,
      description:
        'تفاصيل الحديد والتسليح بالدارجة المغربية: فين كاين الحديد (السواري، الكمرات، الضالة، السوميلات)، شحال من بار (قضيب)، قطر الحديد، والمسافات بيناتهم (مثلا كل 15 سنتيم).',
    },
    audioScript: {
      type: Type.STRING,
      description: 'نص نقي للقراءة الصوتية بالدارجة المغربية 100% بدون أي كلمة فرنسية أو رموز غريبة.',
    },
    rooms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: {type: Type.STRING},
          areaSqm: {type: Type.STRING},
          notesDarija: {type: Type.STRING},
        },
        required: ['name', 'areaSqm', 'notesDarija'],
      },
    },
    materials: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: {type: Type.STRING},
          quantityEstimate: {type: Type.STRING},
          unit: {type: Type.STRING},
          notesDarija: {type: Type.STRING},
        },
        required: ['item', 'quantityEstimate', 'unit', 'notesDarija'],
      },
    },
    workPhases: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stepNumber: {type: Type.INTEGER},
          phaseName: {type: Type.STRING},
          durationEstimate: {type: Type.STRING},
          explanationDarija: {type: Type.STRING},
        },
        required: ['stepNumber', 'phaseName', 'durationEstimate', 'explanationDarija'],
      },
    },
    warningsDarija: {
      type: Type.ARRAY,
      items: {type: Type.STRING},
    },
  },
  required: [
    'isBlueprint',
    'title',
    'buildingType',
    'totalAreaSqm',
    'roomsCount',
    'darijaSummary',
    'rebarDetailsDarija',
    'audioScript',
    'rooms',
    'materials',
    'workPhases',
    'warningsDarija',
  ],
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

async function parseRequestBody(
  req: ApiRequest
): Promise<{imageBase64?: string; mimeType?: string; notes?: string} | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as {imageBase64?: string; mimeType?: string; notes?: string};
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8')) as {
          imageBase64?: string;
          mimeType?: string;
          notes?: string;
        };
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as {imageBase64?: string; mimeType?: string; notes?: string};
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
    return JSON.parse(rawText) as {imageBase64?: string; mimeType?: string; notes?: string};
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
        error: 'تعذر قراءة بيانات الصورة المرسلة.',
      });
      return;
    }

    const {imageBase64, mimeType, notes} = body;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({
        success: false,
        error: 'خاصك تصور ولا ترفع صورة ديال البلان أولا.',
      });
      return;
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    if (!cleanBase64) {
      res.status(400).json({
        success: false,
        error: 'صورة البلان غير صالحة، عاود رفع الصورة.',
      });
      return;
    }

    const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
    const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
    const promptText = [
      'حلل هاد الصورة مزيان: أول حاجة تأكد واش هادي صورة ديال بلان بناء أو بلان ديال الحديد (مخطط هندسي، رسومات معمارية، أو تسليح).',
      'إلى ما كانتش صورة بلان ديال البناء ولا الحديد، رجع isBlueprint: false وحط بالضبط فـ darijaSummary وفـ audioScript: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".',
      'وإلى كانت صورة ديال البلان، رجع isBlueprint: true وشرح كلشي 100% بالدارجة المغربية الحقيقية النقية بلا حتى كلمة فرنسية أو إنجليزية: فين كاين الحديد، شحال من بار (قضيب)، الأقطار والمسافات بين الحديد، نوع البناء، المساحات، عدد الغرف، المواد المطلوبة، ومراحل العمل بالترتيب.',
      trimmedNotes ? `ملاحظة إضافية من مول البلان: ${trimmedNotes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const systemInstructionText =
      'أنت معلم بناء ومهندس مغربي كتجاوب 100% بالدارجة المغربية الصافية والمفهومة، وممنوع نهائياً تكتب أي كلمة بالفرنسية أو الإنجليزية أو الترجمة الحرفية بحال béton أو dalle أو ferraillage أو diamètre أو salon أو cuisine أو R+1 — استعمل غير الكلمات المغربية العربية (الضالة، السواري، الكمرة، السوميلة، الحديد، البار، القطر، السنتيم، الصالون، الكوزينة، البيت، السيما، الرملة، الكياس). إلا كانت الصورة ماشي بلان ديال البناء أو الحديد (مثلاً وجه إنسان، طريق، طابلة، حيط خاوي...)، ضروري ترد isBlueprint=false وتكتب بالضبط: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".';

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
            contents: {
              parts: [{inlineData: {mimeType: safeMime, data: cleanBase64}}, {text: promptText}],
            },
            config: {
              systemInstruction: systemInstructionText,
              responseMimeType: 'application/json',
              responseSchema: PLAN_RESPONSE_SCHEMA,
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
          `[analyze-plan] model=${modelName} vertex=${useVertexAi} lowThink=${useLowThinking} failed:`,
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
    if (parsed.isBlueprint === false) {
      const rejection = 'هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك';
      parsed.darijaSummary = rejection;
      parsed.audioScript = rejection;
      parsed.rebarDetailsDarija = rejection;
    }

    res.status(200).json({success: true, ...parsed});
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'تعذر تحليل البلان، عاود حاول';
    console.error('[analyze-plan] fatal error:', rawMsg);
    const lower = rawMsg.toLowerCase();
    const isOverloaded =
      rawMsg.includes('503') ||
      lower.includes('overloaded') ||
      lower.includes('high demand') ||
      lower.includes('unavailable');
    res.status(isOverloaded ? 503 : 500).json({
      success: false,
      error: isOverloaded
        ? 'السيرفرات ديال الذكاء الاصطناعي عامرين دابا شوية، عاود ضغط على التحليل من بعد ثواني قليلة.'
        : rawMsg,
    });
  }
}
