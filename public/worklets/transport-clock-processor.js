class TransportClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.tickIntervalFrames = 1024;
    this.nextTickFrame = 0;

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || data.type !== 'config') return;

      if (typeof data.enabled === 'boolean') {
        this.enabled = data.enabled;
      }

      if (Number.isFinite(data.tickIntervalFrames)) {
        this.tickIntervalFrames = Math.max(128, Math.floor(data.tickIntervalFrames));
      }

      this.nextTickFrame = currentFrame + this.tickIntervalFrames;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (output && output[0]) {
      output[0].fill(0);
    }

    if (!this.enabled) {
      return true;
    }

    if (currentFrame >= this.nextTickFrame) {
      this.port.postMessage({
        type: 'tick',
        frame: currentFrame,
        time: currentTime
      });

      this.nextTickFrame = currentFrame + this.tickIntervalFrames;
    }

    return true;
  }
}

registerProcessor('transport-clock-processor', TransportClockProcessor);
