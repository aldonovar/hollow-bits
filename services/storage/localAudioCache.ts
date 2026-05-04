import localforage from 'localforage';

/**
 * Cache system for audio buffers using OPFS (Origin Private File System)
 * with a fallback to IndexedDB via localforage.
 */
class LocalAudioCache {
  private opfsRoot: FileSystemDirectoryHandle | null = null;
  private opfsSupported: boolean = false;
  private lfInstance: LocalForage;

  constructor() {
    this.lfInstance = localforage.createInstance({
      name: 'HollowBitsAudio',
      storeName: 'audio_cache'
    });
    this.init();
  }

  private async init() {
    try {
      if (navigator.storage && navigator.storage.getDirectory) {
        this.opfsRoot = await navigator.storage.getDirectory();
        this.opfsSupported = true;
      }
    } catch (err) {
      console.warn('OPFS not available, falling back to IndexedDB', err);
    }
  }

  public async saveAudioLocally(id: string, data: Blob): Promise<void> {
    if (this.opfsSupported && this.opfsRoot) {
      try {
        const fileHandle = await this.opfsRoot.getFileHandle(`${id}.blob`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        return;
      } catch (err) {
        console.error('Failed to write to OPFS, falling back to IndexedDB', err);
      }
    }
    
    // Fallback to IndexedDB
    await this.lfInstance.setItem(id, data);
  }

  public async getAudioLocally(id: string): Promise<Blob | null> {
    if (this.opfsSupported && this.opfsRoot) {
      try {
        const fileHandle = await this.opfsRoot.getFileHandle(`${id}.blob`);
        const file = await fileHandle.getFile();
        return file; // File inherits from Blob
      } catch (err) {
        // Expected if file doesn't exist
      }
    }

    // Fallback to IndexedDB
    try {
      return await this.lfInstance.getItem<Blob>(id);
    } catch (err) {
      return null;
    }
  }
}

export const localAudioCache = new LocalAudioCache();
