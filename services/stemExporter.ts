// path: src/services/stemExporter.ts
// Professional multitrack stem exporter for HOLLOW BITS
// Uses OfflineAudioContext for isolated track rendering + JSZip for packaging

import JSZip from 'jszip';
import { ExportAudioFormat, Track, TrackType } from '../types';
import { audioTranscodeService } from './audioTranscodeService';
import { audioEngine } from './audioEngine';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ExportOptions {
    sampleRate: 44100 | 48000 | 88200 | 96000 | 192000;
    bitDepth: 16 | 24 | 32;
    format: ExportAudioFormat;
    includeEffects: boolean;
    includeMaster: boolean;
    normalizeLevel: number; // 0-1, 0 = no normalization, 1 = full normalize
}

export interface StemProgress {
    trackId: string;
    trackName: string;
    status: 'pending' | 'rendering' | 'encoding' | 'complete' | 'error';
    progress: number; // 0-100
    error?: string;
}

export interface ExportResult {
    success: boolean;
    zipBlob?: Blob;
    stems: StemProgress[];
    totalDuration: number;
    totalSize: number;
}

export type ProgressCallback = (stems: StemProgress[]) => void;

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
    sampleRate: 48000,
    bitDepth: 24,
    format: 'wav',
    includeEffects: true,
    includeMaster: false,
    normalizeLevel: 0
};

// ============================================================================
// STEM EXPORTER CLASS
// ============================================================================

class StemExporter {
    private currentExport: AbortController | null = null;

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private normalizePan(pan: number): number {
        if (pan >= -1 && pan <= 1) return pan;
        return this.clamp(pan / 50, -1, 1);
    }

    /**
     * Export all tracks as individual stems packaged in a ZIP file.
     */
    async exportStems(
        tracks: Track[],
        bpm: number,
        projectDurationBars: number,
        options: Partial<ExportOptions> = {},
        onProgress?: ProgressCallback
    ): Promise<ExportResult> {
        const opts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

        // Calculate project duration in seconds
        const beatsPerBar = 4;
        const secondsPerBeat = 60 / bpm;
        const projectDurationSeconds = projectDurationBars * beatsPerBar * secondsPerBeat;

        // Filter exportable tracks that actually have renderable audio content.
        const exportableTracks = tracks.filter((track) => {
            const isAudioLike = track.type === TrackType.AUDIO || track.type === TrackType.MIDI;
            if (!isAudioLike) return false;
            return track.clips.some((clip) => Boolean(clip.buffer));
        });

        if (exportableTracks.length === 0) {
            return {
                success: false,
                stems: [],
                totalDuration: 0,
                totalSize: 0
            };
        }

        // Initialize progress tracking
        const stems: StemProgress[] = exportableTracks.map((track, idx) => ({
            trackId: track.id,
            trackName: `${String(idx + 1).padStart(2, '0')}_${this.sanitizeFilename(track.name)}`,
            status: 'pending' as const,
            progress: 0
        }));

        onProgress?.(stems);

        const zip = new JSZip();
        const stemFolder = zip.folder('stems');

        if (!stemFolder) {
            return { success: false, stems, totalDuration: 0, totalSize: 0 };
        }

        this.currentExport = new AbortController();
        let totalSize = 0;

        const previousMasterVolumeDb = opts.includeEffects ? audioEngine.getMasterVolumeDb() : null;
        if (opts.includeEffects && previousMasterVolumeDb !== null && previousMasterVolumeDb !== 0) {
            audioEngine.setMasterVolumeDb(0);
        }

        try {
            // Render each track sequentially to keep memory stable on large projects.
            for (let stemIdx = 0; stemIdx < exportableTracks.length; stemIdx++) {
                const track = exportableTracks[stemIdx];

                try {
                    stems[stemIdx].status = 'rendering';
                    onProgress?.(stems);

                    if (this.currentExport?.signal.aborted) {
                        throw new Error('Export cancelled');
                    }

                    const audioBuffer = opts.includeEffects
                        ? await this.renderTrackWithEffects(
                            tracks,
                            track,
                            bpm,
                            projectDurationBars,
                            opts,
                            (progress) => {
                                stems[stemIdx].progress = progress * 50;
                                onProgress?.(stems);
                            }
                        )
                        : await this.renderTrackOffline(
                            track,
                            bpm,
                            projectDurationSeconds,
                            opts,
                            (progress) => {
                                stems[stemIdx].progress = progress * 50;
                                onProgress?.(stems);
                            }
                        );

                    stems[stemIdx].status = 'encoding';
                    stems[stemIdx].progress = 50;
                    onProgress?.(stems);

                    const wavBlob = this.encodeWav(audioBuffer, opts);
                    let outputBlob: Blob = wavBlob;
                    let extension: ExportAudioFormat = 'wav';

                    if (opts.format !== 'wav') {
                        outputBlob = await audioTranscodeService.transcodeFromWavBlob(wavBlob, {
                            format: opts.format,
                            sampleRate: opts.sampleRate,
                            bitDepth: opts.bitDepth
                        });
                        extension = opts.format;
                    }

                    const filename = `${stems[stemIdx].trackName}.${extension}`;
                    stemFolder.file(filename, outputBlob);
                    totalSize += outputBlob.size;

                    stems[stemIdx].status = 'complete';
                    stems[stemIdx].progress = 100;
                    onProgress?.(stems);
                } catch (error) {
                    stems[stemIdx].status = 'error';
                    stems[stemIdx].error = error instanceof Error ? error.message : 'Unknown error';
                    onProgress?.(stems);
                }
            }

            // Check if any stems completed successfully
            const completedStems = stems.filter(s => s.status === 'complete');

            if (completedStems.length === 0) {
                return {
                    success: false,
                    stems,
                    totalDuration: projectDurationSeconds,
                    totalSize: 0
                };
            }

            // Generate ZIP blob
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'STORE' // Keep export fast and avoid re-compressing already encoded audio.
            });

            return {
                success: true,
                zipBlob,
                stems,
                totalDuration: projectDurationSeconds,
                totalSize
            };
        } finally {
            if (opts.includeEffects && previousMasterVolumeDb !== null) {
                audioEngine.setMasterVolumeDb(previousMasterVolumeDb);
            }
            this.currentExport = null;
        }
    }

    private buildStemGroupRouteChain(tracks: Track[], targetTrackId: string): Set<string> {
        const tracksById = new Map(tracks.map((track) => [track.id, track]));
        const routeChain = new Set<string>([targetTrackId]);
        let cursor = tracksById.get(targetTrackId) || null;
        let guard = 0;

        while (cursor?.groupId && guard < 32) {
            const groupId = cursor.groupId;
            if (!groupId || routeChain.has(groupId)) break;

            const groupTrack = tracksById.get(groupId);
            if (!groupTrack || groupTrack.type !== TrackType.GROUP) break;

            routeChain.add(groupId);
            cursor = groupTrack;
            guard += 1;
        }

        return routeChain;
    }

    private buildIsolatedStemTracks(tracks: Track[], targetTrackId: string): Track[] {
        const routeChain = this.buildStemGroupRouteChain(tracks, targetTrackId);

        return tracks.map((track) => {
            const isReturn = track.type === TrackType.RETURN;
            const isOnRoute = routeChain.has(track.id);
            const shouldKeepActive = isReturn || isOnRoute;

            return {
                ...track,
                isMuted: shouldKeepActive ? track.isMuted : true,
                isSoloed: false,
                soloSafe: false,
                sends: shouldKeepActive ? (track.sends || {}) : {},
                sendModes: shouldKeepActive ? (track.sendModes || {}) : {}
            };
        });
    }

    private async renderTrackWithEffects(
        tracks: Track[],
        targetTrack: Track,
        bpm: number,
        projectDurationBars: number,
        options: ExportOptions,
        onProgress?: (progress: number) => void
    ): Promise<AudioBuffer> {
        const isolatedTracks = this.buildIsolatedStemTracks(tracks, targetTrack.id);
        onProgress?.(0.15);

        const renderedBuffer = await audioEngine.renderProject(isolatedTracks, {
            bars: Math.max(1, projectDurationBars),
            bpm,
            sampleRate: options.sampleRate,
            sourceId: `stem-${targetTrack.id}`
        });

        onProgress?.(1);

        if (options.normalizeLevel > 0) {
            return this.normalizeBuffer(renderedBuffer, options.normalizeLevel);
        }

        return renderedBuffer;
    }

    /**
     * Render a single track to an AudioBuffer using OfflineAudioContext.
     */
    private async renderTrackOffline(
        track: Track,
        bpm: number,
        durationSeconds: number,
        options: ExportOptions,
        onProgress?: (progress: number) => void
    ): Promise<AudioBuffer> {
        const { sampleRate } = options;
        const numChannels = 2; // Stereo
        const numSamples = Math.ceil(durationSeconds * sampleRate);

        const offlineCtx = new OfflineAudioContext(numChannels, numSamples, sampleRate);

        // Create output chain for this track
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.isMuted ? 0 : Math.pow(10, track.volume / 20);
        trackGain.connect(offlineCtx.destination);

        const panner = offlineCtx.createStereoPanner();
        panner.pan.value = this.normalizePan(track.pan);
        panner.connect(trackGain);

        // Schedule all clips for this track
        const beatsPerBar = 4;
        const secondsPerBeat = 60 / bpm;

        for (const clip of track.clips) {
            if (!clip.buffer) continue;

            const clipStartSeconds = (clip.start - 1) * beatsPerBar * secondsPerBeat;
            const clipDurationSeconds = clip.length * beatsPerBar * secondsPerBeat;

            // Create source
            const source = offlineCtx.createBufferSource();
            source.buffer = clip.buffer;

            const clipGain = offlineCtx.createGain();
            const clipLinearGain = this.clamp(clip.gain ?? 1, 0, 2);
            clipGain.gain.setValueAtTime(clipLinearGain, 0);
            source.connect(clipGain);
            clipGain.connect(panner);

            // Calculate playback rate for time stretching
            const originalBpm = clip.originalBpm || bpm;
            const transposeSemitones = (track.transpose || 0) + (clip.transpose || 0);
            const clipPlaybackRate = this.clamp(clip.playbackRate || 1, 0.25, 4);
            const playbackRate = (bpm / originalBpm) * clipPlaybackRate * Math.pow(2, transposeSemitones / 12);
            source.playbackRate.value = playbackRate;

            // Schedule the clip
            const startTime = Math.max(0, clipStartSeconds);
            const clipOffsetSeconds = (clip.offset || 0) * beatsPerBar * secondsPerBeat;
            const timelineOffset = clipStartSeconds < 0 ? Math.abs(clipStartSeconds) : 0;
            const safeRate = Math.max(0.0001, Math.abs(playbackRate));
            const offset = (clipOffsetSeconds + timelineOffset) * safeRate;
            const maxTimelineDurationFromBuffer = Math.max(0, (clip.buffer.duration - offset) / safeRate);
            const duration = Math.min(clipDurationSeconds, durationSeconds - startTime, maxTimelineDurationFromBuffer);

            if (startTime < durationSeconds && duration > 0) {
                const fadeInSeconds = this.clamp((clip.fadeIn || 0) * beatsPerBar * secondsPerBeat, 0, duration);
                const fadeOutSeconds = this.clamp((clip.fadeOut || 0) * beatsPerBar * secondsPerBeat, 0, duration);
                const safeFadeOutSeconds = Math.min(fadeOutSeconds, Math.max(0, duration - fadeInSeconds));
                const fadeOutStart = startTime + Math.max(0, duration - safeFadeOutSeconds);

                clipGain.gain.cancelScheduledValues(startTime);
                clipGain.gain.setValueAtTime(fadeInSeconds > 0 ? 0 : clipLinearGain, startTime);

                if (fadeInSeconds > 0) {
                    clipGain.gain.linearRampToValueAtTime(clipLinearGain, startTime + fadeInSeconds);
                }

                if (safeFadeOutSeconds > 0) {
                    clipGain.gain.setValueAtTime(clipLinearGain, fadeOutStart);
                    clipGain.gain.linearRampToValueAtTime(0, startTime + duration);
                }

                source.start(startTime, offset, duration * safeRate);
            }
        }

        // Fire progress updates (simulated since OfflineAudioContext doesn't have native progress)
        let simulatedProgress = 0;
        const progressInterval = setInterval(() => {
            // Estimate progress based on time (not accurate but useful for UX)
            simulatedProgress = Math.min(0.95, simulatedProgress + 0.05 + Math.random() * 0.05);
            onProgress?.(simulatedProgress);
        }, 100);

        let renderedBuffer: AudioBuffer;
        try {
            renderedBuffer = await offlineCtx.startRendering();
        } finally {
            clearInterval(progressInterval);
        }

        onProgress?.(1);

        // Apply normalization if requested
        if (options.normalizeLevel > 0) {
            return this.normalizeBuffer(renderedBuffer, options.normalizeLevel);
        }

        return renderedBuffer;
    }

    /**
     * Normalize an AudioBuffer to a target peak level.
     */
    private normalizeBuffer(buffer: AudioBuffer, targetLevel: number): AudioBuffer {
        const channels = buffer.numberOfChannels;
        let maxPeak = 0;

        // Find the peak across all channels
        for (let ch = 0; ch < channels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                maxPeak = Math.max(maxPeak, Math.abs(data[i]));
            }
        }

        if (maxPeak === 0) return buffer;

        // Calculate gain to reach target level
        const gain = (targetLevel * 0.99) / maxPeak; // Slight headroom

        // Apply gain (mutates in place)
        for (let ch = 0; ch < channels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                data[i] *= gain;
            }
        }

        return buffer;
    }

    /**
     * Encode an AudioBuffer to WAV format.
     */
    private encodeWav(buffer: AudioBuffer, options: ExportOptions): Blob {
        const { bitDepth } = options;
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const numSamples = buffer.length;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = numSamples * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;

        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        // WAV Header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, totalSize - 8, true);
        this.writeString(view, 8, 'WAVE');

        // fmt chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
        view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // AudioFormat: 1=PCM, 3=IEEE float
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);

        // data chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Interleave channel data
        const channelData: Float32Array[] = [];
        for (let ch = 0; ch < numChannels; ch++) {
            channelData.push(buffer.getChannelData(ch));
        }

        let offset = 44;
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sourceSample = channelData[ch][i];
                const sample = bitDepth === 32
                    ? sourceSample
                    : Math.max(-1, Math.min(1, sourceSample));

                if (bitDepth === 16) {
                    const intSample = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
                    view.setInt16(offset, intSample, true);
                    offset += 2;
                } else if (bitDepth === 24) {
                    const intSample = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF);
                    view.setUint8(offset, intSample & 0xFF);
                    view.setUint8(offset + 1, (intSample >> 8) & 0xFF);
                    view.setUint8(offset + 2, (intSample >> 16) & 0xFF);
                    offset += 3;
                } else if (bitDepth === 32) {
                    view.setFloat32(offset, sample, true);
                    offset += 4;
                }
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    /**
     * Write a string to a DataView at a specific offset.
     */
    private writeString(view: DataView, offset: number, str: string): void {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    /**
     * Sanitize a filename for safe file system use.
     */
    private sanitizeFilename(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
            .replace(/\s+/g, '_') // Spaces to underscores
            .substring(0, 50); // Limit length
    }

    /**
     * Cancel the current export operation.
     */
    cancelExport(): void {
        this.currentExport?.abort();
        this.currentExport = null;
    }

    /**
     * Download a blob as a file.
     */
    downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Singleton instance
export const stemExporter = new StemExporter();
