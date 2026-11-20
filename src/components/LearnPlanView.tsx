import React, {useEffect, useRef, useState} from 'react';
import {
  ArrowRight,
  BookOpen,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import {SpeakButton, useDarijaSpeech, VoiceGenderSwitch} from '../contexts/SpeechContext';

interface LessonDef {
  id: string;
  title: string;
  durationSec: number;
  tag: string;
  summaryDarija: string;
  narrationDarija: string;
  steps: string[];
}

const LESSONS: LessonDef[] = [
  {
    id: 'lesson-rebar',
    title: 'كيفاش تقرا بلان الحديد (السواري، البار والمسافات)',
    durationSec: 18,
    tag: 'فيديو قصير · الحديد والتسليح',
    summaryDarija:
      'تعلم تقرا عدد القضبان فالعمود والضالة، قطر الحديد (10، 12، 14)، والمسافة بين كل بار وبار (15 أو 20 سنتيم).',
    narrationDarija:
      'مرحبا بيك فالدرس الأول: كيفاش تقرا بلان الحديد. ملي كتشوف سارية مربعة، النقط اللي فالجوانب هوما قضبان الحديد الواقفين، مثلاً ستة بارات قطر طناش، والخيط اللي داير بيهم هو الكادر كل خمسطاش سنتيم. وفالضالة الشبكة كتكون مربعة، حديد غليظ لتحت وحديد رقيق لفوق بمسافة عشرين سنتيم بين كل بار وبار.',
    steps: [
      'البار الواقف (العمودي): كيتكتب مثلاً 6 بارات قطر 12.',
      'الكادر (الحلقة): كيمسك الحديد كل 15 سنتيم باش ما يتحلش.',
      'الضالة: شبكة مربعة بمسافة 15 أو 20 سنتيم بين القضبان.',
    ],
  },
  {
    id: 'lesson-rooms',
    title: 'كيفاش تقرا بلان الدار: السواري، الحيوط والأبواب',
    durationSec: 16,
    tag: 'فيديو قصير · المخطط المعماري',
    summaryDarija:
      'عرف الفرق بين السارية ديال البيطون والحيط ديال البريك، وفهم رموز الأبواب والشراجم باش ما تغلطش فالبني.',
    narrationDarija:
      'فالدرس الثاني غادي نعرفو رموز بلان الدار. المربع الأسود المغلوق هو السارية ديال البيطون اللي كتهز الثقل، ممنوع تحفر فيها. الخطوط المزدوجة هوما الحيوط ديال البريك. والقوس اللي داير حدا الخط كيعني الباب وفين كيتحل، والخط الرقيق وسط الحيط هو الشرجم.',
    steps: [
      'المربع الكحل: سارية بيطون مسلحة (ممنوع التهديم).',
      'خطين متوازيين: حيط ديال البريك (10 أو 20 سنتيم).',
      'القوس المنحني: الباب واتجاه الفتحة ديالو.',
    ],
  },
  {
    id: 'lesson-scale',
    title: 'حساب المساحات وفهم السلم (1/100) فالبلان',
    durationSec: 15,
    tag: 'فيديو قصير · القياس والمساحة',
    summaryDarija:
      'إلى كان مكتوب فـ البلان السلم 1 على 100، يعني كل سنتيم فـ الورقة كيساوي متر فـ الواقع، وضرب الطول فالعرض كيعطيك المتر مربع.',
    narrationDarija:
      'فالدرس الثالث، كيفاش تعرف المساحة الحقيقية من البلان. شوف لتحت فالورقة، إلا لقيتي السلم واحد على مية، معناها كل سنتيمتر بالمسطرة فوق الورقة كيساوي متر واحد فالأرض. وإلى كانت الغرفة فيها ربعة ميترو على تلاتة ميترو، كتضرب ربعة فتلاتة كتساوي طناش متر مربع.',
    steps: [
      'السلم 1/100: كل 1 سنتيم على الورقة = 1 متر في الأرض.',
      'المساحة = الطول × العرض (مثال: 4م × 3م = 12 متر مربع).',
      'ديما قارن الأرقام المكتوبة مع مجموع الواجهة كاملة.',
    ],
  },
  {
    id: 'lesson-mistakes',
    title: 'أخطاء خطيرة فالشانطي خاصك ترد ليها البال',
    durationSec: 16,
    tag: 'فيديو قصير · نصائح المعلم',
    summaryDarija:
      'تجنب نقصان الغطاء الخرساني على الحديد، التوصيل القصير للحديد، وقلة السقي ديال البيطون بالماء.',
    narrationDarija:
      'فالدرس الرابع: رد البال من تلاتة دالأخطاء فالشانطي. اللول، الحديد ما خاصوش يبان أو يلامس الخشب ديال الكوفراج، خاص تخلي جوج سنتيم ونص بالكالات. التاني، إلا وصلتي بار مع بار، خاصو يركب عليه خمسين مرة القطر. والتالت، ديما سقي الضالة والسواري بالما سبع يام متابعة باش ما يتشقش البيطون.',
    steps: [
      'الكالات (2.5 سنتيم): كتحمي الحديد من الصدأ والرطوبة.',
      'توصيل الحديد: خاص تداخل 60 سنتيم لحديد قطر 12.',
      'سقي البيطون بالماء لمدة 7 أيام كيحمي من التشققات.',
    ],
  },
];

function drawLessonFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lessonId: string,
  progress: number // 0..1
) {
  ctx.fillStyle = '#070b16';
  ctx.fillRect(0, 0, w, h);

  // Blueprint grid background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (lessonId === 'lesson-rebar') {
    const cx = w * 0.34;
    const cy = h * 0.5;
    const size = Math.min(w, h) * 0.42;

    // Concrete column box
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);

    // Stirrup (Cadre) animated reveal
    if (progress > 0.15) {
      ctx.strokeStyle = '#ff7a1a';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - size * 0.38, cy - size * 0.38, size * 0.76, size * 0.76);
    }

    // 6 Rebar longitudinal bars animated one by one
    const barPositions = [
      [cx - size * 0.34, cy - size * 0.34],
      [cx + size * 0.34, cy - size * 0.34],
      [cx - size * 0.34, cy + size * 0.34],
      [cx + size * 0.34, cy + size * 0.34],
      [cx, cy - size * 0.34],
      [cx, cy + size * 0.34],
    ];
    const visibleBars = Math.min(barPositions.length, Math.floor(progress * 8));
    for (let i = 0; i < visibleBars; i++) {
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.arc(barPositions[i][0], barPositions[i][1], 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Slab mesh on right side
    const rx = w * 0.62;
    const ry = h * 0.25;
    const rw = w * 0.28;
    const rh = h * 0.5;
    ctx.strokeStyle = progress > 0.5 ? '#22c55e' : 'rgba(34,197,94,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const stepX = rx + (rw / 4) * i;
      const stepY = ry + (rh / 4) * i;
      if (progress > 0.35 + i * 0.08) {
        ctx.beginPath();
        ctx.moveTo(stepX, ry);
        ctx.lineTo(stepX, ry + rh);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(rx, stepY);
        ctx.lineTo(rx + rw, stepY);
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Cairo, sans-serif';
    ctx.fillText('سارية: 6 بارات قطر 12', cx, cy + size / 2 + 24);
    ctx.fillText('شبكة الضالة: مسافة 15-20 سم', rx + rw / 2, ry + rh + 24);
  } else if (lessonId === 'lesson-rooms') {
    const bx = w * 0.18;
    const by = h * 0.2;
    const bw = w * 0.64;
    const bh = h * 0.6;

    // Outer brick walls
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 6;
    ctx.strokeRect(bx, by, bw, bh);

    // Concrete columns at corners
    if (progress > 0.1) {
      ctx.fillStyle = '#ff7a1a';
      const cols = [
        [bx - 8, by - 8],
        [bx + bw - 8, by - 8],
        [bx - 8, by + bh - 8],
        [bx + bw - 8, by + bh - 8],
        [bx + bw * 0.5 - 8, by - 8],
        [bx + bw * 0.5 - 8, by + bh - 8],
      ];
      cols.forEach(([x, y]) => ctx.fillRect(x, y, 16, 16));
    }

    // Inner dividing wall + Door swing arc
    if (progress > 0.35) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.5, by);
      ctx.lineTo(bx + bw * 0.5, by + bh * 0.65);
      ctx.stroke();

      // Door arc
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx + bw * 0.5, by + bh * 0.72, 28, -Math.PI / 2, 0);
      ctx.stroke();
    }

    // Window marker on top wall
    if (progress > 0.6) {
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(bx + bw * 0.18, by - 4, 48, 8);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px Cairo, sans-serif';
      ctx.fillText('الصالون', bx + bw * 0.25, by + bh * 0.5);
      ctx.fillText('الكوزينة', bx + bw * 0.75, by + bh * 0.5);
    }
  } else if (lessonId === 'lesson-scale') {
    const rx = w * 0.22;
    const ry = h * 0.26;
    const rw = w * 0.56 * Math.min(1, progress * 1.4 + 0.2);
    const rh = h * 0.44;

    ctx.fillStyle = 'rgba(255, 122, 26, 0.14)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = 3;
    ctx.strokeRect(rx, ry, rw, rh);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Cairo, sans-serif';
    ctx.fillText('الطول = 4 متر', rx + rw / 2, ry - 18);
    ctx.fillText('العرض = 3 متر', rx - 54, ry + rh / 2);

    if (progress > 0.45) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 20px Cairo, sans-serif';
      ctx.fillText('المساحة = 4 × 3 = 12 متر مربع', rx + rw / 2, ry + rh / 2);
    }
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 14px Cairo, sans-serif';
    ctx.fillText('السلم 1/100: كل 1 سم فالورقة = 1 متر فالواقع', w / 2, h - 22);
  } else {
    // Lesson 4: Cover & overlap mistakes
    const lx = w * 0.15;
    const ly = h * 0.38;
    const lw = w * 0.7;
    const lh = h * 0.26;

    ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.fillRect(lx, ly, lw, lh);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(lx, ly, lw, lh);

    // Overlap rebar bars
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(lx + 18, ly + lh * 0.4);
    ctx.lineTo(lx + lw * 0.62, ly + lh * 0.4);
    ctx.stroke();

    if (progress > 0.35) {
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(lx + lw * 0.38, ly + lh * 0.6);
      ctx.lineTo(lx + lw - 18, ly + lh * 0.6);
      ctx.stroke();
    }

    // Spacers (Cales)
    if (progress > 0.6) {
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(lx + 40, ly + lh - 12, 16, 12);
      ctx.fillRect(lx + lw - 56, ly + lh - 12, 16, 12);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Cairo, sans-serif';
    ctx.fillText('التداخل بين الحديد: 50 × القطر (مثلاً 60 سم)', w / 2, ly - 24);
    ctx.fillStyle = '#22c55e';
    ctx.fillText('الكالات 2.5 سم تحت الحديد + سقي بالما 7 أيام', w / 2, ly + lh + 28);
  }
}

export const LearnPlanView: React.FC<{onBack: () => void}> = ({onBack}) => {
  const {speakPro, stop, settings} = useDarijaSpeech();
  const [selectedLesson, setSelectedLesson] = useState<LessonDef>(LESSONS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawLessonFrame(ctx, canvas.width, canvas.height, selectedLesson.id, progress);
  }, [progress, selectedLesson.id]);

  useEffect(() => {
    if (!isPlaying) return;
    const stepMs = 50;
    const increment = stepMs / (selectedLesson.durationSec * 1000);
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        const next = prev + increment;
        if (next >= 1) {
          setIsPlaying(false);
          return 1;
        }
        return next;
      });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, selectedLesson.durationSec]);

  const startLessonVideo = (lesson: LessonDef) => {
    setSelectedLesson(lesson);
    setProgress(0);
    setIsPlaying(true);
    if (settings.voiceEnabled) {
      void speakPro(lesson.narrationDarija, {id: `learn-${lesson.id}`});
    }
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      stop();
    } else {
      if (progress >= 0.99) setProgress(0);
      setIsPlaying(true);
      if (settings.voiceEnabled) {
        void speakPro(selectedLesson.narrationDarija, {id: `learn-${selectedLesson.id}`});
      }
    }
  };

  const currentSeconds = Math.round(progress * selectedLesson.durationSec);

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            stop();
            onBack();
          }}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#11182c] px-4 py-2 text-sm font-bold text-white hover:bg-[#16203a]"
        >
          <ArrowRight className="w-4 h-4 text-[#ff7a1a]" />
          <span>رجوع</span>
        </button>

        <div className="flex items-center gap-2">
          <VoiceGenderSwitch />
          <SpeakButton
            id="learn-hub-voice"
            variant="ghost"
            label="سمع الدليل"
            text="مرحبا بيك فقسم تعلم البلان. هنا كاين فيديوهات قصيرة مشروحة بالدارجة المغربية باش تتعلم كيفاش تقرا بلان الحديد، السواري، الغرف، وحساب المساحات."
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 text-[#ff7a1a] text-xs font-bold mb-1">
          <BookOpen className="w-4 h-4" />
          <span>أكاديمية فاهم بلان</span>
        </div>
        <h1 className="text-2xl font-extrabold text-white">تعلم تقرا البلان — فيديوهات مختصرة</h1>
        <p className="text-sm text-slate-400 mt-1">
          شاهد الشرح بالرسم المتحرك واسمع التفاصيل بالدارجة المغربية خطوة بخطوة
        </p>
      </div>

      {/* Interactive Short Video Player */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 rounded-2xl border border-[#ff7a1a]/35 bg-[#11182c] overflow-hidden">
          <div className="relative bg-[#070b16] aspect-video">
            <canvas
              ref={canvasRef}
              width={720}
              height={405}
              className="w-full h-full object-contain"
            />

            {!isPlaying && progress === 0 && (
              <button
                type="button"
                onClick={togglePlayPause}
                aria-label="تشغيل الفيديو"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 hover:bg-black/30 transition-colors"
              >
                <div className="w-16 h-16 rounded-full bg-[#ff7a1a] text-[#0a0f1e] flex items-center justify-center shadow-xl">
                  <Play className="w-8 h-8 fill-current" />
                </div>
                <span className="text-sm font-extrabold text-white bg-[#0a0f1e]/80 px-4 py-1.5 rounded-xl">
                  شغل الفيديو بالدارجة
                </span>
              </button>
            )}
          </div>

          {/* Player Controls */}
          <div className="p-4 sm:p-5 space-y-4">
            <div className="space-y-2">
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(progress * 100)}
                onChange={(e) => setProgress(Number(e.target.value) / 100)}
                className="w-full accent-[#ff7a1a]"
              />
              <div className="flex items-center justify-between text-xs font-mono-nums text-slate-400">
                <span>00:{String(currentSeconds).padStart(2, '0')}</span>
                <span>00:{String(selectedLesson.durationSec).padStart(2, '0')}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#ff7a1a] hover:bg-[#ff8d3b] text-[#0a0f1e] px-5 py-2 text-sm font-extrabold"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span>{isPlaying ? 'توقيف' : 'تشغيل'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => startLessonVideo(selectedLesson)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#0a0f1e] px-3.5 py-2 text-xs font-bold text-slate-200"
                >
                  <RotateCcw className="w-4 h-4 text-[#ff7a1a]" />
                  <span>إعادة</span>
                </button>
              </div>

              <SpeakButton
                id={`lesson-speak-${selectedLesson.id}`}
                variant="secondary"
                label="سمع الدرس كامل"
                text={selectedLesson.narrationDarija}
              />
            </div>

            <div className="border-t border-white/10 pt-3 space-y-2">
              <p className="text-xs font-bold text-[#ff7a1a]">{selectedLesson.tag}</p>
              <h2 className="text-lg font-extrabold text-white">{selectedLesson.title}</h2>
              <p className="text-sm text-slate-300 leading-relaxed">{selectedLesson.summaryDarija}</p>
              <ul className="space-y-1.5 pt-2">
                {selectedLesson.steps.map((st, idx) => (
                  <li key={idx} className="text-xs text-slate-200 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-[#ff7a1a]/15 text-[#ff7a1a] font-mono-nums font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span>{st}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Short Video Lessons Playlist */}
        <div className="lg:col-span-5 space-y-3">
          <h3 className="text-base font-bold text-white">قائمة الدروس المختصرة ({LESSONS.length})</h3>
          {LESSONS.map((lesson, idx) => {
            const active = lesson.id === selectedLesson.id;
            return (
              <div
                key={lesson.id}
                onClick={() => startLessonVideo(lesson)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    startLessonVideo(lesson);
                  }
                }}
                className={`cursor-pointer rounded-2xl border p-4 transition-colors space-y-2 ${
                  active
                    ? 'border-[#ff7a1a] bg-[#ff7a1a]/10'
                    : 'border-white/10 bg-[#11182c] hover:border-[#ff7a1a]/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        active ? 'bg-[#ff7a1a] text-[#0a0f1e]' : 'bg-white/5 text-[#ff7a1a]'
                      }`}
                    >
                      <Play className="w-4 h-4 fill-current" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-[#ff7a1a]">
                        فيديو 0{idx + 1} · {lesson.durationSec} ثانية
                      </p>
                      <h4 className="text-sm font-extrabold text-white">{lesson.title}</h4>
                    </div>
                  </div>
                  <Volume2 className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{lesson.summaryDarija}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
