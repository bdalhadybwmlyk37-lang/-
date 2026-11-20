import {TTS_MODEL, VOICE_BOY, VOICE_GIRL} from './config.js';

export const PREVIEW_GIRL_VOICE_ID = VOICE_GIRL;
export const PREVIEW_BOY_VOICE_ID = VOICE_BOY;

const SELECTED_VOICE_KEY = 'selectedVoice';
const LEGACY_SETTINGS_KEY = 'fahem_blan_voice_settings_v2';
const TTS_LOCAL_CACHE_KEY = 'fahem_tts_audio_cache_v3';
const TTS_IDB_NAME = 'fahem_tts_audio_db_v2';
const TTS_IDB_STORE = 'clips';
const MAX_MEMORY_CACHE_ITEMS = 100;
const MAX_LOCAL_CACHE_ITEMS = 20;
const MAX_LOCAL_CACHE_CHARS = 3_000_000;
const QUOTA_COOLDOWN_MS = 60_000;

let globalAudio = null;
let audioCtx = null;
let activeSource = null;
let abortController = null;
let requestToken = 0;
let objectUrl = null;

let quotaExhausted = false;
let quotaExhaustedAt = 0;

const memoryCache = new Map();
const audioStateListeners = new Set();

let audioState = {
  isSpeaking: false,
  isLoadingAudio: false,
  activeSpeechId: null,
};

function notifyAudioState() {
  const snapshot = {...audioState};
  for (const listener of audioStateListeners) {
    try {
      listener(snapshot);
    } catch {
      // ignore listener errors
    }
  }
}

function setAudioState(isSpeaking, isLoadingAudio, activeSpeechId) {
  audioState = {isSpeaking, isLoadingAudio, activeSpeechId};
  notifyAudioState();
}

export function subscribeAudioState(listener) {
  audioStateListeners.add(listener);
  listener({...audioState});
  return () => {
    audioStateListeners.delete(listener);
  };
}

export function getAudioState() {
  return {...audioState};
}

export function clearQuotaExhausted() {
  quotaExhausted = false;
  quotaExhaustedAt = 0;
}

export function isQuotaExhausted() {
  if (!quotaExhausted) return false;
  if (Date.now() - quotaExhaustedAt >= QUOTA_COOLDOWN_MS) {
    quotaExhausted = false;
    quotaExhaustedAt = 0;
    return false;
  }
  return true;
}

export function normalizeVoiceId(voiceIdOrGender) {
  if (
    voiceIdOrGender === PREVIEW_GIRL_VOICE_ID ||
    voiceIdOrGender === 'female' ||
    voiceIdOrGender === 'girl'
  ) {
    return PREVIEW_GIRL_VOICE_ID;
  }
  if (
    voiceIdOrGender === PREVIEW_BOY_VOICE_ID ||
    voiceIdOrGender === 'male' ||
    voiceIdOrGender === 'boy'
  ) {
    return PREVIEW_BOY_VOICE_ID;
  }
  return null;
}

export function getVoiceId() {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(SELECTED_VOICE_KEY);
      if (saved === 'girl') return PREVIEW_GIRL_VOICE_ID;
      if (saved === 'boy') return PREVIEW_BOY_VOICE_ID;

      const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (parsed && parsed.voiceGender === 'female') return PREVIEW_GIRL_VOICE_ID;
        if (parsed && parsed.voiceGender === 'male') return PREVIEW_BOY_VOICE_ID;
      }
    } catch {
      // ignore storage errors
    }
  }
  return PREVIEW_BOY_VOICE_ID;
}

if (typeof window !== 'undefined') {
  window.getVoiceId = getVoiceId;
  window.getSelectedVoice = getVoiceId;
}

export function toDarija(input) {
  if (typeof input !== 'string') return '';
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
    .trim();
}

function base64ToUint8Array(b64) {
  const byteChars = atob(b64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return bytes;
}

function base64ToObjectUrl(b64, mime = 'audio/wav') {
  const bytes = base64ToUint8Array(b64);
  const blob = new Blob([bytes.buffer], {type: mime});
  return URL.createObjectURL(blob);
}

function openTtsIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(TTS_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TTS_IDB_STORE)) {
          db.createObjectStore(TTS_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readIdbTtsCache(key) {
  const db = await openTtsIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(TTS_IDB_STORE, 'readonly');
      const store = tx.objectStore(TTS_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeIdbTtsCache(key, entry) {
  const db = await openTtsIdb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(TTS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(TTS_IDB_STORE);
      store.put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function readLocalTtsCache(key) {
  try {
    const direct = localStorage.getItem(`tts_v3_${key}`);
    if (direct) return JSON.parse(direct);
    const raw = localStorage.getItem(TTS_LOCAL_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map[key] || null;
  } catch {
    return null;
  }
}

function writeLocalTtsCache(key, b64, mime) {
  if (!b64) return;
  const entry = {b64, mime, ts: Date.now()};

  void writeIdbTtsCache(key, entry);

  if (b64.length > 750_000) return;
  try {
    try {
      localStorage.setItem(`tts_v3_${key}`, JSON.stringify(entry));
    } catch {
      const ttsKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('tts_v3_') || k.startsWith('tts_'))) {
          try {
            const parsed = JSON.parse(localStorage.getItem(k) || '{}');
            ttsKeys.push({k, ts: parsed.ts || 0});
          } catch {
            ttsKeys.push({k, ts: 0});
          }
        }
      }
      ttsKeys.sort((a, b) => a.ts - b.ts);
      for (const item of ttsKeys.slice(0, Math.max(1, Math.ceil(ttsKeys.length / 2)))) {
        localStorage.removeItem(item.k);
      }
      try {
        localStorage.setItem(`tts_v3_${key}`, JSON.stringify(entry));
      } catch {
        // ignore
      }
    }

    const raw = localStorage.getItem(TTS_LOCAL_CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = entry;

    const entries = Object.entries(map).sort((a, b) => b[1].ts - a[1].ts);
    const trimmed = {};
    let totalChars = 0;
    for (const [k, v] of entries) {
      if (Object.keys(trimmed).length >= MAX_LOCAL_CACHE_ITEMS) break;
      if (totalChars + v.b64.length > MAX_LOCAL_CACHE_CHARS) continue;
      trimmed[k] = v;
      totalChars += v.b64.length;
    }
    localStorage.setItem(TTS_LOCAL_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore QuotaExceededError safely
  }
}

function saveToAllCaches(cacheKey, b64, mime) {
  if (memoryCache.size >= MAX_MEMORY_CACHE_ITEMS) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(cacheKey, {b64, mime});
  writeLocalTtsCache(cacheKey, b64, mime);
}

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
}

export function stopAudio() {
  requestToken += 1;

  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (activeSource) {
    try {
      activeSource.onended = null;
      activeSource.stop();
      activeSource.disconnect();
    } catch {
      // ignore
    }
    activeSource = null;
  }

  if (globalAudio) {
    try {
      globalAudio.onended = null;
      globalAudio.onerror = null;
      globalAudio.pause();
      globalAudio.currentTime = 0;
      globalAudio.removeAttribute('src');
    } catch {
      // ignore
    }
    globalAudio = null;
  }

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }

  setAudioState(false, false, null);
}

async function getLoadedBrowserVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  let voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) return voices;
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
      resolve();
    };
    const onVoices = () => done();
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
    setTimeout(done, 180);
  });
  voices = window.speechSynthesis.getVoices();
  return voices;
}

function pickBrowserArabicVoice(voices, isGirl) {
  const arVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('ar'));
  if (arVoices.length === 0) {
    return {voice: null, matchedGender: false};
  }

  const femaleRe =
    /salma|sana|laila|leila|hoda|zariyah|fatima|amina|noura|mariam|maryam|rana|amira|samira|kenza|nour|female|woman|wavenet-a|wavenet-d|standard-a|standard-d|neural2-a|neural2-d/i;
  const maleRe =
    /shakir|maged|majed|tarik|tariq|naayf|hamed|hamdan|omar|ali|ahmed|ahmad|karim|male|man|wavenet-b|wavenet-c|standard-b|standard-c|neural2-b|neural2-c/i;

  const rankVoice = (v) => {
    const lang = (v.lang || '').toLowerCase();
    const name = (v.name || '').toLowerCase();
    let score = 0;
    if (name.includes('natural') || name.includes('online') || name.includes('google')) score += 4;
    if (lang === 'ar-ma') score += 3;
    else if (lang === 'ar-eg' || lang === 'ar-sa') score += 2;
    else score += 1;
    return score;
  };

  const sorted = [...arVoices].sort((a, b) => rankVoice(b) - rankVoice(a));

  if (isGirl) {
    const exactFemale = sorted.find((v) => femaleRe.test(v.name || ''));
    if (exactFemale) return {voice: exactFemale, matchedGender: true};
    const nonMale = sorted.find((v) => !maleRe.test(v.name || ''));
    return {voice: nonMale || sorted[0], matchedGender: false};
  }

  const exactMale = sorted.find((v) => maleRe.test(v.name || ''));
  if (exactMale) return {voice: exactMale, matchedGender: true};
  const nonFemale = sorted.find((v) => !femaleRe.test(v.name || ''));
  return {voice: nonFemale || sorted[0], matchedGender: false};
}

function splitSpeechChunks(text, maxLen = 155) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const rawParts = cleaned.split(/(?<=[.،,!؟?\n])\s+/);
  const chunks = [];
  let current = '';

  for (const part of rawParts) {
    if (!part) continue;
    if ((current + ' ' + part).trim().length <= maxLen) {
      current = (current + ' ' + part).trim();
    } else {
      if (current) chunks.push(current);
      if (part.length <= maxLen) {
        current = part;
      } else {
        const words = part.split(' ');
        let sub = '';
        for (const w of words) {
          if ((sub + ' ' + w).trim().length <= maxLen) {
            sub = (sub + ' ' + w).trim();
          } else {
            if (sub) chunks.push(sub);
            sub = w;
          }
        }
        current = sub;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function speakWithBrowserFallback(darijaText, voiceId, id, sessionToken, speechRate = 0.95) {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    sessionToken !== requestToken
  ) {
    return false;
  }

  try {
    window.speechSynthesis.cancel();
    const voices = await getLoadedBrowserVoices();
    if (sessionToken !== requestToken) return false;

    const isGirl = voiceId === PREVIEW_GIRL_VOICE_ID;
    const {voice: arVoice, matchedGender} = pickBrowserArabicVoice(voices, isGirl);
    const chunks = splitSpeechChunks(darijaText, 155);
    if (chunks.length === 0) return false;

    setAudioState(true, false, id);

    const rate = Math.min(1.15, Math.max(0.8, Number(speechRate) || 0.95));
    const pitch = matchedGender ? 1.0 : isGirl ? 1.08 : 0.92;

    for (const chunk of chunks) {
      if (sessionToken !== requestToken) return false;
      const ok = await new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(chunk);
        utter.lang = arVoice?.lang || 'ar-MA';
        if (arVoice) utter.voice = arVoice;
        utter.rate = rate;
        utter.pitch = pitch;
        utter.onend = () => resolve(true);
        utter.onerror = () => resolve(false);
        window.speechSynthesis.speak(utter);
      });
      if (!ok || sessionToken !== requestToken) break;
    }

    if (sessionToken === requestToken) {
      setAudioState(false, false, null);
    }
    return true;
  } catch {
    if (sessionToken === requestToken) {
      setAudioState(false, false, null);
    }
    return false;
  }
}

async function playBase64Audio(b64, mime, id, sessionToken, speechRate = 0.95) {
  if (sessionToken !== requestToken) return false;

  const rate = Math.min(1.3, Math.max(0.75, Number(speechRate) || 0.95));
  const url = base64ToObjectUrl(b64, mime || 'audio/wav');
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
  objectUrl = url;

  if (globalAudio) {
    try {
      globalAudio.onended = null;
      globalAudio.onerror = null;
      globalAudio.pause();
      globalAudio.removeAttribute('src');
    } catch {
      // ignore
    }
    globalAudio = null;
  }

  try {
    const audio = new Audio(url);
    globalAudio = audio;
    audio.playbackRate = rate;

    setAudioState(true, false, id);

    const played = await new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (globalAudio === audio) {
          globalAudio = null;
        }
        if (sessionToken === requestToken) {
          setAudioState(false, false, null);
        }
        resolve(ok);
      };

      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);

      audio.play().catch((err) => {
        console.info('[voice.js] new Audio().play() fallback to AudioContext:', err);
        finish(false);
      });
    });

    if (played || sessionToken !== requestToken) {
      return played;
    }
  } catch (err) {
    console.info('[voice.js] Audio element fallback to AudioContext:', err);
  }

  const ctx = getAudioContext();
  if (ctx) {
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const bytes = base64ToUint8Array(b64);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await ctx.decodeAudioData(arrayBuffer);

      if (sessionToken !== requestToken) return false;

      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.playbackRate.value = rate;
      source.connect(ctx.destination);
      activeSource = source;

      setAudioState(true, false, id);

      await new Promise((resolve) => {
        source.onended = () => {
          if (sessionToken === requestToken) {
            setAudioState(false, false, null);
          }
          if (activeSource === source) {
            activeSource = null;
          }
          resolve();
        };
        source.start(0);
      });
      return true;
    } catch (err) {
      console.info('[voice.js] AudioContext decode/play failed:', err);
    }
  }

  if (sessionToken === requestToken) {
    setAudioState(false, false, null);
  }
  return false;
}

export async function callTTS(text, voiceId, options = {}) {
  if (typeof window === 'undefined') {
    return {ok: false, voiceId, voiceName: voiceId};
  }

  const resolvedVoiceId = normalizeVoiceId(voiceId) || getVoiceId();
  const id = options.id || 'global';
  const isAdminKeyTest = typeof options.testOrder === 'number';
  const speechRate = typeof options.speechRate === 'number' ? options.speechRate : 0.95;

  const darijaText = toDarija(text);
  if (!darijaText) {
    return {ok: false, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
  }

  stopAudio();
  const myToken = requestToken;

  getAudioContext();

  const cacheKey = `${TTS_MODEL}::${resolvedVoiceId}::${darijaText}`;
  if (!isAdminKeyTest) {
    const memHit = memoryCache.get(cacheKey);
    if (memHit) {
      const ok = await playBase64Audio(memHit.b64, memHit.mime, id, myToken, speechRate);
      if (ok) return {ok: true, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
    }

    const localHit = readLocalTtsCache(cacheKey);
    if (localHit?.b64) {
      memoryCache.set(cacheKey, {b64: localHit.b64, mime: localHit.mime || 'audio/wav'});
      const ok = await playBase64Audio(
        localHit.b64,
        localHit.mime || 'audio/wav',
        id,
        myToken,
        speechRate
      );
      if (ok) return {ok: true, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
    }

    const idbHit = await readIdbTtsCache(cacheKey);
    if (myToken !== requestToken) {
      return {ok: false, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
    }
    if (idbHit?.b64) {
      memoryCache.set(cacheKey, {b64: idbHit.b64, mime: idbHit.mime || 'audio/wav'});
      const ok = await playBase64Audio(
        idbHit.b64,
        idbHit.mime || 'audio/wav',
        id,
        myToken,
        speechRate
      );
      if (ok) return {ok: true, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
    }
  }

  // Fast-path browser fallback while server keys are known quota-exhausted (cleared immediately when admin saves new keys)
  if (!isAdminKeyTest && !options.noFallback && isQuotaExhausted()) {
    const fallbackPlayed = await speakWithBrowserFallback(
      darijaText,
      resolvedVoiceId,
      id,
      myToken,
      speechRate
    );
    return {
      ok: fallbackPlayed,
      usedFallback: true,
      quotaExhausted: true,
      voiceId: resolvedVoiceId,
      voiceName: resolvedVoiceId,
      status: 'exhausted',
      message: 'All API keys quota full, using browser voice',
    };
  }

  const controller = new AbortController();
  abortController = controller;
  setAudioState(true, true, id);

  try {
    const endpoint = isAdminKeyTest ? '/api/admin/tts-keys/test' : '/api/tts';
    const headers = {'Content-Type': 'application/json'};
    if (isAdminKeyTest) {
      headers['x-admin-pin'] = options.adminPin || '999';
    }

    const payload = isAdminKeyTest
      ? {
          order: options.testOrder,
          plainKey: options.testPlainKey,
          voiceId: resolvedVoiceId,
          voiceType: resolvedVoiceId,
          text: darijaText,
        }
      : {
          text: darijaText,
          voiceId: resolvedVoiceId,
          voiceType: resolvedVoiceId,
        };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (myToken !== requestToken) {
      return {ok: false, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
    }

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.audioBase64) {
      clearQuotaExhausted();
      const mime = data.mimeType || 'audio/wav';
      saveToAllCaches(cacheKey, data.audioBase64, mime);
      const played = await playBase64Audio(data.audioBase64, mime, id, myToken, speechRate);
      if (played) {
        return {
          ok: true,
          usedFallback: false,
          voiceId: resolvedVoiceId,
          voiceName: resolvedVoiceId,
          status: data.status ?? 'active',
          message: data.message,
          slots: data.slots,
        };
      }
    }

    if (data.errorDetail) {
      console.info(`[voice.js] Gemini TTS unavailable (${resolvedVoiceId}), using browser fallback`);
    }

    if (!isAdminKeyTest) {
      quotaExhausted = true;
      quotaExhaustedAt = Date.now();
    }

    if (!isAdminKeyTest && !options.noFallback) {
      const fallbackPlayed = await speakWithBrowserFallback(
        darijaText,
        resolvedVoiceId,
        id,
        myToken,
        speechRate
      );
      return {
        ok: fallbackPlayed,
        usedFallback: true,
        quotaExhausted: true,
        voiceId: resolvedVoiceId,
        voiceName: resolvedVoiceId,
        status: data.status ?? 'exhausted',
        message: 'All API keys quota full, using browser voice',
        slots: data.slots,
        errorDetail: data.errorDetail,
      };
    }

    if (myToken === requestToken) {
      setAudioState(false, false, null);
    }

    return {
      ok: false,
      usedFallback: false,
      quotaExhausted: true,
      voiceId: resolvedVoiceId,
      voiceName: resolvedVoiceId,
      status: data.status ?? 'exhausted',
      message: data.message,
      slots: data.slots,
      errorDetail: data.errorDetail,
    };
  } catch (err) {
    if (controller.signal.aborted || myToken !== requestToken) {
      return {ok: false, voiceId: resolvedVoiceId, voiceName: resolvedVoiceId};
    }
    console.info('[voice.js] Network/fetch fallback:', err);
    if (!isAdminKeyTest && !options.noFallback) {
      const fallbackPlayed = await speakWithBrowserFallback(
        darijaText,
        resolvedVoiceId,
        id,
        myToken,
        speechRate
      );
      return {
        ok: fallbackPlayed,
        usedFallback: true,
        quotaExhausted: true,
        voiceId: resolvedVoiceId,
        voiceName: resolvedVoiceId,
        status: 'exhausted',
        message: 'All API keys quota full, using browser voice',
        errorDetail: err instanceof Error ? err.message : String(err),
      };
    }
    if (myToken === requestToken) {
      setAudioState(false, false, null);
    }
    return {
      ok: false,
      usedFallback: false,
      voiceId: resolvedVoiceId,
      voiceName: resolvedVoiceId,
      status: 'exhausted',
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function speak(text, options = {}) {
  const id = options.id || 'global';
  const isAdminKeyTest = typeof options.testOrder === 'number';

  if (
    !options.forcePlay &&
    !isAdminKeyTest &&
    (audioState.isSpeaking || audioState.isLoadingAudio) &&
    audioState.activeSpeechId === id
  ) {
    stopAudio();
    return {ok: true, stopped: true, voiceId: getVoiceId(), voiceName: getVoiceId()};
  }

  const voiceId =
    normalizeVoiceId(options.voiceId || options.voiceType || options.gender) || getVoiceId();

  return callTTS(text, voiceId, options);
}
