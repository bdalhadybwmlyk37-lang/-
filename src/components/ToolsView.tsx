import React, {useState} from 'react';
import {
  ArrowRight,
  BrickWall,
  Calculator,
  Compass,
  Crosshair,
  Droplets,
  FlaskConical,
  Grid2x2,
  Hammer,
  Magnet,
  Mic,
  PaintBucket,
  Pencil,
  QrCode,
  Ruler,
  Scale,
  ScanLine,
  SlidersHorizontal,
} from 'lucide-react';
import {SpeakButton, VoiceGenderSwitch} from '../contexts/SpeechContext';
import type {ToolId, VoiceNoteItem} from '../types';
import {CalculatorsSuite} from './tools/CalculatorsSuite';
import {FieldToolsSuite} from './tools/FieldToolsSuite';
import {SmartToolkitSuite} from './tools/SmartToolkitSuite';

interface ToolsViewProps {
  activeTool: ToolId | null;
  onSelectTool: (tool: ToolId | null) => void;
  onBackHome: () => void;
  initialDrawImage: string | null;
  voiceNotes: VoiceNoteItem[];
  onSaveVoiceNote: (title: string, rawTranscript: string, structuredDarija: string) => Promise<void>;
  onDeleteVoiceNote: (id: string) => Promise<void>;
}

interface ToolDef {
  id: ToolId;
  title: string;
  desc: string;
  voiceGuide: string;
  category: 'smart' | 'calc' | 'field';
  icon: React.ComponentType<{className?: string}>;
}

const TOOLS: ToolDef[] = [
  // === صندوق العدة الذكي (6 أدوات) ===
  {
    id: 'metal-detector',
    title: 'كاشف الحديد 5 سم',
    desc: 'مقياس المغناطيسية لاكتشاف الحديد فالحيط',
    voiceGuide: 'كاشف الحديد كيعبر المغناطيسية حتى لعمق خمسة سنتيمتر باش ما تثقبش الحديد ولا السلوك.',
    category: 'smart',
    icon: Magnet,
  },
  {
    id: 'laser-level',
    title: 'نيفو ليزر',
    desc: 'خطوط ليزر أفقية وعمودية بمستشعر الهاتف',
    voiceGuide: 'نيفو ليزر كيخرج لك خط الليزر أفقي ولا عمودي باش تقاد الزليج والكادر.',
    category: 'smart',
    icon: Crosshair,
  },
  {
    id: 'ar-meter',
    title: 'متر AR بالكاميرا',
    desc: 'قياس المسافات والأطوال مباشرة بالكاميرا',
    voiceGuide: 'متر الواقع المعزز بالكاميرا كيعاونك تعبر الطول والعرض غير من شاشة التليفون.',
    category: 'smart',
    icon: Ruler,
  },
  {
    id: 'crack-detector',
    title: 'كاشف الشقوق',
    desc: 'تشخيص شقوق الحيوط والسواري بـ Gemini Vision',
    voiceGuide: 'كاشف الشقوق كيصور الشق ويشخص ليك بالدارجة واش سطحي ولا خطير مع طريقة الإصلاح.',
    category: 'smart',
    icon: ScanLine,
  },
  {
    id: 'leak-detector',
    title: 'كاشف التسريب',
    desc: 'تحليل صوت التسريب فالأنابيب بـ Web Audio',
    voiceGuide: 'كاشف التسريب كيسمع الترددات ديال الما وسط الحيوط والجعاب ويعطيك تنبيه.',
    category: 'smart',
    icon: Droplets,
  },
  {
    id: 'cement-formula',
    title: 'حاسبة سيما بفورمول',
    desc: 'فورمول هندسي حقيقي (1.54) والبرويطة',
    voiceGuide: 'حاسبة السيما بالفورمول الحقيقي كتضرب فمعامل التقلص واحد فاصل أربعة وخمسين وتعطيك الخناشي والبرويطات.',
    category: 'smart',
    icon: FlaskConical,
  },

  // === حاسبات البناء (6 أدوات) ===
  {
    id: 'cement',
    title: 'حساب السيما',
    desc: 'خناشي 50 كلغ والرملة والكياس',
    voiceGuide: 'أداة حساب السيما كتعاونك تعرف شحال خاصك من خنشة السيما والرملة للضالة ولا المرطوب.',
    category: 'calc',
    icon: Calculator,
  },
  {
    id: 'concrete',
    title: 'الحساب الخرساني',
    desc: 'حساب البيطون للسواري والضالة',
    voiceGuide: 'الحساب الخرساني كيحسب لك حجم البيطون بالمتر مكعب والسيما والكياس والماء.',
    category: 'calc',
    icon: Hammer,
  },
  {
    id: 'brick',
    title: 'حساب البريك',
    desc: 'عدد البريقات 6 و 8 و 12 تقبة',
    voiceGuide: 'حساب البريك كيحسب ليك شحال من بريقة خاصاك للحيوط مع نسبة الاحتياط.',
    category: 'calc',
    icon: BrickWall,
  },
  {
    id: 'paint',
    title: 'حساب الصباغة',
    desc: 'الليترات والسطولة والفيكساتور',
    voiceGuide: 'حساب الصباغة كيعطيك عدد السطولة ديال عشرين كيلو اللي خاصينك على حساب الكوش.',
    category: 'calc',
    icon: PaintBucket,
  },
  {
    id: 'tile',
    title: 'حساب الزليج',
    desc: 'عدد الحبات والكرطونات والكولا',
    voiceGuide: 'حساب الزليج كيحسب عدد الزليجات والكرطونات وخناشي الكولا للي خاصاك.',
    category: 'calc',
    icon: Grid2x2,
  },
  {
    id: 'rebar',
    title: 'حساب الحديد',
    desc: 'الوزن بالكيلو وقضبان 12 متر',
    voiceGuide: 'حساب الحديد كيحسب لك الوزن بالكيلو وعدد القضبان ديال طناش متر على حساب القطر.',
    category: 'calc',
    icon: Scale,
  },

  // === أدوات الشانطي (6 أدوات) ===
  {
    id: 'level',
    title: 'الميزان',
    desc: 'ميزان الماء الرقمي بالدرجات',
    voiceGuide: 'الميزان الرقمي كيخليك تعبر استواء الأرضية والحيوط مباشرة بالتليفون.',
    category: 'field',
    icon: SlidersHorizontal,
  },
  {
    id: 'compass',
    title: 'بوصلة',
    desc: 'تحديد الشمال، القبلة والشمس',
    voiceGuide: 'البوصلة كتوريك فين كاين الشمال والقبلة واتجاه الشمس باش تحط الفاصاد ديالك مزيان.',
    category: 'field',
    icon: Compass,
  },
  {
    id: 'camera-measure',
    title: 'قياس بالكاميرا',
    desc: 'عبر المسافات فوق الصورة',
    voiceGuide: 'أداة القياس بالكاميرا كتخليك تعبر أي حيط غير من الصورة باستعمال مسافة مرجعية.',
    category: 'field',
    icon: Ruler,
  },
  {
    id: 'voice-ideas',
    title: 'أفكار صوتية',
    desc: 'سجل ملاحظات الشانطي بالصوت',
    voiceGuide: 'أفكار صوتية كتخليك تهضر بالميكروفون وتسجل الملاحظات والسلعة اللي خاصك فالشانطي.',
    category: 'field',
    icon: Mic,
  },
  {
    id: 'draw',
    title: 'رسم على الصورة',
    desc: 'خطط وعلم بالألوان فوق البلان',
    voiceGuide: 'أداة الرسم على الصورة كتخليك تكتب وترسم فوق البلان وتشاركها مع البناي.',
    category: 'field',
    icon: Pencil,
  },
  {
    id: 'qr',
    title: 'QR للمشروع',
    desc: 'كود QR لمعلومات الورشة',
    voiceGuide: 'مولد كود كي آر كيعطيك بطاقة ذكية فيها معلومات الشانطي تقدر تلصقها فالورشة.',
    category: 'field',
    icon: QrCode,
  },
];

export const ToolsView: React.FC<ToolsViewProps> = ({
  activeTool,
  onSelectTool,
  onBackHome,
  initialDrawImage,
  voiceNotes,
  onSaveVoiceNote,
  onDeleteVoiceNote,
}) => {
  const [filter, setFilter] = useState<'all' | 'smart' | 'calc' | 'field'>('all');

  const selectedDef = TOOLS.find((t) => t.id === activeTool) || null;
  const visibleTools = TOOLS.filter((t) => (filter === 'all' ? true : t.category === filter));

  // Standalone Tool Page ("كل أداة صفحة بوحدها")
  if (selectedDef) {
    const isSmart = selectedDef.category === 'smart';
    const isCalc = selectedDef.category === 'calc';

    return (
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectTool(null)}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#11182c] px-4 py-2 text-sm font-bold text-white hover:bg-[#16203a]"
          >
            <ArrowRight className="w-4 h-4 text-[#ff7a1a]" />
            <span>رجوع لصندوق العدة</span>
          </button>

          <div className="flex items-center gap-2">
            <VoiceGenderSwitch />
            <SpeakButton
              id={`tool-guide-${selectedDef.id}`}
              variant="ghost"
              label="شرح الأداة"
              text={selectedDef.voiceGuide}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#11182c] p-5 sm:p-7">
          {isSmart ? (
            <SmartToolkitSuite
              toolId={
                selectedDef.id as
                  | 'metal-detector'
                  | 'laser-level'
                  | 'ar-meter'
                  | 'crack-detector'
                  | 'leak-detector'
                  | 'cement-formula'
              }
            />
          ) : isCalc ? (
            <CalculatorsSuite
              toolId={
                selectedDef.id as 'cement' | 'concrete' | 'brick' | 'paint' | 'tile' | 'rebar'
              }
            />
          ) : (
            <FieldToolsSuite
              toolId={
                selectedDef.id as
                  | 'level'
                  | 'compass'
                  | 'camera-measure'
                  | 'voice-ideas'
                  | 'draw'
                  | 'qr'
              }
              initialDrawImage={initialDrawImage}
              voiceNotes={voiceNotes}
              onSaveVoiceNote={onSaveVoiceNote}
              onDeleteVoiceNote={onDeleteVoiceNote}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-white/15 bg-[#11182c] px-4 py-2 text-sm font-bold text-white hover:bg-[#16203a]"
        >
          <ArrowRight className="w-4 h-4 text-[#ff7a1a]" />
          <span>رجوع للرئيسية</span>
        </button>

        <div className="flex items-center gap-2">
          <VoiceGenderSwitch />
          <SpeakButton
            id="tools-hub-intro"
            variant="secondary"
            label="سمع دليل العدة"
            text="مرحبا بيك فصندوق العدة الذكي: عندك كاشف الحديد، نيفو ليزر، متر الكاميرا، كاشف الشقوق بالذكاء الاصطناعي، كاشف التسريب، وحاسبة السيما بالفورمول الحقيقي، مع طناش أداة أخرى للبناء."
          />
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-extrabold text-white">صندوق العدة الذكي وأدوات الشانطي</h1>
        <p className="text-sm text-slate-400 mt-1">
          كل مربع كيحل ليك أداة فصفحة مستقلة مع الشرح الصوتي بالدارجة (بنت أو ولد)
        </p>
      </div>

      {/* Filter Segmented Control */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-[#11182c] border border-white/10 w-fit">
        {[
          {id: 'all', label: 'الكل (18)'},
          {id: 'smart', label: 'صندوق العدة الذكي (6)'},
          {id: 'calc', label: 'حساب المواد (6)'},
          {id: 'field', label: 'أدوات الشانطي (6)'},
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id as 'all' | 'smart' | 'calc' | 'field')}
            className={`min-h-[40px] px-3.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              filter === tab.id ? 'bg-[#ff7a1a] text-[#0a0f1e]' : 'text-slate-300 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Clickable Square Tool Grid ("مربع قابل للضغط") */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {visibleTools.map((tool) => {
          const Icon = tool.icon;
          const isSmart = tool.category === 'smart';
          return (
            <div
              key={tool.id}
              onClick={() => onSelectTool(tool.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTool(tool.id);
                }
              }}
              className={`group cursor-pointer aspect-square rounded-2xl border p-4 flex flex-col justify-between transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a1a] ${
                isSmart
                  ? 'border-[#ff7a1a]/35 bg-[#11182c] hover:border-[#ff7a1a] hover:bg-[#16203a]'
                  : 'border-white/10 bg-[#11182c] hover:border-[#ff7a1a]/60 hover:bg-[#16203a]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                    isSmart
                      ? 'bg-[#ff7a1a] text-[#0a0f1e]'
                      : 'bg-[#ff7a1a]/15 border border-[#ff7a1a]/30 text-[#ff7a1a]'
                  }`}
                >
                  <Icon className="w-6 h-6" />
                </div>

                <div
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                >
                  <SpeakButton
                    id={`tool-card-${tool.id}`}
                    compact
                    variant="ghost"
                    text={tool.voiceGuide}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-[#ff7a1a]">
                  {isSmart ? 'العدة الذكية' : tool.category === 'calc' ? 'حاسبة' : 'أداة شانطي'}
                </p>
                <h2 className="text-base font-extrabold text-white leading-snug group-hover:text-[#ff7a1a] transition-colors">
                  {tool.title}
                </h2>
                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                  {tool.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
