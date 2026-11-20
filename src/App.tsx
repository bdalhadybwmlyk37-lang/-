import React, {useEffect, useState} from 'react';
import {onAuthStateChanged, type User} from 'firebase/auth';
import {
  BookOpen,
  FolderKanban,
  Home,
  ScanEye,
  Settings,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import {AdminView} from './components/AdminView';
import {AnalyzePlanView} from './components/AnalyzePlanView';
import {CameraModal} from './components/CameraModal';
import {ErrorBoundary} from './components/ErrorBoundary';
import {HomeView} from './components/HomeView';
import {LearnPlanView} from './components/LearnPlanView';
import {ProjectsView} from './components/ProjectsView';
import {SettingsView} from './components/SettingsView';
import {ToolsView} from './components/ToolsView';
import {
  getSelectedVoice,
  SpeechProvider,
  useDarijaSpeech,
  VoiceGenderSwitch,
} from './contexts/SpeechContext';
import {VOICE_GIRL} from '../config.js';
import {OfflineIndicator, PWAInstallButton} from './hooks/usePWAInstall';
import {
  MandatoryCodeGateModal,
  MAX_CODE_TRIALS,
  PaymentBlockedModal,
  TrialProvider,
  useTrialQuota,
  WHATSAPP_NUMBER_DISPLAY,
  WHATSAPP_URL,
} from './hooks/useTrialQuota';
import {
  auth,
  deletePlanFromFirestore,
  deleteVoiceNoteFromFirestore,
  fetchUserSettings,
  savePlanToFirestore,
  saveVoiceNoteToFirestore,
  signInWithGoogle,
  signOutFirebase,
  subscribeAccessCodes,
  subscribeUserPlans,
  subscribeUserVoiceNotes,
  testFirestoreConnection,
  updatePlanTitleInFirestore,
  upsertUserSettings,
} from './lib/firebase';
import type {
  AccessCodeItem,
  AppTab,
  FloorPlanAnalysis,
  SavedPlan,
  ToolId,
  VoiceNoteItem,
} from './types';

const LOCAL_PLANS_KEY = 'fahem_blan_local_plans_v1';
const LOCAL_NOTES_KEY = 'fahem_blan_local_notes_v1';

function loadLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function saveLocal<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // ignore
  }
}

const AppShell: React.FC = () => {
  const {settings, updateSettings, isSpeaking, isLoadingAudio, activeSpeechId, stop, speakPro} =
    useDarijaSpeech();
  const {activeCode, remainingTrials, isCodeBlocked, openPaymentModal, blockReason} = useTrialQuota();

  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    window.location.pathname === '/admin' ? 'admin' : 'home'
  );
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pendingAnalyzeSrc, setPendingAnalyzeSrc] = useState<string | null>(null);
  const [pendingDrawSrc, setPendingDrawSrc] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudPlans, setCloudPlans] = useState<SavedPlan[]>([]);
  const [localPlans, setLocalPlans] = useState<SavedPlan[]>(() =>
    loadLocal<SavedPlan>(LOCAL_PLANS_KEY)
  );
  const [cloudNotes, setCloudNotes] = useState<VoiceNoteItem[]>([]);
  const [localNotes, setLocalNotes] = useState<VoiceNoteItem[]>(() =>
    loadLocal<VoiceNoteItem>(LOCAL_NOTES_KEY)
  );
  const [cloudCodes, setCloudCodes] = useState<AccessCodeItem[]>([]);

  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname === '/admin') {
        setActiveTab('admin');
      } else if (activeTab === 'admin') {
        setActiveTab('home');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeTab]);

  const navigateTab = (tab: AppTab) => {
    setActiveTab(tab);
    if (tab !== 'tools') setActiveTool(null);
    if (tab === 'admin') {
      if (window.location.pathname !== '/admin') {
        window.history.pushState({}, '', '/admin');
      }
    } else if (window.location.pathname === '/admin') {
      window.history.pushState({}, '', '/');
    }
  };

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        try {
          const remoteSettings = await fetchUserSettings(u.uid);
          if (remoteSettings) {
            const hasSavedVoice = Boolean(localStorage.getItem('selectedVoice'));
            updateSettings(
              hasSavedVoice
                ? {
                    ...remoteSettings,
                    voiceGender: getSelectedVoice() === VOICE_GIRL ? 'female' : 'male',
                  }
                : remoteSettings
            );
          } else {
            await upsertUserSettings(u, settings);
          }
        } catch {
          // ignore
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authReady || !user) {
      setCloudPlans([]);
      setCloudNotes([]);
      setCloudCodes([]);
      return;
    }
    const unsubPlans = subscribeUserPlans(user.uid, setCloudPlans);
    const unsubNotes = subscribeUserVoiceNotes(user.uid, setCloudNotes);
    const unsubCodes = subscribeAccessCodes(user.uid, setCloudCodes);
    return () => {
      unsubPlans();
      unsubNotes();
      unsubCodes();
    };
  }, [authReady, user]);

  const allPlans = user ? [...cloudPlans, ...localPlans] : localPlans;
  const allVoiceNotes = user ? [...cloudNotes, ...localNotes] : localNotes;

  const handleCameraCapture = (dataUrl: string) => {
    setCameraOpen(false);
    setPendingAnalyzeSrc(dataUrl);
    navigateTab('analyze');
  };

  const handleSelectImageForAnalysis = (src: string) => {
    setPendingAnalyzeSrc(src);
    navigateTab('analyze');
  };

  const handleOpenInAnnotator = (src: string) => {
    setPendingDrawSrc(src);
    setActiveTool('draw');
    navigateTab('tools');
  };

  const handleSavePlan = async (
    analysis: FloorPlanAnalysis,
    thumbnailDataUrl?: string
  ) => {
    if (user) {
      await savePlanToFirestore(user, analysis, thumbnailDataUrl);
      return;
    }
    const localItem: SavedPlan = {
      ...analysis,
      id: `local_${Date.now()}`,
      ownerId: 'local',
      thumbnailDataUrl,
      createdAtMs: Date.now(),
      syncedToCloud: false,
    };
    const next = [localItem, ...localPlans];
    setLocalPlans(next);
    saveLocal(LOCAL_PLANS_KEY, next);
  };

  const handleDeletePlan = async (id: string) => {
    if (id.startsWith('local_')) {
      const next = localPlans.filter((p) => p.id !== id);
      setLocalPlans(next);
      saveLocal(LOCAL_PLANS_KEY, next);
      return;
    }
    await deletePlanFromFirestore(id);
  };

  const handleRenamePlan = async (id: string, title: string) => {
    if (id.startsWith('local_')) {
      const next = localPlans.map((p) => (p.id === id ? {...p, title} : p));
      setLocalPlans(next);
      saveLocal(LOCAL_PLANS_KEY, next);
      return;
    }
    await updatePlanTitleInFirestore(id, title);
  };

  const handleSaveVoiceNote = async (
    title: string,
    rawTranscript: string,
    structuredDarija: string
  ) => {
    if (user) {
      await saveVoiceNoteToFirestore(user, title, rawTranscript, structuredDarija);
      return;
    }
    const item: VoiceNoteItem = {
      id: `local_note_${Date.now()}`,
      ownerId: 'local',
      title,
      rawTranscript,
      structuredDarija,
      createdAtMs: Date.now(),
      syncedToCloud: false,
    };
    const next = [item, ...localNotes];
    setLocalNotes(next);
    saveLocal(LOCAL_NOTES_KEY, next);
  };

  const handleDeleteVoiceNote = async (id: string) => {
    if (id.startsWith('local_')) {
      const next = localNotes.filter((n) => n.id !== id);
      setLocalNotes(next);
      saveLocal(LOCAL_NOTES_KEY, next);
      return;
    }
    await deleteVoiceNoteFromFirestore(id);
  };

  const handleSignIn = async () => {
    const signedUser = await signInWithGoogle();
    await upsertUserSettings(signedUser, settings);
  };

  const handleSignOut = async () => {
    await signOutFirebase();
  };

  const handleSaveCloudSettings = async () => {
    if (user) {
      await upsertUserSettings(user, settings);
    }
  };

  const navItems: {
    id: Exclude<AppTab, 'admin'>;
    label: string;
    mobileLabel?: string;
    icon: React.ComponentType<{className?: string}>;
  }[] = [
    {id: 'home', label: 'الرئيسية', icon: Home},
    {id: 'analyze', label: 'فهم البلان', mobileLabel: 'البلان', icon: ScanEye},
    {id: 'tools', label: 'الأدوات', icon: Wrench},
    {id: 'learn', label: 'تعلم البلان', mobileLabel: 'تعلم', icon: BookOpen},
    {id: 'projects', label: 'المشاريع', icon: FolderKanban},
    {id: 'settings', label: 'الضبط', icon: Settings},
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1e] blueprint-grid text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones cleanly separated */}
      <header className="sticky top-0 z-30 h-14 border-b border-white/10 bg-[#0a0f1e]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand wordmark */}
          <button
            type="button"
            onClick={() => navigateTab('home')}
            className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <img src="/icon.svg" alt="شعار فاهم بلان" className="w-7 h-7 rounded-lg shrink-0" />
            <span>فاهم بلان</span>
          </button>

          {/* Zone 2: Nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-300">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTab(item.id)}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeTab === item.id
                    ? 'border-[#ff7a1a] text-white'
                    : 'border-transparent hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Quick Voice + Gender + WhatsApp/Trials */}
          <div className="flex items-center gap-2 shrink-0">
            <VoiceGenderSwitch className="hidden sm:inline-flex" />

            {isSpeaking && activeSpeechId === 'header-quick-voice' ? (
              <button
                type="button"
                onClick={stop}
                className="min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-[#ff7a1a] px-3.5 py-1.5 text-xs font-extrabold text-[#0a0f1e] whitespace-nowrap shrink-0"
              >
                <VolumeX className="w-4 h-4 shrink-0" />
                <span>{isLoadingAudio ? 'جاري...' : 'حبس'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void speakPro(
                    'مرحبا بيك فـ فاهم بلان. ورك على صور بلان ديالك باش نقراو ليك مخطط البناء بالدارجة المغربية.',
                    {id: 'header-quick-voice'}
                  )
                }
                aria-label="تشغيل الصوت التعريفي"
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#ff7a1a]/40 bg-[#16203a] px-3 py-1.5 text-xs font-bold text-[#ff7a1a] hover:bg-[#1e2b4d] whitespace-nowrap shrink-0"
              >
                <Volume2 className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">سمع</span>
              </button>
            )}

            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={`واتساب ${WHATSAPP_NUMBER_DISPLAY}`}
              aria-label="واتساب"
              className="relative min-h-[34px] inline-flex items-center gap-1.5 rounded-full bg-[#25D366] hover:bg-[#1ebe5b] px-2.5 py-1 text-[11px] font-extrabold text-[#062411] shadow-md shadow-[#25D366]/25 whitespace-nowrap shrink-0 transition-colors"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-0.5 rounded-full bg-[#25D366]/40 animate-pulse"
              />
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="relative w-3.5 h-3.5 shrink-0"
              >
                <path d="M12.031 2c-5.516 0-9.969 4.453-9.969 9.969 0 1.766.453 3.484 1.328 5l-1.391 5.078 5.203-1.359a9.92 9.92 0 0 0 4.828 1.25c5.516 0 9.969-4.453 9.969-9.969S17.547 2 12.031 2zm5.813 14.125c-.25.703-1.438 1.344-1.984 1.422-.531.078-1.203.109-1.938-.125-.453-.141-1.031-.344-1.766-.656-3.094-1.344-5.109-4.484-5.266-4.688-.156-.203-1.266-1.688-1.266-3.219 0-1.531.797-2.281 1.078-2.594.281-.313.625-.391.828-.391.203 0 .422 0 .609.016.188.016.453-.078.703.531.266.625.891 2.172.969 2.328.078.156.125.344.031.547-.094.203-.156.344-.313.516-.156.172-.328.391-.469.516-.156.156-.313.328-.141.641.188.313.813 1.344 1.75 2.172 1.203 1.078 2.219 1.406 2.531 1.563.313.156.5.125.688-.078.188-.203.797-.938 1.016-1.25.219-.313.422-.266.719-.156.297.109 1.891.891 2.219 1.047.328.156.547.234.625.375.078.141.078.797-.172 1.5z" />
              </svg>
              <span className="relative">واتساب</span>
            </a>

            <div className="hidden xl:block">
              <PWAInstallButton compact />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-10">
        {activeTab === 'home' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {isCodeBlocked ? (
                <button
                  type="button"
                  onClick={() => openPaymentModal(blockReason || 'limit_reached')}
                  className="text-xs font-bold text-red-300 hover:text-red-200 underline underline-offset-4"
                >
                  {blockReason === 'inactive'
                    ? `الكود (${activeCode}) موقوف — تواصل عبر واتساب ${WHATSAPP_NUMBER_DISPLAY}`
                    : `ساليو تجارب الكود (${activeCode}: 0/${MAX_CODE_TRIALS}) — تواصل عبر واتساب ${WHATSAPP_NUMBER_DISPLAY}`}
                </button>
              ) : (
                <span className="text-xs font-semibold text-slate-400">
                  الكود: <span className="font-mono-nums text-[#ff7a1a] font-bold">{activeCode || '---'}</span> · الباقي:{' '}
                  <span className="font-mono-nums text-white font-bold">
                    {remainingTrials} / {MAX_CODE_TRIALS}
                  </span>
                </span>
              )}
              <VoiceGenderSwitch />
            </div>
            <HomeView
              onOpenCamera={() => setCameraOpen(true)}
              onSelectImageForAnalysis={handleSelectImageForAnalysis}
              onNavigate={(tab) => navigateTab(tab)}
              recentPlans={allPlans}
              onOpenSavedPlan={() => navigateTab('projects')}
            />
          </div>
        )}

        {activeTab === 'analyze' && (
          <AnalyzePlanView
            initialImageSrc={pendingAnalyzeSrc}
            onClearInitialImage={() => setPendingAnalyzeSrc(null)}
            onOpenCamera={() => setCameraOpen(true)}
            onSavePlan={handleSavePlan}
            onOpenInAnnotator={handleOpenInAnnotator}
            onBack={() => navigateTab('home')}
          />
        )}

        {activeTab === 'tools' && (
          <ToolsView
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onBackHome={() => navigateTab('home')}
            initialDrawImage={pendingDrawSrc}
            voiceNotes={allVoiceNotes}
            onSaveVoiceNote={handleSaveVoiceNote}
            onDeleteVoiceNote={handleDeleteVoiceNote}
          />
        )}

        {activeTab === 'learn' && <LearnPlanView onBack={() => navigateTab('home')} />}

        {activeTab === 'projects' && (
          <ProjectsView
            plans={allPlans}
            user={user}
            onSignIn={handleSignIn}
            onDeletePlan={handleDeletePlan}
            onRenamePlan={handleRenamePlan}
            onOpenInAnnotator={handleOpenInAnnotator}
            onGoAnalyze={() => navigateTab('analyze')}
            onBack={() => navigateTab('home')}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            user={user}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onSaveCloudSettings={handleSaveCloudSettings}
            onOpenAdmin={() => navigateTab('admin')}
            onBack={() => navigateTab('home')}
          />
        )}

        {activeTab === 'admin' && (
          <AdminView
            user={user}
            cloudCodes={cloudCodes}
            onBack={() => navigateTab('home')}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="التنقل الرئيسي"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0a0f1e]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-6 h-16 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTab(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active ? 'text-[#ff7a1a]' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-bold tracking-tight whitespace-nowrap">
                  {item.mobileLabel || item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <CameraModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
      />

      <MandatoryCodeGateModal
        suppressGate={activeTab === 'admin'}
        onOpenAdmin={() => navigateTab('admin')}
      />

      <PaymentBlockedModal />

      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <SpeechProvider>
        <TrialProvider>
          <AppShell />
        </TrialProvider>
      </SpeechProvider>
    </ErrorBoundary>
  );
}
