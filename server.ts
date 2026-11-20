import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';
import {TTS_MODEL, VOICE_BOY, VOICE_GIRL} from './config.js';

type LockedVoiceName = typeof VOICE_GIRL | typeof VOICE_BOY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

export const MAX_CODE_TRIALS = 10;

// In-memory store synchronized with /admin for fast client code verification
interface ServerAccessCode {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  trials: number;
  createdAtMs: number;
  updatedAtMs: number;
}

const serverAccessCodes: ServerAccessCode[] = [
  {
    id: 'default_vip',
    name: 'كود الافتتاح VIP',
    code: 'FAHEM2026',
    isActive: true,
    trials: 0,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  },
];

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function cleanJsonString(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// --- Global Serial Queue (1 request at a time, 2s spacing for 50+ concurrent users) ---
const GLOBAL_QUEUE_GAP_MS = 2000;
let globalQueueTail: Promise<unknown> = Promise.resolve();
let lastGoogleApiFinishMs = 0;

function enqueueGoogleRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = globalQueueTail.then(async () => {
    const elapsed = Date.now() - lastGoogleApiFinishMs;
    if (lastGoogleApiFinishMs > 0 && elapsed < GLOBAL_QUEUE_GAP_MS) {
      await new Promise((r) => setTimeout(r, GLOBAL_QUEUE_GAP_MS - elapsed));
    }
    try {
      return await task();
    } finally {
      lastGoogleApiFinishMs = Date.now();
    }
  });
  globalQueueTail = run.catch(() => undefined);
  return run;
}

const planAnalysisCache = new Map<string, Record<string, unknown>>();
const MAX_PLAN_ANALYSIS_CACHE = 100;

async function generateJsonWithRetry(
  ai: GoogleGenAI,
  params: {
    contents: unknown;
    systemInstruction: string;
    responseSchema: Record<string, unknown>;
  }
): Promise<unknown> {
  const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  let lastErr: unknown = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await enqueueGoogleRequest(() =>
          ai.models.generateContent({
            model,
            contents: params.contents as Parameters<typeof ai.models.generateContent>[0]['contents'],
            config: {
              systemInstruction: params.systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: params.responseSchema,
              thinkingConfig: {thinkingLevel: ThinkingLevel.MINIMAL},
            },
          })
        );
        const text = response.text;
        if (!text) {
          throw new Error('رد فارغ من الذكاء الاصطناعي');
        }
        return JSON.parse(cleanJsonString(text));
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient =
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED');
        if (isTransient && attempt === 0) {
          continue;
        }
        break;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const PLAN_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isBlueprint: {
      type: Type.BOOLEAN,
      description: 'true فقط إذا كانت الصورة مخطط بناء أو بلان هندسي أو بلان ديال الحديد والتسليح، و false إذا كانت صورة عادية ما عندهاش علاقة بالبلانات.',
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

const CRACK_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    severity: {
      type: Type.STRING,
      description: 'درجة الخطورة بالدارجة: سطحي بسيط، متوسط، أو خطير إنشائي',
    },
    crackType: {
      type: Type.STRING,
      description: 'نوع الشق بالدارجة (شق ديال المرطوب والصباغة، شق رطوبة، شق فالسواري أو الكمرة...)',
    },
    causesDarija: {
      type: Type.STRING,
      description: 'علاش خرج هاد الشق بالدارجة المغربية الواضحة',
    },
    repairStepsDarija: {
      type: Type.ARRAY,
      items: {type: Type.STRING},
      description: 'خطوات الإصلاح بالترتيب بالدارجة',
    },
    audioScript: {
      type: Type.STRING,
      description: 'ملخص صوتي نقي بالدارجة المغربية يشرح التشخيص والحل بسرعة',
    },
  },
  required: ['severity', 'crackType', 'causesDarija', 'repairStepsDarija', 'audioScript'],
};

async function startServer() {
  const app = express();
  app.use(express.json({limit: '15mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Admin Access Codes API (protected by passcode 999)
  app.get('/api/codes', (req, res) => {
    const pin = req.header('x-admin-pin');
    if (pin !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    res.json({codes: serverAccessCodes});
  });

  app.post('/api/codes', (req, res) => {
    const pin = req.header('x-admin-pin');
    if (pin !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    const {id, name, code, isActive, trials} = req.body as {
      id?: string;
      name?: string;
      code?: string;
      isActive?: boolean;
      trials?: number;
    };
    if (!name?.trim() || !code?.trim()) {
      res.status(400).json({error: 'خاصك تعمر الاسم والكود بجوج'});
      return;
    }
    const normalized = code.trim().toUpperCase().slice(0, 40);
    const existing = serverAccessCodes.find((c) => c.code.toUpperCase() === normalized);
    if (existing) {
      existing.name = name.trim().slice(0, 100);
      if (typeof isActive === 'boolean') existing.isActive = isActive;
      if (typeof trials === 'number' && Number.isFinite(trials)) {
        existing.trials = Math.max(0, Math.round(trials));
      }
      existing.updatedAtMs = Date.now();
      res.json({item: existing});
      return;
    }

    const item: ServerAccessCode = {
      id: id?.trim() || `code_${Date.now()}`,
      name: name.trim().slice(0, 100),
      code: normalized,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      trials: typeof trials === 'number' && Number.isFinite(trials) ? Math.max(0, Math.round(trials)) : 0,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    serverAccessCodes.unshift(item);
    res.json({item});
  });

  app.patch('/api/codes/:id', (req, res) => {
    const pin = req.header('x-admin-pin');
    if (pin !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    const targetParam = req.params.id;
    const {isActive, resetTrials, trials, name, code} = req.body as {
      isActive?: boolean;
      resetTrials?: boolean;
      trials?: number;
      name?: string;
      code?: string;
    };

    let item = serverAccessCodes.find(
      (c) => c.id === targetParam || (code && c.code.toUpperCase() === code.trim().toUpperCase())
    );
    if (!item && name && code) {
      item = {
        id: targetParam,
        name: name.trim().slice(0, 100),
        code: code.trim().toUpperCase().slice(0, 40),
        isActive: typeof isActive === 'boolean' ? isActive : true,
        trials: 0,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      serverAccessCodes.unshift(item);
    }

    if (!item) {
      res.status(404).json({error: 'الكود غير موجود'});
      return;
    }

    if (typeof name === 'string' && name.trim()) {
      item.name = name.trim().slice(0, 100);
    }
    if (typeof isActive === 'boolean') {
      item.isActive = isActive;
    }
    if (resetTrials) {
      item.trials = 0;
    } else if (typeof trials === 'number' && Number.isFinite(trials)) {
      item.trials = Math.max(0, Math.round(trials));
    }
    item.updatedAtMs = Date.now();
    res.json({item});
  });

  app.delete('/api/codes/:id', (req, res) => {
    const pin = req.header('x-admin-pin');
    if (pin !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    const target = req.params.id;
    const idx = serverAccessCodes.findIndex(
      (c) => c.id === target || c.code.toUpperCase() === target.toUpperCase()
    );
    if (idx !== -1) serverAccessCodes.splice(idx, 1);
    res.json({ok: true});
  });

  app.post('/api/codes/verify', (req, res) => {
    const {code} = req.body as {code?: string};
    const normalized = (code || '').trim().toUpperCase();
    const found = serverAccessCodes.find((c) => c.code.toUpperCase() === normalized);
    if (!found) {
      res.status(404).json({
        valid: false,
        reason: 'not_found',
        error: 'هاد الكود غير صحيح أو ما مسجلش عند الإدارة.',
      });
      return;
    }
    if (!found.isActive) {
      res.status(403).json({
        valid: false,
        reason: 'inactive',
        isActive: false,
        trials: found.trials,
        maxTrials: MAX_CODE_TRIALS,
        name: found.name,
        code: found.code,
        error: 'هاد الكود موقوف حالياً من الإدارة. تواصل مع واتساب 0647205383 للتفعيل.',
      });
      return;
    }
    if (found.trials >= MAX_CODE_TRIALS) {
      res.status(403).json({
        valid: false,
        reason: 'limit_reached',
        isActive: true,
        trials: found.trials,
        maxTrials: MAX_CODE_TRIALS,
        name: found.name,
        code: found.code,
        error: `هاد الكود وصل للحد الأقصى (${MAX_CODE_TRIALS}/${MAX_CODE_TRIALS}). تواصل عبر واتساب 0647205383 باش تخلص وتصفر العداد.`,
      });
      return;
    }
    res.json({
      valid: true,
      id: found.id,
      name: found.name,
      code: found.code,
      isActive: found.isActive,
      trials: found.trials,
      maxTrials: MAX_CODE_TRIALS,
      updatedAtMs: found.updatedAtMs,
    });
  });

  app.post('/api/codes/consume', (req, res) => {
    const {code} = req.body as {code?: string};
    const normalized = (code || '').trim().toUpperCase();
    const found = serverAccessCodes.find((c) => c.code.toUpperCase() === normalized);
    if (!found) {
      res.status(404).json({ok: false, reason: 'not_found', error: 'الكود غير موجود'});
      return;
    }
    if (!found.isActive) {
      res.status(403).json({
        ok: false,
        reason: 'inactive',
        isActive: false,
        trials: found.trials,
        error: 'الكود موقوف من الإدارة',
      });
      return;
    }
    if (found.trials >= MAX_CODE_TRIALS) {
      res.status(403).json({
        ok: false,
        reason: 'limit_reached',
        isActive: true,
        trials: found.trials,
        error: 'وصلتي للحد الأقصى ديال المحاولات (10/10)',
      });
      return;
    }
    found.trials += 1;
    found.updatedAtMs = Date.now();
    res.json({
      ok: true,
      trials: found.trials,
      isActive: found.isActive,
      maxTrials: MAX_CODE_TRIALS,
      updatedAtMs: found.updatedAtMs,
    });
  });

  app.post('/api/analyze-plan', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({
        error: 'خدمة تحليل الصور غير مفعلة حالياً على الخادم.',
      });
      return;
    }

    const {imageBase64, mimeType, notes} = req.body as {
      imageBase64?: string;
      mimeType?: string;
      notes?: string;
    };

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({error: 'خاصك تصور ولا ترفع صورة ديال البلان أولا.'});
      return;
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
    const trimmedNotes = (notes || '').trim();
    const analysisCacheKey = crypto
      .createHash('sha256')
      .update(`${cleanBase64}::${trimmedNotes}`)
      .digest('hex');

    const cachedPlan = planAnalysisCache.get(analysisCacheKey);
    if (cachedPlan) {
      res.json(cachedPlan);
      return;
    }

    try {
      const promptText = [
        'حلل هاد الصورة مزيان: أول حاجة تأكد واش هادي صورة ديال بلان بناء أو بلان ديال الحديد (مخطط هندسي، رسومات معمارية، أو تسليح).',
        'إلى ما كانتش صورة بلان ديال البناء ولا الحديد، رجع isBlueprint: false وحط بالضبط فـ darijaSummary وفـ audioScript: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".',
        'وإلى كانت صورة ديال البلان، رجع isBlueprint: true وشرح كلشي 100% بالدارجة المغربية الحقيقية النقية بلا حتى كلمة فرنسية أو إنجليزية: فين كاين الحديد، شحال من بار (قضيب)، الأقطار والمسافات بين الحديد، نوع البناء، المساحات، عدد الغرف، المواد المطلوبة، ومراحل العمل بالترتيب.',
        trimmedNotes ? `ملاحظة إضافية من مول البلان: ${trimmedNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const parsed = (await generateJsonWithRetry(ai, {
        contents: {
          parts: [
            {inlineData: {mimeType: safeMime, data: cleanBase64}},
            {text: promptText},
          ],
        },
        systemInstruction:
          'أنت معلم بناء ومهندس مغربي كتجاوب 100% بالدارجة المغربية الصافية والمفهومة، وممنوع نهائياً تكتب أي كلمة بالفرنسية أو الإنجليزية أو الترجمة الحرفية بحال béton أو dalle أو ferraillage أو diamètre أو salon أو cuisine أو R+1 — استعمل غير الكلمات المغربية العربية (الضالة، السواري، الكمرة، السوميلة، الحديد، البار، القطر، السنتيم، الصالون، الكوزينة، البيت، السيما، الرملة، الكياس). إلا كانت الصورة ماشي بلان ديال البناء أو الحديد (مثلاً وجه إنسان، طريق، طابلة، حيط خاوي...)، ضروري ترد isBlueprint=false وتكتب بالضبط: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".',
        responseSchema: PLAN_RESPONSE_SCHEMA,
      })) as Record<string, unknown> & {
        isBlueprint?: boolean;
        darijaSummary?: string;
        audioScript?: string;
        rebarDetailsDarija?: string;
      };

      if (parsed && parsed.isBlueprint === false) {
        const rejection = 'هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك';
        parsed.darijaSummary = rejection;
        parsed.audioScript = rejection;
        parsed.rebarDetailsDarija = rejection;
      }

      if (planAnalysisCache.size >= MAX_PLAN_ANALYSIS_CACHE) {
        const firstKey = planAnalysisCache.keys().next().value;
        if (firstKey) planAnalysisCache.delete(firstKey);
      }
      planAnalysisCache.set(analysisCacheKey, parsed);

      res.json(parsed);
    } catch (err) {
      console.error('Gemini analyze-plan error:', err);
      const message = err instanceof Error ? err.message : 'وقع مشكل أثناء تحليل البلان';
      res.status(500).json({error: `وقع خطأ تقني فالتحليل: ${message}`});
    }
  });

  app.post('/api/chat-plan', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({error: 'خدمة الدردشة غير مفعلة حالياً على الخادم.'});
      return;
    }

    const {imageBase64, mimeType, history, message} = req.body as {
      imageBase64?: string;
      mimeType?: string;
      history?: {role: 'user' | 'assistant'; text: string}[];
      message?: string;
    };

    if (!message || !message.trim()) {
      res.status(400).json({error: 'كتب ولا قول سؤالك على البلان أولا.'});
      return;
    }

    const parts: Array<{inlineData?: {mimeType: string; data: string}; text?: string}> = [];
    if (imageBase64 && typeof imageBase64 === 'string') {
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
      parts.push({inlineData: {mimeType: safeMime, data: cleanBase64}});
    }

    const historyText = (history || [])
      .slice(-8)
      .map((h) => `${h.role === 'user' ? 'مول الدار' : 'المعلم فاهم بلان'}: ${h.text}`)
      .join('\n');

    const promptText = [
      historyText ? `المحادثة اللي فاتت:\n${historyText}` : '',
      `سؤال المستخدم الجديد: ${message.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    parts.push({text: promptText});

    try {
      const parsed = await generateJsonWithRetry(ai, {
        contents: {parts},
        systemInstruction:
          'أنت المعلم ومهندس مغربي في تطبيق فاهم بلان. جاوب المستخدم في الدردشة على سؤالو حول البلان ديالو بـ 100% دارجة مغربية حقيقية وساهلة ومفهومة، بلا حتى كلمة فرنسية أو إنجليزية أو رموز غريبة. ركز مزيان على تفاصيل الحديد (فين كاين الحديد، شحال من بار، المسافات بين القضبان، السواري، الضالة، الكمرة)، المساحات والسلعة. وإلى كانت الصورة ماشي ديال البلان قول ليه: هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك.',
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
      });
      res.json(parsed);
    } catch (err) {
      console.error('Gemini chat-plan error:', err);
      res.status(500).json({error: 'ما قدرناش نجاوبو دابا، جرب عاود صيفط السؤال.'});
    }
  });

  app.post('/api/detect-cracks', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({error: 'خدمة كشف الشقوق غير مفعلة حالياً على الخادم.'});
      return;
    }

    const {imageBase64, mimeType} = req.body as {imageBase64?: string; mimeType?: string};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({error: 'خاصك تصور ولا ترفع صورة ديال الشق أولا.'});
      return;
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

    try {
      const parsed = await generateJsonWithRetry(ai, {
        contents: {
          parts: [
            {inlineData: {mimeType: safeMime, data: cleanBase64}},
            {
              text: 'فحص هاد الصورة ديال الحيط أو السقف أو السارية، وشخص أي شقوق أو رطوبة بالدارجة المغربية مع خطوات الإصلاح.',
            },
          ],
        },
        systemInstruction:
          'أنت مهندس مدني مغربي خبير فـ تشخيص شقوق البناء والهياكل الخرسانية. فحص الصورة وحدد واش الشق سطحي (ديال المرطوب/الصباغة) ولا متوسط ولا خطير إنشائي (فالسواري/الضالة/الأساس)، وعطي الأسباب وخطوات الإصلاح العملية بالدارجة المغربية الواضحة.',
        responseSchema: CRACK_RESPONSE_SCHEMA,
      });

      res.json(parsed);
    } catch (err) {
      console.error('Gemini detect-cracks error:', err);
      const message = err instanceof Error ? err.message : 'وقع خطأ فـ كشف الشقوق';
      res.status(500).json({error: `ما قدرناش نشخصو الصورة دابا: ${message}`});
    }
  });

  app.post('/api/voice-idea-summary', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(503).json({error: 'خدمة الذكاء الاصطناعي غير متوفرة حالياً على الخادم.'});
      return;
    }

    const {rawIdea} = req.body as {rawIdea?: string};
    if (!rawIdea || typeof rawIdea !== 'string' || !rawIdea.trim()) {
      res.status(400).json({error: 'كتب ولا هضر بالفكرة ديالك أولا.'});
      return;
    }

    try {
      const parsed = await generateJsonWithRetry(ai, {
        contents: `نظم هاد الفكرة الصوتية ديال الشانطي وعطيها عنوان قصير وخلاصة مرتبة بالدارجة المغربية على شكل نقط عملية:\n"${rawIdea.slice(0, 2500)}"`,
        systemInstruction:
          'أنت مساعد بناء مغربي كتقيد أفكار المعلم أو مول الدار وترتبها بالدارجة المغربية الواضحة في نقط عملية قصيرة.',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {type: Type.STRING},
            structuredDarija: {type: Type.STRING},
          },
          required: ['title', 'structuredDarija'],
        },
      });
      res.json(parsed);
    } catch (err) {
      console.error('Gemini voice-idea-summary error:', err);
      res.status(500).json({error: 'ما قدرناش نرتبو الفكرة دابا، جرب مرة أخرى.'});
    }
  });

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
    header.writeUInt32LE(16, 16); // PCM
    header.writeUInt16LE(1, 20); // Linear PCM
    header.writeUInt16LE(1, 22); // Mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(2, 32); // Block align
    header.writeUInt16LE(16, 34); // Bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
  }

  const ttsCache = new Map<string, {audioBase64: string; mimeType: string; provider: string}>();

  // --- Encrypted TTS API Key Pool & Round-Robin Rotation Vault ---
  type TtsKeyStatus = 'active' | 'exhausted';
  interface StoredTtsApiKey {
    key: string; // AES-256-GCM encrypted ciphertext ONLY (never plaintext)
    order: number; // 1..20
    status: TtsKeyStatus;
    lastUsed: number;
    failCount: number;
  }
  interface TtsKeySlotDto {
    order: number;
    hasKey: boolean;
    maskedKey: string;
    encryptedKey?: string;
    status: TtsKeyStatus;
    lastUsed: number;
    failCount: number;
  }

  const MAX_TTS_KEY_SLOTS = 20;
  const TTS_KEY_RESET_MS = 24 * 60 * 60 * 1000;
  const TTS_MAX_SERVER_CACHE = 250;
  const TTS_MAX_SILENT_RETRIES = MAX_TTS_KEY_SLOTS;
  const TTS_ALL_EXHAUSTED_COOLDOWN_MS = 60_000;
  const TTS_VAULT_FILE = path.resolve(__dirname, '.tts_api_keys.enc.json');
  let ttsRoundRobinCursor = 0;
  let lastUsedKeyOrder: number | null = null;
  let ttsAllExhaustedUntilMs = 0;

  function getTtsVaultCipherKey(): Buffer {
    const secret =
      process.env.TTS_ENCRYPTION_SECRET ||
      process.env.GEMINI_API_KEY ||
      'fahem-blan-tts-vault-key-v1';
    return crypto.createHash('sha256').update(secret).digest();
  }

  function encryptTtsKey(plainKey: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getTtsVaultCipherKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `encv1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  function decryptTtsKey(cipherPayload: string): string | null {
    try {
      if (!cipherPayload.startsWith('encv1:')) return null;
      const parts = cipherPayload.split(':');
      if (parts.length !== 4) return null;
      const iv = Buffer.from(parts[1], 'hex');
      const tag = Buffer.from(parts[2], 'hex');
      const encrypted = Buffer.from(parts[3], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', getTtsVaultCipherKey(), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      return plain.trim() || null;
    } catch {
      return null;
    }
  }

  function loadTtsVaultFromDisk(): StoredTtsApiKey[] {
    try {
      if (!fs.existsSync(TTS_VAULT_FILE)) return [];
      const raw = fs.readFileSync(TTS_VAULT_FILE, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const valid: StoredTtsApiKey[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Partial<StoredTtsApiKey>;
        const order = Number(rec.order);
        if (
          typeof rec.key === 'string' &&
          rec.key.startsWith('encv1:') &&
          Number.isInteger(order) &&
          order >= 1 &&
          order <= MAX_TTS_KEY_SLOTS
        ) {
          valid.push({
            key: rec.key,
            order,
            status: rec.status === 'exhausted' ? 'exhausted' : 'active',
            lastUsed: Number.isFinite(Number(rec.lastUsed)) ? Math.max(0, Number(rec.lastUsed)) : 0,
            failCount: Number.isFinite(Number(rec.failCount)) ? Math.max(0, Number(rec.failCount)) : 0,
          });
        }
      }
      valid.sort((a, b) => a.order - b.order);
      return valid;
    } catch {
      return [];
    }
  }

  const ttsKeyVault: StoredTtsApiKey[] = loadTtsVaultFromDisk();
  console.log(`[TTS Vault] Loaded ${ttsKeyVault.length} keys from ${path.basename(TTS_VAULT_FILE)} (model=${TTS_MODEL})`);
  for (const rec of ttsKeyVault) {
    const plain = decryptTtsKey(rec.key);
    console.log(
      `[TTS Vault] Key ${rec.order}: ${plain ? `valid-format (len=${plain.length}, hasSpaces=${/\s/.test(plain)})` : 'EMPTY_OR_DECRYPT_FAILED'}, status=${rec.status}`
    );
  }

  function saveTtsVaultToDisk(): void {
    try {
      ttsKeyVault.sort((a, b) => a.order - b.order);
      fs.writeFileSync(TTS_VAULT_FILE, JSON.stringify(ttsKeyVault, null, 2), {mode: 0o600});
    } catch (err) {
      console.warn('Could not persist TTS key vault:', err);
    }
  }

  function resetExpiredTtsKeysIf24h(): boolean {
    const now = Date.now();
    let changed = false;
    for (const rec of ttsKeyVault) {
      if (rec.status === 'exhausted' && rec.lastUsed > 0 && now - rec.lastUsed >= TTS_KEY_RESET_MS) {
        rec.status = 'active';
        rec.failCount = 0;
        changed = true;
      }
    }
    if (changed) {
      saveTtsVaultToDisk();
    }
    return changed;
  }

  // Run 24h auto-reset check on startup and every 15 minutes
  resetExpiredTtsKeysIf24h();
  const ttsResetTimer = setInterval(() => {
    resetExpiredTtsKeysIf24h();
  }, 15 * 60_000);
  ttsResetTimer.unref();

  function buildTtsSlotsResponse(): TtsKeySlotDto[] {
    const byOrder = new Map<number, StoredTtsApiKey>();
    for (const rec of ttsKeyVault) {
      byOrder.set(rec.order, rec);
    }
    const slots: TtsKeySlotDto[] = [];
    for (let order = 1; order <= MAX_TTS_KEY_SLOTS; order++) {
      const rec = byOrder.get(order);
      if (rec) {
        slots.push({
          order,
          hasKey: true,
          maskedKey: '****',
          encryptedKey: rec.key,
          status: rec.status,
          lastUsed: rec.lastUsed,
          failCount: rec.failCount,
        });
      } else {
        slots.push({
          order,
          hasKey: false,
          maskedKey: '',
          status: 'active',
          lastUsed: 0,
          failCount: 0,
        });
      }
    }
    return slots;
  }

  async function callGeminiPreviewTtsWithKey(
    apiKey: string,
    darijaText: string,
    voiceName: LockedVoiceName
  ): Promise<
    | {ok: true; audioBase64: string; mimeType: string}
    | {ok: false; httpStatus: number; isQuota: boolean; error: string}
  > {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{parts: [{text: darijaText}]}],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {voiceName},
                },
              },
            },
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const isQuota =
          response.status === 429 ||
          errText.includes('RESOURCE_EXHAUSTED') ||
          errText.toLowerCase().includes('quota');
        return {
          ok: false,
          httpStatus: response.status,
          isQuota,
          error: errText.slice(0, 900) || `HTTP ${response.status}`,
        };
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: {data?: string; mimeType?: string};
            }>;
          };
        }>;
      };
      const inlineData = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) {
        return {
          ok: false,
          httpStatus: 502,
          isQuota: false,
          error: 'No audio inlineData returned',
        };
      }

      const rawBuf = Buffer.from(inlineData.data, 'base64');
      const hasRiffHeader = rawBuf.length >= 4 && rawBuf.slice(0, 4).toString('ascii') === 'RIFF';
      const wavBuf = hasRiffHeader ? rawBuf : wrapPcm16AsWav(rawBuf, 24000);
      return {
        ok: true,
        audioBase64: wavBuf.toString('base64'),
        mimeType: 'audio/wav',
      };
    } catch (err) {
      return {
        ok: false,
        httpStatus: 500,
        isQuota: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  app.get('/api/admin/tts-keys', (req, res) => {
    if (req.header('x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    resetExpiredTtsKeysIf24h();
    res.json({slots: buildTtsSlotsResponse()});
  });

  app.post('/api/admin/tts-keys', (req, res) => {
    if (req.header('x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    const {entries} = req.body as {
      entries?: Array<{order: number; keyInput?: string; clear?: boolean}>;
    };
    if (!Array.isArray(entries)) {
      res.status(400).json({error: 'بيانات المفاتيح غير صالحة'});
      return;
    }

    for (const entry of entries) {
      const order = Number(entry.order);
      if (!Number.isInteger(order) || order < 1 || order > MAX_TTS_KEY_SLOTS) continue;
      const idx = ttsKeyVault.findIndex((k) => k.order === order);

      if (entry.clear) {
        if (idx !== -1) ttsKeyVault.splice(idx, 1);
        continue;
      }

      if (typeof entry.keyInput === 'string') {
        const trimmed = entry.keyInput.trim();
        if (!trimmed || trimmed === '****') {
          // Leave existing encrypted key untouched
          continue;
        }
        if (trimmed.length < 10 || trimmed.length > 512) {
          res.status(400).json({error: `المفتاح رقم ${order} غير صالح`});
          return;
        }
        const encryptedCipher = encryptTtsKey(trimmed);
        const record: StoredTtsApiKey = {
          key: encryptedCipher,
          order,
          status: 'active',
          lastUsed: 0,
          failCount: 0,
        };
        if (idx !== -1) {
          ttsKeyVault[idx] = record;
        } else {
          ttsKeyVault.push(record);
        }
      }
    }

    saveTtsVaultToDisk();
    // Immediately reload keys from disk and clear quotaExhausted cooldown so Google TTS retries right away without restart
    const reloaded = loadTtsVaultFromDisk();
    ttsKeyVault.splice(0, ttsKeyVault.length, ...reloaded);
    ttsAllExhaustedUntilMs = 0;
    ttsRoundRobinCursor = 0;
    lastUsedKeyOrder = null;
    console.log(`[TTS Vault] Saved & reloaded ${ttsKeyVault.length} keys — quotaExhausted cleared`);
    res.json({ok: true, quotaCleared: true, slots: buildTtsSlotsResponse()});
  });

  app.post('/api/admin/tts-keys/hydrate', (req, res) => {
    if (req.header('x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    const {records} = req.body as {
      records?: Array<{
        order: number;
        encryptedKey: string;
        status?: TtsKeyStatus;
        lastUsed?: number;
        failCount?: number;
      }>;
    };
    if (!Array.isArray(records)) {
      res.status(400).json({error: 'بيانات المزامنة غير صالحة'});
      return;
    }

    let changed = false;
    for (const item of records) {
      const order = Number(item.order);
      if (
        !Number.isInteger(order) ||
        order < 1 ||
        order > MAX_TTS_KEY_SLOTS ||
        typeof item.encryptedKey !== 'string' ||
        !item.encryptedKey.startsWith('encv1:')
      ) {
        continue;
      }
      // Only hydrate records encrypted by this vault key
      if (!decryptTtsKey(item.encryptedKey)) continue;
      const existing = ttsKeyVault.find((k) => k.order === order);
      if (!existing) {
        ttsKeyVault.push({
          key: item.encryptedKey,
          order,
          status: item.status === 'exhausted' ? 'exhausted' : 'active',
          lastUsed: Number.isFinite(Number(item.lastUsed)) ? Math.max(0, Number(item.lastUsed)) : 0,
          failCount: Number.isFinite(Number(item.failCount)) ? Math.max(0, Number(item.failCount)) : 0,
        });
        changed = true;
      }
    }

    if (changed) {
      saveTtsVaultToDisk();
      ttsAllExhaustedUntilMs = 0;
    }
    resetExpiredTtsKeysIf24h();
    res.json({ok: true, slots: buildTtsSlotsResponse()});
  });

  function resolveLockedVoiceName(voiceType?: string, gender?: string): LockedVoiceName {
    if (voiceType === VOICE_GIRL || gender === 'female') return VOICE_GIRL;
    if (voiceType === VOICE_BOY || gender === 'male') return VOICE_BOY;
    return VOICE_BOY;
  }

  app.post('/api/admin/tts-keys/test', async (req, res) => {
    if (req.header('x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    const {order, plainKey, gender, voiceId, voiceType, text} = req.body as {
      order?: number;
      plainKey?: string;
      gender?: 'male' | 'female';
      voiceId?: string;
      voiceType?: string;
      text?: string;
    };
    const slotOrder = Number(order);
    if (!Number.isInteger(slotOrder) || slotOrder < 1 || slotOrder > MAX_TTS_KEY_SLOTS) {
      res.status(400).json({ok: false, status: 'exhausted', error: 'رقم المفتاح غير صالح'});
      return;
    }

    const storedRecord = ttsKeyVault.find((k) => k.order === slotOrder);
    const trimmedInput = typeof plainKey === 'string' ? plainKey.trim() : '';
    const usingUnsavedPlain = Boolean(trimmedInput && trimmedInput !== '****');
    const resolvedKey = usingUnsavedPlain
      ? trimmedInput
      : storedRecord
        ? decryptTtsKey(storedRecord.key)
        : null;

    if (!resolvedKey) {
      res.status(400).json({
        ok: false,
        status: 'exhausted',
        message: 'ما كاينش مفتاح محفوظ فهاد الخانة باش نختابروه.',
        slots: buildTtsSlotsResponse(),
      });
      return;
    }

    const voiceName = resolveLockedVoiceName(voiceId || voiceType, gender);
    const sampleText = toDarijaServer(text?.trim() || 'مرحبا بيك ف فاهم بلان');
    const result = await callGeminiPreviewTtsWithKey(resolvedKey, sampleText, voiceName);
    const nowTs = Date.now();

    if (result.ok) {
      ttsAllExhaustedUntilMs = 0;
      if (storedRecord && !usingUnsavedPlain) {
        storedRecord.status = 'active';
        storedRecord.failCount = 0;
        storedRecord.lastUsed = nowTs;
        saveTtsVaultToDisk();
      }
      res.json({
        ok: true,
        status: 'active' as TtsKeyStatus,
        message: '✅ شغال',
        voiceName,
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
        slots: buildTtsSlotsResponse(),
      });
      return;
    }

    if (storedRecord && !usingUnsavedPlain) {
      storedRecord.status = 'exhausted';
      storedRecord.failCount += 1;
      storedRecord.lastUsed = nowTs;
      saveTtsVaultToDisk();
    }

    res.status(200).json({
      ok: false,
      status: 'exhausted' as TtsKeyStatus,
      httpStatus: result.httpStatus,
      voiceName,
      errorDetail: result.error,
      message: result.isQuota ? '❌ الكوتا عامرة' : `❌ الكوتا عامرة (${result.httpStatus})`,
      slots: buildTtsSlotsResponse(),
    });
  });

  app.post('/api/tts', async (req, res) => {
    const {text, gender, voiceId, voiceType} = req.body as {
      text?: string;
      gender?: 'male' | 'female';
      voiceId?: string;
      voiceType?: string;
    };
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({error: 'النص خاوي'});
      return;
    }

    const voiceName = resolveLockedVoiceName(voiceId || voiceType, gender);
    const darijaText = toDarijaServer(text);
    const cacheKey = `${voiceName}::${darijaText}`;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    resetExpiredTtsKeysIf24h();
    const sortedVaultKeys = [...ttsKeyVault].sort((a, b) => a.order - b.order);
    const activeVaultKeys = sortedVaultKeys.filter((k) => k.status !== 'exhausted');
    const exhaustedVaultKeys = sortedVaultKeys.filter((k) => k.status === 'exhausted');

    // If all 20 slots are currently in short cooldown (no new keys saved yet), fast-fail to browser fallback
    if (activeVaultKeys.length === 0 && Date.now() < ttsAllExhaustedUntilMs) {
      res.status(200).json({
        ok: false,
        quotaExhausted: true,
        loadedCount: sortedVaultKeys.length,
        voiceName,
        errorDetail: 'ALL_KEYS_COOLDOWN',
      });
      return;
    }

    // Rotate starting position across active keys first, then append any exhausted keys as backup
    // so EVERY saved key (key 1 -> key 2 -> ... -> key 20) is tried on 429/error without stopping early.
    const rotateList = <T,>(arr: T[], cursor: number): T[] => {
      if (arr.length <= 1) return arr;
      const offset = ((cursor % arr.length) + arr.length) % arr.length;
      return [...arr.slice(offset), ...arr.slice(0, offset)];
    };

    const orderedActive = rotateList(activeVaultKeys, ttsRoundRobinCursor);
    const orderedExhausted = rotateList(exhaustedVaultKeys, ttsRoundRobinCursor);
    const candidateKeys = [...orderedActive, ...orderedExhausted];
    let lastErrorDetail = '';
    const attemptErrors: string[] = [];

    console.log(
      `[TTS Rotate] Loaded ${sortedVaultKeys.length} keys (active=${activeVaultKeys.length}, exhausted=${exhaustedVaultKeys.length}), trying ${candidateKeys.length} keys for voice=${voiceName}`
    );

    if (candidateKeys.length > 0) {
      let vaultMutated = false;
      const maxAttempts = Math.min(candidateKeys.length, TTS_MAX_SILENT_RETRIES);
      ttsRoundRobinCursor = (ttsRoundRobinCursor + 1) % Math.max(1, sortedVaultKeys.length);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const rec = candidateKeys[attempt];
        lastUsedKeyOrder = rec.order;

        const rawKey = decryptTtsKey(rec.key);
        if (!rawKey) {
          console.log(`[TTS Rotate] Key ${rec.order}: empty or failed to decrypt`);
          attemptErrors.push(`key${rec.order}:INVALID_EMPTY`);
          rec.status = 'exhausted';
          rec.failCount += 1;
          rec.lastUsed = Date.now();
          vaultMutated = true;
          continue;
        }

        const attemptRes = await callGeminiPreviewTtsWithKey(rawKey, darijaText, voiceName);
        if (attemptRes.ok) {
          ttsAllExhaustedUntilMs = 0;
          rec.status = 'active';
          rec.failCount = 0;
          rec.lastUsed = Date.now();
          saveTtsVaultToDisk();

          const payload = {
            ok: true,
            audioBase64: attemptRes.audioBase64,
            mimeType: attemptRes.mimeType,
            voiceName,
            provider: `${TTS_MODEL}-key${rec.order}-${voiceName}`,
          };
          if (ttsCache.size >= TTS_MAX_SERVER_CACHE) {
            const firstKey = ttsCache.keys().next().value;
            if (firstKey) ttsCache.delete(firstKey);
          }
          ttsCache.set(cacheKey, payload);
          res.json(payload);
          return;
        }

        const errMsg = `key${rec.order}:${attemptRes.httpStatus}:${attemptRes.error}`;
        attemptErrors.push(errMsg);
        lastErrorDetail = attemptErrors.join(' | ');
        console.log(`[TTS Rotate] Key ${rec.order} quota/http=${attemptRes.httpStatus} — trying next key`);
        rec.status = 'exhausted';
        rec.failCount += 1;
        rec.lastUsed = Date.now();
        vaultMutated = true;
      }

      if (vaultMutated) {
        saveTtsVaultToDisk();
      }
    }

    // Backup attempt with server GEMINI_API_KEY (with 1 fast retry on transient 429/503)
    const defaultEnvKey = process.env.GEMINI_API_KEY;
    if (defaultEnvKey) {
      for (let envTry = 0; envTry < 2; envTry++) {
        const envPreviewRes = await callGeminiPreviewTtsWithKey(defaultEnvKey, darijaText, voiceName);
        if (envPreviewRes.ok) {
          ttsAllExhaustedUntilMs = 0;
          const payload = {
            ok: true,
            audioBase64: envPreviewRes.audioBase64,
            mimeType: envPreviewRes.mimeType,
            voiceName,
            provider: `${TTS_MODEL}-env-${voiceName}`,
          };
          if (ttsCache.size >= TTS_MAX_SERVER_CACHE) {
            const firstKey = ttsCache.keys().next().value;
            if (firstKey) ttsCache.delete(firstKey);
          }
          ttsCache.set(cacheKey, payload);
          res.json(payload);
          return;
        }
        const envErr = `env:${envPreviewRes.httpStatus}:${envPreviewRes.error}`;
        lastErrorDetail = [lastErrorDetail, envErr].filter(Boolean).join(' | ');
        if (envTry === 0 && (envPreviewRes.httpStatus === 429 || envPreviewRes.httpStatus === 503)) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        break;
      }
    }

    ttsAllExhaustedUntilMs = Date.now() + TTS_ALL_EXHAUSTED_COOLDOWN_MS;
    res.status(200).json({
      ok: false,
      quotaExhausted: true,
      loadedCount: sortedVaultKeys.length,
      voiceName,
      errorDetail: lastErrorDetail || 'TTS_UNAVAILABLE',
    });
  });

  app.post('/api/tts-keys/test-all', async (_req, res) => {
    const sortedVaultKeys = [...ttsKeyVault].sort((a, b) => a.order - b.order);
    console.log(`[TTS Debug] Loaded ${sortedVaultKeys.length} keys for sequential test`);

    const results: Array<{
      order: number;
      label: string;
      state: 'OK' | 'Quota Full' | 'Invalid';
      httpStatus: number;
      hasSpaces: boolean;
      keyLength: number;
      detail: string;
    }> = [];

    const uniqueFingerprints = new Set<string>();
    let vaultMutated = false;

    for (const rec of sortedVaultKeys) {
      const rawKey = decryptTtsKey(rec.key);
      if (!rawKey) {
        rec.status = 'exhausted';
        rec.failCount += 1;
        rec.lastUsed = Date.now();
        vaultMutated = true;
        results.push({
          order: rec.order,
          label: `Key ${rec.order}`,
          state: 'Invalid',
          httpStatus: 0,
          hasSpaces: false,
          keyLength: 0,
          detail: 'Empty or failed decryption',
        });
        continue;
      }

      const trimmed = rawKey.trim();
      uniqueFingerprints.add(crypto.createHash('sha256').update(trimmed).digest('hex'));
      const testRes = await callGeminiPreviewTtsWithKey(trimmed, 'مرحبا', VOICE_GIRL);

      if (testRes.ok) {
        rec.status = 'active';
        rec.failCount = 0;
        rec.lastUsed = Date.now();
        vaultMutated = true;
        results.push({
          order: rec.order,
          label: `Key ${rec.order}`,
          state: 'OK',
          httpStatus: 200,
          hasSpaces: /\s/.test(rawKey),
          keyLength: trimmed.length,
          detail: 'Working with ' + TTS_MODEL,
        });
      } else {
        rec.status = 'exhausted';
        rec.failCount += 1;
        rec.lastUsed = Date.now();
        vaultMutated = true;
        const state: 'Quota Full' | 'Invalid' = testRes.isQuota ? 'Quota Full' : 'Invalid';
        results.push({
          order: rec.order,
          label: `Key ${rec.order}`,
          state,
          httpStatus: testRes.httpStatus,
          hasSpaces: /\s/.test(rawKey),
          keyLength: trimmed.length,
          detail: testRes.isQuota
            ? '429 Quota exceeded (10/day Free Tier limit on gemini-2.5-flash-tts)'
            : testRes.error.slice(0, 180),
        });
      }
    }

    if (vaultMutated) {
      saveTtsVaultToDisk();
    }

    const quotaFullCount = results.filter((r) => r.state === 'Quota Full').length;
    const okCount = results.filter((r) => r.state === 'OK').length;

    res.json({
      ok: true,
      model: TTS_MODEL,
      loadedCount: sortedVaultKeys.length,
      uniqueCount: uniqueFingerprints.size,
      okCount,
      quotaFullCount,
      sameProjectLikely: sortedVaultKeys.length > 1 && quotaFullCount === sortedVaultKeys.length,
      results,
    });
  });

  const httpServer = http.createServer(app);

  if (!isProduction) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: {server: httpServer},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Fahem Blan server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
