
import { GoogleGenAI, Type } from "@google/genai";
import { Track } from "../types";

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const generatePattern = async (prompt: string, bpm: number) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a musical MIDI pattern based on this description: "${prompt}". 
                 BPM is ${bpm}. 
                 Return ONLY a JSON object representing a list of notes for a 1-bar loop.
                 Each note should have: 'pitch' (MIDI number 0-127), 'start' (0-15 for 16th steps), 'duration' (in 16th steps), 'velocity' (0-127).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            notes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pitch: { type: Type.INTEGER },
                  start: { type: Type.NUMBER },
                  duration: { type: Type.NUMBER },
                  velocity: { type: Type.INTEGER }
                }
              }
            },
            name: { type: Type.STRING }
          }
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return null;
  } catch (error) {
    console.error("Gemini generation error:", error);
    return null;
  }
};

export const analyzeMix = async (tracks: Track[]) => {
  try {
    // Simplify track data for the AI to save tokens
    const mixState = tracks.map(t => ({
      name: t.name,
      type: t.type,
      volumedB: t.volume,
      pan: t.pan,
      reverbSend: t.reverb,
      activeDevices: t.devices.map((d) => d.name)
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a professional Mixing Engineer (Ingeniero de Mezcla Profesional). Analyze the following JSON state of a music project.
                 
                 Current Project State: ${JSON.stringify(mixState)}

                 Provide a concise, bulleted list of 3-5 high-impact mixing suggestions. 
                 Focus on gain staging (volume balance), spatial placement (panning), and potential conflicts based on track names (e.g., Kick vs Bass).
                 Be technical but encouraging. Do not simply list the state back to me.
                 
                 IMPORTANT: RESPOND IN LATIN AMERICAN SPANISH.
                 `,
    });

    return response.text;
  } catch (error) {
    console.error("Mix analysis error:", error);
    return "No se pudo analizar la mezcla en este momento. Por favor verifica tu conexión.";
  }
};
