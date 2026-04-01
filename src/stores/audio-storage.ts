import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "tts-app";
const DB_VERSION = 1;
const STORE_NAME = "audio";

interface AudioDB {
  audio: {
    key: string;
    value: Blob | ArrayBuffer;
  };
}

let dbPromise: Promise<IDBPDatabase<AudioDB>> | null = null;

function getDB(): Promise<IDBPDatabase<AudioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

// --- Key helpers ---

function promptKey(projectId: string): string {
  return `${projectId}/promptVoice`;
}

function approvedAudioKey(projectId: string, sentenceIndex: number): string {
  return `${projectId}/sentence_${sentenceIndex}/concatenated`;
}

function projectPrefix(projectId: string): string {
  return `${projectId}/`;
}

// --- Public API ---

export async function savePromptVoice(
  projectId: string,
  blob: Blob,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, blob, promptKey(projectId));
}

export async function loadPromptVoice(
  projectId: string,
): Promise<Blob | undefined> {
  const db = await getDB();
  const result = await db.get(STORE_NAME, promptKey(projectId));
  return result instanceof Blob ? result : undefined;
}

export async function saveApprovedAudio(
  projectId: string,
  sentenceIndex: number,
  audio: ArrayBuffer,
): Promise<void> {
  const db = await getDB();
  await db.put(
    STORE_NAME,
    audio,
    approvedAudioKey(projectId, sentenceIndex),
  );
}

export async function loadApprovedAudio(
  projectId: string,
  sentenceIndex: number,
): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  const result = await db.get(
    STORE_NAME,
    approvedAudioKey(projectId, sentenceIndex),
  );
  return result instanceof ArrayBuffer ? result : undefined;
}

export async function deleteProjectAudio(projectId: string): Promise<void> {
  const db = await getDB();
  const prefix = projectPrefix(projectId);
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  let cursor = await store.openCursor();
  while (cursor) {
    if (typeof cursor.key === "string" && cursor.key.startsWith(prefix)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }

  await tx.done;
}

export async function getStorageEstimate(): Promise<{
  usageMB: number;
  quotaMB: number;
}> {
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return {
      usageMB: Math.round(((usage ?? 0) / 1024 / 1024) * 10) / 10,
      quotaMB: Math.round(((quota ?? 0) / 1024 / 1024) * 10) / 10,
    };
  }
  return { usageMB: 0, quotaMB: 0 };
}
