import React, {useEffect, useState} from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Lock,
  LogIn,
  LogOut,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {User} from 'firebase/auth';
import {SpeakButton, useDarijaSpeech} from '../contexts/SpeechContext';
import {PWAInstallButton} from '../hooks/usePWAInstall';
import {TrialBanner, WHATSAPP_NUMBER_DISPLAY, WHATSAPP_URL} from '../hooks/useTrialQuota';

interface SettingsViewProps {
  user: User | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSaveCloudSettings: () => Promise<void>;
  onOpenAdmin: () => void;
  onBack: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  onSignIn,
  onSignOut,
  onSaveCloudSettings,
  onOpenAdmin,
  onBack,
}) => {
  const {
    settings,
    updateSettings,
    previewVoice,
    isConfirmingVoice,
    previewVoiceSelection,
    confirmVoiceSelection,
    isLoadingAudio,
    activeSpeechId,
  } = useDarijaSpeech();
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [syncSavedToast, setSyncSavedToast] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setAiReady(Boolean(d?.aiConfigured)))
      .catch(() => setAiReady(false));
  }, []);

  const handleVoiceChange = async (partial: Partial<typeof settings>) => {
    updateSettings(partial);
    if (user) {
      setTimeout(async () => {
        try {
          await onSaveCloudSettings();
          setSyncSavedToast(true);
          setTimeout(() => setSyncSavedToast(false), 2000);
        } catch {
          // ignore
        }
      }, 50);
    }
  };

  return (
    <div className="space-y-6 pb-8 max-w-3xl mx-auto">
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
          id="settings-intro-voice"
          variant="secondary"
          label="سمع الشرح"
          text="فهاد الصفحة تقدر تشعل ولا تطفي الصوت، تختار واش يهضر معاك صوت ولد ولا بنت، وتعدل سرعة القراءة، وتقدر تسجل الدخول بـ جوجل باش تحفظ البلانات ديالك فـ فايربيز."
        />
      </div>

      <div>
        <h1 className="text-2xl font-extrabold text-white">الضبط والإعدادات</h1>
        <p className="text-sm text-slate-400 mt-1">
          تحكم فالصوت بالدارجة، نوع المتكلم (ولد / بنت)، الاشتراك ومزامنة المشاريع
        </p>
      </div>

      {/* 20-Trial Quota + Code + WhatsApp */}
      <TrialBanner />

      {/* Voice Settings Card */}
      <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {settings.voiceEnabled ? (
              <Volume2 className="w-6 h-6 text-[#ff7a1a]" />
            ) : (
              <VolumeX className="w-6 h-6 text-slate-400" />
            )}
            <div>
              <h2 className="text-lg font-bold text-white">الشرح الصوتي بالدارجة</h2>
              <p className="text-xs text-slate-400">
                تفعيل القراءة الصوتية التلقائية ومكبر الصوت فكل صفحة
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleVoiceChange({voiceEnabled: !settings.voiceEnabled})}
            className={`min-h-[44px] px-5 rounded-xl text-sm font-extrabold transition-colors ${
              settings.voiceEnabled
                ? 'bg-[#ff7a1a] text-[#0a0f1e]'
                : 'bg-white/10 text-slate-300'
            }`}
          >
            {settings.voiceEnabled ? 'الصوت مشعل' : 'الصوت طافي'}
          </button>
        </div>

        {/* Male / Female Voice Choice */}
        <div className="space-y-2.5 border-t border-white/10 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-200">اختيار صوت المتكلم بالدارجة المغربية</p>
            <span className="text-[11px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-lg">
              أصوات ذكية نقية (ولد / بنت)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                previewVoiceSelection(
                  'boy',
                  'مرحبا بيك أخويا ف فاهم بلان، كيداير؟ أنا المعلم، غادي نشرح ليك المخطط بالدارجة المغربية بصوت راجل واضح.',
                  'test-male'
                )
              }
              className={`min-h-[54px] rounded-xl border p-3.5 text-center font-bold transition-colors ${
                (previewVoice ?? (settings.voiceGender === 'female' ? 'girl' : 'boy')) === 'boy'
                  ? 'border-[#ff7a1a] bg-[#ff7a1a]/15 text-[#ff7a1a]'
                  : 'border-white/10 bg-[#0a0f1e] text-slate-300 hover:border-white/25'
              }`}
            >
              {isLoadingAudio && activeSpeechId === 'test-male' ? 'جاري...' : 'صوت ولد (المعلم)'}
            </button>
            <button
              type="button"
              onClick={() =>
                previewVoiceSelection(
                  'girl',
                  'أهلا ومرحبا بيك ف فاهم بلان، كيداير؟ أنا سلمى المهندسة، غادي نعاونك تفهم البلان خطوة بخطوة بالدارجة.',
                  'test-female'
                )
              }
              className={`min-h-[54px] rounded-xl border p-3.5 text-center font-bold transition-colors ${
                (previewVoice ?? (settings.voiceGender === 'female' ? 'girl' : 'boy')) === 'girl'
                  ? 'border-[#ff7a1a] bg-[#ff7a1a]/15 text-[#ff7a1a]'
                  : 'border-white/10 bg-[#0a0f1e] text-slate-300 hover:border-white/25'
              }`}
            >
              {isLoadingAudio && activeSpeechId === 'test-female' ? 'جاري...' : 'صوت بنت (المهندسة)'}
            </button>
          </div>
          {previewVoice && (
            <button
              type="button"
              disabled={isConfirmingVoice}
              onClick={async () => {
                const confirmed = await confirmVoiceSelection();
                if (confirmed && user) {
                  setTimeout(() => {
                    void onSaveCloudSettings().catch(() => undefined);
                  }, 50);
                }
              }}
              className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-[#0a0f1e] font-extrabold text-sm transition-colors"
            >
              {isConfirmingVoice ? 'جاري التأكيد...' : 'تم · Confirm Selection'}
            </button>
          )}
        </div>

        {/* Speech Speed */}
        <div className="space-y-2.5 border-t border-white/10 pt-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-200">سرعة الكلام</span>
            <span className="font-mono-nums text-sm font-bold text-[#ff7a1a]">
              {settings.speechRate.toFixed(2)}x
            </span>
          </div>
          <input
            type="range"
            min="0.75"
            max="1.3"
            step="0.05"
            value={settings.speechRate}
            onChange={(e) => handleVoiceChange({speechRate: parseFloat(e.target.value)})}
            className="w-full accent-[#ff7a1a]"
          />
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>بطيئة وواضحة</span>
            <span>عادية</span>
            <span>سريعة</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <SpeakButton
            id="settings-test-btn"
            variant="primary"
            label="جرب الصوت بالدارجة دابا"
            text="تبارك الله عليك! هاد الصوت خدام مزيان باش يشرح ليك بلان الدار، المساحات، الغرف، السيما والحديد بالدارجة المغربية."
          />
          <span className="text-xs text-slate-400">
            محرك الصوت: <span className="font-mono-nums text-emerald-300">Gemini Neural TTS</span>
          </span>
        </div>

        {syncSavedToast && (
          <p className="text-xs text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>تحفظو الإعدادات فحسابك</span>
          </p>
        )}
      </section>

      {/* Firebase Account & Cloud Storage */}
      <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Cloud className="w-6 h-6 text-[#ff7a1a]" />
          <div>
            <h2 className="text-lg font-bold text-white">التخزين السحابي (Firebase)</h2>
            <p className="text-xs text-slate-400">
              احفظ البلانات والأفكار الصوتية فحسابك باش ما يضيعوش إلى بدلتي التليفون
            </p>
          </div>
        </div>

        {user ? (
          <div className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <UserCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-bold text-white">{user.displayName || 'مستخدم فاهم بلان'}</p>
                <p className="text-xs text-slate-400">{user.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="min-h-[48px] w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-6 py-3 text-sm font-extrabold hover:bg-[#ff8d3b]"
          >
            <LogIn className="w-4 h-4" />
            <span>ربط الحساب بـ Google للحفظ السحابي</span>
          </button>
        )}
      </section>

      {/* Gemini Vision Status & WhatsApp Support */}
      <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-[#ff7a1a]" />
            <div>
              <h2 className="text-lg font-bold text-white">محرك رؤية الجوزاء (Gemini Vision)</h2>
              <p className="text-xs text-slate-400">
                الاتصال كيدوز بشكل آمن ومباشر عبر الخادم
              </p>
            </div>
          </div>
          <span
            className={`text-xs font-bold px-3 py-1 rounded-lg ${
              aiReady === true
                ? 'bg-emerald-500/15 text-emerald-300'
                : aiReady === false
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-white/5 text-slate-400'
            }`}
          >
            {aiReady === true ? 'متصل وجاهز' : aiReady === false ? 'غير مهيأ' : 'جاري التحقق'}
          </span>
        </div>

        <div className="border-t border-white/10 pt-4 flex flex-wrap items-center justify-between gap-3">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-extrabold"
          >
            <MessageCircle className="w-4 h-4" />
            <span>تواصل واتساب: {WHATSAPP_NUMBER_DISPLAY}</span>
          </a>

          <button
            type="button"
            onClick={onOpenAdmin}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
          >
            <Lock className="w-4 h-4 text-[#ff7a1a]" />
            <span>لوحة الإدارة (/admin)</span>
          </button>
        </div>
      </section>

      {/* PWA Install Card */}
      <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Smartphone className="w-6 h-6 text-[#ff7a1a]" />
          <div>
            <h2 className="text-lg font-bold text-white">تثبيت التطبيق فالتليفون (PWA)</h2>
            <p className="text-xs text-slate-400">
              تقدر تزيد فاهم بلان للشاشة الرئيسية ويخدم معاك بحال تطبيق نيتيف
            </p>
          </div>
        </div>
        <PWAInstallButton />
      </section>
    </div>
  );
};
