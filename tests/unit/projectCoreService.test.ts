import { describe, expect, it } from 'vitest';
import { createTrack } from '../../services/projectCoreService';
import { TrackType } from '../../types';

const STUDIO_SETTINGS_STORAGE_KEY = 'hollowbits.studio-settings.v1';

const seedDefaultListenMode = (mode: 'manual' | 'armed' | 'always') => {
    localStorage.setItem(STUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({
        pluginFolders: [],
        libraryFolders: [],
        pluginIndex: [],
        libraryIndex: [],
        defaultListenMode: mode,
        updatedAt: Date.now()
    }));
};

describe('projectCoreService.createTrack', () => {
    it('applies manual listen mode defaults on new audio tracks', () => {
        seedDefaultListenMode('manual');

        const track = createTrack({
            id: 'audio-manual',
            name: 'Audio Manual',
            type: TrackType.AUDIO
        });

        expect(track.monitor).toBe('auto');
        expect(track.micSettings?.monitoringEnabled).toBe(false);
    });

    it('applies armed listen mode defaults on new audio tracks', () => {
        seedDefaultListenMode('armed');

        const track = createTrack({
            id: 'audio-armed',
            name: 'Audio Armed',
            type: TrackType.AUDIO
        });

        expect(track.monitor).toBe('auto');
        expect(track.micSettings?.monitoringEnabled).toBe(true);
    });

    it('applies always listen mode defaults on new audio tracks', () => {
        seedDefaultListenMode('always');

        const track = createTrack({
            id: 'audio-always',
            name: 'Audio Always',
            type: TrackType.AUDIO
        });

        expect(track.monitor).toBe('in');
        expect(track.micSettings?.monitoringEnabled).toBe(true);
    });

    it('respects explicit monitor and mic settings overrides', () => {
        seedDefaultListenMode('always');

        const track = createTrack({
            id: 'audio-override',
            name: 'Audio Override',
            type: TrackType.AUDIO,
            monitor: 'off',
            micSettings: {
                profile: 'raw',
                inputGain: 1,
                monitoringEnabled: false,
                monitoringReverb: true,
                monitoringEcho: true
            }
        });

        expect(track.monitor).toBe('off');
        expect(track.micSettings?.monitoringEnabled).toBe(false);
        expect(track.micSettings?.profile).toBe('raw');
    });

    it('does not force audio listen defaults into non-audio tracks', () => {
        seedDefaultListenMode('always');

        const track = createTrack({
            id: 'midi-track',
            name: 'MIDI Track',
            type: TrackType.MIDI
        });

        expect(track.monitor).toBe('auto');
        expect(track.micSettings?.monitoringEnabled).toBe(false);
    });
});
