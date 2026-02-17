
import { DesktopWindowState, DirectoryScanRequest, FileData, ScannedFileEntry } from '../types';
import { desktopRuntimeService } from './desktopRuntimeService';

class PlatformService {
  public isDesktop: boolean;
  public isElectron: boolean;
  public isNativeWindows: boolean;
  public platform: string;

  private toArrayBuffer(data: unknown): ArrayBuffer | null {
    if (data instanceof ArrayBuffer) return data;

    if (ArrayBuffer.isView(data)) {
      const view = data as Uint8Array;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }

    if (data && typeof data === 'object') {
      const candidate = data as { type?: unknown; data?: unknown };
      if (candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
        return new Uint8Array(candidate.data).buffer;
      }
    }

    return null;
  }

  constructor() {
    this.isDesktop = desktopRuntimeService.isDesktop;
    this.isElectron = desktopRuntimeService.isElectron;
    this.isNativeWindows = desktopRuntimeService.isNativeWindows;
    this.platform = desktopRuntimeService.platform;
  }

  // --- Window Management ---

  public minimize() {
    const host = desktopRuntimeService.api;
    if (host) {
      host.minimize();
    }
  }

  public maximize() {
    const host = desktopRuntimeService.api;
    if (host) {
      host.maximize();
    }
  }

  public close() {
    const host = desktopRuntimeService.api;
    if (host) {
      host.close();
    }
  }

  public async getWindowState(): Promise<DesktopWindowState | null> {
    const host = desktopRuntimeService.api;
    if (!host?.getWindowState) {
      return null;
    }

    try {
      return await host.getWindowState();
    } catch (error) {
      console.error('Unable to read window state', error);
      return null;
    }
  }

  public onWindowStateChange(callback: (state: DesktopWindowState) => void): (() => void) {
    const host = desktopRuntimeService.api;
    if (!host?.onWindowStateChange) {
      return () => undefined;
    }

    try {
      return host.onWindowStateChange(callback);
    } catch (error) {
      console.error('Unable to subscribe window state', error);
      return () => undefined;
    }
  }

  // --- File System ---

  public async selectAudioFiles(): Promise<FileData[] | null> {
    const host = desktopRuntimeService.api;
    if (host) {
      try {
        const files = await host.selectFiles();
        const normalized: FileData[] = [];

        files.forEach((file) => {
          const rawData: unknown = (file as FileData & { data: unknown }).data;
          const data = this.toArrayBuffer(rawData);

          if (!data) {
            console.warn(`Skipping file with unsupported binary payload: ${file.name}`);
            return;
          }

          normalized.push({
            name: file.name,
            path: file.path,
            data
          });
        });

        return normalized;
      } catch (error) {
        console.error("Desktop file selection failed", error);
        return [];
      }
    }
    return null;
  }

  public async readFileFromPath(filePath: string): Promise<FileData | null> {
    const targetPath = filePath.trim();
    if (!targetPath) return null;

    const host = desktopRuntimeService.api;
    if (!host?.readFileFromPath) {
      return null;
    }

    try {
      const file = await host.readFileFromPath(targetPath);
      if (!file) return null;

      const data = this.toArrayBuffer((file as FileData & { data: unknown }).data);
      if (!data) {
        console.warn(`Skipping direct file read with unsupported payload: ${targetPath}`);
        return null;
      }

      return {
        name: file.name,
        path: file.path,
        data
      };
    } catch (error) {
      console.error('Direct file read failed', error);
      return null;
    }
  }

  public async selectDirectory(): Promise<string | null> {
    const host = desktopRuntimeService.api;
    if (host?.selectDirectory) {
      try {
        return await host.selectDirectory();
      } catch (error) {
        console.error('Desktop folder selection failed', error);
        return null;
      }
    }

    return null;
  }

  public async scanDirectoryFiles(directory: string, extensions: string[]): Promise<ScannedFileEntry[]> {
    const host = desktopRuntimeService.api;
    if (host?.scanDirectoryFiles) {
      try {
        const payload: DirectoryScanRequest = { directory, extensions };
        const files = await host.scanDirectoryFiles(payload);
        if (!Array.isArray(files)) return [];

        return files
          .filter((file): file is ScannedFileEntry => {
            return Boolean(file && typeof file.name === 'string' && typeof file.path === 'string');
          })
          .map((file) => ({
            name: file.name,
            path: file.path,
            size: Number.isFinite(file.size) ? Number(file.size) : 0
          }));
      } catch (error) {
        console.error('Directory scan failed', error);
        return [];
      }
    }

    return [];
  }

  public async saveProject(data: string, name: string): Promise<{ success: boolean; filePath?: string }> {
    const safeName = name.replace(/[^a-z0-9\s-_]/gi, '').trim() || "untitled";
    const fileName = `${safeName}.esp`;

    const host = desktopRuntimeService.api;
    if (host) {
      return await host.saveProject(data, fileName);
    } else {
      // Web Fallback
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true, filePath: fileName.replace('.esp', '') }; // Web always assumes success
    }
  }

  // Updated to return Text for manual parsing
  public async openProjectFile(): Promise<{ text: string, filename: string } | null> {
    const host = desktopRuntimeService.api;
    if (host) {
      try {
        return await host.openProject();
      } catch (error) {
        console.error("Desktop open project failed", error);
        return null;
      }
    }

    // Web Fallback
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.esp';

      input.onchange = async (event: Event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const text = await file.text();
          resolve({ text, filename: file.name });
        } catch (err) {
          console.error("Error reading project file", err);
          alert("Error de lectura de disco.");
          resolve(null);
        }
      };

      input.click();
    });
  }
}

export const platformService = new PlatformService();
