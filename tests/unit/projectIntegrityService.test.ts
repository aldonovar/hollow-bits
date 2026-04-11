import { describe, expect, it } from 'vitest';
import { ProjectIntegrityError, repairProjectData, summarizeProjectIntegrityReport } from '../../services/projectIntegrityService';
import { ProjectData, TrackType, TransportState } from '../../types';

const transportFixture: TransportState = {
    isPlaying: false,
    isRecording: false,
    loopMode: 'off',
    bpm: 124,
    timeSignature: [4, 4],
    currentBar: 1,
    currentBeat: 1,
    currentSixteenth: 1,
    masterTranspose: 0,
    gridSize: 0.25,
    snapToGrid: true,
    scaleRoot: 0,
    scaleType: 'minor'
};

const baseProject = (): ProjectData => ({
    version: '3.0-reference',
    name: 'Integrity Test',
    tracks: [],
    transport: transportFixture,
    audioSettings: {
        sampleRate: 48000,
        bufferSize: 'auto',
        latencyHint: 'interactive'
    },
    createdAt: 10,
    lastModified: 20
});

describe('projectIntegrityService', () => {
    it('repairs duplicate track ids and invalid routing references', () => {
        const corruptedProject = {
            ...baseProject(),
            tracks: [
                {
                    id: 'track-a',
                    name: 'Lead',
                    type: TrackType.AUDIO,
                    color: '#ff00aa',
                    clips: [{
                        id: 'clip-1',
                        name: 'Lead Clip',
                        color: '#ff00aa',
                        notes: [],
                        start: 1,
                        length: 4,
                        offset: 0,
                        fadeIn: 0,
                        fadeOut: 0,
                        gain: 1,
                        playbackRate: 1
                    }],
                    sessionClips: [],
                    devices: [],
                    sends: {
                        ghost: 0.5,
                        'return-1': 0.35
                    },
                    sendModes: {
                        ghost: 'pre',
                        'return-1': 'post'
                    },
                    groupId: 'group-a',
                    vcaGroupId: 'group-a'
                },
                {
                    id: 'track-a',
                    name: 'Bus A',
                    type: TrackType.GROUP,
                    color: '#b34be4',
                    clips: [],
                    sessionClips: [],
                    devices: [],
                    groupId: 'track-a'
                },
                {
                    id: 'return-1',
                    name: 'Return A',
                    type: TrackType.RETURN,
                    color: '#b34be4',
                    clips: [],
                    sessionClips: [],
                    devices: []
                }
            ]
        };

        const result = repairProjectData(corruptedProject, { source: 'unit-routing' });

        expect(result.project.tracks.map((track) => track.id)).toEqual(['track-a', 'track-a-2', 'return-1']);
        expect(result.project.tracks[0].sends).toEqual({ 'return-1': 0.35 });
        expect(result.project.tracks[0].sendModes).toEqual({ 'return-1': 'post' });
        expect(result.project.tracks[0].groupId).toBeUndefined();
        expect(result.project.tracks[0].vcaGroupId).toBeUndefined();
        expect(result.report.issueCount).toBeGreaterThan(0);
    });

    it('repairs take references, preserves session-only clips and rebuilds comp clips', () => {
        const corruptedProject = {
            ...baseProject(),
            tracks: [
                {
                    id: 'vox',
                    name: 'Vocals',
                    type: TrackType.AUDIO,
                    color: '#cc55ff',
                    clips: [{
                        id: 'clip-base',
                        name: 'Base Clip',
                        color: '#cc55ff',
                        notes: [],
                        start: 1,
                        length: 4,
                        offset: 0,
                        fadeIn: 0,
                        fadeOut: 0,
                        gain: 1,
                        playbackRate: 1
                    }],
                    sessionClips: [{
                        id: 'slot-1',
                        clip: {
                            id: 'clip-session-only',
                            name: 'Scene Clip',
                            color: '#ffffff',
                            notes: [],
                            start: 5,
                            length: 2,
                            offset: 0,
                            fadeIn: 0,
                            fadeOut: 0,
                            gain: 1,
                            playbackRate: 1
                        }
                    }],
                    recordingTakes: [
                        {
                            id: 'take-valid',
                            clipId: 'clip-base',
                            laneId: 'missing-lane',
                            startBar: 1,
                            lengthBars: 4,
                            offsetBars: 0,
                            createdAt: 10
                        },
                        {
                            id: 'take-invalid',
                            clipId: 'ghost-clip',
                            laneId: 'missing-lane',
                            startBar: 1,
                            lengthBars: 2,
                            offsetBars: 0,
                            createdAt: 11
                        }
                    ],
                    takeLanes: [{
                        id: 'comp-lane',
                        name: 'Comp Lane',
                        trackId: 'vox',
                        isCompLane: true,
                        takeIds: ['take-valid', 'take-invalid'],
                        compSegments: [{
                            id: 'seg-1',
                            takeId: 'take-valid',
                            sourceStartBar: 1,
                            sourceEndBar: 2,
                            targetStartBar: 6
                        }]
                    }],
                    activeTakeId: 'take-invalid',
                    activeCompLaneId: 'comp-lane',
                    devices: []
                }
            ]
        };

        const result = repairProjectData(corruptedProject, { source: 'unit-takes' });
        const track = result.project.tracks[0];

        expect(track.recordingTakes?.map((take) => take.id)).toEqual(['take-valid']);
        expect(track.takeLanes?.some((lane) => !lane.isCompLane)).toBe(true);
        expect(track.takeLanes?.find((lane) => !lane.isCompLane)?.takeIds).toEqual(['take-valid']);
        expect(track.activeTakeId).toBeUndefined();
        expect(track.clips.some((clip) => clip.id === 'clip-session-only')).toBe(true);
        expect(track.clips.some((clip) => clip.id === 'comp-seg-seg-1')).toBe(true);
        expect(track.sessionClips[0]?.clip?.id).toBe('clip-session-only');
        expect(result.report.issueCount).toBeGreaterThan(0);
    });

    it('throws on irrecoverable top-level payloads', () => {
        expect(() => repairProjectData({ version: 'broken' }, { source: 'unit-invalid' })).toThrow(ProjectIntegrityError);
    });

    it('summarizes repaired reports for operator feedback', () => {
        const result = repairProjectData(baseProject(), { source: 'unit-summary' });
        const summary = summarizeProjectIntegrityReport(result.report, 'Proyecto');

        expect(summary).toContain('integridad OK');
    });

    it('repairs score workspaces and clamps note velocity to midi range', () => {
        const corruptedProject = {
            ...baseProject(),
            tracks: [{
                id: 'pno',
                name: 'Piano',
                type: TrackType.MIDI,
                color: '#88ccff',
                clips: [{
                    id: 'clip-pno',
                    name: 'Lead',
                    color: '#88ccff',
                    notes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.2 }],
                    start: 1,
                    length: 2,
                    offset: 0,
                    fadeIn: 0,
                    fadeOut: 0,
                    gain: 1,
                    playbackRate: 1
                }],
                sessionClips: [],
                devices: []
            }],
            scoreWorkspaces: [{
                id: 'score-1',
                title: 'Piano Score',
                mode: 'compare',
                source: {
                    kind: 'midi',
                    trackId: 'pno',
                    clipId: 'clip-pno'
                },
                layout: {
                    splitRatio: 2,
                    followTransport: true,
                    zoom: 9
                },
                notationOverrides: [{
                    id: 'override-1',
                    noteKey: '0:60:0.0000:1.0000',
                    hand: 'right'
                }],
                confidenceRegions: [{
                    id: 'conf-1',
                    start16th: 0,
                    end16th: 16,
                    confidence: 0.9
                }],
                updatedAt: 123
            }]
        };

        const result = repairProjectData(corruptedProject, { source: 'unit-score-workspace' });

        expect(result.project.tracks[0].clips[0].notes[0].velocity).toBe(1);
        expect(result.project.scoreWorkspaces?.[0].layout.splitRatio).toBeLessThanOrEqual(0.82);
        expect(result.project.scoreWorkspaces?.[0].layout.zoom).toBeLessThanOrEqual(2.4);
        expect(result.project.scoreWorkspaces?.[0].mode).toBe('compare');
    });
});
