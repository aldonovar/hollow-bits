class PianoPhysicalProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'tone', defaultValue: 0.5, minValue: 0.2, maxValue: 1.0 },
            { name: 'brightness', defaultValue: 0.36, minValue: 0.1, maxValue: 1.0 },
            { name: 'stereoWidth', defaultValue: 0.2, minValue: 0.0, maxValue: 1.0 },
            { name: 'resonance', defaultValue: 0.29, minValue: 0.1, maxValue: 1.0 },
            { name: 'masterGain', defaultValue: 0.52, minValue: 0.1, maxValue: 1.5 }
        ];
    }

    constructor() {
        super();

        this.voices = [];
        this.pendingEvents = [];
        this.nextVoiceId = 1;
        this.sustainPedalDown = false;
        this.maxVoices = 112;
        this.randSeed = 928371;

        this.bodyNetworkL = this.createBodyNetwork(1);
        this.bodyNetworkR = this.createBodyNetwork(-1);
        this.hfShapeL = 0;
        this.hfShapeR = 0;
        this.outputColorL = 0;
        this.outputColorR = 0;

        this.port.onmessage = (event) => {
            this.handleMessage(event.data || {});
        };
    }

    clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    random() {
        this.randSeed = (this.randSeed * 16807) % 2147483647;
        return (this.randSeed - 1) / 2147483646;
    }

    midiToFrequency(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    createBodyNetwork(stereoSign) {
        const modes = [
            [88, 0.075, 0.9958],
            [176, 0.065, 0.9960],
            [352, 0.05, 0.9962],
            [610, 0.038, 0.9964],
            [930, 0.03, 0.99655],
            [1480, 0.022, 0.9967],
            [2210, 0.015, 0.99682]
        ];

        return modes.map((mode, index) => {
            const frequency = mode[0] * (1 + (stereoSign * 0.00065 * (index + 1)));
            const gain = mode[1];
            const radius = mode[2];
            const omega = (2 * Math.PI * frequency) / sampleRate;

            return {
                gain,
                a1: 2 * radius * Math.cos(omega),
                a2: -(radius * radius),
                z1: 0,
                z2: 0
            };
        });
    }

    enqueueEvent(nextEvent) {
        if (!Number.isFinite(nextEvent.frame)) return;

        this.pendingEvents.push(nextEvent);
        this.pendingEvents.sort((a, b) => a.frame - b.frame);
    }

    createVoice(note, velocity, confidence) {
        const midi = this.clamp(Math.round(note), 21, 108);
        const velocityNorm = this.clamp(velocity, 0.02, 1);
        const confidenceNorm = this.clamp(confidence, 0.08, 1);
        const noteNorm = (midi - 21) / 87;

        let stringCount = 3;
        if (midi <= 39) stringCount = 1;
        else if (midi <= 58) stringCount = 2;

        const detuneSets = {
            1: [0],
            2: [-1.65, 1.65],
            3: [-2.6, 0, 2.35]
        };

        const baseFrequency = this.midiToFrequency(midi);
        const attackSamples = Math.max(12, Math.floor((0.001 + ((1 - velocityNorm) * 0.0024)) * sampleRate));
        const hammerDecaySamples = Math.max(22, Math.floor((0.008 + (0.022 * (1 - velocityNorm))) * sampleRate));
        const stringDecay = (10.8 - (noteNorm * 7.4)) * (0.88 + (velocityNorm * 0.22)) * (0.94 + (confidenceNorm * 0.12));
        const releaseSeconds = (0.18 + ((1 - noteNorm) * 0.52)) * (0.9 + (velocityNorm * 0.18));
        const baseBrightness = this.clamp((0.18 + (velocityNorm * 0.34)) * (0.95 + (confidenceNorm * 0.06)), 0.1, 0.58);
        const sympathetic = this.clamp(0.035 + ((1 - noteNorm) * 0.07), 0.03, 0.12);

        const strings = detuneSets[stringCount].map((detuneCents, index) => {
            const jitterCents = (this.random() - 0.5) * 0.9;
            const tuning = detuneCents + jitterCents;
            const frequency = baseFrequency * Math.pow(2, tuning / 1200);
            const phase = this.random() * Math.PI * 2;

            const inharmonicity = 0.000045
                + (Math.pow(noteNorm, 2.2) * 0.00036)
                + ((index + 1) * 0.000018);

            const amplitude = velocityNorm
                * (0.72 / stringCount)
                * (0.92 + (this.random() * 0.18));

            const decayCoeff = Math.exp(-1 / Math.max(1, stringDecay * sampleRate));
            const releaseCoeff = Math.exp(-1 / Math.max(1, releaseSeconds * sampleRate));

            const panBase = ((index / Math.max(1, stringCount - 1)) - 0.5) * 0.48;

            return {
                frequency,
                phase,
                amplitude,
                inharmonicity,
                decayCoeff,
                releaseCoeff,
                panBase,
                harmonic2: 0.038 + (baseBrightness * 0.072),
                harmonic3: 0.004 + (baseBrightness * 0.014)
            };
        });

        return {
            id: this.nextVoiceId++,
            midi,
            keyDown: true,
            sustainLatched: false,
            released: false,
            age: 0,
            attackSamples,
            hammerDecaySamples,
            hammerLevel: velocityNorm * (0.035 + (baseBrightness * 0.07)),
            brightness: baseBrightness,
            sympathetic,
            bridgeEnergy: 0,
            strings,
            peak: 1
        };
    }

    startVoice(note, velocity, confidence) {
        const voice = this.createVoice(note, velocity, confidence);
        this.voices.push(voice);

        if (this.voices.length <= this.maxVoices) {
            return voice.id;
        }

        let removeIndex = -1;
        let weakestScore = Infinity;

        for (let i = 0; i < this.voices.length; i++) {
            const candidate = this.voices[i];
            const releasePenalty = candidate.released ? 0 : 0.4;
            const ageScore = candidate.age / (sampleRate * 4);
            const score = candidate.peak + releasePenalty - ageScore;
            if (score < weakestScore) {
                weakestScore = score;
                removeIndex = i;
            }
        }

        if (removeIndex >= 0) {
            this.voices.splice(removeIndex, 1);
        }

        return voice.id;
    }

    releaseVoiceById(id) {
        for (let i = 0; i < this.voices.length; i++) {
            const voice = this.voices[i];
            if (voice.id !== id) continue;

            voice.keyDown = false;
            if (this.sustainPedalDown) {
                voice.sustainLatched = true;
            } else {
                voice.released = true;
            }
            return;
        }
    }

    releaseAllVoices(immediate) {
        for (let i = 0; i < this.voices.length; i++) {
            const voice = this.voices[i];
            voice.keyDown = false;
            voice.sustainLatched = false;
            voice.released = true;

            if (immediate) {
                for (let s = 0; s < voice.strings.length; s++) {
                    voice.strings[s].amplitude *= 0.32;
                }
            }
        }
    }

    handlePedal(down) {
        this.sustainPedalDown = !!down;

        if (this.sustainPedalDown) {
            return;
        }

        for (let i = 0; i < this.voices.length; i++) {
            const voice = this.voices[i];
            if (voice.keyDown) continue;

            voice.sustainLatched = false;
            voice.released = true;
        }
    }

    handleMessage(message) {
        const type = message.type;
        if (!type) return;

        const nowFrame = currentFrame;

        if (type === 'noteOn') {
            const note = this.clamp(Number(message.note ?? 60), 21, 108);
            const velocity = this.clamp(Number(message.velocity ?? 0.7), 0.01, 1);
            const confidence = this.clamp(Number(message.confidence ?? 0.75), 0.01, 1);
            const whenSec = Number.isFinite(message.when) ? message.when : currentTime;
            const durationSec = this.clamp(Number(message.duration ?? 0.5), 0.05, 12);
            const startFrame = Math.max(nowFrame, Math.floor(whenSec * sampleRate));

            const previewId = this.nextVoiceId;
            this.enqueueEvent({
                type: 'noteOn',
                frame: startFrame,
                note,
                velocity,
                confidence
            });

            this.enqueueEvent({
                type: 'noteOff',
                frame: startFrame + Math.floor(durationSec * sampleRate),
                voiceId: previewId
            });
            return;
        }

        if (type === 'allNotesOff') {
            const whenSec = Number.isFinite(message.when) ? message.when : currentTime;
            const frame = Math.max(nowFrame, Math.floor(whenSec * sampleRate));
            this.enqueueEvent({ type: 'allNotesOff', frame });
            return;
        }

        if (type === 'pedal') {
            const whenSec = Number.isFinite(message.when) ? message.when : currentTime;
            const frame = Math.max(nowFrame, Math.floor(whenSec * sampleRate));
            this.enqueueEvent({ type: 'pedal', frame, down: !!message.down });
        }
    }

    flushEventsForFrame(frame) {
        while (this.pendingEvents.length > 0 && this.pendingEvents[0].frame <= frame) {
            const event = this.pendingEvents.shift();
            if (!event) break;

            if (event.type === 'noteOn') {
                this.startVoice(event.note, event.velocity, event.confidence);
                continue;
            }

            if (event.type === 'noteOff') {
                this.releaseVoiceById(event.voiceId);
                continue;
            }

            if (event.type === 'allNotesOff') {
                this.releaseAllVoices(true);
                continue;
            }

            if (event.type === 'pedal') {
                this.handlePedal(event.down);
            }
        }
    }

    processVoice(voice, tone, brightness, stereoWidth) {
        let sampleL = 0;
        let sampleR = 0;
        let amplitudeSum = 0;

        const attackEnv = voice.age < voice.attackSamples
            ? (voice.age / voice.attackSamples)
            : 1;

        const hammerEnv = Math.exp(-voice.age / voice.hammerDecaySamples);
        const hammerNoise = ((this.random() * 2) - 1)
            * voice.hammerLevel
            * hammerEnv
            * (0.05 + (brightness * 0.08));

        for (let i = 0; i < voice.strings.length; i++) {
            const string = voice.strings[i];

            const phase = string.phase;
            const inharmBend = 1 + (string.inharmonicity * (0.18 + ((1 - attackEnv) * 0.35)));

            const fundamental = Math.sin(phase);
            const harmonic2 = Math.sin((phase * 2 * inharmBend) + 0.3) * string.harmonic2;
            const harmonic3 = Math.sin((phase * 3 * (1 + (string.inharmonicity * 2.4))) + 0.8) * string.harmonic3;
            const bridge = Math.sin((phase * 0.5) + voice.bridgeEnergy) * (0.008 + (voice.brightness * 0.01));

            let stringSignal = (fundamental + harmonic2 + harmonic3 + bridge);
            stringSignal *= string.amplitude;

            const voicePan = string.panBase * stereoWidth;
            const panL = Math.sqrt(this.clamp(0.5 - (voicePan * 0.5), 0, 1));
            const panR = Math.sqrt(this.clamp(0.5 + (voicePan * 0.5), 0, 1));

            sampleL += stringSignal * panL;
            sampleR += stringSignal * panR;

            amplitudeSum += string.amplitude;

            string.phase += ((2 * Math.PI * string.frequency) / sampleRate) * inharmBend;
            if (string.phase > Math.PI * 2) {
                string.phase -= Math.PI * 2;
            }

            if (voice.released) {
                string.amplitude *= string.releaseCoeff;
            } else {
                string.amplitude *= string.decayCoeff;
            }
        }

        voice.bridgeEnergy = (voice.bridgeEnergy * 0.9) + ((sampleL + sampleR) * 0.015);
        voice.age += 1;

        const noiseL = hammerNoise * (0.52 + (this.random() * 0.16));
        const noiseR = hammerNoise * (0.52 + (this.random() * 0.16));
        sampleL += noiseL;
        sampleR += noiseR;

        if (this.sustainPedalDown && !voice.keyDown) {
            const sympatheticBoost = voice.sympathetic * (0.13 + (tone * 0.15));
            sampleL += voice.bridgeEnergy * sympatheticBoost;
            sampleR += voice.bridgeEnergy * sympatheticBoost;
        }

        voice.peak = (voice.peak * 0.9987) + (amplitudeSum * 0.0013);

        return [sampleL * attackEnv, sampleR * attackEnv, amplitudeSum];
    }

    processBody(input, network, resonance) {
        let out = input;

        for (let i = 0; i < network.length; i++) {
            const mode = network[i];
            const y = (mode.gain * input) + (mode.a1 * mode.z1) + (mode.a2 * mode.z2);
            mode.z2 = mode.z1;
            mode.z1 = y;
            out += y * resonance;
        }

        return out;
    }

    process(_inputs, outputs, parameters) {
        const output = outputs[0];
        const outL = output[0];
        const outR = output[1] || output[0];

        const tone = this.clamp(parameters.tone[0] || 0.5, 0.2, 1);
        const brightness = this.clamp(parameters.brightness[0] || 0.36, 0.1, 1);
        const stereoWidth = this.clamp(parameters.stereoWidth[0] || 0.2, 0, 1);
        const resonance = this.clamp(parameters.resonance[0] || 0.29, 0.1, 1);
        const masterGain = this.clamp(parameters.masterGain[0] || 0.52, 0.1, 1.5);

        for (let i = 0; i < outL.length; i++) {
            const frame = currentFrame + i;
            this.flushEventsForFrame(frame);

            let sampleL = 0;
            let sampleR = 0;
            let maxAmp = 0;

            for (let voiceIndex = this.voices.length - 1; voiceIndex >= 0; voiceIndex--) {
                const voice = this.voices[voiceIndex];
                const rendered = this.processVoice(voice, tone, brightness, stereoWidth);

                sampleL += rendered[0];
                sampleR += rendered[1];
                maxAmp = Math.max(maxAmp, rendered[2]);

                const shouldCull = rendered[2] < 0.00002 || voice.age > sampleRate * 16;
                if (shouldCull) {
                    this.voices.splice(voiceIndex, 1);
                }
            }

            const shapedL = this.processBody(sampleL, this.bodyNetworkL, resonance);
            const shapedR = this.processBody(sampleR, this.bodyNetworkR, resonance);

            this.hfShapeL = (this.hfShapeL * 0.95) + ((shapedL - this.hfShapeL) * (0.2 + (tone * 0.13)));
            this.hfShapeR = (this.hfShapeR * 0.95) + ((shapedR - this.hfShapeR) * (0.2 + (tone * 0.13)));

            const colorL = (shapedL * (0.8 + (tone * 0.16))) + ((shapedL - this.hfShapeL) * brightness * 0.1);
            const colorR = (shapedR * (0.8 + (tone * 0.16))) + ((shapedR - this.hfShapeR) * brightness * 0.1);

            const voiceNorm = 1 / (1 + (maxAmp * 0.5));
            const transientMix = 0.1 + (brightness * 0.1);

            this.outputColorL += (colorL - this.outputColorL) * transientMix;
            this.outputColorR += (colorR - this.outputColorR) * transientMix;

            const rawL = this.outputColorL * voiceNorm * masterGain;
            const rawR = this.outputColorR * voiceNorm * masterGain;

            const outSampleL = rawL / (1 + (Math.abs(rawL) * 0.04));
            const outSampleR = rawR / (1 + (Math.abs(rawR) * 0.04));

            outL[i] = outSampleL;
            outR[i] = outSampleR;
        }

        return true;
    }
}

registerProcessor('piano-physical-processor', PianoPhysicalProcessor);
