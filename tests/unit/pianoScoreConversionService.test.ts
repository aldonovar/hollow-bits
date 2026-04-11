import { describe, expect, it } from 'vitest';
import { buildScoreDocument, createDefaultScoreWorkspace, normalizeClipNotes } from '../../services/pianoScoreConversionService';

describe('pianoScoreConversionService', () => {
    it('normalizes midi velocities into the 1..127 range', () => {
        expect(normalizeClipNotes([
            { pitch: 60, start: 0, duration: 1, velocity: 0 },
            { pitch: 64, start: 1, duration: 1, velocity: 240 }
        ])).toEqual([
            { pitch: 60, start: 0, duration: 1, velocity: 1 },
            { pitch: 64, start: 1, duration: 1, velocity: 127 }
        ]);
    });

    it('builds a grand-staff document with rests and measure splitting', () => {
        const workspace = createDefaultScoreWorkspace('track-a', 'clip-a', 'Piano Score', 'midi');
        const document = buildScoreDocument({
            notes: [
                { pitch: 72, start: 0, duration: 4, velocity: 112 },
                { pitch: 52, start: 4, duration: 4, velocity: 90 },
                { pitch: 67, start: 14, duration: 4, velocity: 102 }
            ],
            bpm: 120,
            timeSignature: [4, 4],
            title: workspace.title,
            workspaceId: workspace.id
        });

        expect(document.measures.length).toBe(2);
        expect(document.measures[0].voices.some((voice) => voice.events.some((event) => event.type === 'rest'))).toBe(true);
        expect(document.measures[0].voices.flatMap((voice) => voice.events).some((event) => event.type === 'note' && event.tieEnd)).toBe(true);
        expect(document.measures[1].voices.flatMap((voice) => voice.events).some((event) => event.type === 'note' && event.tieStart)).toBe(true);
    });
});

