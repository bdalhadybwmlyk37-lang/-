import {GoogleGenAI, Type} from '@google/genai';

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
      description: 'عدد الغرف والمرافق الموجودة فالبلان',
    },
    darijaSummary: {
      type: Type.STRING,
      description: 'شرح شامل ومفصل ومفهوم ديال البلان كامل بالدارجة المغربية النقية',
    },
    rebarDetailsDarija: {
      type: Type.STRING,
      description:
        'شرح مفصل ديال الحديد والتسليح بالدارجة: فين كاين الحديد (السواري، الضالة، الكمرة، السوميلة)، شحال من بار (قضيب)، الأقطار والمسافات بين الحديد',
    },
    audioScript: {
      type: Type.STRING,
      description:
        'نص نقي ومنظم ومباشر 100% بالدارجة المغربية النقية باش يتقرا بالصوت بلا رموز ولا فرنسية',
    },
    rooms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: {type: Type.STRING},
          dimensions: {type: Type.STRING},
          areaSqm: {type: Type.STRING},
          purposeDarija: {type: Type.STRING},
        },
        required: ['name', 'dimensions', 'areaSqm', 'purposeDarija'],
      },
    },
    materials: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: {type: Type.STRING},
          quantity: {type: Type.STRING},
          unit: {type: Type.STRING},
          notesDarija: {type: Type.STRING},
        },
        required: ['item', 'quantity', 'unit', 'notesDarija'],
      },
    },
    workPhases: {
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
  ],
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function resolveApiKey(): string | null {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.AI_API_KEY,
  ];
  for (const val of candidates) {
    const trimmed = typeof val === 'string' ? val.trim() : '';
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

export async function POST(request: Request): Promise<Response> {
  try {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      return jsonResponse(
        {
          success: false,
          error: 'مفتاح الذكاء الاصطناعي غير مضبوط في إعدادات الخادم (GEMINI_API_KEY).',
        },
        503
      );
    }

    let body: {imageBase64?: string; mimeType?: string; notes?: string};
    try {
      body = (await request.json()) as {imageBase64?: string; mimeType?: string; notes?: string};
    } catch {
      return jsonResponse({success: false, error: 'تعذر قراءة بيانات الصورة المرسلة.'}, 400);
    }

    const {imageBase64, mimeType, notes} = body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return jsonResponse({success: false, error: 'خاصك تصور ولا ترفع صورة ديال البلان أولا.'}, 400);
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    if (!cleanBase64) {
      return jsonResponse({success: false, error: 'صورة البلان غير صالحة، عاود رفع الصورة.'}, 400);
    }

    const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
    const trimmedNotes = (notes || '').trim();
    const promptText = [
      'حلل هاد الصورة مزيان: أول حاجة تأكد واش هادي صورة ديال بلان بناء أو بلان ديال الحديد (مخطط هندسي، رسومات معمارية، أو تسليح).',
      'إلى ما كانتش صورة بلان ديال البناء ولا الحديد، رجع isBlueprint: false وحط بالضبط فـ darijaSummary وفـ audioScript: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".',
      'وإلى كانت صورة ديال البلان، رجع isBlueprint: true وشرح كلشي 100% بالدارجة المغربية الحقيقية النقية بلا حتى كلمة فرنسية أو إنجليزية: فين كاين الحديد، شحال من بار (قضيب)، الأقطار والمسافات بين الحديد، نوع البناء، المساحات، عدد الغرف، المواد المطلوبة، ومراحل العمل بالترتيب.',
      trimmedNotes ? `ملاحظة إضافية من مول البلان: ${trimmedNotes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const ai = new GoogleGenAI({apiKey});
    const models = ['gemini-3.8-flash', 'gemini-2.5-flash'];
    let lastError: unknown = null;

    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [{inlineData: {mimeType: safeMime, data: cleanBase64}}, {text: promptText}],
          },
          config: {
            systemInstruction:
              'أنت معلم بناء ومهندس مغربي كتجاوب 100% بالدارجة المغربية الصافية والمفهومة، وممنوع نهائياً تكتب أي كلمة بالفرنسية أو الإنجليزية أو الترجمة الحرفية بحال béton أو dalle أو ferraillage أو diamètre أو salon أو cuisine أو R+1 — استعمل غير الكلمات المغربية العربية (الضالة، السواري، الكمرة، السوميلة، الحديد، البار، القطر، السنتيم، الصالون، الكوزينة، البيت، السيما، الرملة، الكياس). إلا كانت الصورة ماشي بلان ديال البناء أو الحديد (مثلاً وجه إنسان، طريق، طابلة، حيط خاوي...)، ضروري ترد isBlueprint=false وتكتب بالضبط: "هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك".',
            responseMimeType: 'application/json',
            responseSchema: PLAN_RESPONSE_SCHEMA,
          },
        });
        const text = response.text;
        if (!text) {
          throw new Error('رد فارغ من الذكاء الاصطناعي');
        }
        const parsed = JSON.parse(cleanJsonString(text)) as Record<string, unknown>;
        if (parsed.isBlueprint === false) {
          const rejection = 'هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك';
          parsed.darijaSummary = rejection;
          parsed.audioScript = rejection;
          parsed.rebarDetailsDarija = rejection;
        }
        return jsonResponse({success: true, ...parsed}, 200);
      } catch (err) {
        lastError = err;
      }
    }

    const msg = lastError instanceof Error ? lastError.message : 'تعذر تحليل البلان، عاود حاول';
    return jsonResponse({success: false, error: msg}, 500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'تعذر تحليل البلان، عاود حاول';
    return jsonResponse({success: false, error: msg}, 500);
  }
}
