
import { ElectronAPI } from './types';

declare global {
    interface Window {
        electron?: ElectronAPI;
    }
}

export { };
