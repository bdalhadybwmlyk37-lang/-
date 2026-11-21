import React, {useCallback, useEffect, useState} from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  Lock,
  MessageCircle,
  Plus,
  Power,
  RotateCcw,
  ShieldBan,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {User} from 'firebase/auth';
import {VOICE_BOY, VOICE_GIRL} from '../../config.js';
import {clearQuotaExhausted} from '../../voice.js';
import {getSelectedVoice, SpeakButton, useDarijaSpeech} from '../contexts/SpeechContext';
import {
  getTrialStorageKey,
  MAX_CODE_TRIALS,
  readCodeTrials,
  readStoredCodes,
  WHATSAPP_NUMBER_DISPLAY,
  writeCodeTrials,
  writeStoredCodes,
} from '../hooks/useTrialQuota';
import {
  deleteAccessCodeFromFirestore,
  fetchTtsApiKeysFromFirestore,
  saveAccessCodeToFirestore,
  signInWithGoogle,
  syncTtsApiKeysToFirestore,
  updateAccessCodeInFirestore,
} from '../lib/firebase';
import type {AccessCodeItem, TtsApiKeySlot, TtsApiKeyStatus} from '../types';

const ADMIN_PIN = '999';

interface AdminViewProps {
  user: User | null;
  cloudCodes: AccessCodeItem[];
  onBack: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({user, cloudCodes, onBack}) => {
  const {speakPro, isLoadingAudio, activeSpeechId} = useDarijaSpeech();
  const [pinInput, setPinInput] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const [clientName, setClientName] = useState('');
  const [codeValue, setCodeValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [localCodes, setLocalCodes] = useState<AccessCodeItem[]>(() => readStoredCodes());

  // --- TTS 20-Key Pool State ---
  const [ttsSlots, setTtsSlots] = useState<TtsApiKeySlot[]>(() =>
    Array.from({length: 20}, (_, idx) => ({
      order: idx + 1,
      hasKey: false,
      maskedKey: '',
      status: 'active',
      lastUsed: 0,
      failCount: 0,
    }))
  );
  const [ttsInputs, setTtsInputs] = useState<Record<number, string>>({});
  const [ttsRevealed, setTtsRevealed] = useState<Record<number, boolean>>({});
  const [ttsTestingOrder, setTtsTestingOrder] = useState<number | null>(null);
  const [ttsTestedStatus, setTtsTestedStatus] = useState<Record<number, TtsApiKeyStatus | undefined>>({});
  const [ttsTestedLabel, setTtsTestedLabel] = useState<Record<number, string | undefined>>({});
  const [ttsSavingKeys, setTtsSavingKeys] = useState(false);
  const [ttsKeyError, setTtsKeyError] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  const persistLocal = useCallback((list: AccessCodeItem[]) => {
    setLocalCodes(list);
    writeStoredCodes(list);
  }, []);

  // Merge server codes + cloud codes + local codes (keyed by uppercase code)
  const syncWithServer = useCallback(async () => {
    try {
      const res = await fetch('/api/codes', {headers: {'x-admin-pin': ADMIN_PIN}});
      const d = await res.json();
      if (!res.ok || !Array.isArray(d.codes)) return;

      const currentLocal = readStoredCodes();
      const map = new Map<string, AccessCodeItem>();

      for (const lc of currentLocal) {
        map.set(lc.code.toUpperCase(), {
          ...lc,
          trials: Math.max(lc.trials || 0, readCodeTrials(lc.code)),
        });
      }

      for (const sc of d.codes as {
        id: string;
        name: string;
        code: string;
        isActive: boolean;
        trials: number;
        createdAtMs: number;
        updatedAtMs?: number;
      }[]) {
        const key = sc.code.toUpperCase();
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            id: sc.id,
            ownerId: 'server',
            name: sc.name,
            code: key,
            isActive: Boolean(sc.isActive),
            trials: Number(sc.trials || 0),
            createdAtMs: sc.createdAtMs || Date.now(),
            updatedAtMs: sc.updatedAtMs || sc.createdAtMs || Date.now(),
            syncedToCloud: false,
          });
        } else {
          // Keep the fresher update timestamp
          const useServer = (sc.updatedAtMs || 0) > (existing.updatedAtMs || 0);
          const mergedTrials = useServer
            ? Number(sc.trials || 0)
            : Math.max(existing.trials || 0, Number(sc.trials || 0));
          map.set(key, {
            ...existing,
            isActive: useServer ? Boolean(sc.isActive) : existing.isActive,
            trials: mergedTrials,
            updatedAtMs: Math.max(existing.updatedAtMs || 0, sc.updatedAtMs || 0),
          });
        }
      }

      persistLocal(Array.from(map.values()));
    } catch {
      // ignore offline
    }
  }, [persistLocal]);

  const applyTtsSlotsFromServer = useCallback((slots: TtsApiKeySlot[]) => {
    setTtsSlots(slots);
    setTtsInputs((prev) => {
      const next: Record<number, string> = {};
      for (const s of slots) {
        if (s.hasKey) {
          // Saved keys are strictly masked as **** and never exposed in raw form to Frontend
          next[s.order] = prev[s.order] && prev[s.order] !== '****' ? prev[s.order] : '****';
        } else {
          next[s.order] = prev[s.order] && prev[s.order] !== '****' ? prev[s.order] : '';
        }
      }
      return next;
    });
  }, []);

  const loadTtsKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tts-keys', {headers: {'x-admin-pin': ADMIN_PIN}});
      const data = await res.json().catch(() => ({}));
      let serverSlots: TtsApiKeySlot[] = Array.isArray(data.slots) ? data.slots : [];

      // If signed in as admin, hydrate backend vault with encrypted Firestore records if needed
      if (user) {
        try {
          const cloudRecs = await fetchTtsApiKeysFromFirestore();
          if (cloudRecs.length > 0) {
            const hydRes = await fetch('/api/admin/tts-keys/hydrate', {
              method: 'POST',
              headers: {'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN},
              body: JSON.stringify({records: cloudRecs}),
            });
            const hydData = await hydRes.json().catch(() => ({}));
            if (hydRes.ok && Array.isArray(hydData.slots)) {
              serverSlots = hydData.slots;
            }
          }
        } catch {
          // Non-admin Google account or offline; rely on backend encrypted vault
        }
      }

      if (serverSlots.length > 0) {
        applyTtsSlotsFromServer(serverSlots);
      }
    } catch {
      // ignore offline
    }
  }, [applyTtsSlotsFromServer, user]);

  useEffect(() => {
    if (!unlocked) return;
    syncWithServer();
    loadTtsKeys();
    const onUpdated = () => {
      setLocalCodes(readStoredCodes());
    };
    window.addEventListener('fahem-codes-updated', onUpdated);
    return () => window.removeEventListener('fahem-codes-updated', onUpdated);
  }, [unlocked, syncWithServer, loadTtsKeys]);

  const handleToggleRevealTtsKey = (order: number) => {
    setTtsRevealed((prev) => ({...prev, [order]: !prev[order]}));
  };

  const handleTestTtsKey = async (order: number) => {
    setTtsKeyError(null);
    const typed = (ttsInputs[order] || '').trim();
    const slotInfo = ttsSlots.find((s) => s.order === order);
    const hasSaved = Boolean(slotInfo?.hasKey);

    if (!typed && !hasSaved) {
      setTtsTestedLabel((prev) => ({...prev, [order]: '⚠️ ما كاينش مفتاح'}));
      showToast(`مفتاح ${order}: ⚠️ ما كاينش مفتاح`);
      return;
    }

    setTtsTestingOrder(order);
    const plainToTest = typed && typed !== '****' ? typed : undefined;

    try {
      const voiceToTest = getSelectedVoice();
      const result = await speakPro('مرحبا بيك ف فاهم بلان', voiceToTest, {
        id: `admin-test-key-${order}`,
        testOrder: order,
        testPlainKey: plainToTest,
        adminPin: ADMIN_PIN,
      });

      if (result.reason === 'no_keys') {
        setTtsTestedLabel((prev) => ({...prev, [order]: '⚠️ ما كاينش مفتاح'}));
        showToast(`مفتاح ${order}: ⚠️ ما كاينش مفتاح`);
      } else if (result.ok || result.status === 'active') {
        clearQuotaExhausted();
        setTtsTestedStatus((prev) => ({...prev, [order]: 'active'}));
        setTtsTestedLabel((prev) => ({...prev, [order]: '✅ شغال'}));
        showToast(`مفتاح ${order}: ✅ شغال مزيان`);
      } else {
        const failLabel =
          result.reason === 'invalid_key'
            ? '❌ مفتاح غير صالح'
            : result.reason === 'quota_exhausted'
              ? '❌ الكوتا عامرة'
              : result.message || '⚠️ تعذر الاتصال';
        setTtsTestedStatus((prev) => ({...prev, [order]: 'exhausted'}));
        setTtsTestedLabel((prev) => ({...prev, [order]: failLabel}));
        showToast(`مفتاح ${order}: ${failLabel}`);
      }

      if (Array.isArray(result.slots)) {
        setTtsSlots(result.slots);
        if (user) {
          await syncTtsApiKeysToFirestore(user, result.slots).catch(() => undefined);
        }
      }
    } catch {
      setTtsTestedStatus((prev) => ({...prev, [order]: 'exhausted'}));
      setTtsTestedLabel((prev) => ({...prev, [order]: '⚠️ وقع خطأ فالاختبار'}));
      setTtsKeyError(`وقع خطأ فاختبار مفتاح ${order}`);
    } finally {
      setTtsTestingOrder(null);
    }
  };

  const handleSaveTtsKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setTtsSavingKeys(true);
    setTtsKeyError(null);

    const entries = ttsSlots.map((slot) => {
      const val = (ttsInputs[slot.order] || '').trim();
      if (slot.hasKey && val === '') {
        return {order: slot.order, clear: true};
      }
      if (val && val !== '****') {
        return {order: slot.order, keyInput: val};
      }
      return {order: slot.order, keyInput: '****'};
    });

    try {
      const res = await fetch('/api/admin/tts-keys', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN},
        body: JSON.stringify({entries}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        slots?: TtsApiKeySlot[];
        envKeyCount?: number;
        isServerless?: boolean;
      };
      if (!res.ok || !Array.isArray(data.slots)) {
        setTtsKeyError(data.error || 'تعذر حفظ مفاتيح الصوت.');
        return;
      }

      // Immediately mask saved inputs to **** and hide revealed toggles
      const nextInputs: Record<number, string> = {};
      for (const s of data.slots) {
        nextInputs[s.order] = s.hasKey ? '****' : '';
      }
      setTtsSlots(data.slots);
      setTtsInputs(nextInputs);
      setTtsRevealed({});
      setTtsTestedStatus({});
      setTtsTestedLabel({});
      clearQuotaExhausted();

      if (user) {
        try {
          await syncTtsApiKeysToFirestore(user, data.slots);
        } catch {
          setTtsKeyError('تم الحفظ مشفر فالسيرفر، ولكن تأكد بلي داخل بحساب الأدمن لمزامنة Firestore.');
        }
      }

      if (data.isServerless && !data.envKeyCount) {
        setTtsKeyError(
          'تم الحفظ فهاد المتصفح مؤقتاً. باش يخدمو المفاتيح عند جميع الناس فـ Vercel ديما، زيدهم فـ Environment Variables (GEMINI_TTS_KEYS أو GEMINI_API_KEY_1..20).'
        );
      }

      showToast('تم حفظ وتشفير مفاتيح الصوت بنجاح 🔐');
    } catch {
      setTtsKeyError('وقع خطأ أثناء حفظ مفاتيح الصوت.');
    } finally {
      setTtsSavingKeys(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === ADMIN_PIN) {
      setUnlocked(true);
      setPinError(null);
    } else {
      setPinError('الكود السري غلط! دخل الكود الصحيح ديال الإدارة.');
    }
  };

  const generateRandomCode = () => {
    const num = Math.floor(1000 + Math.random() * 9000);
    setCodeValue(`FB-${num}`);
  };

  const handleSaveCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !codeValue.trim()) return;
    setSaving(true);
    const cleanName = clientName.trim();
    const cleanCode = codeValue.trim().toUpperCase();

    try {
      const res = await fetch('/api/codes', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN},
        body: JSON.stringify({name: cleanName, code: cleanCode, isActive: true, trials: 0}),
      });
      const data = await res.json().catch(() => ({}));
      const serverId = data?.item?.id || `local_code_${Date.now()}`;

      const existing = readStoredCodes().filter((c) => c.code.toUpperCase() !== cleanCode);
      let newItem: AccessCodeItem = {
        id: serverId,
        ownerId: user?.uid || 'local',
        name: cleanName,
        code: cleanCode,
        isActive: true,
        trials: 0,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        syncedToCloud: false,
      };

      if (user) {
        try {
          const cloudCreated = await saveAccessCodeToFirestore(user, cleanName, cleanCode);
          newItem = cloudCreated;
        } catch {
          // keep local entry
        }
      }

      writeCodeTrials(cleanCode, 0);
      persistLocal([newItem, ...existing]);
      setClientName('');
      setCodeValue('');
      showToast(`تم حفظ الكود ${cleanCode} باسم ${cleanName}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: AccessCodeItem) => {
    const nextActive = !item.isActive;

    const nextList = readStoredCodes().map((c) =>
      c.code.toUpperCase() === item.code.toUpperCase()
        ? {...c, isActive: nextActive, updatedAtMs: Date.now()}
        : c
    );
    // Ensure it exists in local fahem_codes even if originally from cloud
    if (!nextList.some((c) => c.code.toUpperCase() === item.code.toUpperCase())) {
      nextList.unshift({...item, isActive: nextActive, updatedAtMs: Date.now()});
    }
    persistLocal(nextList);

    await fetch(`/api/codes/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN},
      body: JSON.stringify({
        isActive: nextActive,
        name: item.name,
        code: item.code,
      }),
    }).catch(() => undefined);

    if (item.syncedToCloud && user) {
      await updateAccessCodeInFirestore(item.id, {isActive: nextActive}).catch(() => undefined);
    }

    showToast(
      nextActive
        ? `تم تفعيل كود ${item.name} (${item.code})`
        : `تم حظر/تعطيل كود ${item.name} (${item.code})`
    );
  };

  const handleResetTrials = async (item: AccessCodeItem) => {
    writeCodeTrials(item.code, 0);

    const nextList = readStoredCodes().map((c) =>
      c.code.toUpperCase() === item.code.toUpperCase()
        ? {...c, trials: 0, isActive: true, updatedAtMs: Date.now()}
        : c
    );
    if (!nextList.some((c) => c.code.toUpperCase() === item.code.toUpperCase())) {
      nextList.unshift({...item, trials: 0, isActive: true, updatedAtMs: Date.now()});
    }
    persistLocal(nextList);

    await fetch(`/api/codes/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', 'x-admin-pin': ADMIN_PIN},
      body: JSON.stringify({
        isActive: true,
        resetTrials: true,
        name: item.name,
        code: item.code,
      }),
    }).catch(() => undefined);

    if (item.syncedToCloud && user) {
      await updateAccessCodeInFirestore(item.id, {isActive: true, trials: 0}).catch(() => undefined);
    }

    showToast(`تم تصفير العداد وتفعيل كود ${item.name} (${item.code}) من 0/${MAX_CODE_TRIALS}`);
  };

  const handleDelete = async (item: AccessCodeItem) => {
    try {
      localStorage.removeItem(getTrialStorageKey(item.code));
    } catch {
      // ignore
    }

    persistLocal(readStoredCodes().filter((c) => c.code.toUpperCase() !== item.code.toUpperCase()));

    if (item.syncedToCloud && user) {
      await deleteAccessCodeFromFirestore(item.id).catch(() => undefined);
    }

    await fetch(`/api/codes/${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
      headers: {'x-admin-pin': ADMIN_PIN},
    }).catch(() => undefined);

    showToast(`تم حذف الكود ${item.code}`);
  };

  const handleCopy = (item: AccessCodeItem) => {
    navigator.clipboard?.writeText(item.code).catch(() => undefined);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Deduplicate cloudCodes + localCodes by uppercase code
  const mergedMap = new Map<string, AccessCodeItem>();
  for (const c of localCodes) {
    const k = c.code.toUpperCase();
    mergedMap.set(k, {...c, trials: Math.max(c.trials || 0, readCodeTrials(k))});
  }
  if (user) {
    for (const cc of cloudCodes) {
      const k = cc.code.toUpperCase();
      const prev = mergedMap.get(k);
      mergedMap.set(k, {
        ...cc,
        trials: Math.max(cc.trials || 0, prev?.trials || 0, readCodeTrials(k)),
      });
    }
  }
  const allCodes = Array.from(mergedMap.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#11182c] px-4 py-2 text-sm font-bold text-white hover:bg-[#16203a]"
        >
          <ArrowRight className="w-4 h-4 text-[#ff7a1a]" />
          <span>رجوع</span>
        </button>

        <SpeakButton
          id="admin-page-voice"
          variant="secondary"
          label="سمع الشرح"
          text="هاد لوحة الإدارة المطورة ديال فاهم بلان. تقدر تزيد أكواد المشتركين، تشوف كل واحد شحال استعمل من عشرة، تبلوكي اللي ما خلصش، ولا تصفّر العداد وترجعو خدام إلا خلص."
        />
      </div>

      {!unlocked ? (
        <form
          onSubmit={handlePinSubmit}
          autoComplete="off"
          className="rounded-2xl border border-white/10 bg-[#11182c] p-6 sm:p-8 max-w-md mx-auto space-y-5 text-center"
        >
          <div className="w-14 h-14 rounded-2xl bg-[#ff7a1a]/15 border border-[#ff7a1a]/30 flex items-center justify-center text-[#ff7a1a] mx-auto">
            <Lock className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">لوحة الإدارة (/admin)</h1>
            <p className="text-xs text-slate-400 mt-1">دخل الكود السري للتحكم فالمشتركين</p>
          </div>
          <input
            type="password"
            name="admin_secret_pin"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="دخل الكود السري"
            className="w-full min-h-[48px] text-center tracking-widest font-mono-nums text-lg rounded-xl border border-white/15 bg-[#0a0f1e] px-4 text-white focus:border-[#ff7a1a] focus:outline-none"
          />
          {pinError && <p className="text-xs text-red-400">{pinError}</p>}
          <button
            type="submit"
            className="w-full min-h-[48px] rounded-xl bg-[#ff7a1a] text-[#0a0f1e] font-extrabold text-sm hover:bg-[#ff8d3b]"
          >
            دخول للوحة الإدارة
          </button>
        </form>
      ) : (
        <div className="space-y-6">
          {toastMsg && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 py-3 text-sm font-bold text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{toastMsg}</span>
            </div>
          )}

          {/* Add New Code Form */}
          <div className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-6 h-6 text-[#ff7a1a]" />
                <h1 className="text-xl font-extrabold text-white">إدارة المشتركين والأكواد (حد {MAX_CODE_TRIALS} تجارب للكود)</h1>
              </div>
              <span className="text-xs text-slate-400 font-mono-nums">واتساب: {WHATSAPP_NUMBER_DISPLAY}</span>
            </div>

            <form onSubmit={handleSaveCode} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="اسم المشترك (مثلا: المعلم حسن)"
                className="sm:col-span-5 min-h-[46px] rounded-xl border border-white/15 bg-[#0a0f1e] px-4 text-sm text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
              />
              <div className="sm:col-span-4 flex gap-2">
                <input
                  type="text"
                  required
                  value={codeValue}
                  onChange={(e) => setCodeValue(e.target.value)}
                  placeholder="الكود (مثلا: FB-4520)"
                  className="flex-1 min-w-0 min-h-[46px] rounded-xl border border-white/15 bg-[#0a0f1e] px-3 text-sm font-mono-nums text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={generateRandomCode}
                  title="توليد كود عشوائي"
                  className="min-h-[46px] px-3 rounded-xl border border-white/15 bg-white/5 text-xs font-bold text-[#ff7a1a] hover:bg-white/10 shrink-0"
                >
                  توليد
                </button>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="sm:col-span-3 min-h-[46px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] text-sm font-extrabold hover:bg-[#ff8d3b] disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ الكود'}</span>
              </button>
            </form>
          </div>

          {/* Upgraded Management Table */}
          <div className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-white">
                جدول المشتركين ({allCodes.length})
              </h2>
              <p className="text-xs text-slate-400">
                كل كود عندو عداد بوحدو (حتى لـ {MAX_CODE_TRIALS}) — تقدر تحبسو أو تصفّر العداد إلا خلص
              </p>
            </div>

            {allCodes.length === 0 ? (
              <p className="text-sm text-slate-400">مازال ما ضفتي حتى كود.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse min-w-[760px]">
                  <thead>
                    <tr className="border-b border-white/10 text-xs font-bold text-slate-400">
                      <th className="py-3 px-3">الاسم</th>
                      <th className="py-3 px-3">الكود</th>
                      <th className="py-3 px-3">العداد</th>
                      <th className="py-3 px-3">الحالة</th>
                      <th className="py-3 px-3">تفعيل / تعطيل</th>
                      <th className="py-3 px-3">تصفير العداد (إلا خلص)</th>
                      <th className="py-3 px-3">مشاركة / حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {allCodes.map((item) => {
                      const count = Number(item.trials || 0);
                      const isOverLimit = count >= MAX_CODE_TRIALS;
                      const isWorking = item.isActive && !isOverLimit;

                      return (
                        <tr key={item.id + '_' + item.code} className="hover:bg-white/[0.02]">
                          <td className="py-3.5 px-3 font-bold text-white">{item.name}</td>
                          <td className="py-3.5 px-3">
                            <span className="font-mono-nums font-bold text-[#ff7a1a] bg-[#0a0f1e] border border-white/10 rounded-lg px-2.5 py-1">
                              {item.code}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 font-mono-nums font-bold">
                            <span className={isOverLimit ? 'text-red-400' : 'text-white'}>
                              {count}/{MAX_CODE_TRIALS}
                            </span>
                          </td>
                          <td className="py-3.5 px-3">
                            {isWorking ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-300">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>خدام</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 border border-red-500/30 px-2.5 py-1 text-xs font-bold text-red-300">
                                <ShieldBan className="w-3.5 h-3.5" />
                                <span>{!item.isActive ? 'مبلوكي' : 'سالا العداد'}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3">
                            <button
                              type="button"
                              onClick={() => handleToggleActive(item)}
                              className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-colors ${
                                item.isActive
                                  ? 'bg-red-500/15 border border-red-500/35 text-red-300 hover:bg-red-500 hover:text-white'
                                  : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500 hover:text-[#0a0f1e]'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                              <span>{item.isActive ? 'تعطيل (بلوك)' : 'تفعيل'}</span>
                            </button>
                          </td>
                          <td className="py-3.5 px-3">
                            <button
                              type="button"
                              onClick={() => handleResetTrials(item)}
                              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#ff7a1a]/15 border border-[#ff7a1a]/40 text-[#ff7a1a] hover:bg-[#ff7a1a] hover:text-[#0a0f1e] px-3 py-1.5 text-xs font-extrabold transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>تصفير + تفعيل</span>
                            </button>
                          </td>
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopy(item)}
                                title="نسخ الكود"
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#0a0f1e] text-slate-200 hover:border-[#ff7a1a]"
                              >
                                {copiedId === item.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <a
                                href={`https://wa.me/212647205383?text=${encodeURIComponent(`مرحبا ${item.name}، ها هو رمز الدخول الاشتراك ديالك في فاهم بلان: ${item.code}`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="إرسال فالواتساب"
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600 hover:text-white"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </a>

                              <button
                                type="button"
                                onClick={() => handleDelete(item)}
                                aria-label="حذف الكود"
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* TTS API Keys Management Card directly below Subscribers Table */}
          <form
            onSubmit={handleSaveTtsKeys}
            className="rounded-2xl border border-slate-700 bg-[#1e293b] p-5 sm:p-6 space-y-5 text-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 pb-4">
              <div className="space-y-1">
                <h2 className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
                  <span>🔑 إدارة مفاتيح الصوت TTS</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-300">
                  مفاتيح Gemini (تدعم AQ. الجديد - كل مفتاح عندو كوتا منفصلة)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void speakPro('مرحبا بيك ف فاهم بلان، أنا سلمى المهندسة.', VOICE_GIRL, {
                      id: 'admin-quick-girl',
                      useCloudTts: true,
                    })
                  }
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-pink-400/40 bg-pink-500/15 px-3 py-1.5 text-xs font-bold text-pink-200 hover:bg-pink-500/25"
                >
                  {isLoadingAudio && activeSpeechId === 'admin-quick-girl' ? (
                    <span>جاري...</span>
                  ) : (
                    <span>اختبار بنت</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void speakPro('مرحبا بيك أخويا ف فاهم بلان، أنا المعلم.', VOICE_BOY, {
                      id: 'admin-quick-boy',
                      useCloudTts: true,
                    })
                  }
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-500/25"
                >
                  {isLoadingAudio && activeSpeechId === 'admin-quick-boy' ? (
                    <span>جاري...</span>
                  ) : (
                    <span>اختبار ولد</span>
                  )}
                </button>
                {user ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>تشفير + Firestore مفعل</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => signInWithGoogle().catch(() => undefined)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-[#ff7a1a]"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-[#ff7a1a]" />
                    <span>ربط جوجل لمزامنة Firestore</span>
                  </button>
                )}
              </div>
            </div>

            {ttsKeyError && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-2.5 text-xs font-bold text-red-200">
                {ttsKeyError}
              </div>
            )}

            <div className="space-y-3.5">
              {ttsSlots.map((slot) => {
                const order = slot.order;
                const val = ttsInputs[order] ?? (slot.hasKey ? '****' : '');
                const isRevealed = Boolean(ttsRevealed[order]);
                const isTesting = ttsTestingOrder === order;
                const displayStatus = ttsTestedStatus[order] ?? (slot.hasKey ? slot.status : undefined);

                return (
                  <div
                    key={order}
                    className="rounded-xl border border-slate-700 bg-[#0f172a]/70 p-3.5 space-y-2"
                  >
                    <label
                      htmlFor={`tts-key-${order}`}
                      className="block text-xs sm:text-sm font-bold text-white"
                    >
                      مفتاح {order}
                    </label>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id={`tts-key-${order}`}
                        type={isRevealed ? 'text' : 'password'}
                        dir="ltr"
                        autoComplete="new-password"
                        value={val}
                        onFocus={(e) => {
                          if (e.currentTarget.value === '****') {
                            e.currentTarget.select();
                          }
                        }}
                        onChange={(e) =>
                          setTtsInputs((prev) => ({
                            ...prev,
                            [order]: e.target.value,
                          }))
                        }
                        placeholder="AQ.Ab8..."
                        className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-slate-600 bg-[#0a0f1e] px-3.5 text-sm font-mono-nums text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
                      />

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleRevealTtsKey(order)}
                          className="min-h-[44px] px-3.5 rounded-xl border border-slate-600 bg-slate-800 text-xs font-bold text-white hover:bg-slate-700 inline-flex items-center gap-1.5"
                        >
                          {isRevealed ? (
                            <EyeOff className="w-3.5 h-3.5 text-slate-300" />
                          ) : (
                            <Eye className="w-3.5 h-3.5 text-slate-300" />
                          )}
                          <span>إظهار</span>
                        </button>

                        <button
                          type="button"
                          disabled={isTesting}
                          onClick={() => handleTestTtsKey(order)}
                          className="min-h-[44px] px-3.5 rounded-xl border border-[#ff7a1a]/45 bg-[#ff7a1a]/15 text-xs font-bold text-[#ff7a1a] hover:bg-[#ff7a1a] hover:text-[#0a0f1e] disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors"
                        >
                          {isTesting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>جاري...</span>
                            </>
                          ) : (
                            <>
                              <FlaskConical className="w-3.5 h-3.5" />
                              <span>اختبار</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="min-h-[20px] flex items-center justify-between text-xs">
                      {ttsTestedLabel[order] ? (
                        <span
                          className={`font-bold ${
                            displayStatus === 'active'
                              ? 'text-emerald-400'
                              : ttsTestedLabel[order]?.includes('ما كاينش')
                                ? 'text-amber-300'
                                : 'text-red-400'
                          }`}
                        >
                          {ttsTestedLabel[order]}
                        </span>
                      ) : displayStatus === 'active' ? (
                        <span className="font-bold text-emerald-400">✅ شغال</span>
                      ) : displayStatus === 'exhausted' ? (
                        <span className="font-bold text-red-400">❌ الكوتا عامرة</span>
                      ) : (
                        <span className="text-slate-400">غير مضاف بعد</span>
                      )}
                      {slot.hasKey && (
                        <span className="text-[11px] text-slate-400">
                          {slot.source === 'env'
                            ? 'محفوظ فالسيرفر (Vercel Env)'
                            : 'محفوظ مشفر · مسح الخانة والحفظ يحذفه'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={ttsSavingKeys}
              className="w-full min-h-[52px] rounded-xl bg-[#ff7a1a] text-[#0a0f1e] font-extrabold text-base hover:bg-[#ff8d3b] disabled:opacity-50 inline-flex items-center justify-center gap-2 shadow-lg shadow-[#ff7a1a]/20 transition-colors"
            >
              {ttsSavingKeys ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري التشفير والحفظ...</span>
                </>
              ) : (
                <span>+ حفظ مفاتيح الصوت</span>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
