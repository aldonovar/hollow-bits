import { localAudioCache } from './localAudioCache';
import { cloudStorageService } from './cloudStorageService';

/**
 * Audio Resource Manager
 * Proxy between the Engine and the storage layers (Local/OPFS + Cloud/Supabase).
 */
class AudioResourceManager {
  
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
   */
  public async commitSessionAudio(projectId: string, unsyncedFiles: Map<string, Blob>): Promise<void> {
    const uploadPromises = Array.from(unsyncedFiles.entries()).map(async ([fileId, blob]) => {
      try {
        // Upload to cloud
        await cloudStorageService.uploadAudioToCloud(projectId, fileId, blob);
        // We can optionally verify it was already cached locally, or cache it now
        // if it originated purely from RAM.
      } catch (err) {
        console.error(`[Storage] Failed to sync ${fileId} to cloud`, err);
      }
    });

    // Fire and forget (lazy cloud syncing)
    Promise.allSettled(uploadPromises).then(results => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[Storage] ${failed.length} files failed to sync in background.`);
      } else {
        console.log(`[Storage] Lazy sync complete. ${results.length} files synced.`);
      }
    });
  }
}

export const audioResourceManager = new AudioResourceManager();
