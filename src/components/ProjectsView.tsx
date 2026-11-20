import React, {useState} from 'react';
import {
  ArrowRight,
  Calendar,
  Check,
  Cloud,
  Edit3,
  FolderOpen,
  HardDrive,
  LogIn,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {User} from 'firebase/auth';
import {SpeakButton, VoiceGenderSwitch} from '../contexts/SpeechContext';
import type {SavedPlan} from '../types';

interface ProjectsViewProps {
  plans: SavedPlan[];
  user: User | null;
  onSignIn: () => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
  onRenamePlan: (id: string, title: string) => Promise<void>;
  onOpenInAnnotator: (src: string) => void;
  onGoAnalyze: () => void;
  onBack: () => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  plans,
  user,
  onSignIn,
  onDeletePlan,
  onRenamePlan,
  onOpenInAnnotator,
  onGoAnalyze,
  onBack,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<SavedPlan | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const filtered = plans.filter((p) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.buildingType.toLowerCase().includes(q) ||
      p.darijaSummary.toLowerCase().includes(q)
    );
  });

  const startEdit = (plan: SavedPlan) => {
    setEditingId(plan.id);
    setEditTitle(plan.title);
  };

  const commitEdit = async (id: string) => {
    if (editTitle.trim()) {
      await onRenamePlan(id, editTitle.trim());
    }
    setEditingId(null);
  };

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
          <VoiceGenderSwitch />
          <SpeakButton
            id="projects-page-voice"
            variant="secondary"
            label="سمع الشرح"
            text={`عندك دابا ${plans.length} بلان محفوظ فالمشاريع ديالك. تقدر تسمع الشرح ديال أي بلان، تعدل السمية ديالو، ولا ترسم فوقو.`}
          />
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-extrabold text-white">المشاريع والبلانات المحفوظة</h1>
        <p className="text-sm text-slate-400 mt-1">
          كاع البلانات اللي صورتي وحللتي كيبقاو محفوظين هنا باش ترجع ليهم فأي وقت
        </p>
      </div>

      {!user && (
        <div className="rounded-2xl border border-[#ff7a1a]/30 bg-[#11182c] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white">بغيتي تحفظ مشاريعك فالسحابة (Firebase)؟</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              دابا البلانات محفوظين غير فهاد الهاتف. سجل الدخول بحساب Google باش يبقاو محفوظين ومزامنين فأي جهاز.
            </p>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-5 py-2.5 text-sm font-extrabold hover:bg-[#ff8d3b] whitespace-nowrap shrink-0"
          >
            <LogIn className="w-4 h-4" />
            <span>تسجيل الدخول بـ Google</span>
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="قلب على بلان بالسمية أو نوع البناء..."
          className="w-full min-h-[48px] rounded-xl border border-white/10 bg-[#11182c] pr-11 pl-4 text-sm text-white placeholder:text-slate-500 focus:border-[#ff7a1a] focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#11182c] p-10 text-center space-y-4">
          <FolderOpen className="w-12 h-12 text-[#ff7a1a] mx-auto" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">
              {plans.length === 0 ? 'مازال ما حفظتي حتى بلان' : 'ما كاين حتى نتيجة لهاد البحث'}
            </h3>
            <p className="text-sm text-slate-400">
              {plans.length === 0
                ? 'صور البلان اللول ديالك وحللو بالذكاء الاصطناعي ومن بعد ورك على زر الحفظ.'
                : 'جرب تبدل كلمة البحث.'}
            </p>
          </div>
          {plans.length === 0 && (
            <button
              type="button"
              onClick={onGoAnalyze}
              className="min-h-[48px] inline-flex items-center justify-center rounded-xl bg-[#ff7a1a] text-[#0a0f1e] px-6 py-3 text-sm font-extrabold hover:bg-[#ff8d3b]"
            >
              صور وحلل بلان دابا
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((plan) => (
            <div
              key={plan.id}
              className="rounded-2xl border border-white/10 bg-[#11182c] overflow-hidden flex flex-col justify-between"
            >
              <div>
                {plan.thumbnailDataUrl ? (
                  <div className="h-44 bg-[#0a0f1e] border-b border-white/10 overflow-hidden">
                    <img
                      src={plan.thumbnailDataUrl}
                      alt={plan.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-28 bg-[#0a0f1e] border-b border-white/10 flex items-center justify-center text-slate-500 text-xs">
                    بلان محفوظ بدون صورة مصغرة
                  </div>
                )}

                <div className="p-4 space-y-3">
                  {editingId === plan.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 min-h-[40px] rounded-lg border border-[#ff7a1a] bg-[#0a0f1e] px-3 text-sm text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitEdit(plan.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#ff7a1a] text-[#0a0f1e]"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-white leading-snug">{plan.title}</h3>
                      <button
                        type="button"
                        onClick={() => startEdit(plan)}
                        aria-label="تعديل العنوان"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 shrink-0"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{plan.buildingType}</span>
                    <span>·</span>
                    <span className="font-mono-nums text-[#ff7a1a]">{plan.totalAreaSqm}</span>
                    <span>·</span>
                    <span className="font-mono-nums">{plan.roomsCount} غرف</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(plan.createdAtMs).toLocaleDateString('ar-MA')}
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-300">
                      {plan.syncedToCloud ? (
                        <>
                          <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                          <span>محفوظ فالسحابة</span>
                        </>
                      ) : (
                        <>
                          <HardDrive className="w-3.5 h-3.5 text-amber-400" />
                          <span>محلي</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 pt-0 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPlan(plan)}
                  className="min-h-[44px] flex-1 rounded-xl bg-[#ff7a1a] hover:bg-[#ff8d3b] text-[#0a0f1e] text-xs font-extrabold"
                >
                  افتح التفاصيل
                </button>
                <SpeakButton
                  id={`proj-speak-${plan.id}`}
                  compact
                  variant="ghost"
                  text={plan.audioScript || plan.darijaSummary}
                />
                <button
                  type="button"
                  onClick={() => onDeletePlan(plan.id)}
                  aria-label="حذف البلان"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPlan && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-3xl w-full max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#11182c] p-6 space-y-6">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-xs font-semibold text-[#ff7a1a]">{selectedPlan.buildingType}</p>
                <h2 className="text-2xl font-extrabold text-white mt-0.5">{selectedPlan.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                aria-label="إغلاق"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/10 text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SpeakButton
                id={`modal-plan-${selectedPlan.id}`}
                variant="primary"
                label="سمع الشرح كامل"
                text={selectedPlan.audioScript || selectedPlan.darijaSummary}
              />
              {selectedPlan.thumbnailDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInAnnotator(selectedPlan.thumbnailDataUrl!);
                    setSelectedPlan(null);
                  }}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
                >
                  <Pencil className="w-4 h-4 text-[#ff7a1a]" />
                  <span>رسم فوق البلان</span>
                </button>
              )}
            </div>

            {selectedPlan.thumbnailDataUrl && (
              <img
                src={selectedPlan.thumbnailDataUrl}
                alt={selectedPlan.title}
                referrerPolicy="no-referrer"
                className="w-full max-h-72 object-contain rounded-xl bg-[#0a0f1e] border border-white/10"
              />
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[#ff7a1a]">الشرح بالدارجة</h3>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                {selectedPlan.darijaSummary}
              </p>
            </div>

            {selectedPlan.materials.length > 0 && (
              <div className="space-y-2 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">المواد المطلوبة</h3>
                  <SpeakButton
                    id={`modal-mats-${selectedPlan.id}`}
                    compact
                    variant="ghost"
                    text={selectedPlan.materials
                      .map((m) => `${m.item}: ${m.quantityEstimate} ${m.unit}`)
                      .join('. ')}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {selectedPlan.materials.map((m, i) => (
                    <div key={i} className="rounded-xl bg-[#0a0f1e] border border-white/10 p-3">
                      <p className="font-bold text-white text-sm">
                        {m.item} — <span className="font-mono-nums text-[#ff7a1a]">{m.quantityEstimate} {m.unit}</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">{m.notesDarija}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedPlan.workPhases.length > 0 && (
              <div className="space-y-2 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">مراحل العمل بالترتيب</h3>
                  <SpeakButton
                    id={`modal-phases-${selectedPlan.id}`}
                    compact
                    variant="ghost"
                    text={selectedPlan.workPhases
                      .map((p) => `المرحلة ${p.stepNumber}: ${p.phaseName}. ${p.explanationDarija}`)
                      .join('. ')}
                  />
                </div>
                <div className="space-y-2">
                  {selectedPlan.workPhases.map((p, i) => (
                    <div key={i} className="rounded-xl bg-[#0a0f1e] border border-white/10 p-3">
                      <p className="font-bold text-white text-sm">
                        {p.stepNumber}. {p.phaseName} ({p.durationEstimate})
                      </p>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {p.explanationDarija}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
