import React, {useState} from 'react';
import {SpeakButton} from '../../contexts/SpeechContext';
import type {ToolId} from '../../types';

interface CalculatorProps {
  toolId: Extract<ToolId, 'cement' | 'concrete' | 'brick' | 'paint' | 'tile' | 'rebar'>;
}

export const CalculatorsSuite: React.FC<CalculatorProps> = ({toolId}) => {
  // 1. Cement
  const [cementArea, setCementArea] = useState('25');
  const [cementThicknessCm, setCementThicknessCm] = useState('10');
  const [cementMix, setCementMix] = useState<'slab' | 'mortar' | 'plaster'>('slab');

  // 2. Concrete
  const [concL, setConcL] = useState('5');
  const [concW, setConcW] = useState('4');
  const [concH, setConcH] = useState('0.15');
  const [concCount, setConcCount] = useState('1');

  // 3. Brick
  const [wallL, setWallL] = useState('6');
  const [wallH, setWallH] = useState('3');
  const [openingsArea, setOpeningsArea] = useState('2');
  const [brickType, setBrickType] = useState<'6' | '8' | '12'>('8');

  // 4. Paint
  const [paintArea, setPaintArea] = useState('80');
  const [paintCoats, setPaintCoats] = useState('2');
  const [paintDeduction, setPaintDeduction] = useState('8');

  // 5. Tile
  const [tileL, setTileL] = useState('5');
  const [tileW, setTileW] = useState('4');
  const [tileSizeCm, setTileSizeCm] = useState<'30' | '45' | '60' | '80'>('60');
  const [tileWaste, setTileWaste] = useState('10');

  // 6. Rebar
  const [rebarDia, setRebarDia] = useState<'6' | '8' | '10' | '12' | '14' | '16'>('12');
  const [rebarLen, setRebarLen] = useState('6');
  const [rebarCount, setRebarCount] = useState('20');

  const n = (val: string, fallback = 0) => {
    const parsed = parseFloat(val);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  if (toolId === 'cement') {
    const area = n(cementArea);
    const thickM = n(cementThicknessCm) / 100;
    const volumeM3 = area * thickM;
    const bagsPerM3 = cementMix === 'slab' ? 7 : cementMix === 'mortar' ? 6 : 5;
    const bags = Math.ceil(volumeM3 * bagsPerM3);
    const sandM3 = +(volumeM3 * (cementMix === 'slab' ? 0.5 : 1.0)).toFixed(2);
    const gravelM3 = cementMix === 'slab' ? +(volumeM3 * 0.8).toFixed(2) : 0;

    const voiceText = `بالنسبة لمساحة ${area} متر مربع وسمك ${cementThicknessCm} سنتيمتر، خاصك تقريباً ${bags} خنشة ديال السيما من فئة خمسين كيلوغرام، ومعاها ${sandM3} متر مكعب ديال الرملة${gravelM3 > 0 ? ` و ${gravelM3} متر مكعب ديال الكياس` : ''}.`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">حساب السيما (الإسمنت)</h2>
            <p className="text-sm text-slate-400">حسب شحال خاصك من خنشة السيما 50 كلغ والرملة</p>
          </div>
          <SpeakButton id="calc-cement-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceText} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">المساحة (م²)</span>
            <input type="number" min="0" step="0.5" value={cementArea} onChange={(e) => setCementArea(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">السمك (سنتيمتر)</span>
            <input type="number" min="1" step="1" value={cementThicknessCm} onChange={(e) => setCementThicknessCm(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">نوع الاستعمال</span>
            <select value={cementMix} onChange={(e) => setCementMix(e.target.value as 'slab' | 'mortar' | 'plaster')} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white focus:border-[#ff7a1a] focus:outline-none">
              <option value="slab">بيطون / ضالة (350 كغ/م³)</option>
              <option value="mortar">مونة البني / الفورمة (300 كغ/م³)</option>
              <option value="plaster">المرطوب (250 كغ/م³)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/10 pt-5">
          <div>
            <p className="text-xs text-slate-400">الحجم الكلي</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{volumeM3.toFixed(2)} م³</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">خناشي السيما (50 كلغ)</p>
            <p className="text-2xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{bags} خنشة</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الرملة المطلوبة</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{sandM3} م³</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الكياس (كرافيط)</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{gravelM3} م³</p>
          </div>
        </div>
      </div>
    );
  }

  if (toolId === 'concrete') {
    const vol = n(concL) * n(concW) * n(concH) * Math.max(1, n(concCount, 1));
    const bags = Math.ceil(vol * 7); // 350kg/m3 standard Moroccan structural concrete
    const sandM3 = +(vol * 0.45).toFixed(2);
    const gravelM3 = +(vol * 0.82).toFixed(2);
    const waterL = Math.round(vol * 175);

    const voiceText = `الحجم الخرساني هو ${vol.toFixed(2)} متر مكعب. باش تخلط هاد البيطون مزيان، خاصك ${bags} خنشة ديال السيما، و ${sandM3} متر مكعب رملة، و ${gravelM3} متر مكعب ديال الكياس، وتقريباً ${waterL} ليتر ديال الما.`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">الحساب الخرساني (البيطون)</h2>
            <p className="text-sm text-slate-400">للسواري، السوميلات، الشيناج والضالة (عيار 350 كغ/م³)</p>
          </div>
          <SpeakButton id="calc-concrete-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceText} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">الطول (متر)</span>
            <input type="number" step="0.1" value={concL} onChange={(e) => setConcL(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">العرض (متر)</span>
            <input type="number" step="0.1" value={concW} onChange={(e) => setConcW(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">العلو / السمك (متر)</span>
            <input type="number" step="0.05" value={concH} onChange={(e) => setConcH(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">العدد (مثلا عدد السواري)</span>
            <input type="number" min="1" step="1" value={concCount} onChange={(e) => setConcCount(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 border-t border-white/10 pt-5">
          <div>
            <p className="text-xs text-slate-400">حجم البيطون</p>
            <p className="text-xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{vol.toFixed(2)} م³</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">السيما CPJ45</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{bags} خنشة</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الرملة</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{sandM3} م³</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الكياس</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{gravelM3} م³</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الماء</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{waterL} لتر</p>
          </div>
        </div>
      </div>
    );
  }

  if (toolId === 'brick') {
    const netArea = Math.max(0, n(wallL) * n(wallH) - n(openingsArea));
    // Moroccan hollow brick standards per m² (~16 to 17 bricks/m² for 20x30 face + mortar)
    const perSqm = brickType === '6' ? 17 : brickType === '8' ? 16.5 : 15.5;
    const rawBricks = Math.ceil(netArea * perSqm);
    const totalWithWaste = Math.ceil(rawBricks * 1.05);
    const cementBags = Math.ceil(netArea * (brickType === '12' ? 0.25 : 0.16));

    const voiceText = `المساحة الصافية ديال الحيط هي ${netArea.toFixed(1)} متر مربع. خاصك تقريباً ${totalWithWaste} بريقة من نوع ${brickType} تقابي بالزيادة ديال التهراس، ومعاها ${cementBags} خناشي ديال السيما باش تلصقها.`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">حساب البريك (الآجور)</h2>
            <p className="text-sm text-slate-400">احسب عدد البريقات والسيما مع حساب نسبة 5% للضيعان</p>
          </div>
          <SpeakButton id="calc-brick-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceText} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">طول الحيط (م)</span>
            <input type="number" step="0.1" value={wallL} onChange={(e) => setWallL(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">علو الحيط (م)</span>
            <input type="number" step="0.1" value={wallH} onChange={(e) => setWallH(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">مساحة البيبان والشرجم (م²)</span>
            <input type="number" step="0.5" value={openingsArea} onChange={(e) => setOpeningsArea(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">نوع البريك</span>
            <select value={brickType} onChange={(e) => setBrickType(e.target.value as '6' | '8' | '12')} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white focus:border-[#ff7a1a] focus:outline-none">
              <option value="6">بريك 6 تقابي (فواصل داخلية)</option>
              <option value="8">بريك 8 تقابي (قياسي)</option>
              <option value="12">بريك 12 تقبة (عريض)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-t border-white/10 pt-5">
          <div>
            <p className="text-xs text-slate-400">المساحة الصافية</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{netArea.toFixed(1)} م²</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">عدد البريك (+5% احتياط)</p>
            <p className="text-2xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{totalWithWaste} بريقة</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">السيما للمونة</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{cementBags} خنشة</p>
          </div>
        </div>
      </div>
    );
  }

  if (toolId === 'paint') {
    const netArea = Math.max(0, n(paintArea) - n(paintDeduction));
    const coats = Math.max(1, n(paintCoats, 2));
    const litersNeeded = Math.ceil((netArea * coats) / 9); // ~9 m² per liter per coat
    const buckets20Kg = Math.ceil(litersNeeded / 14); // 20kg Moroccan bucket ~ 14L
    const primerLiters = Math.ceil(netArea / 11);

    const voiceText = `لمساحة صافية ديال ${netArea.toFixed(0)} متر مربع وعلى ${coats} كوش، خاصك تقريباً ${litersNeeded} ليتر ديال الصباغة، يعني ${buckets20Kg} سطولة كبار ديال عشرين كيلوغرام، و ${primerLiters} ليتر ديال الفيكساتور فالأول.`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">حساب الصباغة</h2>
            <p className="text-sm text-slate-400">احسب شحال من سطل الصباغة والفيكساتور على حساب الحيوط</p>
          </div>
          <SpeakButton id="calc-paint-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceText} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">مساحة الحيوط والسقف (م²)</span>
            <input type="number" step="1" value={paintArea} onChange={(e) => setPaintArea(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">نقص البيبان والشراجم (م²)</span>
            <input type="number" step="1" value={paintDeduction} onChange={(e) => setPaintDeduction(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">عدد الطبقات (كوش)</span>
            <select value={paintCoats} onChange={(e) => setPaintCoats(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white focus:border-[#ff7a1a] focus:outline-none">
              <option value="1">1 كوش (طبقة وحدة)</option>
              <option value="2">2 كوش (عادي)</option>
              <option value="3">3 كوش (فينيسيون ممتازة)</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/10 pt-5">
          <div>
            <p className="text-xs text-slate-400">المساحة الصافية</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{netArea.toFixed(0)} م²</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">كمية الصباغة</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{litersNeeded} لتر</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">سطولة (20 كلغ)</p>
            <p className="text-2xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{buckets20Kg} سطل</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الفيكساتور (البريمير)</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{primerLiters} لتر</p>
          </div>
        </div>
      </div>
    );
  }

  if (toolId === 'tile') {
    const area = n(tileL) * n(tileW);
    const wasteMult = 1 + n(tileWaste, 10) / 100;
    const totalSqmWithWaste = area * wasteMult;
    const sideM = parseInt(tileSizeCm, 10) / 100;
    const tileArea = sideM * sideM;
    const tilesCount = Math.ceil(totalSqmWithWaste / tileArea);
    const boxes = Math.ceil(totalSqmWithWaste / 1.44); // standard ~1.44m² per box
    const glueBags = Math.ceil(area / 4.5);

    const voiceText = `المساحة هي ${area.toFixed(1)} متر مربع. مع الزيادة ديال التقطيع خاصك تشري ${totalSqmWithWaste.toFixed(1)} متر مربع ديال الزليج، يعني تقريباً ${tilesCount} حبة، أي ${boxes} كرطونة، ومعاها ${glueBags} خناشي ديال الكولا.`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-white">حساب الزليج والرخام</h2>
            <p className="text-sm text-slate-400">احسب عدد الحبات والكرطونات والكولا على حساب قياس الزليجة</p>
          </div>
          <SpeakButton id="calc-tile-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceText} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">الطول (م)</span>
            <input type="number" step="0.1" value={tileL} onChange={(e) => setTileL(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">العرض (م)</span>
            <input type="number" step="0.1" value={tileW} onChange={(e) => setTileW(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">قياس الزليجة</span>
            <select value={tileSizeCm} onChange={(e) => setTileSizeCm(e.target.value as '30' | '45' | '60' | '80')} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white focus:border-[#ff7a1a] focus:outline-none">
              <option value="30">30 × 30 سم</option>
              <option value="45">45 × 45 سم</option>
              <option value="60">60 × 60 سم</option>
              <option value="80">80 × 80 سم</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">احتياط التقطيع (%)</span>
            <input type="number" min="0" max="30" value={tileWaste} onChange={(e) => setTileWaste(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/10 pt-5">
          <div>
            <p className="text-xs text-slate-400">المساحة + الاحتياط</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{totalSqmWithWaste.toFixed(1)} م²</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">عدد الزليجات</p>
            <p className="text-2xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{tilesCount} حبة</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">عدد الكرطونات (تقريبي)</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{boxes} كرطونة</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الكولا (25 كلغ)</p>
            <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{glueBags} خنشة</p>
          </div>
        </div>
      </div>
    );
  }

  // Rebar Calculator (d² / 162 kg/m)
  const d = parseInt(rebarDia, 10);
  const kgPerM = (d * d) / 162;
  const totalMeters = n(rebarLen) * n(rebarCount);
  const totalKg = totalMeters * kgPerM;
  const standardBars12m = Math.ceil(totalMeters / 12);

  const voiceText = `بالنسبة للحديد رقم ${rebarDia}، الطول الإجمالي هو ${totalMeters.toFixed(1)} متر، يعني خاصك ${standardBars12m} قضيب ديال طناش متر. الوزن الكلي كيساوي تقريباً ${totalKg.toFixed(1)} كيلوغرام.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white">حساب الحديد (الفراياج)</h2>
          <p className="text-sm text-slate-400">حساب الوزن بالكيلو والقنطار وعدد القضبان ديال 12 متر</p>
        </div>
        <SpeakButton id="calc-rebar-voice" variant="primary" label="سمع النتيجة بالدارجة" text={voiceText} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">القطر (الرقم)</span>
          <select value={rebarDia} onChange={(e) => setRebarDia(e.target.value as '6' | '8' | '10' | '12' | '14' | '16')} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white focus:border-[#ff7a1a] focus:outline-none">
            <option value="6">T6 (حديد الرقاق / الكادرات)</option>
            <option value="8">T8 (8 ملم)</option>
            <option value="10">T10 (10 ملم)</option>
            <option value="12">T12 (12 ملم للسواري)</option>
            <option value="14">T14 (14 ملم)</option>
            <option value="16">T16 (16 ملم ثقيل)</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">طول كل قطعة (متر)</span>
          <input type="number" step="0.5" value={rebarLen} onChange={(e) => setRebarLen(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">عدد القطع</span>
          <input type="number" min="1" step="1" value={rebarCount} onChange={(e) => setRebarCount(e.target.value)} className="w-full min-h-[46px] rounded-xl border border-white/10 bg-[#0a0f1e] px-4 text-white font-mono-nums focus:border-[#ff7a1a] focus:outline-none" />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-white/10 pt-5">
        <div>
          <p className="text-xs text-slate-400">مجموع الأمتار</p>
          <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{totalMeters.toFixed(1)} م</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">قضبان 12 متر</p>
          <p className="text-2xl font-extrabold text-[#ff7a1a] font-mono-nums mt-1">{standardBars12m} قضيب</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">الوزن بالكيلوغرام</p>
          <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{totalKg.toFixed(1)} كلغ</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">بالقنطار</p>
          <p className="text-xl font-extrabold text-white font-mono-nums mt-1">{(totalKg / 100).toFixed(2)} قنطار</p>
        </div>
      </div>
    </div>
  );
};
