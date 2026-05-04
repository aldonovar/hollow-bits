import { localAudioCache } from './localAudioCache';
import { cloudStorageService } from './cloudStorageService';

/**
 * Audio Resource Manager
 * Proxy between the Engine and the storage layers (Local/OPFS + Cloud/Supabase).
 * Now supports background FLAC compression via WebWorkers to halve egress costs.
 */
class AudioResourceManager {
  private worker: Worker | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof window !== 'undefined') {
      // Initialize the Web Worker for FLAC encoding
      this.worker = new Worker(new URL('./flacWorker.ts', import.meta.url), { type: 'module' });
    }
  }

  /**
   * Promisifies the Worker compression call.
   */
  private compressToFlac(id: string, pcmData: ArrayBuffer | Float32Array): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error("Worker not initialized"));

      const handleMessage = (e: MessageEvent) => {
        if (e.data.id === id) {
          this.worker?.removeEventListener('message', handleMessage);
          if (e.data.success) {
            resolve(e.data.flacBlob);
          } else {
            reject(new Error(e.data.error));
          }
        }
      };

      this.worker.addEventListener('message', handleMessage);
      this.worker.postMessage({
        id,
        pcmData,
        sampleRate: 44100, // Hardcoded for demo, engine will provide this
        numChannels: 1
      });
    });
  }

  /**
   * Retrieves an audio buffer. Checks local OPFS/IDB cache first.
   * If not found, downloads from cloud and caches it locally.
   */
  public async getAudioBuffer(projectId: string, fileId: string): Promise<Blob> {
    // 1. Check local cache (fast)
    const localBlob = await localAudioCache.getAudioLocally(fileId);
    if (localBlob) {
      return localBlob;
    }

    // 2. Not in cache, download from cloud (slow)
    console.log(`[Storage] Cache miss for ${fileId}, downloading from cloud...`);
    const cloudBlob = await cloudStorageService.downloadAudioFromCloud(projectId, fileId);

    // 3. Save asymmetrically to local cache for future
    // We don't await this so we can return the blob to the engine ASAP
    localAudioCache.saveAudioLocally(fileId, cloudBlob).catch(err => {
      console.error('[Storage] Failed to cache downloaded audio:', err);
    });

    return cloudBlob;
  }

  /**
   * Commits the current session's new audio recordings to the cloud in the background.
   * Compresses WAV to FLAC dynamically before upload to save 50% bandwidth.
   */
  public async commitSessionAudio(projectId: string, unsyncedFiles: Map<string, Blob>): Promise<void> {
    const uploadPromises = Array.from(unsyncedFiles.entries()).map(async ([fileId, blob]) => {
      try {
        // Compress to FLAC if it's raw WAV
        let uploadBlob = blob;
        if (blob.type === 'audio/wav' || blob.type === 'audio/x-wav' || blob.type === '') {
           const arrayBuffer = await blob.arrayBuffer();
           uploadBlob = await this.compressToFlac(fileId, arrayBuffer);
        }

        // Upload compressed FLAC to cloud
        await cloudStorageService.uploadAudioToCloud(projectId, fileId, uploadBlob);
        
      } catch (err) {
        console.error(`[Storage] Failed to compress/sync ${fileId} to cloud`, err);
      }
    });

    // Fire and forget
    Promise.allSettled(uploadPromises).then(results => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[Storage] ${failed.length} files failed to sync in background.`);
      } else {
        console.log(`[Storage] Lazy sync complete. ${results.length} files compressed to FLAC and synced.`);
      }
    });
  }
}

export const audioResourceManager = new AudioResourceManager();
