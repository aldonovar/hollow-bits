import { DesktopHostAPI } from '../types';

type RuntimeKind = 'web' | 'electron' | 'native-windows';

class DesktopRuntimeService {
    readonly runtime: RuntimeKind;
    readonly api: DesktopHostAPI | null;
    readonly platform: string;

    constructor() {
        const hostWindow = window as Window & {
            electron?: DesktopHostAPI;
            nativeWindows?: DesktopHostAPI;
        };

        if (hostWindow.nativeWindows) {
            this.runtime = 'native-windows';
            this.api = hostWindow.nativeWindows;
            this.platform = hostWindow.nativeWindows.platform || 'windows';
            return;
        }

        if (hostWindow.electron) {
            this.runtime = 'electron';
            this.api = hostWindow.electron;
            this.platform = hostWindow.electron.platform || 'electron';
            return;
        }

        this.runtime = 'web';
        this.api = null;
        this.platform = 'web';
    }

    get isDesktop(): boolean {
        return this.runtime !== 'web';
    }

    get isElectron(): boolean {
        return this.runtime === 'electron';
    }

    get isNativeWindows(): boolean {
        return this.runtime === 'native-windows';
    }
}

export const desktopRuntimeService = new DesktopRuntimeService();
