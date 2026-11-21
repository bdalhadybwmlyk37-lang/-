export type AppTab = 'home' | 'analyze' | 'tools' | 'learn' | 'projects' | 'settings' | 'admin';

export type ToolId =
  | 'metal-detector'
  | 'laser-level'
  | 'ar-meter'
  | 'crack-detector'
  | 'leak-detector'
  | 'cement-formula'
  | 'cement'
  | 'concrete'
  | 'brick'
  | 'paint'
  | 'tile'
  | 'rebar'
  | 'level'
  | 'compass'
  | 'camera-measure'
  | 'voice-ideas'
  | 'draw'
  | 'qr';

export type VoiceGender = 'male' | 'female';

export interface UserSettings {
  voiceEnabled: boolean;
  voiceGender: VoiceGender;
  speechRate: number;
}

export interface RoomAnalysis {
  name: string;
  areaSqm: string;
  notesDarija: string;
}

export interface MaterialEstimate {
  item: string;
  quantityEstimate: string;
  unit: string;
  notesDarija: string;
}

export interface WorkPhase {
  stepNumber: number;
  phaseName: string;
  durationEstimate: string;
  explanationDarija: string;
}

export interface FloorPlanAnalysis {
  isBlueprint?: boolean;
  title: string;
  buildingType: string;
  totalAreaSqm: string;
  roomsCount: number;
  darijaSummary: string;
  rebarDetailsDarija?: string;
  audioScript: string;
  rooms: RoomAnalysis[];
  materials: MaterialEstimate[];
  workPhases: WorkPhase[];
  warningsDarija: string[];
}

export interface PlanChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageUrl?: string;
  analysis?: FloorPlanAnalysis;
  timestampMs: number;
}

export interface SavedPlan extends FloorPlanAnalysis {
  id: string;
  ownerId: string;
  thumbnailDataUrl?: string;
  createdAtMs: number;
  syncedToCloud: boolean;
}

export interface VoiceNoteItem {
  id: string;
  ownerId: string;
  title: string;
  rawTranscript: string;
  structuredDarija: string;
  createdAtMs: number;
  syncedToCloud: boolean;
}

export interface AccessCodeItem {
  id: string;
  ownerId: string;
  name: string;
  code: string;
  isActive: boolean;
  trials: number;
  createdAtMs: number;
  updatedAtMs?: number;
  syncedToCloud: boolean;
}

export type TtsApiKeyStatus = 'active' | 'exhausted';

export type TtsFailureReason = 'no_keys' | 'invalid_key' | 'quota_exhausted' | 'unavailable';

export interface TtsApiKeySlot {
  order: number;
  hasKey: boolean;
  maskedKey: string;
  encryptedKey?: string;
  status: TtsApiKeyStatus;
  lastUsed: number;
  failCount: number;
  source?: 'vault' | 'env';
}

