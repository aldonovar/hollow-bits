import { AudioTranscodeRequest, ExportAudioFormat } from '../types';
import { desktopRuntimeService } from './desktopRuntimeService';

const MIME_BY_FORMAT: Record<ExportAudioFormat, string> = {
    wav: 'audio/wav',
    aiff: 'audio/aiff',
    flac: 'audio/flac',
    mp3: 'audio/mpeg'
};

interface TranscodeOptions {
    format: ExportAudioFormat;
    sampleRate: number;
    bitDepth: 16 | 24 | 32;
}

class AudioTranscodeService {
    get canTranscode(): boolean {
        return Boolean(desktopRuntimeService.api?.transcodeAudio);
    }

    async transcodeFromWavBlob(inputBlob: Blob, options: TranscodeOptions): Promise<Blob> {
        if (options.format === 'wav') {
            return inputBlob;
        }

        const host = desktopRuntimeService.api;
        if (!host?.transcodeAudio) {
            throw new Error('La transcodificacion avanzada no esta disponible en esta plataforma.');
        }

        const request: AudioTranscodeRequest = {
            inputData: await inputBlob.arrayBuffer(),
            outputFormat: options.format,
            sampleRate: options.sampleRate,
            bitDepth: options.bitDepth
        };

        const result = await host.transcodeAudio(request);
        if (!result.success || !result.data) {
            throw new Error(result.error || 'No se pudo transcodificar el archivo de audio.');
        }

        return new Blob([result.data], { type: result.mimeType || MIME_BY_FORMAT[options.format] });
    }
}

export const audioTranscodeService = new AudioTranscodeService();
