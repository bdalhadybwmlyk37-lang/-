import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {GoogleGenAI, Type} from '@google/genai';
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

const badAuthAiKeys = new Set<string>();
let extraVaultKeysResolver: () => string[] = () => [];

function resolveServerAiApiKeys(): string[] {
  const rawCandidates: Array<string | undefined> = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.AI_API_KEY,
  ];
  const ttsListRaw = process.env.GEMINI_TTS_KEYS || '';
  if (ttsListRaw.trim()) {
    for (const part of ttsListRaw.split(/[\r\n,;]+/)) {
      rawCandidates.push(part);
    }
  }
  for (let i = 1; i <= 20; i++) {
    rawCandidates.push(process.env[`GEMINI_API_KEY_${i}`]);
  }
  for (const vaultKey of extraVaultKeysResolver()) {
    rawCandidates.push(vaultKey);
  }

  const valid: string[] = [];
  const dead: string[] = [];
  const seen = new Set<string>();
  for (const val of rawCandidates) {
    const trimmed = typeof val === 'string' ? val.trim() : '';
    if (!trimmed || trimmed === 'MY_GEMINI_API_KEY' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (badAuthAiKeys.has(trimmed)) {
      dead.push(trimmed);
    } else {
      valid.push(trimmed);
    }
  }
  return [...valid, ...dead];
}

function resolveServerAiApiKey(): string | null {
  return resolveServerAiApiKeys()[0] || null;
}

function isGeminiAuthErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated') ||
    lower.includes('access_token_type_unsupported')
  );
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

async function generateJsonWithRetry(params: {
  contents: unknown;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
}): Promise<unknown> {
  const keysToTry = resolveServerAiApiKeys();
  if (keysToTry.length === 0) {
    throw new Error('مفتاح الذكاء الاصطناعي غير مضبوط على الخادم (GEMINI_API_KEY).');
  }
  const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastErr: unknown = null;

  for (const key of keysToTry) {
    let useVertexAi = false;
    let keyAuthDead = false;

    for (const model of modelsToTry) {
      if (keyAuthDead) break;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const client = new GoogleGenAI({
            apiKey: key,
            ...(useVertexAi ? {vertexai: true} : {}),
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              },
            },
          });
          const response = await enqueueGoogleRequest(() =>
            client.models.generateContent({
              model,
              contents: params.contents as Parameters<typeof client.models.generateContent>[0]['contents'],
              config: {
                systemInstruction: params.systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: params.responseSchema,
              },
            })
          );
          const text = response.text;
          if (!text) {
            throw new Error('رد فارغ من الذكاء الاصطناعي');
          }
          badAuthAiKeys.delete(key);
          return JSON.parse(cleanJsonString(text));
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const lower = msg.toLowerCase();

          if (isGeminiAuthErrorMessage(msg)) {
            if (!useVertexAi && key.startsWith('AQ.')) {
              useVertexAi = true;
              continue;
            }
            badAuthAiKeys.add(key);
            keyAuthDead = true;
            break;
          }

          const isTransient =
            lower.includes('503') ||
            lower.includes('unavailable') ||
            lower.includes('overloaded') ||
            lower.includes('high demand') ||
            lower.includes('429') ||
            lower.includes('resource_exhausted');
          if (isTransient && attempt === 0) {
            await new Promise((r) => setTimeout(r, 650));
            continue;
          }
          break;
        }
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
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api/')) {
        const msg =
          err instanceof Error ? err.message : 'تعذر قراءة بيانات الطلب المرسل إلى الخادم';
        res.status(400).json({success: false, error: msg});
        return;
      }
      next(err);
    }
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(resolveServerAiApiKey()),
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
    try {
      if (resolveServerAiApiKeys().length === 0) {
        res.status(503).json({
          success: false,
          error: 'مفتاح الذكاء الاصطناعي غير مضبوط على الخادم (GEMINI_API_KEY).',
        });
        return;
      }

      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
        imageBase64?: string;
        mimeType?: string;
        notes?: string;
      };
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
      const trimmedNotes = (notes || '').trim();
      const analysisCacheKey = crypto
        .createHash('sha256')
        .update(`${cleanBase64}::${trimmedNotes}`)
        .digest('hex');

      const cachedPlan = planAnalysisCache.get(analysisCacheKey);
      if (cachedPlan) {
        res.status(200).json({success: true, ...cachedPlan});
        return;
      }

      const promptText = [
        'حلل هاد الصورة مزيان: أول حاجة تأكد واش هادي صورة ديال بلان بناء أو بلان ديال الحديد (مخطط هندسي، رسومات معمارية، أو تسليح).',
        'إلى ما كانتش صورة بلان ديال البناء ولا الحديد، رجع isBlueprint: false وحط بالضبط فـ darijaSummary وفـ audioScript: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".',
        'وإلى كانت صورة ديال البلان، رجع isBlueprint: true وشرح كلشي 100% بالدارجة المغربية الحقيقية النقية بلا حتى كلمة فرنسية أو إنجليزية: فين كاين الحديد، شحال من بار (قضيب)، الأقطار والمسافات بين الحديد، نوع البناء، المساحات، عدد الغرف، المواد المطلوبة، ومراحل العمل بالترتيب.',
        trimmedNotes ? `ملاحظة إضافية من مول البلان: ${trimmedNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const parsed = (await generateJsonWithRetry({
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

      res.status(200).json({success: true, ...parsed});
    } catch (err) {
      console.error('Gemini analyze-plan error:', err);
      const message = err instanceof Error ? err.message : 'تعذر تحليل البلان، عاود حاول';
      res.status(500).json({
        success: false,
        error: `تعذر تحليل البلان، عاود حاول (${message})`,
      });
    }
  });

  app.post('/api/chat-plan', async (req, res) => {
    if (resolveServerAiApiKeys().length === 0) {
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
      const parsed = await generateJsonWithRetry({
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
    if (resolveServerAiApiKeys().length === 0) {
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
      const parsed = await generateJsonWithRetry({
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
    if (resolveServerAiApiKeys().length === 0) {
      res.status(503).json({error: 'خدمة الذكاء الاصطناعي غير متوفرة حالياً على الخادم.'});
      return;
    }

    const {rawIdea} = req.body as {rawIdea?: string};
    if (!rawIdea || typeof rawIdea !== 'string' || !rawIdea.trim()) {
      res.status(400).json({error: 'كتب ولا هضر بالفكرة ديالك أولا.'});
      return;
    }

    try {
      const parsed = await generateJsonWithRetry({
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

  app.post('/api/transcribe', async (req, res) => {
    const keysToTry = resolveServerAiApiKeys();
    if (keysToTry.length === 0) {
      res.status(503).json({
        success: false,
        error: 'مفتاح الذكاء الاصطناعي غير مضبوط على الخادم (GEMINI_API_KEY).',
      });
      return;
    }

    const {audioBase64, mimeType} = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      audioBase64?: string;
      mimeType?: string;
    };

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({success: false, error: 'ما وصلنيش الصوت من الميكروفون، عاود جرب.'});
      return;
    }

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
    if (!cleanBase64) {
      res.status(400).json({success: false, error: 'التسجيل الصوتي خاوي، عاود هضر فالميكرو.'});
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

    const runWithKeys = async (): Promise<string> => {
      let lastErr: unknown = null;

      for (const candidateKey of keysToTry) {
        let useVertexAi = false;
        let keyAuthDead = false;

        for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
          if (keyAuthDead) break;
          const modelName = modelsToTry[modelIndex];

          for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
            const client = new GoogleGenAI({
              apiKey: candidateKey,
              ...(useVertexAi ? {vertexai: true} : {}),
              httpOptions: {headers: {'User-Agent': 'aistudio-build'}},
            });

            try {
              const response = await enqueueGoogleRequest(() =>
                client.models.generateContent({
                  model: modelName,
                  contents: {
                    parts: [
                      {inlineData: {mimeType: baseMime, data: cleanBase64}},
                      {text: promptText},
                    ],
                  },
                })
              );
              badAuthAiKeys.delete(candidateKey);
              return response.text || '';
            } catch (attemptErr) {
              lastErr = attemptErr;
              const msg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
              const lower = msg.toLowerCase();

              if (isGeminiAuthErrorMessage(msg)) {
                if (!useVertexAi && candidateKey.startsWith('AQ.')) {
                  useVertexAi = true;
                  continue;
                }
                badAuthAiKeys.add(candidateKey);
                keyAuthDead = true;
                break;
              }

              const isSwitchable =
                lower.includes('503') ||
                lower.includes('unavailable') ||
                lower.includes('overloaded') ||
                lower.includes('high demand') ||
                lower.includes('429') ||
                lower.includes('resource_exhausted') ||
                lower.includes('404') ||
                lower.includes('not_found') ||
                lower.includes('400');

              if (isSwitchable) {
                break; // try next model
              }
              throw attemptErr;
            }
          }
        }
      }

      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    };

    try {
      const raw = await runWithKeys();
      const cleaned = raw
        .replace(/^```[\w-]*\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const finalText =
        !cleaned ||
        cleaned === '__EMPTY__' ||
        /^\[(صمت|لا يوجد كلام|silence|no speech|inaudible)\]$/i.test(cleaned) ||
        /^(صمت|لا يوجد صوت|لا يوجد كلام)$/i.test(cleaned)
          ? ''
          : cleaned;

      res.status(200).json({success: true, text: finalText});
    } catch (err) {
      console.error('Gemini transcribe error:', err);
      res.status(500).json({
        success: false,
        error: 'تعذر تحويل الصوت لكتابة دابا، عاود جرب أو كتب سؤالك بيديك.',
      });
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

  // --- Encrypted TTS API Key Pool & Auto-Rotation Vault (Up to 20 Keys) ---
  type TtsKeyStatus = 'active' | 'exhausted';
  type TtsFailureReason = 'no_keys' | 'invalid_key' | 'quota_exhausted' | 'unavailable';
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
    source?: 'vault' | 'env';
  }

  const MAX_TTS_KEY_SLOTS = 20;
  const TTS_KEY_RESET_MS = 24 * 60 * 60 * 1000;
  const TTS_MAX_SERVER_CACHE = 250;
  const TTS_ALL_EXHAUSTED_COOLDOWN_MS = 8_000;
  const TTS_MODELS_TO_TRY = [
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
    'gemini-2.5-flash-preview-tts',
  ];
  const TTS_VAULT_FILE = path.resolve(__dirname, '.tts_api_keys.enc.json');
  let ttsRoundRobinCursor = 0;
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

  function resolveEnvTtsSlotKeys(): Map<number, string> {
    const map = new Map<number, string>();
    const listRaw = process.env.GEMINI_TTS_KEYS || '';
    if (listRaw.trim()) {
      const splitList = listRaw
        .split(/[\r\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s && s !== 'MY_GEMINI_API_KEY');
      splitList.slice(0, MAX_TTS_KEY_SLOTS).forEach((k, idx) => {
        map.set(idx + 1, k);
      });
    }
    for (let order = 1; order <= MAX_TTS_KEY_SLOTS; order++) {
      const raw = process.env[`GEMINI_API_KEY_${order}`];
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed && trimmed !== 'MY_GEMINI_API_KEY') {
        map.set(order, trimmed);
      }
    }
    return map;
  }

  const ttsKeyVault: StoredTtsApiKey[] = loadTtsVaultFromDisk();
  extraVaultKeysResolver = () => {
    const out: string[] = [];
    for (const rec of ttsKeyVault) {
      const plain = decryptTtsKey(rec.key);
      if (plain && plain.trim()) {
        out.push(plain.trim());
      }
    }
    return out;
  };
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
    const envSlots = resolveEnvTtsSlotKeys();
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
          source: 'vault',
        });
      } else if (envSlots.has(order)) {
        slots.push({
          order,
          hasKey: true,
          maskedKey: '****',
          status: 'active',
          lastUsed: 0,
          failCount: 0,
          source: 'env',
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

  function extractHttpStatusFromErrorMsg(msg: string): number {
    if (msg.includes('429')) return 429;
    if (msg.includes('401')) return 401;
    if (msg.includes('403')) return 403;
    if (msg.includes('404')) return 404;
    if (msg.includes('503')) return 503;
    if (msg.includes('400')) return 400;
    return 500;
  }

  function classifyTtsError(msg: string): {
    httpStatus: number;
    isQuota: boolean;
    isInvalidAuth: boolean;
  } {
    const httpStatus = extractHttpStatusFromErrorMsg(msg);
    const lower = msg.toLowerCase();
    const isQuota =
      httpStatus === 429 ||
      lower.includes('resource_exhausted') ||
      lower.includes('quota') ||
      lower.includes('rate limit');
    const isInvalidAuth =
      !isQuota &&
      (httpStatus === 401 ||
        httpStatus === 403 ||
        lower.includes('api_key_invalid') ||
        lower.includes('api key not valid') ||
        lower.includes('permission_denied') ||
        lower.includes('unauthenticated') ||
        lower.includes('access_token_type_unsupported'));
    return {httpStatus, isQuota, isInvalidAuth};
  }

  async function callGeminiPreviewTtsWithKey(
    apiKey: string,
    darijaText: string,
    voiceName: LockedVoiceName
  ): Promise<
    | {ok: true; audioBase64: string; mimeType: string; modelName: string}
    | {ok: false; httpStatus: number; isQuota: boolean; isInvalidAuth: boolean; error: string}
  > {
    const cleanKey = apiKey.trim();
    if (!cleanKey || cleanKey === 'MY_GEMINI_API_KEY') {
      return {
        ok: false,
        httpStatus: 401,
        isQuota: false,
        isInvalidAuth: true,
        error: 'Empty or placeholder API key',
      };
    }

    const startedAtMs = Date.now();

    const runModelAttempt = async (
      modelIndex: number,
      useVertexAi: boolean,
      useSpeechMetadata: boolean,
      useSpeechConfig = true
    ): Promise<{audioBase64: string; modelName: string}> => {
      const modelName = TTS_MODELS_TO_TRY[modelIndex];
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = Math.max(7000, 20000 - elapsedMs);

      const ai = new GoogleGenAI({
        apiKey: cleanKey,
        ...(useVertexAi ? {vertexai: true} : {apiVersion: 'v1beta'}),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const partPayload: Record<string, unknown> = {text: darijaText};
      if (useSpeechMetadata && modelName.startsWith('gemini-3.8-')) {
        partPayload.speechMetadata = {
          style: 'Clear, warm, natural Moroccan Darija speaker',
        };
      }

      const genConfig: Record<string, unknown> = {
        responseModalities: ['AUDIO'],
      };
      if (useSpeechConfig) {
        genConfig.speechConfig = {
          voiceConfig: {
            prebuiltVoiceConfig: {voiceName},
          },
        };
      }

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [partPayload as {text: string}],
              },
            ],
            config: genConfig,
          }),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error(`Timeout after ${remainingMs}ms on ${modelName}`)), remainingMs);
          }),
        ]);

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
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const lower = errMsg.toLowerCase();
        const isAuthScopeError =
          lower.includes('401') ||
          lower.includes('403') ||
          lower.includes('api_key_invalid') ||
          lower.includes('api key not valid') ||
          lower.includes('unauthenticated') ||
          lower.includes('access_token_type_unsupported');

        if (!useVertexAi && isAuthScopeError && cleanKey.startsWith('AQ.')) {
          return runModelAttempt(modelIndex, true, useSpeechMetadata, useSpeechConfig);
        }

        if (useSpeechMetadata && (lower.includes('speechmetadata') || lower.includes('400'))) {
          return runModelAttempt(modelIndex, useVertexAi, false, useSpeechConfig);
        }

        if (useSpeechConfig && (lower.includes('speechconfig') || lower.includes('unknown name'))) {
          return runModelAttempt(modelIndex, useVertexAi, false, false);
        }

        const isModelSwitchable =
          lower.includes('429') ||
          lower.includes('resource_exhausted') ||
          lower.includes('404') ||
          lower.includes('not_found') ||
          lower.includes('not found') ||
          lower.includes('503') ||
          lower.includes('unavailable') ||
          lower.includes('overloaded') ||
          lower.includes('high demand') ||
          lower.includes('timeout') ||
          lower.includes('400');

        if (isModelSwitchable && modelIndex + 1 < TTS_MODELS_TO_TRY.length && Date.now() - startedAtMs < 18000) {
          return runModelAttempt(modelIndex + 1, useVertexAi, true, true);
        }

        throw new Error(`[${modelName}:v=${useVertexAi}] ${errMsg}`);
      }
    };

    try {
      const okRes = await runModelAttempt(0, false, true, true);
      return {
        ok: true,
        audioBase64: okRes.audioBase64,
        mimeType: 'audio/wav',
        modelName: okRes.modelName,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const classified = classifyTtsError(errMsg);
      return {
        ok: false,
        httpStatus: classified.httpStatus,
        isQuota: classified.isQuota,
        isInvalidAuth: classified.isInvalidAuth,
        error: errMsg.slice(0, 900),
      };
    }
  }

  app.get('/api/admin/tts-keys', (req, res) => {
    if (req.header('x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }
    resetExpiredTtsKeysIf24h();
    res.json({
      slots: buildTtsSlotsResponse(),
      envKeyCount: resolveEnvTtsSlotKeys().size,
      isServerless: false,
    });
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
    const reloaded = loadTtsVaultFromDisk();
    ttsKeyVault.splice(0, ttsKeyVault.length, ...reloaded);
    ttsAllExhaustedUntilMs = 0;
    ttsRoundRobinCursor = 0;
    ttsCache.clear();
    console.log(`[TTS Vault] Saved & reloaded ${ttsKeyVault.length} keys — quotaExhausted cleared`);
    res.json({
      ok: true,
      quotaCleared: true,
      slots: buildTtsSlotsResponse(),
      envKeyCount: resolveEnvTtsSlotKeys().size,
      isServerless: false,
    });
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
    res.json({ok: true, slots: buildTtsSlotsResponse(), envKeyCount: resolveEnvTtsSlotKeys().size});
  });

  function resolveLockedVoiceName(voiceType?: string, gender?: string): LockedVoiceName {
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
      res.status(400).json({ok: false, reason: 'no_keys', status: 'active', error: 'رقم المفتاح غير صالح'});
      return;
    }

    const storedRecord = ttsKeyVault.find((k) => k.order === slotOrder);
    const envSlots = resolveEnvTtsSlotKeys();
    const trimmedInput = typeof plainKey === 'string' ? plainKey.trim() : '';
    const usingUnsavedPlain = Boolean(trimmedInput && trimmedInput !== '****');
    const resolvedKey = usingUnsavedPlain
      ? trimmedInput
      : storedRecord
        ? decryptTtsKey(storedRecord.key)
        : envSlots.get(slotOrder) || null;

    if (!resolvedKey) {
      res.status(200).json({
        ok: false,
        reason: 'no_keys' as TtsFailureReason,
        quotaExhausted: false,
        status: 'active' as TtsKeyStatus,
        message: '⚠️ ما كاينش مفتاح فهاد الخانة',
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

    if (storedRecord && !usingUnsavedPlain && (result.isQuota || result.isInvalidAuth)) {
      storedRecord.status = 'exhausted';
      storedRecord.failCount += 1;
      storedRecord.lastUsed = nowTs;
      saveTtsVaultToDisk();
    }

    const reason: TtsFailureReason = result.isQuota
      ? 'quota_exhausted'
      : result.isInvalidAuth
        ? 'invalid_key'
        : 'unavailable';

    res.status(200).json({
      ok: false,
      reason,
      quotaExhausted: result.isQuota,
      status: (result.isQuota || result.isInvalidAuth ? 'exhausted' : storedRecord?.status ?? 'active') as TtsKeyStatus,
      httpStatus: result.httpStatus,
      voiceName,
      errorDetail: result.error,
      message: result.isQuota
        ? '❌ الكوتا عامرة'
        : result.isInvalidAuth
          ? '❌ مفتاح غير صالح'
          : `⚠️ تعذر الاتصال (${result.httpStatus})`,
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
    const envSlotMap = resolveEnvTtsSlotKeys();
    const defaultEnvKey = resolveServerAiApiKey();

    interface CandidateTtsKey {
      order: number;
      rawKey: string;
      vaultRecord?: StoredTtsApiKey;
      label: string;
    }

    const seenRawKeys = new Set<string>();
    const activeCandidates: CandidateTtsKey[] = [];
    const exhaustedBackupCandidates: CandidateTtsKey[] = [];

    for (const rec of sortedVaultKeys) {
      const plain = decryptTtsKey(rec.key);
      if (!plain || seenRawKeys.has(plain)) continue;
      seenRawKeys.add(plain);
      const item: CandidateTtsKey = {
        order: rec.order,
        rawKey: plain,
        vaultRecord: rec,
        label: `key${rec.order}`,
      };
      if (rec.status === 'exhausted') {
        exhaustedBackupCandidates.push(item);
      } else {
        activeCandidates.push(item);
      }
    }

    for (let order = 1; order <= MAX_TTS_KEY_SLOTS; order++) {
      const envVal = envSlotMap.get(order);
      if (!envVal || seenRawKeys.has(envVal)) continue;
      seenRawKeys.add(envVal);
      activeCandidates.push({
        order,
        rawKey: envVal,
        label: `env${order}`,
      });
    }

    if (defaultEnvKey && !seenRawKeys.has(defaultEnvKey)) {
      seenRawKeys.add(defaultEnvKey);
      activeCandidates.push({
        order: 99,
        rawKey: defaultEnvKey,
        label: 'env_default',
      });
    }

    const totalConfiguredCount = activeCandidates.length + exhaustedBackupCandidates.length;

    // Crucial: If NO keys exist at all, report no_keys — NEVER report "All API keys quota full"!
    if (totalConfiguredCount === 0) {
      ttsAllExhaustedUntilMs = 0;
      res.status(200).json({
        ok: false,
        reason: 'no_keys' as TtsFailureReason,
        quotaExhausted: false,
        loadedCount: 0,
        voiceName,
        message: 'ما كاينش مفتاح صوت محفوظ (دخل للإدارة باش تزيد المفاتيح)',
        errorDetail: 'NO_KEYS_CONFIGURED',
      });
      return;
    }

    // Fast cooldown ONLY if we actually have configured keys AND all active ones hit genuine quota recently
    if (activeCandidates.length === 0 && Date.now() < ttsAllExhaustedUntilMs) {
      res.status(200).json({
        ok: false,
        reason: 'quota_exhausted' as TtsFailureReason,
        quotaExhausted: true,
        loadedCount: totalConfiguredCount,
        voiceName,
        message: 'جميع المفاتيح سالات الكوتا ديالهم، خدام بصوت المتصفح',
        errorDetail: 'ALL_KEYS_COOLDOWN',
      });
      return;
    }

    const rotateList = <T,>(arr: T[], cursor: number): T[] => {
      if (arr.length <= 1) return arr;
      const offset = ((cursor % arr.length) + arr.length) % arr.length;
      return [...arr.slice(offset), ...arr.slice(0, offset)];
    };

    const candidateQueue: CandidateTtsKey[] = [
      ...rotateList(activeCandidates, ttsRoundRobinCursor),
      ...exhaustedBackupCandidates,
    ];

    console.log(
      `[TTS Rotate] Loaded ${totalConfiguredCount} keys (active=${activeCandidates.length}, backup=${exhaustedBackupCandidates.length}), trying sequentially for voice=${voiceName}`
    );

    const attemptErrors: string[] = [];
    let quotaFailCount = 0;
    let invalidAuthCount = 0;
    let vaultMutated = false;

    for (let idx = 0; idx < candidateQueue.length; idx++) {
      const candidate = candidateQueue[idx];
      const attemptRes = await callGeminiPreviewTtsWithKey(candidate.rawKey, darijaText, voiceName);

      if (attemptRes.ok) {
        ttsAllExhaustedUntilMs = 0;
        if (candidate.vaultRecord) {
          candidate.vaultRecord.status = 'active';
          candidate.vaultRecord.failCount = 0;
          candidate.vaultRecord.lastUsed = Date.now();
          vaultMutated = true;
          const activeIdx = activeCandidates.findIndex((c) => c.order === candidate.order);
          if (activeIdx >= 0) {
            ttsRoundRobinCursor = activeIdx;
          }
        }
        if (vaultMutated) {
          saveTtsVaultToDisk();
        }

        const payload = {
          ok: true,
          audioBase64: attemptRes.audioBase64,
          mimeType: attemptRes.mimeType,
          voiceName,
          activeKeyOrder: candidate.order,
          totalKeys: totalConfiguredCount,
          provider: `${attemptRes.modelName}-${candidate.label}-${voiceName}`,
        };
        if (ttsCache.size >= TTS_MAX_SERVER_CACHE) {
          const firstKey = ttsCache.keys().next().value;
          if (firstKey) ttsCache.delete(firstKey);
        }
        ttsCache.set(cacheKey, payload);
        res.json(payload);
        return;
      }

      attemptErrors.push(`${candidate.label}:${attemptRes.httpStatus}:${attemptRes.error}`);
      console.log(
        `[TTS Rotate] ${candidate.label} failed (http=${attemptRes.httpStatus}, quota=${attemptRes.isQuota}, invalid=${attemptRes.isInvalidAuth}) — rotating to next key`
      );

      if (attemptRes.isQuota) {
        quotaFailCount += 1;
      } else if (attemptRes.isInvalidAuth) {
        invalidAuthCount += 1;
      }

      if (candidate.vaultRecord && (attemptRes.isQuota || attemptRes.isInvalidAuth)) {
        candidate.vaultRecord.status = 'exhausted';
        candidate.vaultRecord.failCount += 1;
        candidate.vaultRecord.lastUsed = Date.now();
        vaultMutated = true;
      }

      // Advance cursor past the failing key for subsequent requests
      ttsRoundRobinCursor = (ttsRoundRobinCursor + 1) % Math.max(1, activeCandidates.length || 1);
    }

    if (vaultMutated) {
      saveTtsVaultToDisk();
    }

    const reason: TtsFailureReason =
      quotaFailCount > 0
        ? 'quota_exhausted'
        : invalidAuthCount === candidateQueue.length
          ? 'invalid_key'
          : 'unavailable';

    if (reason === 'quota_exhausted') {
      ttsAllExhaustedUntilMs = Date.now() + TTS_ALL_EXHAUSTED_COOLDOWN_MS;
    } else {
      ttsAllExhaustedUntilMs = 0;
    }

    const message =
      reason === 'quota_exhausted'
        ? 'جميع المفاتيح سالات الكوتا ديالهم، خدام بصوت المتصفح'
        : reason === 'invalid_key'
          ? 'المفاتيح المدخلة غير صالحة أو مرفوضة من Google'
          : 'سيرفرات الصوت عامرين دابا، خدام بصوت المتصفح';

    res.status(200).json({
      ok: false,
      reason,
      quotaExhausted: reason === 'quota_exhausted',
      loadedCount: totalConfiguredCount,
      voiceName,
      message,
      errorDetail: attemptErrors.join(' | ') || 'TTS_UNAVAILABLE',
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
          detail: 'Working with ' + testRes.modelName,
        });
      } else {
        if (testRes.isQuota || testRes.isInvalidAuth) {
          rec.status = 'exhausted';
          rec.failCount += 1;
          rec.lastUsed = Date.now();
          vaultMutated = true;
        }
        const state: 'Quota Full' | 'Invalid' = testRes.isQuota ? 'Quota Full' : 'Invalid';
        results.push({
          order: rec.order,
          label: `Key ${rec.order}`,
          state,
          httpStatus: testRes.httpStatus,
          hasSpaces: /\s/.test(rawKey),
          keyLength: trimmed.length,
          detail: testRes.isQuota ? '429 Quota exceeded' : testRes.error.slice(0, 180),
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

  app.all('/api/*', (_req, res) => {
    res.status(404).json({success: false, error: 'نقطة الاتصال غير موجودة'});
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api/')) {
        const msg = err instanceof Error ? err.message : 'تعذر تحليل البلان، عاود حاول';
        res.status(500).json({success: false, error: msg});
        return;
      }
      next(err);
    }
  );

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
