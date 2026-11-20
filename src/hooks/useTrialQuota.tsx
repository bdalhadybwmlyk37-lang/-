import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import {SpeakButton} from '../contexts/SpeechContext';
import type {AccessCodeItem} from '../types';

export const MAX_CODE_TRIALS = 10;
export const WHATSAPP_NUMBER_DISPLAY = '0647205383';
export const WHATSAPP_URL =
  'https://wa.me/212647205383?text=%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85%20%D8%B9%D9%84%D9%8A%D9%83%D9%85%D8%8C%20%D8%A8%D8%BA%D9%8A%D8%AA%20%D9%86%D8%B4%D8%B1%D9%8A%20%D8%A3%D9%88%20%D9%86%D8%AC%D8%AF%D8%AF%20%D9%83%D9%88%D8%AF%20%D8%A7%D9%84%D8%A7%D8%B4%D8%AA%D8%B1%D8%A7%D9%83%20%D9%81%D9%8A%20%D8%AA%D8%B7%D8%A8%D9%8A%D9%82%20%D9%81%D8%A7%D9%87%D9%85%20%D8%A8%D9%84%D8%A7%D9%86';

export const USER_CODE_KEY = 'fahem_user_code';
export const CODES_STORAGE_KEY = 'fahem_codes';
export const getTrialStorageKey = (code: string) => `fahem_trials_${code.trim().toUpperCase()}`;

const DEFAULT_SEED_CODES: AccessCodeItem[] = [
  {
    id: 'default_vip',
    ownerId: 'system',
    name: 'كود الافتتاح VIP',
    code: 'FAHEM2026',
    isActive: true,
    trials: 0,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    syncedToCloud: false,
  },
];

export function readStoredCodes(): AccessCodeItem[] {
  try {
    const raw = localStorage.getItem(CODES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(CODES_STORAGE_KEY, JSON.stringify(DEFAULT_SEED_CODES));
      return DEFAULT_SEED_CODES;
    }
    const parsed = JSON.parse(raw) as Partial<AccessCodeItem & {active?: boolean}>[];
    if (!Array.isArray(parsed)) return DEFAULT_SEED_CODES;
    return parsed.map((item) => ({
      id: String(item.id || `code_${Date.now()}`),
      ownerId: String(item.ownerId || 'local'),
      name: String(item.name || 'مشترك'),
      code: String(item.code || '').trim().toUpperCase(),
      isActive:
        typeof item.isActive === 'boolean'
          ? item.isActive
          : typeof item.active === 'boolean'
            ? item.active
            : true,
      trials: Number.isFinite(Number(item.trials)) ? Math.max(0, Number(item.trials)) : 0,
      createdAtMs: Number(item.createdAtMs || Date.now()),
      updatedAtMs: Number(item.updatedAtMs || item.createdAtMs || Date.now()),
      syncedToCloud: Boolean(item.syncedToCloud),
    }));
  } catch {
    return DEFAULT_SEED_CODES;
  }
}

export function writeStoredCodes(codes: AccessCodeItem[]): void {
  try {
    localStorage.setItem(CODES_STORAGE_KEY, JSON.stringify(codes));
    window.dispatchEvent(new Event('fahem-codes-updated'));
  } catch {
    // ignore
  }
}

export function readCodeTrials(code: string): number {
  const clean = code.trim().toUpperCase();
  if (!clean) return 0;
  try {
    const raw = localStorage.getItem(getTrialStorageKey(clean));
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  } catch {
    // ignore
  }
  const stored = readStoredCodes().find((c) => c.code.toUpperCase() === clean);
  return stored ? stored.trials : 0;
}

export function writeCodeTrials(code: string, trials: number): void {
  const clean = code.trim().toUpperCase();
  if (!clean) return;
  const safe = Math.max(0, Math.round(trials));
  try {
    localStorage.setItem(getTrialStorageKey(clean), String(safe));
    const list = readStoredCodes();
    const idx = list.findIndex((c) => c.code.toUpperCase() === clean);
    if (idx !== -1) {
      list[idx] = {...list[idx], trials: safe, updatedAtMs: Date.now()};
      localStorage.setItem(CODES_STORAGE_KEY, JSON.stringify(list));
    }
    window.dispatchEvent(new Event('fahem-codes-updated'));
  } catch {
    // ignore
  }
}

interface AllowanceCheckResult {
  allowed: boolean;
  reason?: 'no_code' | 'inactive' | 'limit_reached';
  message?: string;
}

interface TrialContextValue {
  activeCode: string | null;
  activeCodeRecord: AccessCodeItem | null;
  usedTrials: number;
  remainingTrials: number;
  isCodeBlocked: boolean;
  blockReason: 'inactive' | 'limit_reached' | null;
  paymentModalOpen: boolean;
  openPaymentModal: (reason?: 'inactive' | 'limit_reached') => void;
  closePaymentModal: () => void;
  verifyAndUnlock: (code: string) => Promise<{ok: boolean; message: string; reason?: string}>;
  switchCode: () => void;
  checkAllowanceBeforeAnalysis: () => Promise<AllowanceCheckResult>;
  consumeTrial: () => Promise<boolean>;
  refreshActiveCodeStatus: () => Promise<void>;
}

const TrialContext = createContext<TrialContextValue | null>(null);

export const TrialProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [activeCode, setActiveCode] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(USER_CODE_KEY);
      return saved && saved.trim() ? saved.trim().toUpperCase() : null;
    } catch {
      return null;
    }
  });

  const [codesSnapshot, setCodesSnapshot] = useState<AccessCodeItem[]>(() => readStoredCodes());
  const [usedTrials, setUsedTrials] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(USER_CODE_KEY);
      return saved ? readCodeTrials(saved) : 0;
    } catch {
      return 0;
    }
  });

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [blockReason, setBlockReason] = useState<'inactive' | 'limit_reached' | null>(null);

  const activeCodeRecord = activeCode
    ? codesSnapshot.find((c) => c.code.toUpperCase() === activeCode.toUpperCase()) || null
    : null;

  const isExplicitlyInactive = activeCodeRecord ? !activeCodeRecord.isActive : false;
  const isLimitReached = usedTrials >= MAX_CODE_TRIALS;
  const isCodeBlocked = Boolean(activeCode) && (isExplicitlyInactive || isLimitReached);
  const remainingTrials = Math.max(0, MAX_CODE_TRIALS - usedTrials);

  const syncFromStorage = useCallback(() => {
    const list = readStoredCodes();
    setCodesSnapshot(list);
    if (activeCode) {
      const hit = list.find((c) => c.code.toUpperCase() === activeCode.toUpperCase());
      const localCount = readCodeTrials(activeCode);
      if (hit) {
        // Respect reset if hit.trials is 0 and localStorage key was already synced
        setUsedTrials(localCount);
        if (!hit.isActive) {
          setBlockReason('inactive');
        } else if (localCount >= MAX_CODE_TRIALS) {
          setBlockReason('limit_reached');
        } else {
          setBlockReason(null);
        }
      } else {
        setUsedTrials(localCount);
      }
    }
  }, [activeCode]);

  const refreshActiveCodeStatus = useCallback(async () => {
    syncFromStorage();
    if (!activeCode) return;

    try {
      const res = await fetch('/api/codes/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code: activeCode}),
      });
      const data = await res.json();

      if (res.ok && data.valid) {
        const list = readStoredCodes();
        const idx = list.findIndex((c) => c.code.toUpperCase() === activeCode.toUpperCase());
        const serverTrials = Number(data.trials || 0);
        const localTrials = readCodeTrials(activeCode);
        // If local fahem_codes already has an updated timestamp or server was reset, take the authoritative active state
        const localRec = idx !== -1 ? list[idx] : null;
        const resolvedTrials =
          localRec && (localRec.updatedAtMs || 0) > (data.updatedAtMs || 0)
            ? localTrials
            : serverTrials;

        writeCodeTrials(activeCode, resolvedTrials);
        setUsedTrials(resolvedTrials);
        setBlockReason(resolvedTrials >= MAX_CODE_TRIALS ? 'limit_reached' : null);

        if (idx === -1) {
          writeStoredCodes([
            {
              id: data.id || `server_${Date.now()}`,
              ownerId: 'server',
              name: data.name || activeCode,
              code: activeCode,
              isActive: true,
              trials: resolvedTrials,
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
              syncedToCloud: false,
            },
            ...list,
          ]);
        } else {
          list[idx] = {
            ...list[idx],
            name: data.name || list[idx].name,
            isActive: true,
            trials: resolvedTrials,
          };
          writeStoredCodes(list);
        }
      } else if (res.status === 403) {
        const reason = data.reason === 'inactive' ? 'inactive' : 'limit_reached';
        const serverTrials = Number.isFinite(Number(data.trials))
          ? Number(data.trials)
          : readCodeTrials(activeCode);
        const list = readStoredCodes();
        const idx = list.findIndex((c) => c.code.toUpperCase() === activeCode.toUpperCase());
        if (idx !== -1) {
          list[idx] = {
            ...list[idx],
            isActive: reason !== 'inactive',
            trials: serverTrials,
          };
          writeStoredCodes(list);
        }
        writeCodeTrials(activeCode, serverTrials);
        setUsedTrials(serverTrials);
        setBlockReason(reason);
      }
    } catch {
      // Offline: rely on local fahem_codes + fahem_trials_[CODE]
    }
  }, [activeCode, syncFromStorage]);

  useEffect(() => {
    syncFromStorage();
    const handleEvent = () => syncFromStorage();
    window.addEventListener('fahem-codes-updated', handleEvent);
    window.addEventListener('storage', handleEvent);
    return () => {
      window.removeEventListener('fahem-codes-updated', handleEvent);
      window.removeEventListener('storage', handleEvent);
    };
  }, [syncFromStorage]);

  useEffect(() => {
    refreshActiveCodeStatus();
  }, [refreshActiveCodeStatus]);

  const openPaymentModal = useCallback((reason?: 'inactive' | 'limit_reached') => {
    if (reason) setBlockReason(reason);
    setPaymentModalOpen(true);
  }, []);

  const closePaymentModal = useCallback(() => {
    setPaymentModalOpen(false);
  }, []);

  const verifyAndUnlock = useCallback(async (rawCode: string) => {
    const clean = rawCode.trim().toUpperCase();
    if (!clean) {
      return {ok: false, message: 'دخل رمز الدخول ديالك أولا.'};
    }

    // 1) Check local fahem_codes first (covers codes created in /admin offline or locally)
    const list = readStoredCodes();
    const localHit = list.find((c) => c.code.toUpperCase() === clean);

    if (localHit) {
      const localCount = readCodeTrials(clean);
      if (!localHit.isActive) {
        return {
          ok: false,
          reason: 'inactive',
          message: `هاد الكود (${clean}) موقوف من الإدارة. تواصل مع واتساب ${WHATSAPP_NUMBER_DISPLAY}.`,
        };
      }
      if (localCount >= MAX_CODE_TRIALS) {
        return {
          ok: false,
          reason: 'limit_reached',
          message: `هاد الكود (${clean}) وصل للحد الأقصى (${MAX_CODE_TRIALS}/${MAX_CODE_TRIALS}). تواصل مع واتساب ${WHATSAPP_NUMBER_DISPLAY} باش تخلص وتصفر العداد.`,
        };
      }
    }

    // 2) Check server /api/codes/verify as well
    try {
      const res = await fetch('/api/codes/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code: clean}),
      });
      const data = await res.json();

      if (res.ok && data.valid) {
        const trials = localHit ? Math.max(readCodeTrials(clean), Number(data.trials || 0)) : Number(data.trials || 0);
        if (trials >= MAX_CODE_TRIALS) {
          return {
            ok: false,
            reason: 'limit_reached',
            message: `هاد الكود وصل للحد الأقصى (${MAX_CODE_TRIALS}/${MAX_CODE_TRIALS}). تواصل مع واتساب ${WHATSAPP_NUMBER_DISPLAY}.`,
          };
        }

        localStorage.setItem(USER_CODE_KEY, clean);
        writeCodeTrials(clean, trials);

        if (!localHit) {
          writeStoredCodes([
            {
              id: data.id || `code_${Date.now()}`,
              ownerId: 'server',
              name: data.name || clean,
              code: clean,
              isActive: true,
              trials,
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
              syncedToCloud: false,
            },
            ...list,
          ]);
        }

        setActiveCode(clean);
        setUsedTrials(trials);
        setBlockReason(null);
        setPaymentModalOpen(false);
        return {ok: true, message: `مرحبا بيك ${data.name || clean}! الدخول تفعل بنجاح.`};
      }

      // If server returned 404 (e.g. code was created in client localStorage/Firestore only and server restarted), allow localHit
      if (res.status === 404 && localHit && localHit.isActive) {
        const trials = readCodeTrials(clean);
        localStorage.setItem(USER_CODE_KEY, clean);
        writeCodeTrials(clean, trials);
        setActiveCode(clean);
        setUsedTrials(trials);
        setBlockReason(null);
        setPaymentModalOpen(false);
        return {ok: true, message: `مرحبا بيك ${localHit.name}! الدخول تفعل بنجاح.`};
      }

      return {
        ok: false,
        reason: data.reason,
        message: data.error || 'هاد الكود غير صحيح أو موقوف.',
      };
    } catch {
      if (localHit && localHit.isActive) {
        const trials = readCodeTrials(clean);
        localStorage.setItem(USER_CODE_KEY, clean);
        writeCodeTrials(clean, trials);
        setActiveCode(clean);
        setUsedTrials(trials);
        setBlockReason(null);
        setPaymentModalOpen(false);
        return {ok: true, message: `مرحبا بيك ${localHit.name}! تم الدخول.`};
      }
      return {ok: false, message: 'ما قدرناش نتحققو من الكود، تأكد من الاتصال وجرب مرة أخرى.'};
    }
  }, []);

  const switchCode = useCallback(() => {
    try {
      localStorage.removeItem(USER_CODE_KEY);
    } catch {
      // ignore
    }
    setActiveCode(null);
    setPaymentModalOpen(false);
    setBlockReason(null);
  }, []);

  const checkAllowanceBeforeAnalysis = useCallback(async (): Promise<AllowanceCheckResult> => {
    const current = (localStorage.getItem(USER_CODE_KEY) || activeCode || '').trim().toUpperCase();
    if (!current) {
      return {
        allowed: false,
        reason: 'no_code',
        message: 'خاصك تدخل رمز الدخول الاشتراك ديالك أولا.',
      };
    }

    const list = readStoredCodes();
    const localRec = list.find((c) => c.code.toUpperCase() === current);
    let currentCount = readCodeTrials(current);
    let activeFlag = localRec ? localRec.isActive : true;

    // Also check server state so remote admin disable/reset reflects immediately
    try {
      const res = await fetch('/api/codes/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code: current}),
      });
      const data = await res.json();
      if (res.status === 403) {
        activeFlag = data.reason !== 'inactive';
        if (typeof data.trials === 'number') {
          currentCount = Math.max(currentCount, data.trials);
        }
      } else if (res.ok && data.valid) {
        activeFlag = true;
        if (localRec && !localRec.isActive) {
          // Local admin disabled it on this device
          activeFlag = false;
        } else if (typeof data.trials === 'number' && data.trials === 0 && (data.updatedAtMs || 0) > (localRec?.updatedAtMs || 0)) {
          // Server counter was reset by admin
          currentCount = 0;
          writeCodeTrials(current, 0);
        }
      }
    } catch {
      // Offline fallback uses local state
    }

    setUsedTrials(currentCount);

    if (!activeFlag) {
      setBlockReason('inactive');
      setPaymentModalOpen(true);
      return {
        allowed: false,
        reason: 'inactive',
        message: `هاد الكود (${current}) موقوف من الإدارة. تواصل مع واتساب ${WHATSAPP_NUMBER_DISPLAY}.`,
      };
    }

    if (currentCount >= MAX_CODE_TRIALS) {
      setBlockReason('limit_reached');
      setPaymentModalOpen(true);
      return {
        allowed: false,
        reason: 'limit_reached',
        message: `وصلتي للحد الأقصى (${MAX_CODE_TRIALS}/${MAX_CODE_TRIALS}) لهاد الكود. تواصل مع واتساب ${WHATSAPP_NUMBER_DISPLAY} باش تخلص وتكمل.`,
      };
    }

    return {allowed: true};
  }, [activeCode]);

  const consumeTrial = useCallback(async () => {
    const current = (localStorage.getItem(USER_CODE_KEY) || activeCode || '').trim().toUpperCase();
    if (!current) return false;

    const currentCount = readCodeTrials(current);
    const list = readStoredCodes();
    const localRec = list.find((c) => c.code.toUpperCase() === current);
    if (localRec && !localRec.isActive) {
      setBlockReason('inactive');
      setPaymentModalOpen(true);
      return false;
    }
    if (currentCount >= MAX_CODE_TRIALS) {
      setBlockReason('limit_reached');
      setPaymentModalOpen(true);
      return false;
    }

    const next = currentCount + 1;
    writeCodeTrials(current, next);
    setUsedTrials(next);

    try {
      await fetch('/api/codes/consume', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code: current}),
      });
    } catch {
      // keep local count
    }

    return true;
  }, [activeCode]);

  return (
    <TrialContext.Provider
      value={{
        activeCode,
        activeCodeRecord,
        usedTrials,
        remainingTrials,
        isCodeBlocked,
        blockReason,
        paymentModalOpen,
        openPaymentModal,
        closePaymentModal,
        verifyAndUnlock,
        switchCode,
        checkAllowanceBeforeAnalysis,
        consumeTrial,
        refreshActiveCodeStatus,
      }}
    >
      {children}
    </TrialContext.Provider>
  );
};

export function useTrialQuota() {
  const ctx = useContext(TrialContext);
  if (!ctx) throw new Error('useTrialQuota must be used inside TrialProvider');
  return ctx;
}

export const MandatoryCodeGateModal: React.FC<{
  suppressGate: boolean;
  onOpenAdmin: () => void;
}> = ({suppressGate, onOpenAdmin}) => {
  const {activeCode, verifyAndUnlock} = useTrialQuota();
  const [codeInput, setCodeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (suppressGate || activeCode) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    const res = await verifyAndUnlock(codeInput);
    setLoading(false);
    if (!res.ok) {
      setErrorMsg(res.message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="رمز الدخول الاشتراك ديالك"
      className="fixed inset-0 z-50 bg-[#050814]/95 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#11182c] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="فاهم بلان" className="w-10 h-10 rounded-xl" />
            <div>
              <h1 className="text-lg font-extrabold text-white">فاهم بلان — الدخول الإجباري</h1>
              <p className="text-xs text-slate-400">خاص بالمشتركين والمهنيين</p>
            </div>
          </div>

          <SpeakButton
            id="mandatory-gate-voice"
            compact
            variant="ghost"
            text="مرحبا بيك فـ تطبيق فاهم بلان. باش تبدا تستعمل التطبيق، خاصك تدخل رمز الدخول ديال الاشتراك وتورك على تأكيد. إلا ما عندكش الكود، تواصل معنا فـ واتساب صفر ستة سبعة وأربعين عشرين تلاتة وخمسين تلاتة وتمانين."
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-extrabold text-white">
              <KeyRound className="w-4 h-4 text-[#ff7a1a]" />
              <span>رمز الدخول الاشتراك ديالك</span>
            </span>
            <input
              type="text"
              required
              autoFocus
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="دخل الرمز هنا (مثلا: FAHEM2026)"
              className="w-full min-h-[52px] rounded-2xl border border-white/15 bg-[#0a0f1e] px-4 text-center text-base font-bold font-mono-nums tracking-wider text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
            />
          </label>

          {errorMsg && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3 flex items-start gap-2 text-xs text-red-200 leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[52px] rounded-2xl bg-[#ff7a1a] hover:bg-[#ff8d3b] text-[#0a0f1e] text-base font-extrabold shadow-lg shadow-[#ff7a1a]/20 transition-colors disabled:opacity-60"
          >
            {loading ? 'جاري التحقق...' : 'تأكيد'}
          </button>
        </form>

        <div className="border-t border-white/10 pt-4 space-y-3">
          <p className="text-xs text-slate-300 text-center">
            مازال ما عندكش رمز الدخول؟ خد الاشتراك ديالك دابا:
          </p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            <span>طلب رمز الاشتراك عبر واتساب {WHATSAPP_NUMBER_DISPLAY}</span>
          </a>

          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-[#ff7a1a] transition-colors py-1 px-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>دخول الإدارة (/admin)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PaymentBlockedModal: React.FC = () => {
  const {
    activeCode,
    usedTrials,
    blockReason,
    paymentModalOpen,
    closePaymentModal,
    switchCode,
  } = useTrialQuota();

  if (!paymentModalOpen) return null;

  const isInactive = blockReason === 'inactive';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="تفعيل الاشتراك أو تجديد الرصيد"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-3xl border border-[#ff7a1a]/40 bg-[#11182c] p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#ff7a1a]/15 border border-[#ff7a1a]/30 flex items-center justify-center text-[#ff7a1a] shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white">
                {isInactive ? 'هاد الكود موقوف مؤقتاً' : 'ساليو تجارب هاد الكود (10/10)'}
              </h2>
              <p className="text-xs text-slate-400 font-mono-nums">
                الكود: {activeCode || '-'} · الاستعمال: {usedTrials}/{MAX_CODE_TRIALS}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closePaymentModal}
            aria-label="إغلاق"
            className="min-h-[40px] min-w-[40px] rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-200 leading-relaxed">
          {isInactive
            ? 'تم توقيف هاد رمز الدخول من طرف الإدارة. باش ترجعو يخدم ولا تخلص الاشتراك، تواصل معانا مباشرة على الواتساب.'
            : `الكود ديالك وصل لـ ${MAX_CODE_TRIALS} ديال التحاليل بالذكاء الاصطناعي. باش نرجعو نصفروا ليك العداد وتكمل الخدمة، تواصل معانا فـ واتساب باش تخلص.`}
        </p>

        <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0a0f1e] border border-white/10 p-3">
          <span className="text-xs font-bold text-slate-300">سمع التنبيه بالدارجة</span>
          <SpeakButton
            id="blocked-modal-voice"
            compact
            variant="ghost"
            text={
              isInactive
                ? 'هاد الكود موقوف حاليا من الإدارة. تواصل معنا فـ واتساب صفر ستة سبعة وأربعين عشرين تلاتة وخمسين تلاتة وتمانين باش نعاودو نفعّلوه ليك.'
                : 'ساليو العشرة تجارب ديال هاد الكود. تواصل معنا فـ واتساب صفر ستة سبعة وأربعين عشرين تلاتة وخمسين تلاتة وتمانين باش تخلص وتصفّر العداد.'
            }
          />
        </div>

        <div className="space-y-2.5">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[50px] inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold transition-colors"
          >
            <MessageCircle className="w-5 h-5" />
            <span>واتساب {WHATSAPP_NUMBER_DISPLAY} باش تخلص وتفعّل</span>
          </a>

          <button
            type="button"
            onClick={switchCode}
            className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-200 transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-[#ff7a1a]" />
            <span>دخل كود اشتراك آخر</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const TrialBanner: React.FC = () => {
  const {
    activeCode,
    activeCodeRecord,
    usedTrials,
    remainingTrials,
    isCodeBlocked,
    blockReason,
    switchCode,
    openPaymentModal,
  } = useTrialQuota();

  const pct = Math.min(100, Math.round((usedTrials / MAX_CODE_TRIALS) * 100));

  return (
    <div className="rounded-2xl border border-white/10 bg-[#11182c] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {isCodeBlocked ? (
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <div>
            <p className="text-sm font-bold text-white">
              <span>
                اشتراك: {activeCodeRecord?.name || 'مفعل'} (
                <span className="font-mono-nums text-[#ff7a1a]">{activeCode || '-'}</span>)
              </span>
              <span className="mx-2 text-slate-500">·</span>
              <span className="font-mono-nums text-xs">
                {isCodeBlocked
                  ? blockReason === 'inactive'
                    ? 'الحالة: موقوف'
                    : `مكتمل (${usedTrials}/${MAX_CODE_TRIALS})`
                  : `باقي ${remainingTrials} من ${MAX_CODE_TRIALS}`}
              </span>
            </p>
            <p className="text-xs text-slate-400">
              كل كود عندو {MAX_CODE_TRIALS} تحاليل ذكية — للتجديد تواصل معنا فـ واتساب {WHATSAPP_NUMBER_DISPLAY}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isCodeBlocked && (
            <button
              type="button"
              onClick={() => openPaymentModal(blockReason || 'limit_reached')}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-3.5 py-2 text-xs font-extrabold whitespace-nowrap"
            >
              <span>تجديد الاشتراك</span>
            </button>
          )}

          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 text-xs font-extrabold whitespace-nowrap transition-colors"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>واتساب {WHATSAPP_NUMBER_DISPLAY}</span>
          </a>

          <button
            type="button"
            onClick={switchCode}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#0a0f1e] text-slate-200 hover:border-[#ff7a1a] px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5 text-[#ff7a1a]" />
            <span>تبديل الكود</span>
          </button>

          <SpeakButton
            id="trial-banner-voice"
            compact
            variant="ghost"
            text={
              isCodeBlocked
                ? 'هاد الكود وصل للحد ديالو أو توقف. تواصل معنا فـ واتساب صفر ستة سبعة وأربعين عشرين تلاتة وخمسين تلاتة وتمانين باش تجدد الاشتراك.'
                : `أنت داخل بكود ${activeCode}. استعملتي ${usedTrials} من أصل ${MAX_CODE_TRIALS} تحاليل، وباقي ليك ${remainingTrials}.`
            }
          />
        </div>
      </div>

      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          style={{width: `${pct}%`}}
          className={`h-full transition-all ${
            isCodeBlocked ? 'bg-red-500' : remainingTrials <= 2 ? 'bg-amber-400' : 'bg-[#ff7a1a]'
          }`}
        />
      </div>
    </div>
  );
};
