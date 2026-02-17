// path: services/MidiService.ts
export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
  type: 'input' | 'output';
}

export interface MidiMessage {
  type: 'noteon' | 'noteoff' | 'cc' | 'pitchbend' | 'unknown';
  channel: number;
  data1: number; // Note or CC number
  data2: number; // Velocity or Value
  deviceId: string;
}

type MidiCallback = (msg: MidiMessage) => void;

class MidiService {
  private listeners: Set<(devices: MidiDevice[]) => void> = new Set();
  private messageListeners: Set<MidiCallback> = new Set();
  private access: MIDIAccess | null = null;
  private activeInputs: Set<string> = new Set(); // Enabled Input IDs

  async init() {
    if (!navigator.requestMIDIAccess) {
      console.warn("Web MIDI API not supported in this browser.");
      return;
    }

    try {
      this.access = await navigator.requestMIDIAccess();

      this.access.onstatechange = (_e: MIDIConnectionEvent) => {
        this.updateDevices();
      };

      this.updateDevices();
    } catch (err) {
      console.error("MIDI Access Failed", err);
    }
  }

  private updateDevices() {
    if (!this.access) return;

    const devices: MidiDevice[] = [];

    // Inputs
    const inputs = Array.from(this.access.inputs.values());
    inputs.forEach(input => {
      devices.push({
        id: input.id,
        name: input.name || 'Unknown Device',
        manufacturer: input.manufacturer || '',
        state: input.state,
        type: 'input'
      });

      // Auto-enable new connected inputs? User preference usually. 
      // For now, let's enable all connected inputs by default for "Total Freedom".
      if (!this.activeInputs.has(input.id) && input.state === 'connected') {
        this.activeInputs.add(input.id);
      }

      // Bind handler
      input.onmidimessage = (e) => this.handleMidiMessage(e, input.id);
    });

    this.notifyListeners(devices);
  }

  private handleMidiMessage(event: MIDIMessageEvent, deviceId: string) {
    if (!this.activeInputs.has(deviceId)) return;

    const data = event.data;
    if (!data || data.length < 2) return;

    const status = data[0];
    const command = status >> 4;
    const channel = status & 0xF;
    const data1 = data[1];
    const data2 = data.length > 2 ? data[2] : 0;

    let type: MidiMessage['type'] = 'unknown';

    // Note Off
    if (command === 0x8 || (command === 0x9 && data2 === 0)) {
      type = 'noteoff';
    }
    // Note On
    else if (command === 0x9) {
      type = 'noteon';
    }
    // Control Change
    else if (command === 0xB) {
      type = 'cc';
    }
    // Pitch Bend
    else if (command === 0xE) {
      type = 'pitchbend';
    }

    if (type !== 'unknown') {
      const msg: MidiMessage = { type, channel, data1, data2, deviceId };
      this.messageListeners.forEach(cb => cb(msg));
    }
  }

  // --- API ---

  subscribeDevices(callback: (devices: MidiDevice[]) => void) {
    this.listeners.add(callback);
    if (this.access) this.updateDevices();
    return () => { this.listeners.delete(callback); };
  }

  onMessage(callback: MidiCallback) {
    this.messageListeners.add(callback);
    return () => { this.messageListeners.delete(callback); };
  }

  setEnabled(deviceId: string, enabled: boolean) {
    if (enabled) this.activeInputs.add(deviceId);
    else this.activeInputs.delete(deviceId);
  }

  isEnabled(deviceId: string): boolean {
    return this.activeInputs.has(deviceId);
  }

  setAllEnabled(deviceIds: string[], enabled: boolean) {
    deviceIds.forEach((deviceId) => this.setEnabled(deviceId, enabled));
  }

  getEnabledInputs(): string[] {
    return Array.from(this.activeInputs.values());
  }

  // Internal notify for device list changes
  private notifyListeners(devices: MidiDevice[]) {
    this.listeners.forEach(cb => cb(devices));
  }
}

export const midiService = new MidiService();
