import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Loader2, Square, Volume2, VolumeX} from 'lucide-react';
import {VOICE_BOY, VOICE_GIRL} from '../../config.js';
import {
  getAudioState,
  getVoiceId,
  PREVIEW_BOY_VOICE_ID,
  PREVIEW_GIRL_VOICE_ID,
  speak,
  stopAudio,
  subscribeAudioState,
  toDarija,
} from '../../voice.js';
import type {TtsApiKeySlot, TtsApiKeyStatus, UserSettings} from '../types';

export type VoiceType = typeof VOICE_GIRL | typeof VOICE_BOY;

export {toDarija};

export function getSelectedVoice(): VoiceType {
  return getVoiceId() === PREVIEW_GIRL_VOICE_ID ? VOICE_GIRL : VOICE_BOY;
}

export interface SpeakProOptions {
  id?: string;
  gender?: 'male' | 'female';
  voiceId?: VoiceType;
  voiceType?: VoiceType;
  forcePlay?: boolean;
  testOrder?: number;
  testPlainKey?: string;
  adminPin?: string;
}

export interface SpeakProResult {
  ok: boolean;
  stopped?: boolean;
  usedFallback?: boolean;
  quotaExhausted?: boolean;
  voiceId?: VoiceType;
  voiceName?: VoiceType;
  status?: TtsApiKeyStatus;
  message?: string;
  slots?: TtsApiKeySlot[];
  errorDetail?: string;
}

interface SpeechContextValue {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
  isSpeaking: boolean;
  isLoadingAudio: boolean;
  activeSpeechId: string | null;
  previewVoice: 'girl' | 'boy' | null;
  isConfirmingVoice: boolean;
  previewVoiceSelection: (choice: 'girl' | 'boy', previewText: string, id: string) => void;
  confirmVoiceSelection: () => Promise<'girl' | 'boy' | null>;
  speakPro: (
    text: string,
    voiceTypeOrOptions?: VoiceType | SpeakProOptions,
    maybeOptions?: SpeakProOptions
  ) => Promise<SpeakProResult>;
  stop: () => void;
}

export const VOICE_LOCKED = true;

const STORAGE_KEY = 'fahem_blan_voice_settings_v2';
const SELECTED_VOICE_KEY = 'selectedVoice';

const DEFAULT_SETTINGS: UserSettings = {
  voiceEnabled: true,
  voiceGender: 'male',
  speechRate: 0.95,
};

function readInitialVoiceGender(): 'male' | 'female' {
  return getSelectedVoice() === VOICE_GIRL ? 'female' : 'male';
}

const SpeechContext = createContext<SpeechContextValue | null>(null);

export const SpeechProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const initialGender = readInitialVoiceGender();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          voiceEnabled: typeof parsed.voiceEnabled === 'boolean' ? parsed.voiceEnabled : true,
          voiceGender: initialGender,
          speechRate: typeof parsed.speechRate === 'number' ? parsed.speechRate : 0.95,
        };
      }
    } catch {
      // ignore
    }
    return {
      ...DEFAULT_SETTINGS,
      voiceGender: initialGender,
    };
  });

  const [audioUi, setAudioUi] = useState(() => getAudioState());
  const [previewVoice, setPreviewVoice] = useState<'girl' | 'boy' | null>(null);
  const [isConfirmingVoice, setIsConfirmingVoice] = useState(false);
  const [voiceToast, setVoiceToast] = useState<{text: string; tone: 'ok' | 'err'} | null>(null);

  const toastTimerRef = useRef<number | null>(null);

  const showVoiceToast = useCallback((text: string, tone: 'ok' | 'err') => {
    setVoiceToast({text, tone});
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setVoiceToast(null), 3000);
  }, []);

  useEffect(() => {
    return subscribeAudioState(setAudioUi);
  }, []);

  const updateSettings = useCallback((partial: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = {...prev, ...partial};
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    stopAudio();
  }, []);

  const speakPro = useCallback(
    async (
      text: string,
      voiceTypeOrOptions?: VoiceType | SpeakProOptions,
      maybeOptions?: SpeakProOptions
    ): Promise<SpeakProResult> => {
      const options: SpeakProOptions =
        typeof voiceTypeOrOptions === 'string'
          ? {...(maybeOptions || {}), voiceId: voiceTypeOrOptions, voiceType: voiceTypeOrOptions}
          : voiceTypeOrOptions || {};

      const isAdminKeyTest = typeof options.testOrder === 'number';
      if (!settings.voiceEnabled && !options.forcePlay && !isAdminKeyTest) {
        updateSettings({voiceEnabled: true});
      }

      const res = (await speak(text, {
        ...options,
        speechRate: settings.speechRate,
      })) as SpeakProResult;

      if (!isAdminKeyTest && (res.usedFallback || (!res.ok && res.quotaExhausted))) {
        showVoiceToast('All API keys quota full, using browser voice', 'err');
      }

      return res;
    },
    [settings.speechRate, settings.voiceEnabled, showVoiceToast, updateSettings]
  );

  const previewVoiceSelection = useCallback(
    (choice: 'girl' | 'boy', previewText: string, id: string) => {
      const changingPreview = previewVoice !== choice;
      setPreviewVoice(choice);
      const voiceId = choice === 'girl' ? PREVIEW_GIRL_VOICE_ID : PREVIEW_BOY_VOICE_ID;
      void speakPro(previewText, voiceId, {
        id,
        forcePlay: changingPreview,
      });
    },
    [previewVoice, speakPro]
  );

  const confirmVoiceSelection = useCallback(async (): Promise<'girl' | 'boy' | null> => {
    const choice = previewVoice;
    if (!choice || isConfirmingVoice) return null;

    setIsConfirmingVoice(true);
    try {
      localStorage.setItem(SELECTED_VOICE_KEY, choice);
    } catch {
      // ignore
    }

    const nextGender: 'male' | 'female' = choice === 'girl' ? 'female' : 'male';
    updateSettings({voiceGender: nextGender, voiceEnabled: true});
    setPreviewVoice(null);

    const confirmText = choice === 'girl' ? 'تم اختيار صوت البنت' : 'تم اختيار صوت الولد';
    // Call speak() WITHOUT any hardcoded voiceId so it uses getVoiceId() (API or browser fallback)
    const res = (await speak(confirmText, {
      id: `confirm-${choice}`,
      forcePlay: true,
      speechRate: settings.speechRate,
    })) as SpeakProResult;

    setIsConfirmingVoice(false);

    if (res.usedFallback || !res.ok) {
      showVoiceToast('All API keys quota full, using browser voice', 'err');
    } else {
      showVoiceToast('Voice saved', 'ok');
    }

    return choice;
  }, [isConfirmingVoice, previewVoice, settings.speechRate, showVoiceToast, updateSettings]);

  return (
    <SpeechContext.Provider
      value={{
        settings,
        updateSettings,
        isSpeaking: audioUi.isSpeaking,
        isLoadingAudio: audioUi.isLoadingAudio,
        activeSpeechId: audioUi.activeSpeechId,
        previewVoice,
        isConfirmingVoice,
        previewVoiceSelection,
        confirmVoiceSelection,
        speakPro,
        stop,
      }}
    >
      {children}
      {voiceToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl border px-4 py-2.5 text-sm font-extrabold shadow-xl ${
            voiceToast.tone === 'ok'
              ? 'border-emerald-500/40 bg-[#11182c] text-emerald-300'
              : 'border-red-500/40 bg-[#11182c] text-red-300'
          }`}
        >
          {voiceToast.text}
        </div>
      )}
    </SpeechContext.Provider>
  );
};

export function useDarijaSpeech() {
  const ctx = useContext(SpeechContext);
  if (!ctx) {
    throw new Error('useDarijaSpeech must be used inside SpeechProvider');
  }
  return ctx;
}

export const VoiceGenderSwitch: React.FC<{className?: string}> = ({className = ''}) => {
  const {
    settings,
    previewVoice,
    isConfirmingVoice,
    previewVoiceSelection,
    confirmVoiceSelection,
  } = useDarijaSpeech();
  const activeVisual = previewVoice ?? (settings.voiceGender === 'female' ? 'girl' : 'boy');

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#11182c] p-1 ${className}`}
      role="group"
      aria-label="اختيار صوت بنت أو ولد"
    >
      <button
        type="button"
        onClick={() =>
          previewVoiceSelection(
            'boy',
            'مرحبا بيك أخويا ف فاهم بلان، كيداير؟ صوت الولد المعلم خدام دابا.',
            'gender-switch-male'
          )
        }
        className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
          activeVisual === 'boy'
            ? 'bg-[#ff7a1a] text-[#0a0f1e]'
            : 'text-slate-300 hover:text-white'
        }`}
      >
        ولد
      </button>
      <button
        type="button"
        onClick={() =>
          previewVoiceSelection(
            'girl',
            'مرحبا بيك ف فاهم بلان، كيداير؟ أنا سلمى المهندسة، صوت البنت خدام دابا.',
            'gender-switch-female'
          )
        }
        className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
          activeVisual === 'girl'
            ? 'bg-[#ff7a1a] text-[#0a0f1e]'
            : 'text-slate-300 hover:text-white'
        }`}
      >
        بنت
      </button>
      {previewVoice && (
        <button
          type="button"
          disabled={isConfirmingVoice}
          onClick={() => void confirmVoiceSelection()}
          title="Confirm Selection"
          aria-label="Confirm Selection"
          className="min-h-[36px] px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-[#0a0f1e] text-xs font-extrabold transition-colors whitespace-nowrap"
        >
          {isConfirmingVoice ? '...' : 'تم'}
        </button>
      )}
    </div>
  );
};

interface SpeakButtonProps {
  text: string;
  id: string;
  label?: string;
  compact?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}

export const SpeakButton: React.FC<SpeakButtonProps> = ({
  text,
  id,
  label = 'سمع بالدارجة',
  compact = false,
  variant = 'secondary',
  className = '',
}) => {
  const {speakPro, stop, isSpeaking, isLoadingAudio, activeSpeechId, settings} = useDarijaSpeech();
  const isThisActive = isSpeaking && activeSpeechId === id;
  const isThisLoading = isLoadingAudio && activeSpeechId === id;

  const handleToggle = () => {
    if (isThisActive || isThisLoading) {
      stop();
    } else {
      void speakPro(text, {id});
    }
  };

  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 whitespace-nowrap shrink-0 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a1a] active:scale-[0.98]';

  const variantStyles =
    variant === 'primary'
      ? 'bg-[#ff7a1a] text-[#0a0f1e] hover:bg-[#ff8d3b] px-5 py-2.5 text-sm shadow-lg shadow-[#ff7a1a]/15'
      : variant === 'ghost'
        ? 'bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10 px-3.5 py-2 text-xs'
        : 'bg-[#16203a] text-[#ff7a1a] hover:bg-[#1e2b4d] border border-[#ff7a1a]/30 px-4 py-2 text-sm';

  if (!settings.voiceEnabled) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        title="ورك باش تشغل الصوت"
        className={`${baseStyles} bg-white/5 text-slate-400 border border-white/10 px-3.5 py-2 text-xs ${className}`}
      >
        <VolumeX className="w-4 h-4 shrink-0" />
        {!compact && <span>الصوت موقف</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isThisActive ? 'حبس الصوت' : label}
      className={`${baseStyles} ${variantStyles} ${isThisActive ? 'ring-2 ring-[#ff7a1a] bg-[#ff7a1a] text-[#0a0f1e]' : ''} ${compact ? 'min-w-[44px] px-3' : ''} ${className}`}
    >
      {isThisLoading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {!compact && <span>جاري...</span>}
        </>
      ) : isThisActive ? (
        <>
          <Square className="w-4 h-4 fill-current shrink-0" />
          {!compact && <span>حبس الصوت</span>}
        </>
      ) : (
        <>
          <Volume2 className="w-4 h-4 shrink-0" />
          {!compact && <span>{label}</span>}
        </>
      )}
    </button>
  );
};
