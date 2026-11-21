 import React, {useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  BookmarkCheck,
  Bot,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Hammer,
  Layers,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Package,
  Pencil,
  Send,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import {SpeakButton, useDarijaSpeech, VoiceGenderSwitch} from '../contexts/SpeechContext';
import {TrialBanner, useTrialQuota, WHATSAPP_NUMBER_DISPLAY} from '../hooks/useTrialQuota';
import {prepareImageFromSrc, readFileAsDataUrl} from '../lib/imageUtils';
import type {FloorPlanAnalysis, PlanChatMessage} from '../types';

const PLAN_CACHE_STORAGE_KEY = 'fahem_plan_analysis_cache_v1';
const MAX_LOCAL_PLAN_CACHE = 8;
const planMemoryCache = new Map<string, FloorPlanAnalysis>();

function hashStringKey(input: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `${input.length}_${(h1 >>> 0).toString(36)}`;
}

function readPlanAnalysisCache(key: string): FloorPlanAnalysis | null {
  const mem = planMemoryCache.get(key);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(PLAN_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as Array<{k: string; v: FloorPlanAnalysis; ts: number}>;
    const hit = Array.isArray(list) ? list.find((item) => item.k === key) : undefined;
    if (hit?.v) {
      planMemoryCache.set(key, hit.v);
      return hit.v;
    }
  } catch {
    // ignore
  }
  return null;
}

function parseApiJsonSafe<T>(rawText: string, fallbackError = 'تعذر تحليل البلان، عاود حاول'): T {
  try {
    const parsed = JSON.parse(rawText) as T;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(fallbackError);
    }
    return parsed;
  } catch {
    throw new Error(fallbackError);
  }
}

function writePlanAnalysisCache(key: string, value: FloorPlanAnalysis): void {
  planMemoryCache.set(key, value);
  try {
    const raw = localStorage.getItem(PLAN_CACHE_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as Array<{k: string; v: FloorPlanAnalysis; ts: number}>) : [];
    const filtered = Array.isArray(list) ? list.filter((item) => item.k !== key) : [];
    filtered.unshift({k: key, v: value, ts: Date.now()});
    localStorage.setItem(
      PLAN_CACHE_STORAGE_KEY,
      JSON.stringify(filtered.slice(0, MAX_LOCAL_PLAN_CACHE))
    );
  } catch {
    // ignore storage quota
  }
}

interface AnalyzePlanViewProps {
  initialImageSrc: string | null;
  onClearInitialImage: () => void;
  onOpenCamera: () => void;
  onSavePlan: (analysis: FloorPlanAnalysis, thumbnailDataUrl?: string) => Promise<void>;
  onOpenInAnnotator: (imageSrc: string) => void;
  onBack: () => void;
}

const QUICK_DARIJA_QUESTIONS = [
  'فين كاين الحديد وشحال من بار؟',
  'شنو المسافات بين القضبان؟',
  'شحال خاصني ديال السيما والرملة والكياس؟',
  'شرح ليا مراحل الخدمة بالترتيب',
];

export const AnalyzePlanView: React.FC<AnalyzePlanViewProps> = ({
  initialImageSrc,
  onClearInitialImage,
  onOpenCamera,
  onSavePlan,
  onOpenInAnnotator,
  onBack,
}) => {
  const {stop} = useDarijaSpeech();
  const {checkAllowanceBeforeAnalysis, consumeTrial} = useTrialQuota();

  const [previewSrc, setPreviewSrc] = useState<string | null>(initialImageSrc);
  const [preparedDataUrl, setPreparedDataUrl] = useState<string | null>(null);
  const [preparedMime, setPreparedMime] = useState<string>('image/jpeg');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);

  const [notes, setNotes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FloorPlanAnalysis | null>(null);
  const [showFullDetails, setShowFullDetails] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedDone, setSavedDone] = useState(false);

  // Dedicated Chat UI state
  const [chatMessages, setChatMessages] = useState<PlanChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [isTranscribingMic, setIsTranscribingMic] = useState(false);
  const [micVadStatus, setMicVadStatus] = useState<string | null>(null);
  const [micErrorMsg, setMicErrorMsg] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<{
    onresult: ((ev: unknown) => void) | null;
    onspeechend?: (() => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onend: (() => void) | null;
    stop: () => void;
    abort?: () => void;
  } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const autoSendDelayTimerRef = useRef<number | null>(null);
  const discardRecordingRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<number | null>(null);
  const liveTranscriptRef = useRef<string>('');
  const hasSpokenRef = useRef<boolean>(false);
  const autoSentRef = useRef<boolean>(false);
  const manualStopRef = useRef<boolean>(false);
  const recognitionErrorHandledRef = useRef<boolean>(false);
  const handleSendChatRef = useRef<(q?: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [chatMessages, isAnalyzing, isChatSending]);

  const runAnalysis = async (
    srcToAnalyze: string,
    extraNotes?: string,
    bypassCache = false
  ) => {
    const allowance = await checkAllowanceBeforeAnalysis();
    if (!allowance.allowed) {
      setErrorMsg(
        allowance.message ||
          `ساليو التجارب ديال هاد الكود. تواصل معنا عبر واتساب ${WHATSAPP_NUMBER_DISPLAY} باش تخلص وتجدد.`
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setSavedDone(false);
    setAnalysis(null);

    const userMsgId = `msg_user_${Date.now()}`;
    setChatMessages([
      {
        id: userMsgId,
        role: 'user',
        text: extraNotes?.trim()
          ? `ها هي صورة البلان ديالي. ${extraNotes.trim()}`
          : 'ها هي صورة البلان ديالي، عافاك قرا البلان وشرحو ليا بالدارجة.',
        imageUrl: srcToAnalyze,
        timestampMs: Date.now(),
      },
    ]);

    try {
      // 1) Downscale & compress image to 1024px JPEG before Gemini Vision (with fallback if blob URL was revoked)
      let analysisDataUrl = preparedDataUrl;
      let mimeType = preparedMime;
      try {
        const prepared = await prepareImageFromSrc(srcToAnalyze);
        setThumbnailUrl(prepared.thumbnailDataUrl);
        setPreparedDataUrl(prepared.analysisDataUrl);
        setPreparedMime(prepared.mimeType);
        analysisDataUrl = prepared.analysisDataUrl;
        mimeType = prepared.mimeType;
      } catch (imgErr) {
        if (!analysisDataUrl) {
          throw imgErr;
        }
      }

      if (!analysisDataUrl) {
        throw new Error('تعذر تحليل البلان، عاود حاول');
      }

      const cleanNotes = (extraNotes ?? notes).trim();
      const cacheKey = hashStringKey(`${analysisDataUrl}::${cleanNotes}`);
      let data = bypassCache ? null : readPlanAnalysisCache(cacheKey);
      const fromCache = Boolean(data);

      // 2) Call Gemini Vision directly only if not already cached
      if (!data) {
        const res = await fetch('/api/analyze-plan', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            imageBase64: analysisDataUrl,
            mimeType,
            notes: cleanNotes,
          }),
        });

        const rawText = await res.text();
        const rawJson = parseApiJsonSafe<
          FloorPlanAnalysis & {success?: boolean; error?: string}
        >(rawText, 'تعذر تحليل البلان، عاود حاول');

        if (!res.ok || rawJson.success === false) {
          throw new Error(rawJson.error || 'تعذر تحليل البلان، عاود حاول');
        }
        data = rawJson;
        writePlanAnalysisCache(cacheKey, data);
      }

      const isNotBlueprint = data.isBlueprint === false;
      const assistantText = isNotBlueprint
        ? 'هادي ماشي صورة ديال البلان، عافاك صور بلان ديال الحديد باش نشرحو ليك'
        : [
            data.darijaSummary,
            data.rebarDetailsDarija ? `\n\nتفاصيل الحديد والبار والمسافات:\n${data.rebarDetailsDarija}` : '',
          ]
            .filter(Boolean)
            .join('');

      const aiMsgId = `msg_ai_${Date.now()}`;

      // 3) Render analysis text immediately (no auto-play audio; user clicks Listen when desired)
      setAnalysis(data);
      setChatMessages((prev) => [
        ...prev,
        {
          id: aiMsgId,
          role: 'assistant',
          text: assistantText,
          analysis: data,
          timestampMs: Date.now(),
        },
      ]);
      setIsAnalyzing(false);

      // 4) Update trial counter only on fresh analysis
      if (!fromCache) {
        await consumeTrial();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : 'تعذر تحليل البلان، عاود حاول'
      );
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (initialImageSrc) {
      setPreviewSrc(initialImageSrc);
      runAnalysis(initialImageSrc);
      onClearInitialImage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImageSrc]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPreviewSrc(dataUrl);
      await runAnalysis(dataUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر قراءة الصورة');
    }
  };

  const handleSendChat = async (questionText?: string) => {
    const textToSend = (questionText ?? chatInput).trim();
    if (!textToSend || isChatSending) return;

    const userMsg: PlanChatMessage = {
      id: `chat_u_${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestampMs: Date.now(),
    };

    const nextHistory = [...chatMessages, userMsg];
    setChatMessages(nextHistory);
    if (!questionText) setChatInput('');
    setIsChatSending(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/chat-plan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          imageBase64: preparedDataUrl,
          mimeType: preparedMime,
          history: nextHistory.map((m) => ({role: m.role, text: m.text})),
          message: textToSend,
        }),
      });
      const rawText = await res.text();
      const data = parseApiJsonSafe<{reply?: string; error?: string; success?: boolean}>(
        rawText,
        'تعذر الرد دابا، عاود حاول'
      );
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'تعذر الرد دابا');
      }

      const aiMsgId = `chat_ai_${Date.now()}`;
      const replyText = data.reply || '';

      setChatMessages((prev) => [
        ...prev,
        {
          id: aiMsgId,
          role: 'assistant',
          text: replyText,
          timestampMs: Date.now(),
        },
      ]);
      setIsChatSending(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'وقع خطأ في الدردشة');
      setIsChatSending(false);
    }
  };

  useEffect(() => {
    handleSendChatRef.current = handleSendChat;
  });

  const SILENCE_AUTO_SEND_MS = 1500;
  const NO_SPEECH_TIMEOUT_MS = 9500;
  const MAX_RECORDING_MS = 35000;

  const stopVadAndStreamOnly = () => {
    if (vadIntervalRef.current !== null) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      const ctx = audioContextRef.current;
      audioContextRef.current = null;
      ctx.close().catch(() => undefined);
    }
    if (mediaStreamRef.current) {
      const stream = mediaStreamRef.current;
      mediaStreamRef.current = null;
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
    }
  };

  const cleanupMicVad = (discardRecorder = false) => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (autoSendDelayTimerRef.current !== null) {
      window.clearTimeout(autoSendDelayTimerRef.current);
      autoSendDelayTimerRef.current = null;
    }
    stopVadAndStreamOnly();
    if (mediaRecorderRef.current) {
      const rec = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (discardRecorder) {
        discardRecordingRef.current = true;
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.onerror = null;
      }
      if (rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
    }
    if (recognitionRef.current) {
      const activeRec = recognitionRef.current;
      recognitionRef.current = null;
      activeRec.onresult = null;
      activeRec.onspeechend = null;
      activeRec.onerror = null;
      activeRec.onend = null;
      try {
        activeRec.stop();
      } catch {
        // ignore
      }
    }
    setIsListeningMic(false);
  };

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      cleanupMicVad(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('تعذر قراءة التسجيل الصوتي'));
        }
      };
      reader.onerror = () => reject(new Error('تعذر قراءة التسجيل الصوتي'));
      reader.readAsDataURL(blob);
    });

  const deliverTranscribedText = (spokenText: string) => {
    const cleanText = spokenText.replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      setMicVadStatus(null);
      setMicErrorMsg('ما سمعت حتى كلمة واضحة، قرب شوية للميكرو وعاود هضر بالدارجة.');
      return;
    }

    setMicErrorMsg(null);
    setChatInput(cleanText);
    setMicVadStatus(`سمعتك: "${cleanText}" — كيتصيفط دابا...`);

    if (autoSendDelayTimerRef.current !== null) {
      window.clearTimeout(autoSendDelayTimerRef.current);
    }
    autoSendDelayTimerRef.current = window.setTimeout(() => {
      autoSendDelayTimerRef.current = null;
      setMicVadStatus(null);
      setChatInput('');
      void handleSendChatRef.current(cleanText);
    }, 450);
  };

  const transcribeRecordedBlob = async (blob: Blob, mimeType: string) => {
    if (blob.size < 400) {
      setMicVadStatus(null);
      setMicErrorMsg('التسجيل قصير بزاف، عاود ضغط على الميكرو وهضر بالدارجة.');
      return;
    }

    setIsTranscribingMic(true);
    setMicErrorMsg(null);
    setMicVadStatus('سمعتك، دابا كنكتب كلامك بالدارجة...');

    try {
      const audioBase64 = await blobToDataUrl(blob);
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          audioBase64,
          mimeType: (mimeType || blob.type || 'audio/webm').split(';')[0],
        }),
      });

      const rawText = await res.text();
      const data = parseApiJsonSafe<{success?: boolean; text?: string; error?: string}>(
        rawText,
        'تعذر تحويل الصوت لكتابة، عاود حاول.'
      );

      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'تعذر تحويل الصوت لكتابة، عاود حاول.');
      }

      const transcribed = typeof data.text === 'string' ? data.text.trim() : '';
      setIsTranscribingMic(false);
      deliverTranscribedText(transcribed);
    } catch (err) {
      setIsTranscribingMic(false);
      setMicVadStatus(null);
      setMicErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : 'تعذر تحويل الصوت لكتابة، عاود جرب أو كتب سؤالك بيديك.'
      );
    }
  };

  const triggerAutoSendAfterSilence = () => {
    if (autoSentRef.current) return;
    const finalText = liveTranscriptRef.current.trim();
    autoSentRef.current = true;
    cleanupMicVad(true);
    if (finalText) {
      liveTranscriptRef.current = '';
      deliverTranscribedText(finalText);
    } else {
      setMicVadStatus(null);
    }
  };

  const scheduleSilenceAutoSend = () => {
    if (!hasSpokenRef.current || autoSentRef.current || !liveTranscriptRef.current.trim()) return;
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = window.setTimeout(() => {
      triggerAutoSendAfterSilence();
    }, SILENCE_AUTO_SEND_MS);
  };

  const startSpeechRecognitionFallback = () => {
    type SpeechRecInstance = {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      maxAlternatives?: number;
      onresult: ((ev: {results: ArrayLike<ArrayLike<{transcript?: string}>>}) => void) | null;
      onspeechend?: (() => void) | null;
      onerror: ((ev: {error?: string}) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
      abort?: () => void;
    };

    const SR =
      (window as unknown as {SpeechRecognition?: new () => SpeechRecInstance}).SpeechRecognition ||
      (window as unknown as {webkitSpeechRecognition?: new () => SpeechRecInstance})
        .webkitSpeechRecognition;

    if (!SR) {
      setMicErrorMsg('المتصفح ما كيدعمش الميكروفون التلقائي، كتب سؤالك هنا.');
      return;
    }

    liveTranscriptRef.current = '';
    hasSpokenRef.current = false;
    autoSentRef.current = false;
    manualStopRef.current = false;
    recognitionErrorHandledRef.current = false;
    setChatInput('');
    setMicVadStatus('هضر بالدارجة دابا... غير تسكت 1.5 ثانية غيتكتب ويتصيفط');

    const speechLangs = ['ar-MA', 'ar-SA', 'ar'];

    const startWithLang = (langIndex: number) => {
      const rec = new SR();
      rec.lang = speechLangs[langIndex];
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (ev) => {
        let combined = '';
        for (let i = 0; i < ev.results.length; i++) {
          const piece = ev.results[i]?.[0]?.transcript;
          if (piece) {
            combined += `${piece} `;
          }
        }
        const clean = combined.replace(/\s+/g, ' ').trim();
        if (clean) {
          hasSpokenRef.current = true;
          liveTranscriptRef.current = clean;
          setChatInput(clean);
          setMicVadStatus(`سمعتك: "${clean}" — غير تسكت 1.5ث غيتصيفط`);
          scheduleSilenceAutoSend();
        }
      };

      rec.onspeechend = () => {
        if (hasSpokenRef.current && liveTranscriptRef.current.trim()) {
          scheduleSilenceAutoSend();
        }
      };

      rec.onerror = (ev) => {
        const errCode = ev?.error || '';
        if (errCode === 'language-not-supported' && langIndex + 1 < speechLangs.length) {
          rec.onresult = null;
          rec.onspeechend = null;
          rec.onerror = null;
          rec.onend = null;
          try {
            rec.stop();
          } catch {
            // ignore
          }
          startWithLang(langIndex + 1);
          return;
        }

        if (errCode === 'aborted' && (manualStopRef.current || autoSentRef.current)) {
          return;
        }

        if (errCode === 'no-speech' && liveTranscriptRef.current.trim()) {
          scheduleSilenceAutoSend();
          return;
        }

        recognitionErrorHandledRef.current = true;
        cleanupMicVad(true);
        setMicVadStatus(null);

        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          setMicErrorMsg('المتصفح منع الميكروفون. عطيه الإذن (Allow) من القفل لي حدا رابط الموقع الفوق.');
        } else if (errCode === 'audio-capture') {
          setMicErrorMsg('ما لقيناش ميكروفون شغال فهاد الجهاز.');
        } else if (errCode === 'no-speech') {
          setMicErrorMsg('ما سمعت حتى كلمة فالميكرو، قرب شوية وعاود هضر بصوت واضح.');
        } else {
          setMicErrorMsg('وقع مشكل فالميكروفون، عاود ضغط على أيقونة الميكرو وهضر بالدارجة.');
        }
      };

      rec.onend = () => {
        if (autoSentRef.current || manualStopRef.current || recognitionErrorHandledRef.current) {
          return;
        }
        const pending = liveTranscriptRef.current.trim();
        if (pending) {
          setIsListeningMic(false);
          recognitionRef.current = null;
          setMicVadStatus(`سمعتك: "${pending}" — غادي يتصيفط بعد 1.5ث...`);
          scheduleSilenceAutoSend();
        } else {
          cleanupMicVad(true);
          setMicVadStatus(null);
          setMicErrorMsg('الميكروفون حبس قبل ما يسمع كلام واضح. عاود ضغط وهضر نيشان بالدارجة.');
        }
      };

      recognitionRef.current = rec as unknown as typeof recognitionRef.current;
      try {
        rec.start();
        setIsListeningMic(true);
      } catch {
        cleanupMicVad(true);
        setMicVadStatus(null);
        setMicErrorMsg('تعذر تشغيل الميكروفون، عاود ضغط على الزر وتأكد من إذن الميكرو.');
      }
    };

    startWithLang(0);
  };

  const toggleVoiceQuestion = async () => {
    if (isTranscribingMic) return;

    if (isListeningMic) {
      manualStopRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        stopVadAndStreamOnly();
        setIsListeningMic(false);
        setMicVadStatus('كنجمع الصوت ونكتبو...');
        try {
          mediaRecorderRef.current.stop();
        } catch {
          cleanupMicVad(true);
          setMicVadStatus(null);
        }
        return;
      }

      const pending = liveTranscriptRef.current.trim();
      cleanupMicVad(true);
      setMicVadStatus(null);
      if (pending) {
        autoSentRef.current = true;
        liveTranscriptRef.current = '';
        deliverTranscribedText(pending);
      }
      return;
    }

    // Stop AI voice cleanly before starting mic
    stop();
    setErrorMsg(null);
    setMicErrorMsg(null);

    const canRecordMedia =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined';

    if (!canRecordMedia) {
      startSpeechRecognitionFallback();
      return;
    }

    liveTranscriptRef.current = '';
    hasSpokenRef.current = false;
    autoSentRef.current = false;
    manualStopRef.current = false;
    discardRecordingRef.current = false;
    audioChunksRef.current = [];
    setChatInput('');
    setMicVadStatus('كنفتح الميكروفون...');

    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (constraintErr) {
        if (
          constraintErr instanceof DOMException &&
          (constraintErr.name === 'OverconstrainedError' ||
            constraintErr.name === 'ConstraintNotSatisfiedError')
        ) {
          stream = await navigator.mediaDevices.getUserMedia({audio: true});
        } else {
          throw constraintErr;
        }
      }
    } catch (err) {
      setMicVadStatus(null);
      const errName = err instanceof DOMException ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setMicErrorMsg('المتصفح منع الميكروفون. عطيه الإذن (Allow) من القفل لي حدا رابط الموقع الفوق.');
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setMicErrorMsg('ما لقيناش ميكروفون شغال فهاد الجهاز.');
      } else {
        setMicErrorMsg('تعذر تشغيل الميكروفون، تأكد من الإذن وعاود ضغط على الزر.');
      }
      return;
    }

    mediaStreamRef.current = stream;

    const preferredMimes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    const supportedMime =
      typeof MediaRecorder.isTypeSupported === 'function'
        ? preferredMimes.find((m) => MediaRecorder.isTypeSupported(m)) || ''
        : '';

    let recorder: MediaRecorder;
    try {
      const options: MediaRecorderOptions = {audioBitsPerSecond: 32000};
      if (supportedMime) {
        options.mimeType = supportedMime;
      }
      recorder = new MediaRecorder(stream, options);
    } catch {
      try {
        recorder = supportedMime
          ? new MediaRecorder(stream, {mimeType: supportedMime})
          : new MediaRecorder(stream);
      } catch {
        stopVadAndStreamOnly();
        startSpeechRecognitionFallback();
        return;
      }
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        audioChunksRef.current.push(ev.data);
      }
    };

    recorder.onerror = () => {
      if (discardRecordingRef.current) return;
      cleanupMicVad(true);
      setMicVadStatus(null);
      setMicErrorMsg('وقع مشكل فالتسجيل، عاود ضغط على الميكرو وهضر بالدارجة.');
    };

    recorder.onstop = () => {
      const shouldDiscard = discardRecordingRef.current;
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      mediaRecorderRef.current = null;
      stopVadAndStreamOnly();
      setIsListeningMic(false);

      if (shouldDiscard) {
        return;
      }

      if (!hasSpokenRef.current && !manualStopRef.current) {
        setMicVadStatus(null);
        setMicErrorMsg('ما سمعت حتى صوت فالميكرو، قرب شوية وعاود هضر بصوت واضح.');
        return;
      }

      const finalMime = recorder.mimeType || supportedMime || 'audio/webm';
      const audioBlob = new Blob(chunks, {type: finalMime});
      void transcribeRecordedBlob(audioBlob, finalMime);
    };

    try {
      recorder.start(250);
    } catch {
      cleanupMicVad(true);
      setMicVadStatus(null);
      setMicErrorMsg('تعذر بدء تسجيل الصوت، عاود جرب.');
      return;
    }

    setIsListeningMic(true);
    setMicVadStatus('هضر بالدارجة دابا... غير تسكت 1.5 ثانية غيتكتب ويتصيفط');

    // Web Audio RMS Voice Activity Detector (1.5s silence auto-send)
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => undefined);
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        const timeData = new Uint8Array(analyser.fftSize);
        const startedAt = Date.now();
        let lastSpeechAt = startedAt;
        let consecutiveSpeechFrames = 0;
        let noiseFloor = 0.008;

        vadIntervalRef.current = window.setInterval(() => {
          const activeRec = mediaRecorderRef.current;
          if (!activeRec || activeRec.state === 'inactive') {
            return;
          }

          analyser.getByteTimeDomainData(timeData);
          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / timeData.length);
          const now = Date.now();

          if (!hasSpokenRef.current && rms < 0.035) {
            noiseFloor = noiseFloor * 0.85 + rms * 0.15;
          }

          const startThreshold = Math.max(0.015, Math.min(0.05, noiseFloor * 2.4));
          const holdThreshold = Math.max(0.011, startThreshold * 0.72);
          const activeThreshold = hasSpokenRef.current ? holdThreshold : startThreshold;

          if (rms >= activeThreshold) {
            consecutiveSpeechFrames += 1;
            lastSpeechAt = now;
            if (!hasSpokenRef.current && consecutiveSpeechFrames >= 2) {
              hasSpokenRef.current = true;
              setMicVadStatus('كنسمعك... غير تسكت 1.5 ثانية غيتكتب ويتصيفط');
            }
          } else {
            consecutiveSpeechFrames = 0;
          }

          if (hasSpokenRef.current && now - lastSpeechAt >= SILENCE_AUTO_SEND_MS) {
            if (vadIntervalRef.current !== null) {
              window.clearInterval(vadIntervalRef.current);
              vadIntervalRef.current = null;
            }
            activeRec.stop();
            return;
          }

          if (!hasSpokenRef.current && now - startedAt >= NO_SPEECH_TIMEOUT_MS) {
            discardRecordingRef.current = true;
            cleanupMicVad(true);
            setMicVadStatus(null);
            setMicErrorMsg('ما سمعت حتى صوت فالميكرو، قرب شوية وعاود هضر بصوت واضح.');
            return;
          }

          if (now - startedAt >= MAX_RECORDING_MS) {
            if (vadIntervalRef.current !== null) {
              window.clearInterval(vadIntervalRef.current);
              vadIntervalRef.current = null;
            }
            activeRec.stop();
          }
        }, 60);
      }
    } catch {
      // If AudioContext fails on a device, user can still tap mic again to stop & transcribe
    }
  };

  const handleSave = async () => {
    if (!analysis || analysis.isBlueprint === false) return;
    setIsSaving(true);
    try {
      await onSavePlan(analysis, thumbnailUrl);
      setSavedDone(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'وقع خطأ أثناء حفظ البلان');
    } finally {
      setIsSaving(false);
    }
  };

  const fullRoomsSpeech = analysis?.rooms
    .map((r) => `${r.name} مساحتها ${r.areaSqm}، ${r.notesDarija}`)
    .join('. ');

  const fullMaterialsSpeech = analysis?.materials
    .map((m) => `${m.item}: ${m.quantityEstimate} ${m.unit}، ${m.notesDarija}`)
    .join('. ');

  const fullPhasesSpeech = analysis?.workPhases
    .map((p) => `المرحلة ${p.stepNumber}: ${p.phaseName}، المدة ${p.durationEstimate}. ${p.explanationDarija}`)
    .join('. ');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#11182c] px-4 py-2 text-sm font-bold text-white hover:bg-[#16203a]"
        >
          <ArrowRight className="w-4 h-4 text-[#ff7a1a]" />
          <span>رجوع</span>
        </button>

        <div className="flex items-center gap-2">
          <VoiceGenderSwitch useCloudTts />
          <SpeakButton
            useCloudTts
            id="analyze-page-intro"
            variant="ghost"
            label="سمع الشرح"
            text="صور البلان ولا اختار صورة من الهاتف. التطبيق كيقرا النص كامل أوتوماتيكياً، وكيفتح ليك دردشة مباشرة بالدارجة المغربية الصافية باش تسول على الحديد، البار، المسافات، والمواد."
          />
        </div>
      </div>

      {/* Per-Code Counter Banner */}
      <TrialBanner />

      {/* Camera & Upload Bar */}
      <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white">
              قراءة البلان والدردشة الذكية بالدارجة
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              تحليل مباشر فثواني بالذكاء الاصطناعي + دردشة تفاعلية بالدارجة 100%
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onOpenCamera}
            className="min-h-[52px] rounded-xl bg-[#ff7a1a] hover:bg-[#ff8d3b] text-[#0a0f1e] font-extrabold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-[#ff7a1a]/15 active:scale-[0.98] transition-transform"
          >
            <Camera className="w-5 h-5" />
            <span>صور البلان بالكاميرا</span>
          </button>

          <label className="min-h-[52px] cursor-pointer rounded-xl border border-white/15 bg-[#16203a] hover:bg-[#1e2b4d] text-white font-bold text-base flex items-center justify-center gap-2.5 transition-colors">
            <Upload className="w-5 h-5 text-[#ff7a1a]" />
            <span>ارفع صورة البلان</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظة قبل التحليل (مثلا: هادا بلان السواري والضالة، شحال خاصني ديال الحديد؟)"
            className="flex-1 min-h-[44px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#ff7a1a]"
          />
          {previewSrc && (
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => runAnalysis(previewSrc, notes, true)}
              className="min-h-[44px] rounded-xl border border-[#ff7a1a]/40 bg-[#ff7a1a]/15 hover:bg-[#ff7a1a] hover:text-[#0a0f1e] text-[#ff7a1a] px-5 py-2 text-sm font-bold whitespace-nowrap transition-colors disabled:opacity-50"
            >
              {isAnalyzing ? 'جاري التحليل...' : 'عاود قرا وحلل البلان'}
            </button>
          )}
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 flex items-start gap-3 text-red-200">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm leading-relaxed">{errorMsg}</div>
          <SpeakButton
            useCloudTts
            id="analyze-err-voice"
            compact
            variant="ghost"
            text={errorMsg}
          />
        </div>
      )}

      {/* DEDICATED CHAT UI ("صفحة دردشة خاصة") */}
      {chatMessages.length > 0 && (
        <section className="rounded-2xl border border-[#ff7a1a]/30 bg-[#11182c] overflow-hidden flex flex-col">
          {/* Chat Header */}
          <div className="px-5 py-4 border-b border-white/10 bg-[#0d1426] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-white">
                  دردشة المعلم الذكي — شرح البلان بالدارجة
                </h2>
                <p className="text-xs text-slate-400">
                  {isAnalyzing
                    ? 'المعلم الذكي كيشوف صورة البلان وكيخرج التفاصيل...'
                    : 'سول على فين كاين الحديد، البار، المسافات، أو المواد'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {previewSrc && (
                <button
                  type="button"
                  onClick={() => onOpenInAnnotator(previewSrc)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-3 text-xs font-bold text-slate-200"
                >
                  <Pencil className="w-3.5 h-3.5 text-[#ff7a1a]" />
                  <span>رسم على البلان</span>
                </button>
              )}
            </div>
          </div>

          {/* Chat Message Stream */}
          <div className="p-4 sm:p-5 space-y-4 max-h-[600px] overflow-y-auto bg-[#0a0f1e]/60">
            {chatMessages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 ${isUser ? 'flex-row' : 'flex-row-reverse'}`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isUser
                        ? 'bg-white/10 text-white'
                        : 'bg-[#ff7a1a]/20 border border-[#ff7a1a]/40 text-[#ff7a1a]'
                    }`}
                  >
                    {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl p-4 space-y-3 ${
                      isUser
                        ? 'bg-[#16203a] border border-white/10 text-white'
                        : 'bg-[#11182c] border border-[#ff7a1a]/30 text-slate-100'
                    }`}
                  >
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt="صورة البلان المرسلة"
                        referrerPolicy="no-referrer"
                        className="w-full max-w-xs max-h-56 object-contain rounded-xl bg-black border border-white/10"
                      />
                    )}

                    <p className="text-sm sm:text-base leading-relaxed whitespace-pre-line">
                      {msg.text}
                    </p>

                    {!isUser && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
                        <SpeakButton
                          useCloudTts
                          id={msg.id}
                          variant="primary"
                          compact={false}
                          label="سمع بالدارجة"
                          text={msg.analysis?.audioScript || msg.text}
                        />
                        {msg.analysis && msg.analysis.isBlueprint !== false && (
                          <button
                            type="button"
                            disabled={isSaving || savedDone}
                            onClick={handleSave}
                            className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-extrabold ${
                              savedDone
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                          >
                            {savedDone ? (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                <span>تحفظ فالمشاريع</span>
                              </>
                            ) : (
                              <>
                                <BookmarkCheck className="w-4 h-4 text-[#ff7a1a]" />
                                <span>حفظ التحليل</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {(isAnalyzing || isChatSending) && (
              <div className="flex items-center gap-3 flex-row-reverse">
                <div className="w-9 h-9 rounded-xl bg-[#ff7a1a]/20 border border-[#ff7a1a]/40 text-[#ff7a1a] flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
                <div className="rounded-2xl bg-[#11182c] border border-[#ff7a1a]/25 px-4 py-3 text-sm text-slate-200">
                  {isAnalyzing
                    ? 'المعلم الذكي كيقرا البلان وكيفصل الحديد والغرف بالدارجة...'
                    : 'المعلم الذكي كيكتب ليك الجواب بالدارجة...'}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Quick Darija Follow-up Chips */}
          {analysis && analysis.isBlueprint !== false && (
            <div className="px-4 py-2.5 border-t border-white/10 bg-[#0d1426] flex flex-wrap gap-2">
              {QUICK_DARIJA_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isChatSending || isAnalyzing}
                  onClick={() => handleSendChat(q)}
                  className="min-h-[34px] rounded-xl border border-[#ff7a1a]/30 bg-[#ff7a1a]/10 hover:bg-[#ff7a1a] hover:text-[#0a0f1e] text-[#ff7a1a] px-3 py-1 text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Live Voice Activity Detection status banner */}
          {micVadStatus && (
            <div className="px-4 py-2 border-t border-red-500/30 bg-red-950/35 text-xs font-bold text-red-200 flex items-center gap-2">
              {isTranscribingMic ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff7a1a] shrink-0" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
              )}
              <span>{micVadStatus}</span>
            </div>
          )}

          {micErrorMsg && (
            <div className="px-4 py-2 border-t border-amber-500/35 bg-amber-950/35 text-xs font-bold text-amber-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{micErrorMsg}</span>
            </div>
          )}

          {/* Chat Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendChat();
            }}
            className="p-3 sm:p-4 border-t border-white/10 bg-[#11182c] flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleVoiceQuestion}
              disabled={isTranscribingMic || isChatSending || isAnalyzing}
              aria-label={isListeningMic ? 'حبس الميكرو وصيفط' : 'سول بالصوت (إرسال تلقائي بعد 1.5ث سكوت)'}
              className={`min-h-[46px] min-w-[46px] rounded-xl flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 ${
                isListeningMic
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'border border-white/15 bg-[#0a0f1e] text-[#ff7a1a] hover:border-[#ff7a1a]'
              }`}
            >
              {isTranscribingMic ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isListeningMic ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>

            <input
              type="text"
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value);
                if (micErrorMsg) setMicErrorMsg(null);
              }}
              placeholder="هضر بالميكرو ولا كتب سؤالك على البلان بالدارجة..."
              className="flex-1 min-h-[46px] rounded-xl border border-white/15 bg-[#0a0f1e] px-4 text-sm text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
            />

            <button
              type="submit"
              disabled={!chatInput.trim() || isChatSending || isAnalyzing}
              className="min-h-[46px] px-4 sm:px-5 rounded-xl bg-[#ff7a1a] hover:bg-[#ff8d3b] text-[#0a0f1e] font-extrabold text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">صيفط</span>
            </button>
          </form>
        </section>
      )}

      {/* Detailed Structured Blueprint Cards (shown when valid blueprint) */}
      {analysis && analysis.isBlueprint !== false && (
        <motion.div
          initial={{opacity: 0, y: 10}}
          animate={{opacity: 1, y: 0}}
          className="space-y-5"
        >
          <button
            type="button"
            onClick={() => setShowFullDetails((v) => !v)}
            className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#11182c] px-5 py-3 flex items-center justify-between text-sm font-bold text-white"
          >
            <span>التفاصيل الكاملة للبلان (الغرف، الحديد، المواد ومراحل العمل)</span>
            {showFullDetails ? (
              <ChevronUp className="w-4 h-4 text-[#ff7a1a]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#ff7a1a]" />
            )}
          </button>

          {showFullDetails && (
            <div className="space-y-5">
              {/* Summary Metrics */}
              <div className="rounded-2xl border border-white/10 bg-[#11182c] p-5 grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-400">نوع البناء</p>
                  <p className="text-sm sm:text-base font-bold text-white mt-1">
                    {analysis.buildingType}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">المساحة التقديرية</p>
                  <p className="text-sm sm:text-base font-bold text-[#ff7a1a] font-mono-nums mt-1">
                    {analysis.totalAreaSqm}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">عدد الغرف</p>
                  <p className="text-sm sm:text-base font-bold text-white font-mono-nums mt-1">
                    {analysis.roomsCount} غرف
                  </p>
                </div>
              </div>

              {/* Rooms */}
              {analysis.rooms?.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Layers className="w-5 h-5 text-[#ff7a1a]" />
                      <h3 className="text-lg font-bold text-white">تفاصيل الغرف والمساحات</h3>
                    </div>
                    <SpeakButton
                      useCloudTts
                      id="plan-rooms-all"
                      variant="secondary"
                      label="سمع الغرف"
                      text={fullRoomsSpeech || 'تفاصيل الغرف'}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {analysis.rooms.map((room, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4 flex flex-col justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-bold text-white text-base">{room.name}</h4>
                            <span className="font-mono-nums text-xs font-semibold text-[#ff7a1a]">
                              {room.areaSqm}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                            {room.notesDarija}
                          </p>
                        </div>
                        <SpeakButton
                          useCloudTts
                          id={`room-${idx}`}
                          compact
                          variant="ghost"
                          text={`${room.name}، المساحة ${room.areaSqm}. ${room.notesDarija}`}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Materials */}
              {analysis.materials?.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Package className="w-5 h-5 text-[#ff7a1a]" />
                      <h3 className="text-lg font-bold text-white">المواد المطلوبة التقديرية</h3>
                    </div>
                    <SpeakButton
                      useCloudTts
                      id="plan-materials-all"
                      variant="secondary"
                      label="سمع المواد"
                      text={fullMaterialsSpeech || 'قائمة المواد'}
                    />
                  </div>
                  <div className="divide-y divide-white/10">
                    {analysis.materials.map((mat, idx) => (
                      <div
                        key={idx}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{mat.item}</span>
                            <span className="text-xs text-slate-400">·</span>
                            <span className="font-mono-nums text-sm font-bold text-[#ff7a1a]">
                              {mat.quantityEstimate} {mat.unit}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{mat.notesDarija}</p>
                        </div>
                        <SpeakButton
                          useCloudTts
                          id={`mat-${idx}`}
                          compact
                          variant="ghost"
                          text={`${mat.item}: تقريباً ${mat.quantityEstimate} ${mat.unit}. ${mat.notesDarija}`}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Work Phases */}
              {analysis.workPhases?.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Hammer className="w-5 h-5 text-[#ff7a1a]" />
                      <h3 className="text-lg font-bold text-white">مراحل العمل بالترتيب</h3>
                    </div>
                    <SpeakButton
                      useCloudTts
                      id="plan-phases-all"
                      variant="secondary"
                      label="سمع المراحل بالترتيب"
                      text={fullPhasesSpeech || 'مراحل العمل'}
                    />
                  </div>

                  <div className="space-y-3">
                    {analysis.workPhases.map((phase, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono-nums text-xs font-bold text-[#0a0f1e] bg-[#ff7a1a] px-2.5 py-0.5 rounded-md">
                              المرحلة {phase.stepNumber}
                            </span>
                            <h4 className="font-bold text-white text-base">{phase.phaseName}</h4>
                            <span className="text-xs text-slate-400">
                              · المدة: {phase.durationEstimate}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 leading-relaxed">
                            {phase.explanationDarija}
                          </p>
                        </div>
                        <SpeakButton
                          useCloudTts
                          id={`phase-${idx}`}
                          compact
                          variant="ghost"
                          text={`المرحلة ${phase.stepNumber}: ${phase.phaseName}. المدة التقريبية ${phase.durationEstimate}. ${phase.explanationDarija}`}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};
