import {initializeApp} from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AccessCodeItem,
  FloorPlanAnalysis,
  SavedPlan,
  TtsApiKeySlot,
  TtsApiKeyStatus,
  UserSettings,
  VoiceNoteItem,
} from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

function clampString(val: string | undefined, fallback: string, maxLen: number): string {
  const clean = (val || '').trim();
  if (!clean) return fallback.slice(0, maxLen);
  return clean.slice(0, maxLen);
}

function makeValidDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
}

export async function upsertUserSettings(user: User, settings: UserSettings): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const safeName = clampString(user.displayName || 'مستخدم فاهم بلان', 'مستخدم فاهم بلان', 100);
  const safeRate = Math.min(1.4, Math.max(0.7, Number(settings.speechRate) || 1));

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName: safeName,
        voiceEnabled: Boolean(settings.voiceEnabled),
        voiceGender: settings.voiceGender === 'female' ? 'female' : 'male',
        speechRate: safeRate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: safeName,
        voiceEnabled: Boolean(settings.voiceEnabled),
        voiceGender: settings.voiceGender === 'female' ? 'female' : 'male',
        speechRate: safeRate,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchUserSettings(uid: string): Promise<UserSettings | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      voiceEnabled: typeof d.voiceEnabled === 'boolean' ? d.voiceEnabled : true,
      voiceGender: d.voiceGender === 'female' ? 'female' : 'male',
      speechRate: typeof d.speechRate === 'number' ? d.speechRate : 1,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function savePlanToFirestore(
  user: User,
  analysis: FloorPlanAnalysis,
  thumbnailDataUrl?: string
): Promise<SavedPlan> {
  const planId = makeValidDocId('plan');
  const path = `plans/${planId}`;
  const safeThumbnail =
    thumbnailDataUrl && thumbnailDataUrl.length <= 245000 ? thumbnailDataUrl : undefined;

  const payload = {
    ownerId: user.uid,
    title: clampString(analysis.title, 'بلان بدون عنوان', 120),
    buildingType: clampString(analysis.buildingType, 'بناء سكني', 100),
    totalAreaSqm: clampString(analysis.totalAreaSqm, 'غير محددة', 40),
    roomsCount: Math.min(200, Math.max(0, Math.round(Number(analysis.roomsCount) || 0))),
    darijaSummary: clampString(analysis.darijaSummary, 'شرح البلان بالدارجة', 5000),
    audioScript: clampString(analysis.audioScript, analysis.darijaSummary || 'شرح البلان', 5000),
    rooms: (analysis.rooms || []).slice(0, 40),
    materials: (analysis.materials || []).slice(0, 40),
    workPhases: (analysis.workPhases || []).slice(0, 20),
    warningsDarija: (analysis.warningsDarija || [])
      .filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
      .slice(0, 20),
    ...(safeThumbnail ? {thumbnailDataUrl: safeThumbnail} : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'plans', planId), payload);
    return {
      ...analysis,
      title: payload.title,
      buildingType: payload.buildingType,
      totalAreaSqm: payload.totalAreaSqm,
      roomsCount: payload.roomsCount,
      darijaSummary: payload.darijaSummary,
      audioScript: payload.audioScript,
      rooms: payload.rooms,
      materials: payload.materials,
      workPhases: payload.workPhases,
      warningsDarija: payload.warningsDarija,
      id: planId,
      ownerId: user.uid,
      thumbnailDataUrl: safeThumbnail,
      createdAtMs: Date.now(),
      syncedToCloud: true,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePlanTitleInFirestore(
  planId: string,
  title: string
): Promise<void> {
  const path = `plans/${planId}`;
  try {
    await updateDoc(doc(db, 'plans', planId), {
      title: clampString(title, 'بلان بدون عنوان', 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePlanFromFirestore(planId: string): Promise<void> {
  const path = `plans/${planId}`;
  try {
    await deleteDoc(doc(db, 'plans', planId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserPlans(
  uid: string,
  onPlans: (plans: SavedPlan[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'plans';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedPlan[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdTs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
        return {
          id: d.id,
          ownerId: String(data.ownerId || uid),
          title: String(data.title || 'بلان'),
          buildingType: String(data.buildingType || 'بناء سكني'),
          totalAreaSqm: String(data.totalAreaSqm || 'غير محددة'),
          roomsCount: Number(data.roomsCount || 0),
          darijaSummary: String(data.darijaSummary || ''),
          audioScript: String(data.audioScript || data.darijaSummary || ''),
          rooms: Array.isArray(data.rooms) ? data.rooms : [],
          materials: Array.isArray(data.materials) ? data.materials : [],
          workPhases: Array.isArray(data.workPhases) ? data.workPhases : [],
          warningsDarija: Array.isArray(data.warningsDarija) ? data.warningsDarija : [],
          thumbnailDataUrl: typeof data.thumbnailDataUrl === 'string' ? data.thumbnailDataUrl : undefined,
          createdAtMs: createdTs,
          syncedToCloud: true,
        };
      });
      onPlans(items);
    },
    (error) => {
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function saveVoiceNoteToFirestore(
  user: User,
  title: string,
  rawTranscript: string,
  structuredDarija: string
): Promise<VoiceNoteItem> {
  const noteId = makeValidDocId('note');
  const path = `voiceNotes/${noteId}`;
  const payload = {
    ownerId: user.uid,
    title: clampString(title, 'فكرة صوتية من الشانطي', 120),
    rawTranscript: clampString(rawTranscript, '-', 3000),
    structuredDarija: clampString(structuredDarija, rawTranscript, 5000),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'voiceNotes', noteId), payload);
    return {
      id: noteId,
      ownerId: user.uid,
      title: payload.title,
      rawTranscript: payload.rawTranscript,
      structuredDarija: payload.structuredDarija,
      createdAtMs: Date.now(),
      syncedToCloud: true,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteVoiceNoteFromFirestore(noteId: string): Promise<void> {
  const path = `voiceNotes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'voiceNotes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserVoiceNotes(
  uid: string,
  onNotes: (notes: VoiceNoteItem[]) => void
): Unsubscribe {
  const path = 'voiceNotes';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const notes: VoiceNoteItem[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdTs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
        return {
          id: d.id,
          ownerId: String(data.ownerId || uid),
          title: String(data.title || 'فكرة'),
          rawTranscript: String(data.rawTranscript || ''),
          structuredDarija: String(data.structuredDarija || ''),
          createdAtMs: createdTs,
          syncedToCloud: true,
        };
      });
      onNotes(notes);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveAccessCodeToFirestore(
  user: User,
  name: string,
  code: string
): Promise<AccessCodeItem> {
  const codeId = makeValidDocId('code');
  const path = `accessCodes/${codeId}`;
  const cleanName = clampString(name, 'زبون فاهم بلان', 100);
  const cleanCode = clampString(code.toUpperCase(), 'FAHEM999', 40);

  const payload = {
    ownerId: user.uid,
    name: cleanName,
    code: cleanCode,
    isActive: true,
    trials: 0,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'accessCodes', codeId), payload);
    return {
      id: codeId,
      ownerId: user.uid,
      name: cleanName,
      code: cleanCode,
      isActive: true,
      trials: 0,
      createdAtMs: Date.now(),
      syncedToCloud: true,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAccessCodeInFirestore(
  codeId: string,
  updates: {isActive?: boolean; trials?: number; name?: string; code?: string}
): Promise<void> {
  const path = `accessCodes/${codeId}`;
  const cleanUpdates: Record<string, unknown> = {};
  if (typeof updates.isActive === 'boolean') cleanUpdates.isActive = updates.isActive;
  if (typeof updates.trials === 'number' && Number.isFinite(updates.trials)) {
    cleanUpdates.trials = Math.min(10000, Math.max(0, Math.round(updates.trials)));
  }
  if (typeof updates.name === 'string' && updates.name.trim()) {
    cleanUpdates.name = clampString(updates.name, 'زبون فاهم بلان', 100);
  }
  if (typeof updates.code === 'string' && updates.code.trim()) {
    cleanUpdates.code = clampString(updates.code.toUpperCase(), 'FAHEM999', 40);
  }
  try {
    await updateDoc(doc(db, 'accessCodes', codeId), cleanUpdates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAccessCodeFromFirestore(codeId: string): Promise<void> {
  const path = `accessCodes/${codeId}`;
  try {
    await deleteDoc(doc(db, 'accessCodes', codeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeAccessCodes(
  uid: string,
  onCodes: (codes: AccessCodeItem[]) => void
): Unsubscribe {
  const path = 'accessCodes';
  const q = query(
    collection(db, path),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AccessCodeItem[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdTs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
        const isActiveVal =
          typeof data.isActive === 'boolean'
            ? data.isActive
            : typeof data.active === 'boolean'
              ? data.active
              : true;
        return {
          id: d.id,
          ownerId: String(data.ownerId || uid),
          name: String(data.name || ''),
          code: String(data.code || ''),
          isActive: isActiveVal,
          trials: Number.isFinite(Number(data.trials)) ? Math.max(0, Number(data.trials)) : 0,
          createdAtMs: createdTs,
          syncedToCloud: true,
        };
      });
      onCodes(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export interface TtsApiKeyFirestoreRecord {
  order: number;
  encryptedKey: string;
  status: TtsApiKeyStatus;
  lastUsed: number;
  failCount: number;
}

export async function fetchTtsApiKeysFromFirestore(): Promise<TtsApiKeyFirestoreRecord[]> {
  const path = 'tts_api_keys';
  try {
    const q = query(collection(db, path), orderBy('order', 'asc'));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        const order = Number(data.order || 0);
        const encryptedKey = typeof data.key === 'string' ? data.key : '';
        const status: TtsApiKeyStatus = data.status === 'exhausted' ? 'exhausted' : 'active';
        const lastUsed = Number.isFinite(Number(data.lastUsed)) ? Math.max(0, Math.round(Number(data.lastUsed))) : 0;
        const failCount = Number.isFinite(Number(data.failCount)) ? Math.max(0, Math.round(Number(data.failCount))) : 0;
        return {order, encryptedKey, status, lastUsed, failCount};
      })
      .filter((item) => item.order >= 1 && item.order <= 20 && item.encryptedKey.length > 0);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function syncTtsApiKeysToFirestore(
  user: User,
  slots: TtsApiKeySlot[]
): Promise<void> {
  for (const slot of slots) {
    if (slot.order < 1 || slot.order > 20) continue;
    const keyId = `key_${slot.order}`;
    const path = `tts_api_keys/${keyId}`;
    const ref = doc(db, 'tts_api_keys', keyId);

    try {
      const snap = await getDoc(ref);
      if (slot.hasKey && slot.encryptedKey) {
        const cleanCipher = slot.encryptedKey.trim().slice(0, 1024);
        const safeStatus: TtsApiKeyStatus = slot.status === 'exhausted' ? 'exhausted' : 'active';
        const safeLastUsed = Math.max(0, Math.round(Number(slot.lastUsed) || 0));
        const safeFailCount = Math.min(100000, Math.max(0, Math.round(Number(slot.failCount) || 0)));

        if (!snap.exists()) {
          await setDoc(ref, {
            ownerId: user.uid,
            key: cleanCipher,
            order: slot.order,
            status: safeStatus,
            lastUsed: safeLastUsed,
            failCount: safeFailCount,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            key: cleanCipher,
            order: slot.order,
            status: safeStatus,
            lastUsed: safeLastUsed,
            failCount: safeFailCount,
            updatedAt: serverTimestamp(),
          });
        }
      } else if (snap.exists()) {
        await deleteDoc(ref);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}


