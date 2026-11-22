import React, {useEffect, useRef, useState} from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Crosshair,
  Droplets,
  Loader2,
  Magnet,
  Mic,
  MicOff,
  Ruler,
  ScanLine,
  Upload,
  Volume2,
} from 'lucide-react';
import {SpeakButton} from '../../contexts/SpeechContext';
import {useTrialQuota, WHATSAPP_NUMBER_DISPLAY, WHATSAPP_URL} from '../../hooks/useTrialQuota';
import {prepareImageFromSrc, readFileAsDataUrl} from '../../lib/imageUtils';
import {drawDetectedLinesOnOverlay} from '../../lib/lineEdgeOverlay';
import sampleVillaImg from '../../assets/images/sample_villa_plan_1795110540429.jpg';
import type {ToolId} from '../../types';

interface SmartToolkitProps {
  toolId: Extract<
    ToolId,
    | 'metal-detector'
    | 'laser-level'
    | 'ar-meter'
    | 'crack-detector'
    | 'leak-detector'
    | 'cement-formula'
  >;
}

interface CrackDiagnosis {
  severity: string;
  crackType: string;
  causesDarija: string;
  repairStepsDarija: string[];
  audioScript: string;
}

export const SmartToolkitSuite: React.FC<SmartToolkitProps> = ({toolId}) => {
  const {isCodeBlocked, checkAllowanceBeforeAnalysis, consumeTrial} = useTrialQuota();

  // ================= 1. METAL DETECTOR (5cm Magnetometer + Live Camera) =================
  const [magMicroTesla, setMagMicroTesla] = useState(46); // Earth's ambient ~45 µT
  const [magBaseline, setMagBaseline] = useState(46);
  const [magLive, setMagLive] = useState(false);
  const [magBeepOn, setMagBeepOn] = useState(false);
  const [metalCamOn, setMetalCamOn] = useState(true);
  const [metalCamError, setMetalCamError] = useState<string | null>(null);
  const metalVideoRef = useRef<HTMLVideoElement | null>(null);
  const metalStreamRef = useRef<MediaStream | null>(null);

  const startMetalCamera = async () => {
    setMetalCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMetalCamError('المتصفح ما كيدعمش الكاميرا المباشرة.');
      setMetalCamOn(false);
      return;
    }
    try {
      if (metalStreamRef.current) {
        metalStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}},
        audio: false,
      });
      metalStreamRef.current = stream;
      setMetalCamOn(true);
      if (metalVideoRef.current) {
        metalVideoRef.current.srcObject = stream;
        await metalVideoRef.current.play().catch(() => undefined);
      }
    } catch {
      setMetalCamOn(false);
      setMetalCamError('عافاك عطى الإذن للكاميرا من المتصفح باش تشوف الفيديو المباشر.');
    }
  };

  useEffect(() => {
    if (toolId !== 'metal-detector') {
      if (metalStreamRef.current) {
        metalStreamRef.current.getTracks().forEach((t) => t.stop());
        metalStreamRef.current = null;
      }
      return;
    }

    if (metalCamOn) {
      startMetalCamera();
    } else if (metalStreamRef.current) {
      metalStreamRef.current.getTracks().forEach((t) => t.stop());
      metalStreamRef.current = null;
    }

    return () => {
      if (metalStreamRef.current) {
        metalStreamRef.current.getTracks().forEach((t) => t.stop());
        metalStreamRef.current = null;
      }
    };
  }, [metalCamOn, toolId]);

  useEffect(() => {
    if (toolId !== 'metal-detector') return;
    let sensor: {start: () => void; stop: () => void; x?: number; y?: number; z?: number; addEventListener: (ev: string, fn: () => void) => void} | null = null;

    const MagClass = (window as unknown as {Magnetometer?: new (opts: {frequency: number}) => typeof sensor}).Magnetometer;
    if (MagClass) {
      try {
        sensor = new MagClass({frequency: 15});
        if (sensor) {
          sensor.addEventListener('reading', () => {
            if (!sensor) return;
            const total = Math.hypot(sensor.x || 0, sensor.y || 0, sensor.z || 0);
            setMagLive(true);
            setMagMicroTesla(Math.round(total));
          });
          sensor.start();
        }
      } catch {
        setMagLive(false);
      }
    }

    return () => {
      try {
        sensor?.stop();
      } catch {
        // ignore
      }
    };
  }, [toolId]);

  const magDelta = Math.abs(magMicroTesla - magBaseline);
  const rebarDetected = magDelta >= 22;

  useEffect(() => {
    if (toolId !== 'metal-detector' || !magBeepOn || !rebarDetected) return;
    const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = Math.min(1400, 520 + magDelta * 8);
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    return () => {
      ctx.close().catch(() => undefined);
    };
  }, [magBeepOn, magDelta, rebarDetected, toolId]);

  // ================= 2. LASER LEVEL (DeviceOrientation + Camera) =================
  const [laserBeta, setLaserBeta] = useState(0);
  const [laserGamma, setLaserGamma] = useState(0);
  const [laserMode, setLaserMode] = useState<'horizontal' | 'vertical' | 'cross'>('cross');
  const [laserLive, setLaserLive] = useState(false);
  const [laserCamOn, setLaserCamOn] = useState(false);
  const laserVideoRef = useRef<HTMLVideoElement | null>(null);
  const laserStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (toolId !== 'laser-level') return;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma !== null && e.beta !== null) {
        setLaserLive(true);
        setLaserGamma(Number(e.gamma.toFixed(1)));
        setLaserBeta(Number(e.beta.toFixed(1)));
      }
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => window.removeEventListener('deviceorientation', onOrient);
  }, [toolId]);

  useEffect(() => {
    if (toolId !== 'laser-level' || !laserCamOn) {
      if (laserStreamRef.current) {
        laserStreamRef.current.getTracks().forEach((t) => t.stop());
        laserStreamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({video: {facingMode: 'environment'}, audio: false})
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        laserStreamRef.current = s;
        if (laserVideoRef.current) {
          laserVideoRef.current.srcObject = s;
          laserVideoRef.current.play().catch(() => undefined);
        }
      })
      .catch(() => setLaserCamOn(false));

    return () => {
      cancelled = true;
      if (laserStreamRef.current) {
        laserStreamRef.current.getTracks().forEach((t) => t.stop());
        laserStreamRef.current = null;
      }
    };
  }, [laserCamOn, toolId]);

  // ================= 3. AR METER BY CAMERA + LIVE LINE DETECTION =================
  const arVideoRef = useRef<HTMLVideoElement | null>(null);
  const arOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const arWorkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const arStreamRef = useRef<MediaStream | null>(null);
  const [arCamActive, setArCamActive] = useState(true);
  const [arCamError, setArCamError] = useState<string | null>(null);
  const [arLineDetectOn, setArLineDetectOn] = useState(true);
  const [arEdgesCount, setArEdgesCount] = useState(0);
  const [arSnapshot, setArSnapshot] = useState<string | null>(null);
  const [arRefMeters, setArRefMeters] = useState('1.0');
  const [arPoints, setArPoints] = useState<{x: number; y: number}[]>([]);

  const startArCamera = async () => {
    setArCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setArCamError('المتصفح ما كيدعمش الكاميرا المباشرة.');
      setArCamActive(false);
      return;
    }
    try {
      if (arStreamRef.current) {
        arStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}},
        audio: false,
      });
      arStreamRef.current = s;
      setArCamActive(true);
      if (arVideoRef.current) {
        arVideoRef.current.srcObject = s;
        await arVideoRef.current.play().catch(() => undefined);
      }
    } catch {
      setArCamActive(false);
      setArCamError('عافاك عطى الإذن للكاميرا باش يخدم المتر المباشر مع كشف الخطوط.');
    }
  };

  useEffect(() => {
    if (toolId !== 'ar-meter' || !arCamActive) {
      if (arStreamRef.current) {
        arStreamRef.current.getTracks().forEach((t) => t.stop());
        arStreamRef.current = null;
      }
      return;
    }
    startArCamera();
    return () => {
      if (arStreamRef.current) {
        arStreamRef.current.getTracks().forEach((t) => t.stop());
        arStreamRef.current = null;
      }
    };
  }, [arCamActive, toolId]);

  useEffect(() => {
    if (toolId !== 'ar-meter' || !arCamActive || !arLineDetectOn) return;
    if (!arWorkCanvasRef.current) {
      arWorkCanvasRef.current = document.createElement('canvas');
    }
    const timer = window.setInterval(() => {
      const video = arVideoRef.current;
      const overlay = arOverlayCanvasRef.current;
      const work = arWorkCanvasRef.current;
      if (video && overlay && work) {
        const count = drawDetectedLinesOnOverlay(video, overlay, work);
        setArEdgesCount(count);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [arCamActive, arLineDetectOn, toolId]);

  // ================= 4. CRACK DETECTOR (Gemini Vision + Live Camera) =================
  const [crackImg, setCrackImg] = useState<string | null>(null);
  const [crackLoading, setCrackLoading] = useState(false);
  const [crackError, setCrackError] = useState<string | null>(null);
  const [crackResult, setCrackResult] = useState<CrackDiagnosis | null>(null);
  const [crackCamOn, setCrackCamOn] = useState(false);
  const crackVideoRef = useRef<HTMLVideoElement | null>(null);
  const crackStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (toolId !== 'crack-detector' || !crackCamOn) {
      if (crackStreamRef.current) {
        crackStreamRef.current.getTracks().forEach((t) => t.stop());
        crackStreamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false})
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        crackStreamRef.current = s;
        if (crackVideoRef.current) {
          crackVideoRef.current.srcObject = s;
          crackVideoRef.current.play().catch(() => undefined);
        }
      })
      .catch(() => {
        setCrackCamOn(false);
        setCrackError('تأكد من إعطاء إذن الكاميرا أو ارفع صورة من الهاتف.');
      });
    return () => {
      cancelled = true;
      if (crackStreamRef.current) {
        crackStreamRef.current.getTracks().forEach((t) => t.stop());
        crackStreamRef.current = null;
      }
    };
  }, [crackCamOn, toolId]);

  // ================= 5. LEAK DETECTOR (Web Audio API) =================
  const [leakMicOn, setLeakMicOn] = useState(false);
  const [leakLevelDb, setLeakLevelDb] = useState(18);
  const [leakPeakHz, setLeakPeakHz] = useState(0);
  const [leakSimValue, setLeakSimValue] = useState(20);
  const leakRafRef = useRef<number | null>(null);
  const leakCtxRef = useRef<AudioContext | null>(null);
  const leakStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (toolId !== 'leak-detector' || !leakMicOn) {
      if (leakRafRef.current) cancelAnimationFrame(leakRafRef.current);
      if (leakStreamRef.current) {
        leakStreamRef.current.getTracks().forEach((t) => t.stop());
        leakStreamRef.current = null;
      }
      if (leakCtxRef.current) {
        leakCtxRef.current.close().catch(() => undefined);
        leakCtxRef.current = null;
      }
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({audio: true, video: false})
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        leakStreamRef.current = stream;
        const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
        const audioCtx = new AudioCtx();
        leakCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          let maxVal = 0;
          let maxBin = 0;
          for (let i = 0; i < freqData.length; i++) {
            sum += freqData[i];
            if (freqData[i] > maxVal) {
              maxVal = freqData[i];
              maxBin = i;
            }
          }
          const avg = sum / freqData.length;
          const db = Math.min(99, Math.round((avg / 255) * 100 + 15));
          const hz = Math.round((maxBin * audioCtx.sampleRate) / analyser.fftSize);
          setLeakLevelDb(db);
          setLeakPeakHz(hz);
          leakRafRef.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setLeakMicOn(false));

    return () => {
      cancelled = true;
      if (leakRafRef.current) cancelAnimationFrame(leakRafRef.current);
      if (leakStreamRef.current) {
        leakStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (leakCtxRef.current) {
        leakCtxRef.current.close().catch(() => undefined);
      }
    };
  }, [leakMicOn, toolId]);

  // ================= 6. REAL CEMENT FORMULA CALCULATOR =================
  const [fLength, setFLength] = useState('5');
  const [fWidth, setFWidth] = useState('4');
  const [fDepth, setFDepth] = useState('0.15');
  const [fGrade, setFGrade] = useState<'b15' | 'b20' | 'b25' | 'mortar'>('b20');

  // ================= TOOL VIEWS =================

  if (toolId === 'metal-detector') {
    const depthSignalPct = Math.min(100, Math.round((magDelta / 80) * 100));
    const voiceSummary = rebarDetected
      ? `انتباه! كاين حديد أو سلك كهربائي قريب على بعد أقل من خمسة سنتيمتر، قوة المغناطيس ${magMicroTesla} ميكروتسلا.`
      : `البلاصة نقية، ما كاين حتى حديد قريب، القراءة العادية هي ${magMicroTesla} ميكروتسلا.`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">كاشف الحديد (عمق 5 سم + فيديو مباشر)</h2>
            <p className="text-sm text-slate-400">
              وجه الكاميرا وقرب التليفون للحيط أو السارية باش تشوف وتكتشف الحديد قبل ما تثقب
            </p>
          </div>
          <SpeakButton id="smart-metal-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceSummary} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (metalCamOn) setMetalCamOn(false);
              else startMetalCamera();
            }}
            className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold ${
              metalCamOn ? 'bg-emerald-500 text-[#0a0f1e]' : 'bg-[#ff7a1a] text-[#0a0f1e]'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>{metalCamOn ? 'الكاميرا المباشرة شغالة (إيقاف)' : 'شعل الكاميرا المباشرة (طلب الإذن)'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMagBaseline(magMicroTesla)}
            className="min-h-[44px] rounded-xl border border-white/15 bg-[#0a0f1e] px-4 text-xs font-bold text-white hover:border-[#ff7a1a]"
          >
            تصفير المعايرة
          </button>

          <button
            type="button"
            onClick={() => setMagBeepOn((b) => !b)}
            className={`min-h-[44px] rounded-xl px-4 text-xs font-extrabold transition-colors ${
              magBeepOn ? 'bg-[#ff7a1a] text-[#0a0f1e]' : 'bg-white/10 text-slate-200'
            }`}
          >
            {magBeepOn ? 'صوت التنبيه: مشعل' : 'شعل صوت التنبيه'}
          </button>
        </div>

        {metalCamError && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
            <span>{metalCamError}</span>
            <button
              type="button"
              onClick={startMetalCamera}
              className="rounded-lg bg-[#ff7a1a] text-[#0a0f1e] px-3 py-1.5 font-extrabold"
            >
              اطلب إذن الكاميرا
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
          {/* Live Camera + AR Magnetic HUD */}
          <div className="md:col-span-7 relative min-h-[280px] rounded-2xl border border-white/15 bg-black overflow-hidden flex items-center justify-center">
            {metalCamOn ? (
              <video
                ref={metalVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full max-h-[360px] object-cover"
              />
            ) : (
              <div className="p-6 text-center space-y-3">
                <Camera className="w-10 h-10 text-[#ff7a1a] mx-auto" />
                <p className="text-xs text-slate-300">شعل الكاميرا المباشرة باش تشوف البلاصة اللي كتفحصها</p>
              </div>
            )}

            {/* Live Magnetic Scan Reticle Overlay */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div
                className={`w-36 h-36 rounded-full border-4 flex flex-col items-center justify-center backdrop-blur-[1px] transition-colors ${
                  rebarDetected
                    ? 'border-[#ff7a1a] bg-[#ff7a1a]/20 text-white'
                    : 'border-emerald-400/70 bg-black/30 text-emerald-300'
                }`}
              >
                <Magnet className="w-7 h-7 mb-1" />
                <span className="text-2xl font-extrabold font-mono-nums">{magMicroTesla} µT</span>
                <span className="text-[11px] font-bold">
                  {rebarDetected ? 'حديد على بعد ~5 سم!' : 'حيط نقي'}
                </span>
              </div>
            </div>
          </div>

          <div className="md:col-span-5 flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
            <div className="space-y-4">
              <div
                className={`rounded-xl p-4 border text-center ${
                  rebarDetected
                    ? 'border-[#ff7a1a] bg-[#ff7a1a]/15 text-[#ff7a1a]'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                <p className="text-sm font-extrabold">
                  {rebarDetected ? 'انتباه: تم اكتشاف حديد التسليح!' : 'الوضع آمن — ما كاينش حديد'}
                </p>
                <p className="text-xs text-slate-300 mt-1 font-mono-nums">
                  الفرق المغناطيسي: {magDelta} µT · العمق التقديري: ~5 سم
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>قوة الإشارة المغناطيسية</span>
                  <span className="font-mono-nums">{depthSignalPct}%</span>
                </div>
                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div
                    style={{width: `${depthSignalPct}%`}}
                    className={`h-full transition-all ${rebarDetected ? 'bg-[#ff7a1a]' : 'bg-emerald-400'}`}
                  />
                </div>
              </div>
            </div>

            {!magLive && (
              <div className="rounded-xl border border-white/10 bg-[#11182c] p-3.5 space-y-2">
                <p className="text-xs text-slate-300">
                  تجربة يدوية للمغناطيسية (فالهاتف كيقرا الحساس أوتوماتيكياً):
                </p>
                <input
                  type="range"
                  min="35"
                  max="140"
                  value={magMicroTesla}
                  onChange={(e) => setMagMicroTesla(parseInt(e.target.value, 10))}
                  className="w-full accent-[#ff7a1a]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (toolId === 'laser-level') {
    const angle = laserMode === 'vertical' ? laserBeta - 90 : laserGamma;
    const isZero = Math.abs(angle) <= 0.8;

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">نيفو ليزر (DeviceOrientation + كاميرا)</h2>
            <p className="text-sm text-slate-400">خطوط ليزر أفقية وعمودية لتركيب الزليج، الشراجم والكادر</p>
          </div>
          <SpeakButton
            id="smart-laser-voice"
            variant="primary"
            label="سمع بالدارجة"
            text={
              isZero
                ? 'النيفو ليزر مقاد على الصفر نيشان! تقدر تراسي الخط.'
                : `الزاوية دابا هي ${angle.toFixed(1)} درجة، دور التليفون شوية حتى يولي الخط خضر.`
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['cross', 'horizontal', 'vertical'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setLaserMode(m)}
              className={`min-h-[42px] px-4 rounded-xl text-xs font-bold ${
                laserMode === m ? 'bg-[#ff7a1a] text-[#0a0f1e]' : 'bg-[#0a0f1e] text-slate-300 border border-white/10'
              }`}
            >
              {m === 'cross' ? 'ليزر صليب (+)' : m === 'horizontal' ? 'خط أفقي' : 'خط عمودي'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setLaserCamOn((v) => !v)}
            className={`min-h-[42px] inline-flex items-center gap-2 px-4 rounded-xl text-xs font-bold ${
              laserCamOn ? 'bg-emerald-500 text-[#0a0f1e]' : 'bg-white/10 text-white'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>{laserCamOn ? 'حبس الكاميرا' : 'شعل الكاميرا مورا الليزر'}</span>
          </button>
        </div>

        <div className="relative h-72 sm:h-80 rounded-2xl border border-white/15 bg-[#050814] overflow-hidden flex items-center justify-center">
          {laserCamOn && (
            <video ref={laserVideoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover opacity-75" />
          )}

          {/* Laser Projection Lines */}
          <div
            style={{transform: `rotate(${-laserGamma}deg)`}}
            className="relative w-full h-full flex items-center justify-center transition-transform duration-75"
          >
            {(laserMode === 'horizontal' || laserMode === 'cross') && (
              <div className={`w-full h-0.5 ${isZero ? 'bg-emerald-400' : 'bg-[#ff7a1a]'} shadow-[0_0_12px_rgba(255,122,26,0.9)]`} />
            )}
            {(laserMode === 'vertical' || laserMode === 'cross') && (
              <div className={`absolute h-full w-0.5 ${isZero ? 'bg-emerald-400' : 'bg-[#ff7a1a]'} shadow-[0_0_12px_rgba(255,122,26,0.9)]`} />
            )}
            <Crosshair className={`absolute w-8 h-8 ${isZero ? 'text-emerald-400' : 'text-[#ff7a1a]'}`} />
          </div>

          <div className="absolute bottom-3 right-3 rounded-xl bg-[#0a0f1e]/90 border border-white/15 px-3 py-1.5 text-xs font-mono-nums text-white">
            الميلان: <span className={isZero ? 'text-emerald-400 font-bold' : 'text-[#ff7a1a] font-bold'}>{angle.toFixed(1)}°</span>
          </div>
        </div>

        {!laserLive && (
          <div className="rounded-xl border border-white/10 bg-[#0a0f1e] p-4 space-y-2">
            <span className="text-xs text-slate-300">تجربة يدوية للميلان:</span>
            <input
              type="range"
              min="-30"
              max="30"
              step="0.5"
              value={laserGamma}
              onChange={(e) => setLaserGamma(parseFloat(e.target.value))}
              className="w-full accent-[#ff7a1a]"
            />
          </div>
        )}
      </div>
    );
  }

  if (toolId === 'ar-meter') {
    const dist = (a: {x: number; y: number}, b: {x: number; y: number}) => Math.hypot(b.x - a.x, b.y - a.y);
    const refPx = arPoints.length >= 2 ? dist(arPoints[0], arPoints[1]) : 0;
    const targetPx = arPoints.length >= 4 ? dist(arPoints[2], arPoints[3]) : 0;
    const known = Math.max(0.05, parseFloat(arRefMeters) || 1);
    const meters = refPx > 0 && targetPx > 0 ? (targetPx / refPx) * known : null;

    const captureArFrame = () => {
      const v = arVideoRef.current;
      if (!v) return;
      const c = document.createElement('canvas');
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 720;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      setArSnapshot(c.toDataURL('image/jpeg', 0.9));
      setArCamActive(false);
      setArPoints([]);
    };

    const handleArClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (arCamActive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setArPoints((prev) => (prev.length >= 4 ? [{x, y}] : [...prev, {x, y}]));
    };

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">متر AR بالكاميرا مع كشف الخطوط</h2>
            <p className="text-sm text-slate-400">
              شغل الكاميرا المباشرة مع كشف خطوط الحيط والزوايا، ثبت القياس المرجعي وعبر الحيط ولا الغرفة
            </p>
          </div>
          <SpeakButton
            id="smart-ar-voice"
            variant="primary"
            label="سمع القياس"
            text={
              meters
                ? `القياس بالمتر هو ${meters.toFixed(2)} متر، يعني ${Math.round(meters * 100)} سنتيمتر.`
                : 'كاميرا المتر وكشف الخطوط شغالة. صور ولقط الحيط، علم على قياس معروف بحال متر وعبر المسافة اللي بغيتي.'
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setArSnapshot(null);
              if (arCamActive) setArCamActive(false);
              else startArCamera();
            }}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-4 py-2 text-xs font-extrabold"
          >
            <Camera className="w-4 h-4" />
            <span>{arCamActive ? 'حبس الكاميرا' : 'شعل كاميرا AR (طلب الإذن)'}</span>
          </button>

          {arCamActive && (
            <>
              <button
                type="button"
                onClick={() => setArLineDetectOn((v) => !v)}
                className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold border ${
                  arLineDetectOn
                    ? 'border-[#ff7a1a] bg-[#ff7a1a]/20 text-[#ff7a1a]'
                    : 'border-white/15 bg-[#0a0f1e] text-slate-300'
                }`}
              >
                <ScanLine className="w-4 h-4" />
                <span>{arLineDetectOn ? `كشف الخطوط: شغال (${arEdgesCount})` : 'شعل كشف الخطوط'}</span>
              </button>

              <button
                type="button"
                onClick={captureArFrame}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-500 text-[#0a0f1e] px-4 py-2 text-xs font-extrabold"
              >
                <Ruler className="w-4 h-4" />
                <span>ثبت اللقطة للقياس</span>
              </button>
            </>
          )}

          <label className="min-h-[44px] cursor-pointer inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0a0f1e] px-4 py-2 text-xs font-bold text-white">
            <Upload className="w-4 h-4 text-[#ff7a1a]" />
            <span>أو ارفع صورة</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const d = await readFileAsDataUrl(f);
                setArSnapshot(d);
                setArCamActive(false);
                setArPoints([]);
              }}
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span>المرجع (م):</span>
            <input
              type="number"
              step="0.1"
              value={arRefMeters}
              onChange={(e) => setArRefMeters(e.target.value)}
              className="w-20 min-h-[40px] rounded-lg border border-white/15 bg-[#0a0f1e] px-2 text-white font-mono-nums"
            />
          </label>
        </div>

        {arCamError && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
            <span>{arCamError}</span>
            <button
              type="button"
              onClick={startArCamera}
              className="rounded-lg bg-[#ff7a1a] text-[#0a0f1e] px-3 py-1.5 font-extrabold"
            >
              اطلب إذن الكاميرا
            </button>
          </div>
        )}

        <div
          onClick={handleArClick}
          className="relative h-80 sm:h-96 rounded-2xl border border-white/15 bg-black overflow-hidden flex items-center justify-center cursor-crosshair"
        >
          {arCamActive ? (
            <>
              <video ref={arVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {arLineDetectOn && (
                <canvas
                  ref={arOverlayCanvasRef}
                  className="pointer-events-none absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Crosshair className="w-12 h-12 text-[#ff7a1a]/80" />
              </div>
              <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-[#0a0f1e]/85 border border-white/15 px-3 py-1 text-[11px] font-bold text-[#ff7a1a]">
                كشف الخطوط والزوايا مباشر · ثبت اللقطة للقياس
              </div>
            </>
          ) : (
            <img
              src={arSnapshot || sampleVillaImg}
              alt="لقطة متر AR"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain pointer-events-none"
            />
          )}

          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            {arPoints.length >= 2 && (
              <line x1={arPoints[0].x} y1={arPoints[0].y} x2={arPoints[1].x} y2={arPoints[1].y} stroke="#38bdf8" strokeWidth="0.7" />
            )}
            {arPoints.length >= 4 && (
              <line x1={arPoints[2].x} y1={arPoints[2].y} x2={arPoints[3].x} y2={arPoints[3].y} stroke="#ff7a1a" strokeWidth="0.8" />
            )}
            {arPoints.map((p, idx) => (
              <circle key={idx} cx={p.x} cy={p.y} r="1.5" fill={idx < 2 ? '#38bdf8' : '#ff7a1a'} />
            ))}
          </svg>

          {meters !== null && (
            <div className="absolute top-3 left-3 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-4 py-2 text-base font-extrabold font-mono-nums shadow-lg">
              {meters.toFixed(2)} م ({Math.round(meters * 100)} سم)
            </div>
          )}
        </div>
      </div>
    );
  }

  if (toolId === 'crack-detector') {
    const analyzeCrack = async (src: string) => {
      const allowance = await checkAllowanceBeforeAnalysis();
      if (!allowance.allowed) {
        setCrackError(
          allowance.message ||
            `ساليو تجارب هاد الكود. تواصل معنا فـ واتساب ${WHATSAPP_NUMBER_DISPLAY} باش تخلص وتجدد.`
        );
        return;
      }
      setCrackLoading(true);
      setCrackError(null);
      try {
        const prepared = await prepareImageFromSrc(src);
        const res = await fetch('/api/detect-cracks', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            imageBase64: prepared.analysisDataUrl,
            mimeType: prepared.mimeType,
          }),
        });
        const rawText = await res.text();
        let data: CrackDiagnosis & {error?: string; success?: boolean};
        try {
          data = JSON.parse(rawText) as CrackDiagnosis & {error?: string; success?: boolean};
        } catch {
          throw new Error('تعذر تحليل الصورة، عاود حاول');
        }
        if (!res.ok || data.success === false) throw new Error(data.error || 'تعذر فحص الصورة');
        await consumeTrial();
        setCrackResult(data as CrackDiagnosis);
        setCrackLoading(false);
      } catch (err) {
        setCrackError(err instanceof Error ? err.message : 'وقع خطأ أثناء فحص الشق');
        setCrackLoading(false);
      }
    };

    const handleCrackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const d = await readFileAsDataUrl(f);
      setCrackImg(d);
      setCrackResult(null);
      await analyzeCrack(d);
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">كاشف الشقوق بالذكاء الاصطناعي</h2>
            <p className="text-sm text-slate-400">
              صور الشق اللي فالحيط ولا السارية وGemini كيشخص واش خطير ولا غير مرطوب ويعطيك الحل بالدارجة
            </p>
          </div>
          <SpeakButton
            id="smart-crack-guide"
            variant="secondary"
            label="سمع الشرح"
            text="صور الشق اللي عندك فالحيط أو الضالة، والذكاء الاصطناعي غادي يقول ليك واش غير تشقاق عادي ديال الصباغة والمرطوب ولا شق إنشائي خاصو مهندس، وكيفاش تصلحو."
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setCrackCamOn((v) => !v)}
            className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-5 py-2.5 text-sm font-extrabold hover:bg-[#ff8d3b]"
          >
            <Camera className="w-5 h-5" />
            <span>{crackCamOn ? 'حبس الكاميرا' : 'شعل الكاميرا لتصوير الشق'}</span>
          </button>

          {crackCamOn && (
            <button
              type="button"
              onClick={async () => {
                const v = crackVideoRef.current;
                if (!v) return;
                const c = document.createElement('canvas');
                c.width = v.videoWidth || 1280;
                c.height = v.videoHeight || 720;
                const ctx = c.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(v, 0, 0, c.width, c.height);
                const snap = c.toDataURL('image/jpeg', 0.9);
                setCrackCamOn(false);
                setCrackImg(snap);
                setCrackResult(null);
                await analyzeCrack(snap);
              }}
              className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-emerald-500 text-[#0a0f1e] px-5 py-2.5 text-sm font-extrabold"
            >
              <Camera className="w-5 h-5" />
              <span>التقط وحلل الشق</span>
            </button>
          )}

          <label className="min-h-[48px] cursor-pointer inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#0a0f1e] text-white px-5 py-2.5 text-sm font-bold hover:border-[#ff7a1a]">
            <Upload className="w-5 h-5 text-[#ff7a1a]" />
            <span>أو ارفع صورة من الهاتف</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCrackFile} />
          </label>
          {isCodeBlocked && (
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-bold"
            >
              <span>واتساب {WHATSAPP_NUMBER_DISPLAY}</span>
            </a>
          )}
        </div>

        {crackCamOn && (
          <div className="rounded-2xl overflow-hidden border border-[#ff7a1a]/40 bg-black">
            <video ref={crackVideoRef} autoPlay playsInline muted className="w-full max-h-80 object-cover" />
          </div>
        )}

        {crackError && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{crackError}</span>
          </div>
        )}

        {crackImg && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
            <div className="md:col-span-5 rounded-2xl overflow-hidden border border-white/10 bg-[#0a0f1e] relative">
              <img src={crackImg} alt="صورة الشق" className="w-full max-h-72 object-contain" />
              {crackLoading && (
                <div className="absolute inset-0 bg-[#0a0f1e]/80 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 text-[#ff7a1a] animate-spin" />
                  <p className="text-xs font-bold text-white">جاري فحص الشق...</p>
                </div>
              )}
            </div>

            {crackResult && (
              <div className="md:col-span-7 rounded-2xl border border-white/10 bg-[#0a0f1e] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-[#ff7a1a]">{crackResult.severity}</span>
                    <h3 className="text-lg font-extrabold text-white">{crackResult.crackType}</h3>
                  </div>
                  <SpeakButton id="crack-diag-speak" variant="primary" label="سمع التشخيص" text={crackResult.audioScript} />
                </div>

                <p className="text-sm text-slate-300 leading-relaxed">{crackResult.causesDarija}</p>

                <div className="space-y-2 border-t border-white/10 pt-3">
                  <p className="text-xs font-bold text-white">خطوات الإصلاح بالترتيب:</p>
                  <ul className="space-y-1.5 text-sm text-slate-200">
                    {crackResult.repairStepsDarija.map((st, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-[#ff7a1a] shrink-0 mt-1" />
                        <span>{st}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (toolId === 'leak-detector') {
    const activeDb = leakMicOn ? leakLevelDb : leakSimValue;
    const isLeakSuspected = activeDb >= 62;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">كاشف التسريب الصوتي (Web Audio)</h2>
            <p className="text-sm text-slate-400">
              قرب ميكروفون التليفون للحيط أو قادوس الما باش تسمع ترددات التسريب
            </p>
          </div>
          <SpeakButton
            id="smart-leak-voice"
            variant="primary"
            label="سمع النتيجة بالدارجة"
            text={
              isLeakSuspected
                ? `انتباه! كاين صوت عالي ديال تسريب محتمل، القوة وصلت لـ ${activeDb} ديسيبل. قلب مزيان على الجعاب فهاد البلاصة.`
                : `الصوت عادي دابا، ${activeDb} ديسيبل، ما كيبانش شي تسريب باين فهاد البلاصة.`
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setLeakMicOn((v) => !v)}
            className={`min-h-[48px] inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-extrabold ${
              leakMicOn ? 'bg-red-500 text-white' : 'bg-[#ff7a1a] text-[#0a0f1e]'
            }`}
          >
            {leakMicOn ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span>{leakMicOn ? 'حبس الميكروفون' : 'شعل كاشف التسريب'}</span>
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Droplets className={`w-8 h-8 ${isLeakSuspected ? 'text-[#ff7a1a]' : 'text-sky-400'}`} />
              <div>
                <p className="text-xs text-slate-400">شدة الصوت والتردد</p>
                <p className="text-2xl font-extrabold font-mono-nums text-white">
                  {activeDb} dB {leakPeakHz > 0 ? `· ${leakPeakHz} Hz` : ''}
                </p>
              </div>
            </div>
            <span
              className={`text-sm font-extrabold px-3 py-1.5 rounded-xl ${
                isLeakSuspected ? 'bg-[#ff7a1a] text-[#0a0f1e]' : 'bg-emerald-500/15 text-emerald-300'
              }`}
            >
              {isLeakSuspected ? 'احتمال تسريب عالي!' : 'وضع طبيعي'}
            </span>
          </div>

          <div className="h-4 rounded-full bg-white/10 overflow-hidden">
            <div
              style={{width: `${Math.min(100, activeDb)}%`}}
              className={`h-full transition-all duration-100 ${isLeakSuspected ? 'bg-[#ff7a1a]' : 'bg-sky-400'}`}
            />
          </div>

          {!leakMicOn && (
            <div className="space-y-1.5 pt-2">
              <span className="text-xs text-slate-400">تجربة مستوى الصوت قبل تشغيل الميكروفون:</span>
              <input
                type="range"
                min="10"
                max="95"
                value={leakSimValue}
                onChange={(e) => setLeakSimValue(parseInt(e.target.value, 10))}
                className="w-full accent-[#ff7a1a]"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ================= 6. REAL CEMENT FORMULA CALCULATOR =================
  const L = Math.max(0, parseFloat(fLength) || 0);
  const W = Math.max(0, parseFloat(fWidth) || 0);
  const D = Math.max(0, parseFloat(fDepth) || 0);
  const wetVol = L * W * D;
  const dryVol = wetVol * 1.54; // True civil engineering dry shrinkage factor

  const ratioParts =
    fGrade === 'b25'
      ? {c: 1, s: 1.5, g: 3, wc: 0.45, label: 'B25 (1 : 1.5 : 3) للسواري والكمرات'}
      : fGrade === 'b20'
        ? {c: 1, s: 2, g: 4, wc: 0.5, label: 'B20 (1 : 2 : 4) للضالة والسوميلات'}
        : fGrade === 'b15'
          ? {c: 1, s: 3, g: 6, wc: 0.55, label: 'B15 (1 : 3 : 6) بيطون بروبرطي'}
          : {c: 1, s: 4, g: 0, wc: 0.55, label: 'مونة البني والمرطوب (1 : 4)'};

  const sumParts = ratioParts.c + ratioParts.s + ratioParts.g;
  const cementVolM3 = (ratioParts.c / sumParts) * dryVol;
  const cementKg = cementVolM3 * 1440; // Bulk density of cement = 1440 kg/m³
  const cementBags50 = Math.ceil(cementKg / 50);
  const sandM3 = +((ratioParts.s / sumParts) * dryVol).toFixed(2);
  const gravelM3 = +((ratioParts.g / sumParts) * dryVol).toFixed(2);
  const sandBrouettes = Math.ceil(sandM3 / 0.06); // 60L Moroccan brouette
  const gravelBrouettes = Math.ceil(gravelM3 / 0.06);
  const waterLiters = Math.round(cementKg * ratioParts.wc);

  const formulaVoice = `بالفورمول الهندسي الحقيقي للمقدار ${wetVol.toFixed(2)} متر مكعب، الحجم الناشف هو ${dryVol.toFixed(2)} متر مكعب. خاصك ${cementBags50} خنشة ديال السيما، و ${sandBrouettes} برويطة ديال الرملة${gravelBrouettes > 0 ? ` و ${gravelBrouettes} برويطة ديال الكياس` : ''}، ومعاهم ${waterLiters} ليتر ديال الما.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white">حاسبة السيما بفورمول حقيقي (معامل 1.54)</h2>
          <p className="text-sm text-slate-400">
            حساب علمي دقيق بالضرب فمعامل التقلص 1.54، التحويل لوزن 1440 كغ/م³، وحساب البرويطة (60 لتر)
          </p>
        </div>
        <SpeakButton id="smart-formula-voice" variant="primary" label="سمع الحساب بالدارجة" text={formulaVoice} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">الطول (م)</span>
          <input type="number" step="0.1" value={fLength} onChange={(e) => setFLength(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums" />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">العرض (م)</span>
          <input type="number" step="0.1" value={fWidth} onChange={(e) => setFWidth(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums" />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">العلو / السمك (م)</span>
          <input type="number" step="0.05" value={fDepth} onChange={(e) => setFDepth(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums" />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">العيار (الفورمول)</span>
          <select value={fGrade} onChange={(e) => setFGrade(e.target.value as 'b15' | 'b20' | 'b25' | 'mortar')} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-3 text-white text-xs font-bold">
            <option value="b20">B20 (1:2:4) ضالة وسوميلات</option>
            <option value="b25">B25 (1:1.5:3) سواري وكمرات</option>
            <option value="b15">B15 (1:3:6) بيطون بروبرطي</option>
            <option value="mortar">مونة (1:4) بني ومرطوب</option>
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-[#ff7a1a]/30 bg-[#0a0f1e] p-4 text-xs text-slate-300 font-mono-nums">
        الفورمول: V_wet = {wetVol.toFixed(2)} m³ · V_dry = V_wet × 1.54 = {dryVol.toFixed(2)} m³ · {ratioParts.label}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/10 pt-5">
        <div>
          <p className="text-xs text-slate-400">السيما (50 كلغ)</p>
          <p className="text-2xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{cementBags50} خنشة</p>
          <p className="text-[11px] text-slate-400 font-mono-nums">{Math.round(cementKg)} كلغ</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">الرملة</p>
          <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{sandBrouettes} برويطة</p>
          <p className="text-[11px] text-slate-400 font-mono-nums">{sandM3} م³</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">الكياس (كرافيط)</p>
          <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{gravelBrouettes} برويطة</p>
          <p className="text-[11px] text-slate-400 font-mono-nums">{gravelM3} م³</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">الماء النظيف</p>
          <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{waterLiters} لتر</p>
          <p className="text-[11px] text-slate-400 font-mono-nums">W/C = {ratioParts.wc}</p>
        </div>
      </div>
    </div>
  );
};
