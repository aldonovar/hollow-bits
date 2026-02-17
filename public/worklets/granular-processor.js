// path: public/worklets/granular-processor.js

class GranularProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioBuffer = null;

        // Playback State
        this.grains = [];
        this.nextGrainTime = 0;

        // Cursor for "Playhead" (Time), independent of Grain Pitch
        this.bufferCursor = 0;

        // State tracking
        this.wasPlaying = false;

        this.port.onmessage = this.handleMessage.bind(this);
    }

    wrapIndex(index, length) {
        let wrapped = index % length;
        if (wrapped < 0) wrapped += length;
        return wrapped;
    }

    readSampleCubic(channelData, exactIndex) {
        const length = channelData.length;
        const i1Base = Math.floor(exactIndex);
        const frac = exactIndex - i1Base;

        const i0 = this.wrapIndex(i1Base - 1, length);
        const i1 = this.wrapIndex(i1Base, length);
        const i2 = this.wrapIndex(i1Base + 1, length);
        const i3 = this.wrapIndex(i1Base + 2, length);

        const p0 = channelData[i0];
        const p1 = channelData[i1];
        const p2 = channelData[i2];
        const p3 = channelData[i3];

        const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
        const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
        const c = -0.5 * p0 + 0.5 * p2;
        const d = p1;

        return ((a * frac + b) * frac + c) * frac + d;
    }

    static get parameterDescriptors() {
        return [
            { name: 'grainSize', defaultValue: 0.05, minValue: 0.01, maxValue: 0.5 },
            { name: 'overlap', defaultValue: 2, minValue: 1, maxValue: 16 },
            { name: 'playbackRate', defaultValue: 1, minValue: 0 }, // TIMESTRETCH (Tempo)
            { name: 'pitch', defaultValue: 1, minValue: 0.1, maxValue: 4.0 }, // PITCHSHIFT (Tone)
            { name: 'jitter', defaultValue: 0, minValue: 0, maxValue: 0.1 },
            { name: 'isPlaying', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'startOffset', defaultValue: 0, minValue: 0 },
            { name: 'sampleRate', defaultValue: 48000 }
        ];
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channelCount = output.length;

        // --- 1. PARAMETERS ---
        const sr = typeof sampleRate === 'number' ? sampleRate : (parameters.sampleRate[0] || 44100);
        const grainSize = parameters.grainSize[0] || 0.1;
        const overlap = parameters.overlap[0] || 2;
        const playbackRate = parameters.playbackRate[0]; // Can be 0 if paused, or dynamic
        const pitch = parameters.pitch[0] || 1;
        const jitter = parameters.jitter[0] || 0;
        const isPlaying = parameters.isPlaying[0] > 0.5; // Threshold for bool
        const startOffsetSeconds = Math.max(0, parameters.startOffset[0] || 0);

        if (overlap <= 0) {
            return true;
        }

        // --- 2. STATE MANAGEMENT ---
        // Handle Play/Stop transitions
        const hasBuffer = Boolean(this.audioBuffer && this.audioBuffer[0] && this.audioBuffer[0].length > 0);
        const bufferLength = hasBuffer ? this.audioBuffer[0].length : 0;

        if (isPlaying && !this.wasPlaying) {
            if (hasBuffer) {
                const offsetSamples = Math.floor(startOffsetSeconds * sr);
                this.bufferCursor = ((offsetSamples % bufferLength) + bufferLength) % bufferLength;
                this.grains = [];
                this.nextGrainTime = 0;
            }
        }
        this.wasPlaying = isPlaying;

        if (!isPlaying || !hasBuffer) {
            return true; // Keep processor alive
        }

        const bL = this.audioBuffer[0];
        const bR = this.audioBuffer.length > 1 ? this.audioBuffer[1] : bL;

        // --- 3. SCHEDULING CONSTANTS ---
        const safeGrainSize = Math.max(0.015, grainSize);
        const safeOverlap = Math.max(2, overlap);
        const spawnIntervalSeconds = safeGrainSize / safeOverlap;
        const spawnIntervalSamples = Math.max(1, spawnIntervalSeconds * sr);

        // --- 4. DSP BLOCK LOOP ---
        for (let i = 0; i < output[0].length; i++) {

            // A. ADVANCE PLAYHEAD (Time Stretch)
            this.bufferCursor += playbackRate;

            // Loop Logic: Wrap around
            if (this.bufferCursor >= bufferLength) {
                this.bufferCursor -= bufferLength;
            } else if (this.bufferCursor < 0) {
                this.bufferCursor += bufferLength;
            }

            // B. SPAWN GRAINS
            // When nextGrainTime countdown hits 0, born a new grain
            if (this.nextGrainTime <= 0) {
                this.spawnGrain(this.bufferCursor, safeGrainSize, pitch, jitter, sr);
                this.nextGrainTime += spawnIntervalSamples; // Schedule next
            }
            this.nextGrainTime--;

            // C. RENDER GRAINS
            let sampleL = 0;
            let sampleR = 0;
            let weightSum = 0;

            // Iterate backwards to allow safe removal
            for (let g = this.grains.length - 1; g >= 0; g--) {
                const grain = this.grains[g];

                // Check lifecycle
                if (grain.age >= grain.life) {
                    this.grains.splice(g, 1);
                    continue;
                }

                // Window Function (Hanning / Cosine)
                // Range [0, 1]
                const progress = grain.age / grain.life;
                const win = 0.42 - (0.5 * Math.cos(6.28318530718 * progress)) + (0.08 * Math.cos(12.56637061436 * progress));

                // Calculate Read Position
                // Start position + (Age * PitchSpeed)
                const exactIndex = this.wrapIndex(grain.startSampleIndex + (grain.age * grain.speed), bufferLength);
                const sL = this.readSampleCubic(bL, exactIndex);
                const sR = this.readSampleCubic(bR, exactIndex);

                // Accumulate
                sampleL += sL * win;
                sampleR += sR * win;
                weightSum += win;

                grain.age++;
            }

            // D. WRITE OUTPUT
            const norm = weightSum > 1e-6 ? (1 / weightSum) : 0;
            if (channelCount > 0) output[0][i] = sampleL * norm;
            if (channelCount > 1) output[1][i] = sampleR * norm;
        }

        return true;
    }

    spawnGrain(centerSample, durationSeconds, speed, jitter, sr) {
        // Apply Jitter to position
        // jitter is in seconds usually? Descriptor says 0.1 max (100ms)
        const jitterSamples = (Math.random() * 2 - 1) * jitter * sr;
        let startSample = centerSample + jitterSamples;

        // Safety wrap
        const bufferLength = this.audioBuffer[0].length;
        if (startSample < 0) startSample += bufferLength;
        if (startSample >= bufferLength) startSample -= bufferLength;

        const lifeSamples = Math.floor(durationSeconds * sr);

        this.grains.push({
            startSampleIndex: startSample,
            age: 0,
            life: lifeSamples,
            speed: speed
        });
    }

    handleMessage(event) {
        if (event.data.type === 'loadBuffer') {
            this.audioBuffer = event.data.buffer;
        }
        else if (event.data.type === 'stop') {
            this.audioBuffer = null;
            this.grains = [];
            this.bufferCursor = 0;
        }
        else if (event.data.type === 'UPDATE_PARAMS') {
            // Usually handled by AudioParams, but some might be messaged
            // if we needed one-shot triggers
        }
    }
}

registerProcessor('granular-processor', GranularProcessor);
