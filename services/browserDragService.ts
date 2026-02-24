import { ScannedFileEntry } from '../types';

export const BROWSER_DRAG_MIME = 'application/x-hollowbits-browser-item';
export const LEGACY_BROWSER_DRAG_MIME = 'application/x-ethereal-browser-item';

export type BrowserDragPayload =
    | {
        kind: 'project-clip';
        sourceTrackId: string;
        clipId: string;
    }
    | {
        kind: 'library-entry';
        entry: Pick<ScannedFileEntry, 'name' | 'path' | 'size'>;
    }
    | {
        kind: 'generator';
        generatorType: 'noise' | 'sine';
    };

export const serializeBrowserDragPayload = (payload: BrowserDragPayload): string => {
    return JSON.stringify(payload);
};

export const parseBrowserDragPayload = (value: string | null | undefined): BrowserDragPayload | null => {
    if (!value) return null;

    try {
        const parsed = JSON.parse(value) as BrowserDragPayload;

        if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
            return null;
        }

        if (parsed.kind === 'project-clip') {
            if (typeof parsed.clipId !== 'string' || typeof parsed.sourceTrackId !== 'string') return null;
            return parsed;
        }

        if (parsed.kind === 'library-entry') {
            if (!parsed.entry || typeof parsed.entry.name !== 'string' || typeof parsed.entry.path !== 'string') return null;
            return parsed;
        }

        if (parsed.kind === 'generator') {
            if (parsed.generatorType !== 'noise' && parsed.generatorType !== 'sine') return null;
            return parsed;
        }

        return null;
    } catch {
        return null;
    }
};

export const readBrowserDragPayload = (dataTransfer: Pick<DataTransfer, 'getData'>): BrowserDragPayload | null => {
    const current = parseBrowserDragPayload(dataTransfer.getData(BROWSER_DRAG_MIME));
    if (current) return current;

    return parseBrowserDragPayload(dataTransfer.getData(LEGACY_BROWSER_DRAG_MIME));
};
