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

type TtsKeyStatus = 'active' | 'exhausted';
type TtsFailureReason = 'no_keys' | 'invalid_key' | 'quota_exhausted' | 'unavailable';

interface StoredTtsApiKey {
  key: string;
  order: number;
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

function setCorsHeaders(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-pin');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
}

function getHeader(req: ApiRequest, name: string): string {
  const lower = name.toLowerCase();
  const headers = req.headers || {};
  const val = headers[lower] ?? headers[name];
  return Array.isArray(val) ? val[0] || '' : val || '';
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
  const cookieString = getHeader(req, 'cookie');
  if (!cookieString) return result;
  for (const part of cookieString.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const keyName = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (keyName) {
      try {
        result[keyName] = decodeURIComponent(val);
      } catch {
        result[keyName] = val;
      }
    }
  }
  return result;
}

function loadVault(req: ApiRequest): StoredTtsApiKey[] {
  const byOrder = new Map<number, StoredTtsApiKey>();
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
    // ignore
  }

  try {
    const cookies = parseCookies(req);
    const joined = [
      cookies.fahem_tts_v1 || '',
      cookies.fahem_tts_v2 || '',
      cookies.fahem_tts_v3 || '',
      cookies.fahem_tts_v4 || '',
    ].join('');
    if (joined) {
      const parsedCookie = JSON.parse(Buffer.from(joined, 'base64url').toString('utf8')) as unknown;
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
    // ignore
  }
  return Array.from(byOrder.values()).sort((a, b) => a.order - b.order);
}

function saveVault(records: StoredTtsApiKey[], res: ApiResponse): void {
  const sorted = [...records].sort((a, b) => a.order - b.order);
  try {
    fs.writeFileSync(TMP_VAULT_FILE, JSON.stringify(sorted), {mode: 0o600});
  } catch {
    // ignore
  }
  const compact = sorted.map((r) => ({
    o: r.order,
    k: r.key,
    s: r.status === 'exhausted' ? 'e' : 'a',
  }));
  const encoded = Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
  const chunkSize = 2800;
  const cookieHeaders: string[] = [];
  for (let i = 0; i < 4; i++) {
    const cookieName = `fahem_tts_v${i + 1}`;
    const slice = encoded.slice(i * chunkSize, (i + 1) * chunkSize);
    if (slice) {
      cookieHeaders.push(
        `${cookieName}=${encodeURIComponent(slice)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      );
    } else {
      cookieHeaders.push(`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    }
  }
  res.setHeader('Set-Cookie', cookieHeaders);
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

function buildSlotsResponse(records: StoredTtsApiKey[]): TtsKeySlotDto[] {
  const byOrder = new Map<number, StoredTtsApiKey>();
  for (const r of records) byOrder.set(r.order, r);
  const envSlots = resolveEnvSlotKeys();
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

async function parseJsonBody(req: ApiRequest): Promise<Record<string, unknown> | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (typeof req.body === 'object') {
      return req.body as Record<string, unknown>;
    }
  }
  if (typeof req.on !== 'function') return null;

  const rawText = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on?.('data', (chunk?: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, 'utf8'));
    });
    req.on?.('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on?.('error', () => resolve(''));
  });
  if (!rawText) return null;
  try {
    return JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return null;
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
      res.status(405).json({ok: false, error: 'الطريقة غير مسموح بها'});
      return;
    }

    if (getHeader(req, 'x-admin-pin') !== '999') {
      res.status(401).json({ok: false, error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }

    const body = (await parseJsonBody(req)) || {};
    const slotOrder = Number(body.order);
    if (!Number.isInteger(slotOrder) || slotOrder < 1 || slotOrder > MAX_TTS_KEY_SLOTS) {
      res.status(400).json({ok: false, reason: 'no_keys', error: 'رقم المفتاح غير صالح'});
      return;
    }

    const vaultRecords = loadVault(req);
    const storedRecord = vaultRecords.find((k) => k.order === slotOrder);
    const envSlots = resolveEnvSlotKeys();
    const trimmedInput = typeof body.plainKey === 'string' ? body.plainKey.trim() : '';
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
        slots: buildSlotsResponse(vaultRecords),
      });
      return;
    }

    const voiceName = resolveLockedVoiceName(
      typeof body.voiceId === 'string' ? body.voiceId : typeof body.voiceType === 'string' ? body.voiceType : undefined,
      typeof body.gender === 'string' ? body.gender : undefined
    );
    const sampleText =
      typeof body.text === 'string' && body.text.trim()
        ? body.text.trim().slice(0, 300)
        : 'مرحبا بيك ف فاهم بلان';

    const startedAtMs = Date.now();
    const runModelAttempt = async (
      modelIndex: number,
      useVertexAi: boolean,
      useSpeechMetadata: boolean,
      useSpeechConfig = true
    ): Promise<{audioBase64: string; modelName: string}> => {
      const modelName = TTS_MODELS_TO_TRY[modelIndex];
      const remainingMs = Math.max(6000, 18000 - (Date.now() - startedAtMs));
      const ai = new GoogleGenAI({
        apiKey: resolvedKey,
        ...(useVertexAi ? {vertexai: true} : {apiVersion: 'v1beta'}),
        httpOptions: {headers: {'User-Agent': 'aistudio-build'}},
      });

      const partPayload: Record<string, unknown> = {text: sampleText};
      if (useSpeechMetadata && modelName.startsWith('gemini-3.8-')) {
        partPayload.speechMetadata = {style: 'Clear, warm, natural Moroccan Darija speaker'};
      }

      const genConfig: Record<string, unknown> = {
        responseModalities: ['AUDIO'],
      };
      if (useSpeechConfig) {
        genConfig.speechConfig = {
          voiceConfig: {prebuiltVoiceConfig: {voiceName}},
        };
      }

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: [{role: 'user', parts: [partPayload as {text: string}]}],
            config: genConfig,
          }),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error(`Timeout after ${remainingMs}ms`)), remainingMs);
          }),
        ]);

        const parts = response.candidates?.[0]?.content?.parts || [];
        const audioPart = parts.find((p) => Boolean(p?.inlineData?.data));
        const base64Raw = audioPart?.inlineData?.data;
        if (!base64Raw) {
          throw new Error(`No audio inlineData returned from ${modelName}`);
        }
        const rawBuf = Buffer.from(base64Raw, 'base64');
        const hasRiff = rawBuf.length >= 4 && rawBuf.subarray(0, 4).toString('ascii') === 'RIFF';
        const wavBuf = hasRiff ? rawBuf : wrapPcm16AsWav(rawBuf, 24000);
        return {audioBase64: wavBuf.toString('base64'), modelName};
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
        if (!useVertexAi && isAuthScopeError && resolvedKey.startsWith('AQ.')) {
          return runModelAttempt(modelIndex, true, useSpeechMetadata, useSpeechConfig);
        }
        if (useSpeechMetadata && (lower.includes('speechmetadata') || lower.includes('400'))) {
          return runModelAttempt(modelIndex, useVertexAi, false, useSpeechConfig);
        }
        if (useSpeechConfig && (lower.includes('speechconfig') || lower.includes('unknown name'))) {
          return runModelAttempt(modelIndex, useVertexAi, false, false);
        }
        const isSwitchable =
          lower.includes('404') ||
          lower.includes('not_found') ||
          lower.includes('not found') ||
          lower.includes('503') ||
          lower.includes('unavailable') ||
          lower.includes('timeout') ||
          lower.includes('400');
        if (isSwitchable && modelIndex + 1 < TTS_MODELS_TO_TRY.length) {
          return runModelAttempt(modelIndex + 1, useVertexAi, true, true);
        }
        throw new Error(`[${modelName}:v=${useVertexAi}] ${errMsg}`);
      }
    };

    try {
      const okAudio = await runModelAttempt(0, false, true, true);
      if (storedRecord && !usingUnsavedPlain) {
        storedRecord.status = 'active';
        storedRecord.failCount = 0;
        storedRecord.lastUsed = Date.now();
        saveVault(vaultRecords, res);
      }
      res.status(200).json({
        ok: true,
        status: 'active' as TtsKeyStatus,
        message: '✅ شغال',
        voiceName,
        audioBase64: okAudio.audioBase64,
        mimeType: 'audio/wav',
        slots: buildSlotsResponse(vaultRecords),
      });
    } catch (testErr) {
      const errMsg = testErr instanceof Error ? testErr.message : String(testErr);
      const lower = errMsg.toLowerCase();
      let httpStatus = 500;
      if (errMsg.includes('429')) httpStatus = 429;
      else if (errMsg.includes('401')) httpStatus = 401;
      else if (errMsg.includes('403')) httpStatus = 403;
      else if (errMsg.includes('503')) httpStatus = 503;

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

      if (storedRecord && !usingUnsavedPlain && (isQuota || isInvalidAuth)) {
        storedRecord.status = 'exhausted';
        storedRecord.failCount += 1;
        storedRecord.lastUsed = Date.now();
        saveVault(vaultRecords, res);
      }

      const reason: TtsFailureReason = isQuota
        ? 'quota_exhausted'
        : isInvalidAuth
          ? 'invalid_key'
          : 'unavailable';

      res.status(200).json({
        ok: false,
        reason,
        quotaExhausted: isQuota,
        status: (isQuota || isInvalidAuth ? 'exhausted' : storedRecord?.status ?? 'active') as TtsKeyStatus,
        httpStatus,
        voiceName,
        errorDetail: errMsg.slice(0, 700),
        message: isQuota
          ? '❌ الكوتا عامرة'
          : isInvalidAuth
            ? '❌ مفتاح غير صالح'
            : `⚠️ تعذر الاتصال (${httpStatus})`,
        slots: buildSlotsResponse(vaultRecords),
      });
    }
  } catch (err) {
    res.status(500).json({
      ok: false,
      reason: 'unavailable',
      errorDetail: err instanceof Error ? err.message : 'TTS_TEST_FAILED',
    });
  }
}
