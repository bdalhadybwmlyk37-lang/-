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

const MAX_TTS_KEY_SLOTS = 20;
const TMP_VAULT_FILE = '/tmp/.fahem_tts_vault.enc.json';

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

function canDecryptTtsKey(cipherPayload: string): boolean {
  try {
    if (!cipherPayload.startsWith('encv1:')) return false;
    const parts = cipherPayload.split(':');
    if (parts.length !== 4) return false;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getTtsVaultCipherKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return Boolean(plain.trim());
  } catch {
    return false;
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
      res.status(405).json({error: 'الطريقة غير مسموح بها'});
      return;
    }

    if (getHeader(req, 'x-admin-pin') !== '999') {
      res.status(401).json({error: 'الكود السري ديال الإدارة غير صحيح'});
      return;
    }

    const body = await parseJsonBody(req);
    const records = body?.records as
      | Array<{
          order: number;
          encryptedKey: string;
          status?: TtsKeyStatus;
          lastUsed?: number;
          failCount?: number;
        }>
      | undefined;

    if (!Array.isArray(records)) {
      res.status(400).json({error: 'بيانات المزامنة غير صالحة'});
      return;
    }

    const byOrder = new Map<number, StoredTtsApiKey>();
    try {
      if (fs.existsSync(TMP_VAULT_FILE)) {
        const existing = JSON.parse(fs.readFileSync(TMP_VAULT_FILE, 'utf8')) as StoredTtsApiKey[];
        if (Array.isArray(existing)) {
          for (const rec of existing) {
            if (rec && typeof rec.order === 'number' && typeof rec.key === 'string') {
              byOrder.set(rec.order, rec);
            }
          }
        }
      }
    } catch {
      // ignore
    }

    for (const item of records) {
      const order = Number(item.order);
      if (
        !Number.isInteger(order) ||
        order < 1 ||
        order > MAX_TTS_KEY_SLOTS ||
        typeof item.encryptedKey !== 'string' ||
        !item.encryptedKey.startsWith('encv1:') ||
        !canDecryptTtsKey(item.encryptedKey)
      ) {
        continue;
      }
      if (!byOrder.has(order)) {
        byOrder.set(order, {
          key: item.encryptedKey,
          order,
          status: item.status === 'exhausted' ? 'exhausted' : 'active',
          lastUsed: Number.isFinite(Number(item.lastUsed)) ? Math.max(0, Number(item.lastUsed)) : 0,
          failCount: Number.isFinite(Number(item.failCount)) ? Math.max(0, Number(item.failCount)) : 0,
        });
      }
    }

    const sorted = Array.from(byOrder.values()).sort((a, b) => a.order - b.order);
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

    const envSlots = resolveEnvSlotKeys();
    const slots = Array.from({length: MAX_TTS_KEY_SLOTS}, (_, idx) => {
      const order = idx + 1;
      const rec = byOrder.get(order);
      if (rec) {
        return {
          order,
          hasKey: true,
          maskedKey: '****',
          encryptedKey: rec.key,
          status: rec.status,
          lastUsed: rec.lastUsed,
          failCount: rec.failCount,
          source: 'vault',
        };
      }
      if (envSlots.has(order)) {
        return {
          order,
          hasKey: true,
          maskedKey: '****',
          status: 'active',
          lastUsed: 0,
          failCount: 0,
          source: 'env',
        };
      }
      return {
        order,
        hasKey: false,
        maskedKey: '',
        status: 'active',
        lastUsed: 0,
        failCount: 0,
      };
    });

    res.status(200).json({ok: true, slots, envKeyCount: envSlots.size, isServerless: true});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'تعذر مزامنة المفاتيح'});
  }
}
