import React, {useEffect, useRef, useState} from 'react';
import {Camera, RefreshCw, Upload, X} from 'lucide-react';
import {SpeakButton} from '../contexts/SpeechContext';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const startCamera = async () => {
    setCameraError(null);
    setIsReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('المتصفح ما كيدعمش الكاميرا المباشرة، استعمل زر رفع الصورة لتحت.');
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: facingMode}, width: {ideal: 1920}, height: {ideal: 1080}},
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsReady(true);
      }
    } catch {
      setCameraError('ما قدرناش نحلو الكاميرا (ورك على اطلب إذن الكاميرا لتحت أو ارفع صورة من الهاتف).');
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setIsReady(false);
      setCameraError(null);
      return;
    }

    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode, isOpen]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video || !isReady) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    onCapture(dataUrl);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onCapture(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0f1e]/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-white">صور البلان ديالك</h3>
          <SpeakButton
            id="camera-guide"
            compact
            variant="ghost"
            text="وجه الكاميرا نيشان فوق البلان فالضو مزيان، وورك على الزر الليموني الكبير باش تصور وتحلل البلان دغيا."
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق الكاميرا"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/10 text-slate-200 hover:bg-white/20"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden p-4">
        {cameraError ? (
          <div className="max-w-sm w-full rounded-2xl border border-white/10 bg-[#11182c] p-6 text-center space-y-4">
            <Camera className="w-12 h-12 text-[#ff7a1a] mx-auto" />
            <p className="text-sm text-slate-300 leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={startCamera}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#ff7a1a]/45 bg-[#16203a] px-5 py-3 text-sm font-bold text-[#ff7a1a]"
            >
              <Camera className="w-5 h-5" />
              <span>اطلب إذن الكاميرا مرة أخرى</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff7a1a] px-5 py-3 text-sm font-bold text-[#0a0f1e]"
            >
              <Upload className="w-5 h-5" />
              <span>اختار صورة من الهاتف / الكاميرا</span>
            </button>
          </div>
        ) : (
          <div className="relative w-full max-w-2xl aspect-[4/3] rounded-2xl overflow-hidden border border-white/15 bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Architectural Framing Guide */}
            <div className="pointer-events-none absolute inset-6 border-2 border-dashed border-[#ff7a1a]/60 rounded-xl">
              <div className="absolute top-2 right-3 text-xs font-semibold text-[#ff7a1a] bg-[#0a0f1e]/80 px-2 py-1 rounded">
                حط البلان وسط الإطار
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-4 border-t border-white/10 bg-[#11182c] flex items-center justify-center gap-4 pb-safe">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[48px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10"
        >
          <Upload className="w-4 h-4" />
          <span>من المعرض</span>
        </button>

        {!cameraError && (
          <>
            <button
              type="button"
              disabled={!isReady}
              onClick={handleSnap}
              className="min-h-[56px] px-8 inline-flex items-center gap-2 rounded-2xl bg-[#ff7a1a] text-[#0a0f1e] text-base font-extrabold shadow-lg shadow-[#ff7a1a]/25 hover:bg-[#ff8d3b] disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              <Camera className="w-5 h-5" />
              <span>التقط الصورة</span>
            </button>

            <button
              type="button"
              onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
              aria-label="تبديل الكاميرا"
              className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
