import crypto from 'crypto';
import fs from 'fs';

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

const MAX_TTS_KEY_SLOTS = 20;
const TMP_VAULT_FILE = '/tmp/.fahem_tts_vault.enc.json';

function setCorsHeaders(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function encryptTtsKey(plainKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTtsVaultCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `encv1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
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

function buildSlotsResponse(records: StoredTtsApiKey[]): {
  slots: TtsKeySlotDto[];
  envKeyCount: number;
} {
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
  return {slots, envKeyCount: envSlots.size};
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

    if (getHeader(req, 'x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }

    const vaultRecords = loadVault(req);

    if (req.method === 'GET') {
      const built = buildSlotsResponse(vaultRecords);
      res.status(200).json({
        slots: built.slots,
        envKeyCount: built.envKeyCount,
        isServerless: true,
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({error: 'الطريقة غير مسموح بها'});
      return;
    }

    const body = await parseJsonBody(req);
    const entries = body?.entries as
      | Array<{order?: number; keyInput?: string; clear?: boolean}>
      | undefined;

    if (!Array.isArray(entries)) {
      res.status(400).json({error: 'بيانات المفاتيح غير صالحة'});
      return;
    }

    for (const entry of entries) {
      const order = Number(entry.order);
      if (!Number.isInteger(order) || order < 1 || order > MAX_TTS_KEY_SLOTS) continue;
      const idx = vaultRecords.findIndex((k) => k.order === order);

      if (entry.clear) {
        if (idx !== -1) vaultRecords.splice(idx, 1);
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
          vaultRecords[idx] = record;
        } else {
          vaultRecords.push(record);
        }
      }
    }

    saveVault(vaultRecords, res);
    const built = buildSlotsResponse(vaultRecords);
    res.status(200).json({
      ok: true,
      quotaCleared: true,
      slots: built.slots,
      envKeyCount: built.envKeyCount,
      isServerless: true,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'تعذر حفظ مفاتيح الصوت',
    });
  }
}
