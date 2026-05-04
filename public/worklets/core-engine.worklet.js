/**
 * Hollow Web DSP - Core Engine AudioWorklet
 * This script runs in a dedicated Audio Thread, guaranteeing real-time
 * processing without being blocked by React UI rendering or Garbage Collection.
 */

class CoreEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Vista Float32Array respaldada por SharedArrayBuffer
    this.meterBuffer = null;
    
    // Escuchar el puerto de mensajes para recibir el bloque de memoria compartida
    this.port.onmessage = (event) => {
      if (event.data.type === 'INIT_METER_BUFFER') {
        this.meterBuffer = event.data.buffer;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    let maxL = 0;
    let maxR = 0;
    let sumSquaresL = 0;
    let sumSquaresR = 0;

    // Si hay audio de entrada, procesamos
    if (input && input.length > 0) {
      const channelL = input[0];
      const channelR = input.length > 1 ? input[1] : input[0]; // Fallback a mono si no hay canal D
      
      const outChannelL = output[0];
      const outChannelR = output.length > 1 ? output[1] : (output[0] || new Float32Array(128));

      // Iteramos sobre los 128 samples del bloque de audio
      for (let i = 0; i < channelL.length; i++) {
        // 1. Passthrough (pasar la señal de entrada a la salida)
        if (outChannelL) outChannelL[i] = channelL[i];
        if (outChannelR && input.length > 1) outChannelR[i] = channelR[i];

        // 2. Cálculos de Telemetría (Peak y RMS)
        const valL = channelL[i];
        const valR = channelR[i];
        
        const absL = Math.abs(valL);
        const absR = Math.abs(valR);
        
        if (absL > maxL) maxL = absL;
        if (absR > maxR) maxR = absR;
        
        sumSquaresL += valL * valL;
        sumSquaresR += valR * valR;
      }

      // 3. Escribir directamente en SharedArrayBuffer.
      // Esta es la clave del rendimiento: escribimos en RAM y el hilo de UI
      // leerá exactamente la misma dirección física. Cero copias (zero-copy),
      // cero eventos postMessage, cero impacto en el Garbage Collector.
      if (this.meterBuffer) {
        this.meterBuffer[0] = maxL;
        this.meterBuffer[1] = maxR;
        this.meterBuffer[2] = Math.sqrt(sumSquaresL / channelL.length);
        this.meterBuffer[3] = Math.sqrt(sumSquaresR / channelL.length);
      }
    }

    // Retornar true mantiene el procesador vivo en el hilo
    return true;
  }
}

registerProcessor('core-engine-processor', CoreEngineProcessor);
