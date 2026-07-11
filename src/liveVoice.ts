import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { authHeaders } from "./api";

type LiveTokenResponse = {
  token: string;
  model: string;
  expiresAt: string;
  newSessionExpiresAt: string;
  sampleRate: { input: number; output: number };
};

type VoiceStatusResponse = {
  configured: boolean;
  status: string;
  model: string;
  voice: string;
};

type LiveVoiceEvents = {
  onState?: (state: "connecting" | "listening" | "speaking" | "idle" | "error", detail?: string) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onTurnComplete?: (turn: { input: string; output: string }) => void;
  onToolResult?: (tool: string, result: unknown) => void;
};

function floatToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = Math.max(-1, Math.min(1, input[index]));
    output[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output;
}

function downsample(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let source = start; source < end; source += 1) total += input[source];
    output[index] = total / Math.max(1, end - start);
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export class LiveVoiceController {
  private events: LiveVoiceEvents;
  private session: Session | null = null;
  private stream: MediaStream | null = null;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private outputCursor = 0;
  private playing = new Set<AudioBufferSourceNode>();
  private inputTranscript = "";
  private outputTranscript = "";
  private closing = false;
  private resumptionHandle = "";

  // Exposed for waveform visualizers
  _inputAnalyser: AnalyserNode | null = null;
  _outputAnalyser: AnalyserNode | null = null;

  constructor(events: LiveVoiceEvents = {}) {
    this.events = events;
  }

  get active() {
    return Boolean(this.session && this.stream);
  }

  async start() {
    if (this.active) return;
    this.closing = false;
    this.events.onState?.("connecting");
    const statusResponse = await fetch("/api/voice/status", { headers: authHeaders() });
    const status = await statusResponse.json() as VoiceStatusResponse & { error?: string };
    if (!statusResponse.ok || !status.configured) {
      throw new Error(status.error || "Gemini Live voice is not configured. Add the Gemini API key in Connections first.");
    }
    const tokenResponse = await fetch("/api/live/token", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: "{}",
    });
    const token = await tokenResponse.json() as LiveTokenResponse & { error?: string };
    if (!tokenResponse.ok) throw new Error(token.error || "Could not create Gemini Live session");

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError") throw new Error("Microphone permission is blocked. Allow microphone access for this site, then start voice again.");
      if (name === "NotFoundError") throw new Error("No microphone was found. Connect or enable a microphone, then start voice again.");
      throw error;
    }
    this.inputContext = new AudioContext();
    this.outputContext = new AudioContext({ sampleRate: token.sampleRate.output });
    await Promise.all([this.inputContext.resume(), this.outputContext.resume()]);

    this._inputAnalyser = this.inputContext.createAnalyser();
    this._inputAnalyser.fftSize = 512;
    this._inputAnalyser.smoothingTimeConstant = 0.75;

    this._outputAnalyser = this.outputContext.createAnalyser();
    this._outputAnalyser.fftSize = 512;
    this._outputAnalyser.smoothingTimeConstant = 0.8;
    this._outputAnalyser.connect(this.outputContext.destination);

    const ai = new GoogleGenAI({
      apiKey: token.token,
      httpOptions: { apiVersion: "v1alpha" },
    });
    this.session = await ai.live.connect({
      model: token.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
      },
      callbacks: {
        onopen: () => this.events.onState?.("listening"),
        onmessage: (message) => void this.handleMessage(message),
        onerror: (event) => this.fail(event.error?.message || event.message || "Gemini Live connection failed"),
        onclose: () => {
          if (!this.closing) this.events.onState?.("idle", "Gemini Live connection closed");
        },
      },
    });

    this.inputSource = this.inputContext.createMediaStreamSource(this.stream);
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);
    const silentGain = this.inputContext.createGain();
    silentGain.gain.value = 0;
    // Tap mic into analyser for waveform visualization
    this.inputSource.connect(this._inputAnalyser!);
    this._inputAnalyser!.connect(this.processor);
    this.processor.onaudioprocess = (event) => {
      if (!this.session) return;
      const source = event.inputBuffer.getChannelData(0);
      const downsampled = downsample(source, this.inputContext!.sampleRate, token.sampleRate.input);
      const pcm = floatToPcm16(downsampled);
      this.session.sendRealtimeInput({
        audio: {
          data: bytesToBase64(new Uint8Array(pcm.buffer)),
          mimeType: `audio/pcm;rate=${token.sampleRate.input}`,
        },
      });
    };
    this.processor.connect(silentGain);
    silentGain.connect(this.inputContext.destination);
  }

  async stop() {
    this.closing = true;
    if (this.session) {
      this.session.sendRealtimeInput({ audioStreamEnd: true });
      this.session.close();
    }
    this.session = null;
    this.processor?.disconnect();
    this.inputSource?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stopPlayback();
    await Promise.allSettled([this.inputContext?.close(), this.outputContext?.close()]);
    this.processor = null;
    this.inputSource = null;
    this.stream = null;
    this.inputContext = null;
    this.outputContext = null;
    this._inputAnalyser = null;
    this._outputAnalyser = null;
    this.events.onState?.("idle");
  }

  private async handleMessage(message: LiveServerMessage) {
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.serverContent?.interrupted) {
      this.stopPlayback();
      this.events.onState?.("listening");
    }
    const input = message.serverContent?.inputTranscription?.text;
    if (input) {
      this.inputTranscript += input;
      this.events.onInputTranscript?.(this.inputTranscript.trim());
    }
    const output = message.serverContent?.outputTranscription?.text;
    if (output) {
      this.outputTranscript += output;
      this.events.onOutputTranscript?.(this.outputTranscript.trim());
    }
    for (const part of message.serverContent?.modelTurn?.parts || []) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("audio/")) this.playPcm(inline.data);
    }
    if (message.toolCall?.functionCalls?.length && this.session) {
      const responses = [];
      for (const call of message.toolCall.functionCalls) {
        const response = await fetch("/api/capabilities/execute", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ tool: call.name, args: call.args || {}, source: "voice" }),
        });
        const result = await response.json();
        this.events.onToolResult?.(call.name || "unknown", result);
        responses.push({ id: call.id, name: call.name, response: result });
      }
      this.session.sendToolResponse({ functionResponses: responses });
    }
    if (message.serverContent?.turnComplete) {
      const turn = { input: this.inputTranscript.trim(), output: this.outputTranscript.trim() };
      if (turn.input || turn.output) {
        this.events.onTurnComplete?.(turn);
        void fetch("/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            kind: "episodic",
            category: "conversation",
            source: "gemini-live",
            confidence: 0.85,
            importance: 0.5,
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
            text: `User: ${turn.input}\nJARVIS: ${turn.output}`,
          }),
        });
      }
      this.inputTranscript = "";
      this.outputTranscript = "";
      this.events.onState?.("listening");
    }
    if (message.goAway?.timeLeft) {
      this.events.onState?.("idle", `Live session will reconnect in ${message.goAway.timeLeft}`);
    }
  }

  private playPcm(base64: string) {
    if (!this.outputContext) return;
    this.events.onState?.("speaking");
    const bytes = base64ToBytes(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = this.outputContext.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 0x8000;
    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this._outputAnalyser ?? this.outputContext.destination);
    this.outputCursor = Math.max(this.outputCursor, this.outputContext.currentTime);
    source.start(this.outputCursor);
    this.outputCursor += buffer.duration;
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
  }

  private stopPlayback() {
    for (const source of this.playing) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.playing.clear();
    this.outputCursor = this.outputContext?.currentTime || 0;
  }

  private fail(message: string) {
    this.events.onState?.("error", message);
    void this.stop();
  }
}
