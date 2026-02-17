
// VIRTUAL FILE SYSTEM (IndexedDB)
// Stores the heavy audio binaries so the project file remains lightweight logic.

const DB_NAME = 'EtherealAudioPool';
const STORE_NAME = 'audio_files';
const VERSION = 1;

interface AudioRecord {
    id: string; // The Hash of the file
    name: string;
    blob: Blob;
    createdAt: number;
}

class AssetDatabase {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, VERSION);

            request.onerror = () => reject("Error opening Asset DB");
            
            request.onsuccess = (e) => {
                this.db = (e.target as IDBOpenDBRequest).result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    async saveFile(file: File | Blob): Promise<string> {
        if (!this.db) await this.init();

        const buffer = await file.arrayBuffer();
        const hash = await this.computeHash(buffer); // Content-addressable storage
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // Check if exists first to save write time
            const check = store.get(hash);
            
            check.onsuccess = () => {
                if (check.result) {
                    resolve(hash); // Already exists, return reference
                } else {
                    const fileName = file instanceof File ? file.name : 'Unknown Audio';
                    const record: AudioRecord = {
                        id: hash,
                        name: fileName,
                        blob: file instanceof Blob ? file : new Blob([file]),
                        createdAt: Date.now()
                    };
                    const addRequest = store.add(record);
                    addRequest.onsuccess = () => resolve(hash);
                    addRequest.onerror = () => reject("Failed to write to VFS");
                }
            };
            check.onerror = () => reject("DB Read Error");
        });
    }

    async getFile(hash: string): Promise<Blob | null> {
        if (!this.db) await this.init();

        return new Promise((resolve) => {
            const transaction = this.db!.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(hash);

            request.onsuccess = () => {
                if (request.result) resolve(request.result.blob);
                else resolve(null); // File missing (Offline media)
            };
            request.onerror = () => resolve(null);
        });
    }

    // SHA-1 is fast enough for file fingerprinting in browser
    private async computeHash(buffer: ArrayBuffer): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

export const assetDb = new AssetDatabase();
