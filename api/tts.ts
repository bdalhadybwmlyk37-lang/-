import crypto from 'crypto';
import fs from 'fs';
import {GoogleGenAI} from '@google/genai';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
};

type ApiResponse = {
  setHeader: (name: string, value: string | string[]) => void;
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

type TtsKeyStatus = 'active' | 'exhausted';
type TtsFailureReason = 'no_keys' | 'invalid_key' | 'quota_exhausted' | 'unavailable';

interface StoredTtsApiKey {
  key: string;
  order: number;
  status: TtsKeyStatus;
  lastUsed: number;
  failCount: number;
}

interface CandidateTtsKey {
  order: number;
  rawKey: string;
  label: string;
  vaultRecord?: StoredTtsApiKey;
}

export const maxDuration = 60;

const VOICE_GIRL = 'Kore';
const VOICE_BOY = 'Charon';
const MAX_TTS_KEY_SLOTS = 20;
const TMP_VAULT_FILE = '/tmp/.fahem_tts_vault.enc.json';
const TTS_MODELS_TO_TRY = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash-preview-tts',
];

let warmRotationCursor = 0;

function setCorsHeaders(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-pin');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
}

function getTtsVaultCipherKey(): Buffer {
  const secret =
    process.env.TTS_ENCRYPTION_SECRET ||
    process.env.GEMINI_API_KEY ||
    'fahem-blan-tts-vault-key-v1';
  return crypto.createHash('sha256').update(secret).digest();
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

function parseCookies(req: ApiRequest): Record<string, string> {
  const result: Record<string, string> = {};
  const rawHeader = req.headers?.cookie;
  const cookieString = Array.isArray(rawHeader) ? rawHeader.join('; ') : rawHeader || '';
  if (!cookieString) return result;
  for (const part of cookieString.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name) {
      try {
        result[name] = decodeURIComponent(val);
      } catch {
        result[name] = val;
      }
    }
  }
  return result;
}

function loadVaultRecords(req: ApiRequest): StoredTtsApiKey[] {
  const byOrder = new Map<number, StoredTtsApiKey>();

  // 1. Read from /tmp warm serverless storage
  try {
    if (fs.existsSync(TMP_VAULT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TMP_VAULT_FILE, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
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
            byOrder.set(order, {
              key: rec.key,
              order,
              status: rec.status === 'exhausted' ? 'exhausted' : 'active',
              lastUsed: Number.isFinite(Number(rec.lastUsed)) ? Math.max(0, Number(rec.lastUsed)) : 0,
              failCount: Number.isFinite(Number(rec.failCount)) ? Math.max(0, Number(rec.failCount)) : 0,
            });
          }
        }
      }
    }
  } catch {
    // ignore /tmp error
  }

  // 2. Merge from encrypted chunked cookies if present
  try {
    const cookies = parseCookies(req);
    const joined = [
      cookies.fahem_tts_v1 || '',
      cookies.fahem_tts_v2 || '',
      cookies.fahem_tts_v3 || '',
      cookies.fahem_tts_v4 || '',
    ].join('');
    if (joined) {
      const decodedJson = Buffer.from(joined, 'base64url').toString('utf8');
      const parsedCookie = JSON.parse(decodedJson) as unknown;
      if (Array.isArray(parsedCookie)) {
        for (const item of parsedCookie) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as {o?: number; k?: string; s?: string};
          const order = Number(rec.o);
          if (
            typeof rec.k === 'string' &&
            rec.k.startsWith('encv1:') &&
            Number.isInteger(order) &&
            order >= 1 &&
            order <= MAX_TTS_KEY_SLOTS &&
            !byOrder.has(order)
          ) {
            byOrder.set(order, {
              key: rec.k,
              order,
              status: rec.s === 'e' ? 'exhausted' : 'active',
              lastUsed: 0,
              failCount: 0,
            });
          }
        }
      }
    }
  } catch {
    // ignore cookie decode error
  }

  return Array.from(byOrder.values()).sort((a, b) => a.order - b.order);
}

function saveTmpVault(records: StoredTtsApiKey[]): void {
  try {
    fs.writeFileSync(TMP_VAULT_FILE, JSON.stringify(records), {mode: 0o600});
  } catch {
    // ignore read-only fs edge case
  }
}

function resolveEnvSlotKeys(): Map<number, string> {
  const map = new Map<number, string>();
  const listRaw = process.env.GEMINI_TTS_KEYS || '';
  if (listRaw.trim()) {
    const parts = listRaw
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s && s !== 'MY_GEMINI_API_KEY');
    parts.slice(0, MAX_TTS_KEY_SLOTS).forEach((k, idx) => {
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

function resolveDefaultEnvKeys(): string[] {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.AI_API_KEY,
  ];
  const valid: string[] = [];
  for (const candidate of candidates) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY' && !valid.includes(trimmed)) {
      valid.push(trimmed);
    }
  }
  return valid;
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
    ...(useVertexAi ? {vertexai: true} : {apiVersion: 'v1beta'}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyError(msg: string): {
  httpStatus: number;
  isQuota: boolean;
  isInvalidAuth: boolean;
} {
  const lower = msg.toLowerCase();
  let httpStatus = 500;
  if (msg.includes('429')) httpStatus = 429;
  else if (msg.includes('401')) httpStatus = 401;
  else if (msg.includes('403')) httpStatus = 403;
  else if (msg.includes('404')) httpStatus = 404;
  else if (msg.includes('503')) httpStatus = 503;
  else if (msg.includes('400')) httpStatus = 400;

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

async function generateAudioWithKey(
  apiKey: string,
  darijaText: string,
  voiceName: 'Kore' | 'Charon',
  deadlineMs: number
): Promise<
  | {ok: true; audioBase64: string; modelName: string}
  | {ok: false; httpStatus: number; isQuota: boolean; isInvalidAuth: boolean; error: string}
> {
  const runModelAttempt = async (
    modelIndex: number,
    useVertexAi: boolean,
    useSpeechMetadata: boolean,
    useSpeechConfig = true
  ): Promise<{audioBase64: string; modelName: string}> => {
    const modelName = TTS_MODELS_TO_TRY[modelIndex];
    const remainingMs = Math.max(5000, deadlineMs - Date.now());
    const ai = createGenAiClient(apiKey, useVertexAi);

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
      const response = await withTimeout(
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

      const isAuthScopeError =
        lowerMsg.includes('401') ||
        lowerMsg.includes('403') ||
        lowerMsg.includes('api_key_invalid') ||
        lowerMsg.includes('api key not valid') ||
        lowerMsg.includes('unauthenticated') ||
        lowerMsg.includes('access_token_type_unsupported');

      if (!useVertexAi && isAuthScopeError && apiKey.startsWith('AQ.')) {
        return runModelAttempt(modelIndex, true, useSpeechMetadata, useSpeechConfig);
      }

      if (useSpeechMetadata && (lowerMsg.includes('speechmetadata') || lowerMsg.includes('400'))) {
        return runModelAttempt(modelIndex, useVertexAi, false, useSpeechConfig);
      }

      if (useSpeechConfig && (lowerMsg.includes('speechconfig') || lowerMsg.includes('unknown name'))) {
        return runModelAttempt(modelIndex, useVertexAi, false, false);
      }

      const isModelSwitchable =
        lowerMsg.includes('404') ||
        lowerMsg.includes('not_found') ||
        lowerMsg.includes('not found') ||
        lowerMsg.includes('503') ||
        lowerMsg.includes('unavailable') ||
        lowerMsg.includes('overloaded') ||
        lowerMsg.includes('high demand') ||
        lowerMsg.includes('timeout') ||
        lowerMsg.includes('400');

      if (isModelSwitchable && modelIndex + 1 < TTS_MODELS_TO_TRY.length && deadlineMs - Date.now() > 4000) {
        return runModelAttempt(modelIndex + 1, useVertexAi, true, true);
      }

      throw new Error(`[${modelName}:v=${useVertexAi}] ${errMsg}`);
    }
  };

  try {
    const resAudio = await runModelAttempt(0, false, true, true);
    return {
      ok: true,
      audioBase64: resAudio.audioBase64,
      modelName: resAudio.modelName,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const classified = classifyError(errMsg);
    return {
      ok: false,
      httpStatus: classified.httpStatus,
      isQuota: classified.isQuota,
      isInvalidAuth: classified.isInvalidAuth,
      error: errMsg.slice(0, 700),
    };
  }
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

    const vaultRecords = loadVaultRecords(req);
    const envSlotMap = resolveEnvSlotKeys();
    const defaultEnvKeys = resolveDefaultEnvKeys();

    const seenKeys = new Set<string>();
    const activePool: CandidateTtsKey[] = [];
    const exhaustedBackupPool: CandidateTtsKey[] = [];

    for (const rec of vaultRecords) {
      const plain = decryptTtsKey(rec.key);
      if (!plain || seenKeys.has(plain)) continue;
      seenKeys.add(plain);
      const entry: CandidateTtsKey = {
        order: rec.order,
        rawKey: plain,
        label: `key${rec.order}`,
        vaultRecord: rec,
      };
      if (rec.status === 'exhausted') {
        exhaustedBackupPool.push(entry);
      } else {
        activePool.push(entry);
      }
    }

    for (let order = 1; order <= MAX_TTS_KEY_SLOTS; order++) {
      const envVal = envSlotMap.get(order);
      if (!envVal || seenKeys.has(envVal)) continue;
      seenKeys.add(envVal);
      activePool.push({
        order,
        rawKey: envVal,
        label: `env${order}`,
      });
    }

    for (let idx = 0; idx < defaultEnvKeys.length; idx++) {
      const k = defaultEnvKeys[idx];
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        activePool.push({
          order: 90 + idx,
          rawKey: k,
          label: `env_default_${idx + 1}`,
        });
      }
    }

    const totalKeys = activePool.length + exhaustedBackupPool.length;
    if (totalKeys === 0) {
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

    const rotate = <T,>(arr: T[], cursor: number): T[] => {
      if (arr.length <= 1) return arr;
      const offset = ((cursor % arr.length) + arr.length) % arr.length;
      return [...arr.slice(offset), ...arr.slice(0, offset)];
    };

    const orderedCandidates: CandidateTtsKey[] = [
      ...rotate(activePool, warmRotationCursor),
      ...exhaustedBackupPool,
    ];

    const attemptErrors: string[] = [];
    let quotaFails = 0;
    let invalidFails = 0;
    let vaultMutated = false;
    const totalDeadlineMs = Date.now() + 50000;

    for (let i = 0; i < orderedCandidates.length; i++) {
      if (Date.now() > totalDeadlineMs - 2000) break;
      const candidate = orderedCandidates[i];
      const perKeyDeadline = Math.min(totalDeadlineMs, Date.now() + 14000);
      const resAttempt = await generateAudioWithKey(
        candidate.rawKey,
        darijaText,
        voiceName,
        perKeyDeadline
      );

      if (resAttempt.ok) {
        if (candidate.vaultRecord) {
          candidate.vaultRecord.status = 'active';
          candidate.vaultRecord.failCount = 0;
          candidate.vaultRecord.lastUsed = Date.now();
          vaultMutated = true;
        }
        const activeIdx = activePool.findIndex((item) => item.label === candidate.label);
        if (activeIdx >= 0) {
          warmRotationCursor = activeIdx;
        }
        if (vaultMutated && vaultRecords.length > 0) {
          saveTmpVault(vaultRecords);
        }

        res.status(200).json({
          ok: true,
          audioBase64: resAttempt.audioBase64,
          mimeType: 'audio/wav',
          voiceName,
          activeKeyOrder: candidate.order,
          totalKeys,
          provider: `${resAttempt.modelName}-${candidate.label}-${voiceName}`,
        });
        return;
      }

      attemptErrors.push(`${candidate.label}:${resAttempt.httpStatus}:${resAttempt.error}`);
      if (resAttempt.isQuota) quotaFails += 1;
      else if (resAttempt.isInvalidAuth) invalidFails += 1;

      if (candidate.vaultRecord && (resAttempt.isQuota || resAttempt.isInvalidAuth)) {
        candidate.vaultRecord.status = 'exhausted';
        candidate.vaultRecord.failCount += 1;
        candidate.vaultRecord.lastUsed = Date.now();
        vaultMutated = true;
      }

      warmRotationCursor = (warmRotationCursor + 1) % Math.max(1, activePool.length || 1);
    }

    if (vaultMutated && vaultRecords.length > 0) {
      saveTmpVault(vaultRecords);
    }

    const reason: TtsFailureReason =
      quotaFails > 0
        ? 'quota_exhausted'
        : invalidFails === attemptErrors.length && invalidFails > 0
          ? 'invalid_key'
          : 'unavailable';

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
      loadedCount: totalKeys,
      voiceName,
      message,
      errorDetail: attemptErrors.join(' | ') || 'TTS_UNAVAILABLE',
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'TTS_UNAVAILABLE';
    res.status(500).json({
      ok: false,
      reason: 'unavailable',
      quotaExhausted: false,
      message: 'وقع خطأ فالسيرفر ديال الصوت',
      errorDetail: rawMsg,
    });
  }
}
