import React, {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  CheckCircle2,
  Compass,
  Download,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {SpeakButton} from '../../contexts/SpeechContext';
import {drawDetectedLinesOnOverlay} from '../../lib/lineEdgeOverlay';
import type {ToolId, VoiceNoteItem} from '../../types';

interface FieldToolsProps {
  toolId: Extract<ToolId, 'level' | 'compass' | 'camera-measure' | 'voice-ideas' | 'draw' | 'qr'>;
  initialDrawImage?: string | null;
  voiceNotes: VoiceNoteItem[];
  onSaveVoiceNote: (title: string, rawTranscript: string, structuredDarija: string) => Promise<void>;
  onDeleteVoiceNote: (id: string) => Promise<void>;
}

export const FieldToolsSuite: React.FC<FieldToolsProps> = ({
  toolId,
  initialDrawImage,
  voiceNotes,
  onSaveVoiceNote,
  onDeleteVoiceNote,
}) => {

  // --- 7. Spirit Level ---
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);
  const [sensorActive, setSensorActive] = useState(false);

  useEffect(() => {
    if (toolId !== 'level') return;
    const handler = (e: DeviceOrientationEvent) => {
      if (e.gamma !== null && e.beta !== null) {
        setSensorActive(true);
        setTiltX(Math.max(-45, Math.min(45, Number(e.gamma.toFixed(1)))));
        setTiltY(Math.max(-45, Math.min(45, Number(e.beta.toFixed(1)))));
      }
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [toolId]);

  const requestIOSSensor = async () => {
    const devOrient = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof devOrient?.requestPermission === 'function') {
      try {
        const res = await devOrient.requestPermission();
        if (res === 'granted') setSensorActive(true);
      } catch {
        // fallback to manual slider
      }
    }
  };

  // --- 8. Compass ---
  const [heading, setHeading] = useState(93);
  const [compassLive, setCompassLive] = useState(false);

  useEffect(() => {
    if (toolId !== 'compass') return;
    const handler = (e: DeviceOrientationEvent) => {
      const webkitHeading = (e as unknown as {webkitCompassHeading?: number}).webkitCompassHeading;
      if (typeof webkitHeading === 'number') {
        setCompassLive(true);
        setHeading(Math.round(webkitHeading));
      } else if (e.alpha !== null) {
        setCompassLive(true);
        setHeading(Math.round((360 - e.alpha) % 360));
      }
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [toolId]);

  // --- 9. Camera Measure (with live getUserMedia + Line Detection) ---
  const [measureImg, setMeasureImg] = useState<string>(
    '/src/assets/images/sample_appart_plan_1795110541026.jpg'
  );
  const [measureCamOn, setMeasureCamOn] = useState(false);
  const [measureCamError, setMeasureCamError] = useState<string | null>(null);
  const [refMeters, setRefMeters] = useState('1.0');
  const [points, setPoints] = useState<{x: number; y: number}[]>([]);
  const measureImgRef = useRef<HTMLImageElement | null>(null);
  const measureVideoRef = useRef<HTMLVideoElement | null>(null);
  const measureOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const measureWorkRef = useRef<HTMLCanvasElement | null>(null);
  const measureStreamRef = useRef<MediaStream | null>(null);

  const startMeasureCamera = async () => {
    setMeasureCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMeasureCamError('المتصفح ما كيدعمش الكاميرا المباشرة.');
      setMeasureCamOn(false);
      return;
    }
    try {
      if (measureStreamRef.current) {
        measureStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}},
        audio: false,
      });
      measureStreamRef.current = s;
      setMeasureCamOn(true);
      if (measureVideoRef.current) {
        measureVideoRef.current.srcObject = s;
        await measureVideoRef.current.play().catch(() => undefined);
      }
    } catch {
      setMeasureCamOn(false);
      setMeasureCamError('عافاك عطى إذن الكاميرا باش يخدم المتر المباشر.');
    }
  };

  useEffect(() => {
    if (toolId !== 'camera-measure' || !measureCamOn) {
      if (measureStreamRef.current) {
        measureStreamRef.current.getTracks().forEach((t) => t.stop());
        measureStreamRef.current = null;
      }
      return;
    }
    startMeasureCamera();
    if (!measureWorkRef.current) {
      measureWorkRef.current = document.createElement('canvas');
    }
    const timer = window.setInterval(() => {
      if (measureVideoRef.current && measureOverlayRef.current && measureWorkRef.current) {
        drawDetectedLinesOnOverlay(
          measureVideoRef.current,
          measureOverlayRef.current,
          measureWorkRef.current
        );
      }
    }, 120);
    return () => {
      window.clearInterval(timer);
      if (measureStreamRef.current) {
        measureStreamRef.current.getTracks().forEach((t) => t.stop());
        measureStreamRef.current = null;
      }
    };
  }, [measureCamOn, toolId]);

  // --- 10. Voice Ideas ---
  const [rawIdea, setRawIdea] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const recognitionRef = useRef<unknown>(null);

  // --- 11. Draw on Image ---
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawBgSrc, setDrawBgSrc] = useState<string>(
    initialDrawImage || '/src/assets/images/sample_villa_plan_1795110540429.jpg'
  );
  const [drawColor, setDrawColor] = useState('#ff7a1a');
  const [drawWidth, setDrawWidth] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawHistory, setDrawHistory] = useState<ImageData[]>([]);

  useEffect(() => {
    if (initialDrawImage) setDrawBgSrc(initialDrawImage);
  }, [initialDrawImage]);

  useEffect(() => {
    if (toolId !== 'draw') return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxW = 900;
      const scale = Math.min(1, maxW / (img.naturalWidth || 800));
      canvas.width = Math.round((img.naturalWidth || 800) * scale);
      canvas.height = Math.round((img.naturalHeight || 600) * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setDrawHistory([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    };
    img.src = drawBgSrc;
  }, [drawBgSrc, toolId]);

  // --- 12. QR Generator ---
  const [qrTitle, setQrTitle] = useState('ورشة فيلا النخيل - المعلم رشيد');
  const [qrDetails, setQrDetails] = useState('مشروع بناء R+1 · الدار البيضاء · هاتف: 0600000000');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (toolId !== 'qr') return;
    const payload = `${qrTitle}\n${qrDetails}`.trim() || 'Fahem Blan';
    QRCode.toDataURL(payload, {
      width: 320,
      margin: 2,
      color: {dark: '#0a0f1e', light: '#ffffff'},
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [qrDetails, qrTitle, toolId]);

  // ========== RENDER BY TOOL ID ==========

  if (toolId === 'level') {
    const isLevel = Math.abs(tiltX) <= 1.2 && Math.abs(tiltY) <= 1.2;
    const bubbleX = Math.max(-42, Math.min(42, tiltX * 2));
    const bubbleY = Math.max(-42, Math.min(42, tiltY * 2));

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">الميزان (ميزان الما الرقمي)</h2>
            <p className="text-sm text-slate-400">
              حط التليفون فوق الحيط ولا الفورمة باش تشوف واش مقادة 100%
            </p>
          </div>
          <SpeakButton
            id="tool-level-voice"
            variant="primary"
            label="سمع النتيجة بالدارجة"
            text={
              isLevel
                ? 'مقاد ناضي! الميزان فـ الصفر والسطح مستوي مزيان.'
                : `كاين ميلان خفيف ديال ${Math.abs(tiltX).toFixed(1)} درجة، عاود قد السطح حتى توصل الفقاعة للوسط.`
            }
          />
        </div>

        <div className="flex flex-col items-center gap-6 py-4">
          <div className="relative w-56 h-56 rounded-full border-4 border-white/15 bg-[#0a0f1e] flex items-center justify-center shadow-inner">
            <div className="absolute inset-8 rounded-full border border-dashed border-white/15" />
            <div className="w-12 h-12 rounded-full border-2 border-[#ff7a1a]/60" />
            <div
              style={{transform: `translate(${bubbleX}px, ${bubbleY}px)`}}
              className={`w-10 h-10 rounded-full transition-transform duration-75 shadow-lg ${
                isLevel ? 'bg-emerald-400' : 'bg-[#ff7a1a]'
              }`}
            />
          </div>

          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-xs text-slate-400">الميلان الأفقي (X)</p>
              <p className="text-2xl font-extrabold font-mono-nums text-white mt-1">{tiltX}°</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">الحالة</p>
              <p className={`text-lg font-extrabold mt-1 ${isLevel ? 'text-emerald-400' : 'text-[#ff7a1a]'}`}>
                {isLevel ? 'مقاد ناضي' : 'مائل'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">الميلان العمودي (Y)</p>
              <p className="text-2xl font-extrabold font-mono-nums text-white mt-1">{tiltY}°</p>
            </div>
          </div>

          {!sensorActive && (
            <div className="w-full max-w-md space-y-3 rounded-xl border border-white/10 bg-[#0a0f1e] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">تجربة يدوية (الحاسوب بلا مستشعر):</span>
                <button
                  type="button"
                  onClick={requestIOSSensor}
                  className="text-xs font-bold text-[#ff7a1a] hover:underline"
                >
                  تفعيل مستشعر الهاتف
                </button>
              </div>
              <input
                type="range"
                min="-20"
                max="20"
                step="0.5"
                value={tiltX}
                onChange={(e) => setTiltX(parseFloat(e.target.value))}
                className="w-full accent-[#ff7a1a]"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (toolId === 'compass') {
    const dirLabel =
      heading >= 337 || heading < 23
        ? 'الشمال (N)'
        : heading < 68
          ? 'الشمال الشرقي (NE)'
          : heading < 113
            ? 'الشرق — شمس الصباح وجهة القبلة'
            : heading < 158
              ? 'الجنوب الشرقي (SE)'
              : heading < 203
                ? 'الجنوب (S) — مشمش النهار كامل'
                : heading < 248
                  ? 'الجنوب الغربي (SW)'
                  : heading < 293
                    ? 'الغرب (W) — شمس العشية'
                    : 'الشمال الغربي (NW)';

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">بوصلة الشانطي والقبلة والشمس</h2>
            <p className="text-sm text-slate-400">عرف واجهة الدار والقبلة واتجاه الشمس قبل ما تحط الفاصاد</p>
          </div>
          <SpeakButton
            id="tool-compass-voice"
            variant="primary"
            label="سمع الاتجاه بالدارجة"
            text={`الاتجاه دابا هو ${heading} درجة، يعني ${dirLabel}. فالمغرب القبلة تقريباً فـ تلاتة وتسعين درجة شرق، والواجهة اللي كتشوف للجنوب الشرقي كتدخل ليها شمس الصباح مزيان.`}
          />
        </div>

        <div className="flex flex-col items-center gap-6 py-4">
          <div className="relative w-56 h-56 rounded-full border-4 border-white/15 bg-[#0a0f1e] flex items-center justify-center">
            <span className="absolute top-2 text-xs font-bold text-[#ff7a1a]">N</span>
            <span className="absolute bottom-2 text-xs font-bold text-slate-400">S</span>
            <span className="absolute right-3 text-xs font-bold text-slate-400">E</span>
            <span className="absolute left-3 text-xs font-bold text-slate-400">W</span>
            <div
              style={{transform: `rotate(${heading}deg)`}}
              className="w-24 h-24 flex items-center justify-center transition-transform duration-150"
            >
              <Compass className="w-16 h-16 text-[#ff7a1a]" />
            </div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-3xl font-extrabold font-mono-nums text-white">{heading}°</p>
            <p className="text-base font-bold text-[#ff7a1a]">{dirLabel}</p>
            <p className="text-xs text-slate-400">اتجاه القبلة فالمغرب: ~93° شرق</p>
          </div>

          {!compassLive && (
            <div className="w-full max-w-md space-y-2 rounded-xl border border-white/10 bg-[#0a0f1e] p-4">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>تدوير البوصلة يدوياً (إلى ما كانش مستشعر):</span>
                <button type="button" onClick={requestIOSSensor} className="text-[#ff7a1a] font-bold">
                  تفعيل البوصلة
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="359"
                value={heading}
                onChange={(e) => setHeading(parseInt(e.target.value, 10))}
                className="w-full accent-[#ff7a1a]"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (toolId === 'camera-measure') {
    const dist = (a: {x: number; y: number}, b: {x: number; y: number}) =>
      Math.hypot(b.x - a.x, b.y - a.y);

    const refPx = points.length >= 2 ? dist(points[0], points[1]) : 0;
    const targetPx = points.length >= 4 ? dist(points[2], points[3]) : 0;
    const knownM = Math.max(0.05, parseFloat(refMeters) || 1);
    const measuredMeters = refPx > 0 && targetPx > 0 ? (targetPx / refPx) * knownM : null;

    const handleMeasureClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setPoints((prev) => (prev.length >= 4 ? [{x, y}] : [...prev, {x, y}]));
    };

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        if (typeof r.result === 'string') {
          setMeasureImg(r.result);
          setPoints([]);
        }
      };
      r.readAsDataURL(file);
    };

    const stepPrompt =
      points.length < 2
        ? '1. ورك على جوج نقط ديال قياس معروف (مثلا عرض باب = 1 متر)'
        : points.length < 4
          ? '2. دابا ورك على جوج نقط ديال المسافة اللي باغي تعبرها'
          : `القياس التقريبي هو ${measuredMeters?.toFixed(2)} متر`;

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">القياس بالكاميرا والصورة</h2>
            <p className="text-sm text-slate-400">علم على مسافة معروفة ومن بعد عبر أي حيط ولا بلان</p>
          </div>
          <SpeakButton
            id="tool-measure-voice"
            variant="primary"
            label="سمع الشرح والنتيجة"
            text={
              measuredMeters
                ? `القياس اللي عبرتي كيساوي تقريباً ${measuredMeters.toFixed(2)} متر.`
                : 'صور الحيط أو البلان، علم على جوج نقط كتعرف الطول ديالهم بحال باب فيه متر، ومن بعد علم على البلاصة اللي باغي تعبرها.'
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (measureCamOn) setMeasureCamOn(false);
              else startMeasureCamera();
            }}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-4 py-2 text-sm font-extrabold"
          >
            <Camera className="w-4 h-4" />
            <span>{measureCamOn ? 'حبس الكاميرا' : 'شعل الكاميرا مع كشف الخط'}</span>
          </button>

          {measureCamOn && (
            <button
              type="button"
              onClick={() => {
                const v = measureVideoRef.current;
                if (!v) return;
                const c = document.createElement('canvas');
                c.width = v.videoWidth || 1280;
                c.height = v.videoHeight || 720;
                const ctx = c.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(v, 0, 0, c.width, c.height);
                setMeasureImg(c.toDataURL('image/jpeg', 0.9));
                setMeasureCamOn(false);
                setPoints([]);
              }}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-500 text-[#0a0f1e] px-4 py-2 text-sm font-extrabold"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>التقط للقياس</span>
            </button>
          )}

          <label className="min-h-[44px] cursor-pointer inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0a0f1e] text-white px-4 py-2 text-sm font-bold">
            <Upload className="w-4 h-4 text-[#ff7a1a]" />
            <span>اختار صورة</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span>الطول المرجعي (متر):</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={refMeters}
              onChange={(e) => setRefMeters(e.target.value)}
              className="w-20 min-h-[40px] rounded-lg border border-white/15 bg-[#0a0f1e] px-2.5 text-white font-mono-nums"
            />
          </label>

          <button
            type="button"
            onClick={() => setPoints([])}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            <RotateCcw className="w-4 h-4" />
            <span>مسح النقط</span>
          </button>
        </div>

        {measureCamError && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
            {measureCamError}
          </div>
        )}

        <div className="rounded-xl border border-[#ff7a1a]/30 bg-[#0a0f1e] px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-bold text-[#ff7a1a]">{stepPrompt}</span>
          {measuredMeters !== null && (
            <span className="text-xl font-extrabold font-mono-nums text-white">
              {measuredMeters.toFixed(2)} م
            </span>
          )}
        </div>

        <div
          onClick={measureCamOn ? undefined : handleMeasureClick}
          className="relative w-full rounded-2xl overflow-hidden border border-white/15 bg-black cursor-crosshair select-none"
        >
          {measureCamOn ? (
            <div className="relative w-full h-80 sm:h-96">
              <video ref={measureVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <canvas
                ref={measureOverlayRef}
                className="pointer-events-none absolute inset-0 w-full h-full object-cover"
              />
            </div>
          ) : (
            <img
              ref={measureImgRef}
              src={measureImg}
              alt="صورة للقياس"
              referrerPolicy="no-referrer"
              className="w-full max-h-[420px] object-contain mx-auto pointer-events-none"
            />
          )}
          {!measureCamOn && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {points.length >= 2 && (
                <line
                  x1={points[0].x}
                  y1={points[0].y}
                  x2={points[1].x}
                  y2={points[1].y}
                  stroke="#38bdf8"
                  strokeWidth="0.7"
                />
              )}
              {points.length >= 4 && (
                <line
                  x1={points[2].x}
                  y1={points[2].y}
                  x2={points[3].x}
                  y2={points[3].y}
                  stroke="#ff7a1a"
                  strokeWidth="0.8"
                />
              )}
              {points.map((pt, i) => (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r="1.4"
                  fill={i < 2 ? '#38bdf8' : '#ff7a1a'}
                  stroke="#0a0f1e"
                  strokeWidth="0.4"
                />
              ))}
            </svg>
          )}
        </div>
      </div>
    );
  }

  if (toolId === 'voice-ideas') {
    const startSpeechRec = () => {
      const SR =
        (window as unknown as {SpeechRecognition?: new () => unknown}).SpeechRecognition ||
        (window as unknown as {webkitSpeechRecognition?: new () => unknown}).webkitSpeechRecognition;

      if (!SR) {
        setIdeaError('المتصفح ما كيدعمش التسجيل الصوتي التلقائي، تقدر تكتب الفكرة ديالك هنا لتحت.');
        return;
      }

      if (isRecording && recognitionRef.current) {
        (recognitionRef.current as {stop: () => void}).stop();
        setIsRecording(false);
        return;
      }

      setIdeaError(null);
      const rec = new SR() as {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onresult: (ev: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      rec.lang = 'ar-MA';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        let text = '';
        for (let i = 0; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript + ' ';
        }
        setRawIdea((prev) => `${prev} ${text}`.trim());
      };
      rec.onerror = () => {
        setIsRecording(false);
        setIdeaError('تأكد من السماح للميكروفون ولا اكتب الفكرة مباشرة.');
      };
      rec.onend = () => setIsRecording(false);
      recognitionRef.current = rec;
      rec.start();
      setIsRecording(true);
    };

    const handleOrganizeAndSave = async () => {
      if (!rawIdea.trim()) return;
      setIsOrganizing(true);
      setIdeaError(null);
      try {
        const res = await fetch('/api/voice-idea-summary', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({rawIdea}),
        });
        const rawText = await res.text();
        let data: {title?: string; structuredDarija?: string; error?: string; success?: boolean};
        try {
          data = JSON.parse(rawText) as {
            title?: string;
            structuredDarija?: string;
            error?: string;
            success?: boolean;
          };
        } catch {
          throw new Error('تعذر تنظيم الفكرة، عاود حاول');
        }
        if (!res.ok || data.success === false) throw new Error(data.error || 'تعذر تنظيم الفكرة');
        const title = data.title || 'ملاحظة من الشانطي';
        const structured = data.structuredDarija || rawIdea;
        await onSaveVoiceNote(title, rawIdea, structured);
        setRawIdea('');
        setIsOrganizing(false);
      } catch (err) {
        setIdeaError(err instanceof Error ? err.message : 'وقع خطأ فـ حفظ الفكرة');
        setIsOrganizing(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">أفكار وملاحظات صوتية للشانطي</h2>
            <p className="text-sm text-slate-400">سجل بالصوت أي تعديل ولا طلب ديال السلعة والذكاء كيرتبو ليك</p>
          </div>
          <SpeakButton
            id="tool-voice-ideas-intro"
            variant="secondary"
            label="كيفاش كتخدم؟"
            text="ورك على زر الميكروفون وهضر بالدارجة على أي حاجة خاصها فالشانطي، بحال خاصنا عشرين خنشة سيما غدا ولا نبدلو بلاصة الباب، والتطبيق غادي يرتبها ويحفظها ليك."
          />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startSpeechRec}
              className={`min-h-[48px] inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-extrabold transition-colors ${
                isRecording
                  ? 'bg-red-500 text-white'
                  : 'bg-[#ff7a1a] text-[#0a0f1e] hover:bg-[#ff8d3b]'
              }`}
            >
              {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span>{isRecording ? 'حبس التسجيل' : 'هضر وسجل بالصوت'}</span>
            </button>
          </div>

          <textarea
            rows={4}
            value={rawIdea}
            onChange={(e) => setRawIdea(e.target.value)}
            placeholder="مثال: غدا خاصنا نوصيو على 30 خنشة ديال السيما و 2 بوطات ديال البريك 8 تقابي للكوزينة..."
            className="w-full rounded-xl border border-white/10 bg-[#0a0f1e] p-4 text-sm text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
          />

          {ideaError && <p className="text-xs text-amber-300">{ideaError}</p>}

          <button
            type="button"
            disabled={!rawIdea.trim() || isOrganizing}
            onClick={handleOrganizeAndSave}
            className="min-h-[48px] w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-white text-[#0a0f1e] hover:bg-slate-200 px-6 py-3 text-sm font-extrabold disabled:opacity-50"
          >
            {isOrganizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{isOrganizing ? 'جاري الترتيب والحفظ...' : 'رتب بالدارجة واحفظ'}</span>
          </button>
        </div>

        {voiceNotes.length > 0 && (
          <div className="space-y-3 border-t border-white/10 pt-5">
            <h3 className="text-base font-bold text-white">الأفكار المحفوظة ({voiceNotes.length})</h3>
            <div className="space-y-3">
              {voiceNotes.map((note) => (
                <div key={note.id} className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-[#ff7a1a]">{note.title}</h4>
                    <div className="flex items-center gap-2">
                      <SpeakButton id={`vn-${note.id}`} compact variant="ghost" text={`${note.title}. ${note.structuredDarija}`} />
                      <button
                        type="button"
                        onClick={() => onDeleteVoiceNote(note.id)}
                        aria-label="حذف الملاحظة"
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{note.structuredDarija}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (toolId === 'draw') {
    const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = drawWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      setIsDrawing(true);
    };

    const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const endDraw = () => {
      if (!isDrawing) return;
      setIsDrawing(false);
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        setDrawHistory((prev) => [...prev.slice(-15), ctx.getImageData(0, 0, canvas.width, canvas.height)]);
      }
    };

    const undoDraw = () => {
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || drawHistory.length <= 1) return;
      const next = drawHistory.slice(0, -1);
      ctx.putImageData(next[next.length - 1], 0, 0);
      setDrawHistory(next);
    };

    const downloadAnnotated = () => {
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `fahem-blan-edited-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    const handleDrawImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        if (typeof r.result === 'string') setDrawBgSrc(r.result);
      };
      r.readAsDataURL(f);
    };

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">الرسم والتعديل على البلان</h2>
            <p className="text-sm text-slate-400">علم بالألوان فوق الصورة باش توري للمعلم فين يدوز الجعاب ولا السواري</p>
          </div>
          <SpeakButton
            id="tool-draw-voice"
            variant="primary"
            label="سمع الشرح"
            text="هنا تقدر ترسم بصبعك فوق البلان باش تعلم البلايص اللي بغيتي تبدل، بحال بلاصة الباب ولا الجعاب، ومن بعد تحمل الصورة وتصيفطها للمعلم."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="min-h-[44px] cursor-pointer inline-flex items-center gap-2 rounded-xl bg-[#16203a] border border-white/15 px-4 py-2 text-xs font-bold text-white">
            <Upload className="w-4 h-4 text-[#ff7a1a]" />
            <span>بدل الصورة</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleDrawImageUpload} />
          </label>

          <div className="flex items-center gap-2">
            {['#ff7a1a', '#38bdf8', '#22c55e', '#ffffff'].map((col) => (
              <button
                key={col}
                type="button"
                aria-label={`لون ${col}`}
                onClick={() => setDrawColor(col)}
                style={{backgroundColor: col}}
                className={`w-9 h-9 rounded-full border-2 ${
                  drawColor === col ? 'border-white scale-110' : 'border-transparent'
                }`}
              />
            ))}
          </div>

          <select
            value={drawWidth}
            onChange={(e) => setDrawWidth(Number(e.target.value))}
            className="min-h-[40px] rounded-lg border border-white/15 bg-[#0a0f1e] px-3 text-xs text-white"
          >
            <option value={3}>خط رقيق</option>
            <option value={6}>خط متوسط</option>
            <option value={11}>خط غليظ</option>
          </select>

          <button
            type="button"
            onClick={undoDraw}
            disabled={drawHistory.length <= 1}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40"
          >
            <RotateCcw className="w-4 h-4" />
            <span>رجوع</span>
          </button>

          <button
            type="button"
            onClick={downloadAnnotated}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-4 py-2 text-xs font-extrabold"
          >
            <Download className="w-4 h-4" />
            <span>تحميل الصورة</span>
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden border border-white/15 bg-black touch-none">
          <canvas
            ref={drawCanvasRef}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            className="w-full h-auto block cursor-crosshair"
          />
        </div>
      </div>
    );
  }

  // 12. QR Generator
  const downloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.download = `fahem-blan-qr-${Date.now()}.png`;
    a.href = qrDataUrl;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white">صانع QR للشانطي والمشروع</h2>
          <p className="text-sm text-slate-400">صايب كود QR فيه معلومات المشروع والهاتف باش تعلقو فالشانطي</p>
        </div>
        <SpeakButton
          id="tool-qr-voice"
          variant="primary"
          label="سمع الشرح"
          text="كتب سمية المشروع، العنوان ورقم الهاتف ديال المعلم، والتطبيق كيصايب ليك كود QR تقدر تطبعو وتلصقو فالورشة."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        <div className="md:col-span-7 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">اسم المشروع أو المعلم</span>
            <input
              type="text"
              value={qrTitle}
              onChange={(e) => setQrTitle(e.target.value)}
              className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-sm text-white focus:border-[#ff7a1a] focus:outline-none"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">التفاصيل (العنوان، الهاتف، ملاحظات البلان)</span>
            <textarea
              rows={3}
              value={qrDetails}
              onChange={(e) => setQrDetails(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0a0f1e] p-4 text-sm text-white focus:border-[#ff7a1a] focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={downloadQr}
            disabled={!qrDataUrl}
            className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-6 py-3 text-sm font-extrabold hover:bg-[#ff8d3b]"
          >
            <Download className="w-4 h-4" />
            <span>تحميل كود QR</span>
          </button>
        </div>

        <div className="md:col-span-5 flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0a0f1e] p-6 gap-3">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="كود QR للمشروع" className="w-48 h-48 rounded-xl bg-white p-2" />
          ) : (
            <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-400">
              جاري التوليد...
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>جاهز للمسح بالكاميرا</span>
          </div>
        </div>
      </div>
    </div>
  );
};
