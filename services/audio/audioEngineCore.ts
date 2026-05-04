/**
 * Singleton AudioContext Manager (Web DSP)
 * Implementa un puente SharedArrayBuffer para telemetría UI de 0-latencia.
 */

export class AudioEngineCore extends EventTarget {
  private static instance: AudioEngineCore;
  
  public context: AudioContext;
  private masterWorkletNode: AudioWorkletNode | null = null;
  
  // Memoria compartida para telemetría (Peak, RMS) sin copias
  private sharedBuffer: SharedArrayBuffer | null = null;
  private meterView: Float32Array | null = null;

  private isInitialized = false;

  private constructor() {
    super();
    // Inicialización Cross-browser
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.context = new AudioContextClass();
  }

  public static getInstance(): AudioEngineCore {
    if (!AudioEngineCore.instance) {
      AudioEngineCore.instance = new AudioEngineCore();
    }
    return AudioEngineCore.instance;
  }

  /**
   * Inicializa el Worklet y establece el puente de SharedArrayBuffer.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 1. Cargar el módulo Worklet (servido estáticamente)
      await this.context.audioWorklet.addModule('/worklets/core-engine.worklet.js');

      // 2. Instanciar el nodo principal
      this.masterWorkletNode = new AudioWorkletNode(this.context, 'core-engine-processor');

      // 3. Crear SharedArrayBuffer.
      // ¡ATENCIÓN! Esto requiere cabeceras COOP/COEP estrictas (Cross-Origin Isolation) en el servidor.
      // Asignamos 1024 bytes (256 floats). Usamos 4 (Left/Right Peak, Left/Right RMS),
      // pero dejamos espacio para telemetría multicanal o del analizador de espectro futuro.
      this.sharedBuffer = new SharedArrayBuffer(1024);
      this.meterView = new Float32Array(this.sharedBuffer);

      // 4. Enviar bloque de memoria al Worklet
      this.masterWorkletNode.port.postMessage({
        type: 'INIT_METER_BUFFER',
        buffer: this.meterView
      });

      // 5. Conectar Nodo al destino final (Altavoces)
      this.masterWorkletNode.connect(this.context.destination);

      this.isInitialized = true;
      this.dispatchEvent(new Event('initialized'));
      
      console.log("[AudioEngine] Web DSP initialized with SharedArrayBuffer telemetry bridge.");
    } catch (err) {
      console.error("[AudioEngine] Failed to initialize Web DSP. Verify COOP/COEP headers.", err);
      throw err;
    }
  }

  /**
   * DIRECTRIZ UI: Este método DEBE ser llamado dentro de un bucle `requestAnimationFrame`
   * en los componentes Canvas de React.
   * Lee directamente de la RAM, garantizando 60 FPS continuos sin disparar el Garbage Collector.
   */
  public getMeterValues() {
    if (!this.meterView) {
      return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
    }
    
    // Mapeo físico en memoria: [0: PeakL, 1: PeakR, 2: RMSL, 3: RMSR]
    return {
      peakL: this.meterView[0],
      peakR: this.meterView[1],
      rmsL: this.meterView[2],
      rmsR: this.meterView[3],
    };
  }

  /**
   * Desbloquea el motor de audio.
   * Debe ser invocado por el primer evento de interacción del usuario (Click / Touch).
   */
  public async resume(): Promise<void> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
      this.dispatchEvent(new Event('resumed'));
      console.log("[AudioEngine] AudioContext resumed. DSP Online.");
    }
  }

  /**
   * Suspende el motor de audio para ahorrar ciclos de CPU (Ej. minimización de pestaña).
   */
  public async suspend(): Promise<void> {
    if (this.context.state === 'running') {
      await this.context.suspend();
      this.dispatchEvent(new Event('suspended'));
      console.log("[AudioEngine] AudioContext suspended. DSP Offline.");
    }
  }
}

export const audioEngineCore = AudioEngineCore.getInstance();
