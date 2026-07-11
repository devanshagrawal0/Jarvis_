// T6a: Wake word + push-to-talk for Jarvis.
// Uses Porcupine for "Hey Jarvis" hotword detection + optional Whisper-small for STT.
// Gracefully degrades if native deps are not installed — exports a stub with no-op handlers.
// To activate: npm install @picovoice/porcupine-node @picovoice/pvrecorder-node
// Porcupine access key required in settings as porcupineKey.

let Porcupine, PvRecorder;
let porcupineAvailable = false;
try {
  Porcupine = require("@picovoice/porcupine-node");
  PvRecorder = require("@picovoice/pvrecorder-node").PvRecorder;
  porcupineAvailable = true;
} catch (_) {
  // Deps not installed — wake word will be disabled
}

const SAMPLE_RATE = 16000;
const FRAME_SIZE = 512;

function createWakeWordEngine({ getSettings, onWakeWord, onError } = {}) {
  let porcupine = null;
  let recorder = null;
  let running = false;
  let frameLoop = null;

  function isAvailable() {
    return porcupineAvailable;
  }

  function status() {
    return {
      available: porcupineAvailable,
      running,
      deps: "@picovoice/porcupine-node + @picovoice/pvrecorder-node",
      note: porcupineAvailable ? "active" : "install deps to enable",
    };
  }

  async function start() {
    if (!porcupineAvailable) {
      console.warn("[wake-word] Porcupine not installed — wake word disabled");
      return { ok: false, reason: "deps_not_installed" };
    }
    if (running) return { ok: true, reason: "already_running" };

    const settings = getSettings?.() || {};
    const accessKey = settings.porcupineKey;
    if (!accessKey) return { ok: false, reason: "porcupineKey not configured in settings" };

    try {
      // Built-in "jarvis" keyword on supported platforms (needs ppn file on unsupported)
      porcupine = Porcupine.fromBuiltinKeywords(accessKey, ["jarvis"]);
      recorder = new PvRecorder(FRAME_SIZE, -1);
      recorder.start();
      running = true;

      const processFrame = () => {
        if (!running) return;
        try {
          const pcm = recorder.read();
          const keywordIndex = porcupine.process(pcm);
          if (keywordIndex >= 0) {
            onWakeWord?.({ keyword: "jarvis", index: keywordIndex, at: new Date().toISOString() });
          }
        } catch (err) {
          onError?.({ error: err.message, phase: "frame_processing" });
        }
        frameLoop = setImmediate(processFrame);
      };
      frameLoop = setImmediate(processFrame);
      console.log("[wake-word] Listening for 'Hey Jarvis'...");
      return { ok: true };
    } catch (err) {
      running = false;
      onError?.({ error: err.message, phase: "startup" });
      return { ok: false, error: err.message };
    }
  }

  function stop() {
    running = false;
    if (frameLoop) { clearImmediate(frameLoop); frameLoop = null; }
    try { recorder?.stop(); recorder?.release(); } catch (_) {}
    try { porcupine?.release(); } catch (_) {}
    recorder = null;
    porcupine = null;
    return { ok: true };
  }

  return { start, stop, status, isAvailable };
}

// Push-to-talk: simple toggle-based recording using pvrecorder only (no hotword).
function createPushToTalk({ onAudio, onError } = {}) {
  let recorder = null;
  let active = false;
  let chunks = [];

  function isAvailable() {
    return porcupineAvailable; // PvRecorder comes with porcupine-node
  }

  function startRecording() {
    if (!porcupineAvailable) return { ok: false, reason: "deps_not_installed" };
    if (active) return { ok: false, reason: "already_recording" };
    try {
      recorder = new PvRecorder(FRAME_SIZE, -1);
      recorder.start();
      active = true;
      chunks = [];
      return { ok: true };
    } catch (err) {
      onError?.({ error: err.message });
      return { ok: false, error: err.message };
    }
  }

  function stopRecording() {
    if (!active) return { ok: false, reason: "not_recording" };
    active = false;
    const allSamples = [];
    try {
      let pcm;
      while ((pcm = recorder.read()) && pcm.length) {
        allSamples.push(...pcm);
      }
    } catch (_) {}
    try { recorder.stop(); recorder.release(); } catch (_) {}
    recorder = null;
    onAudio?.({ samples: allSamples, sampleRate: SAMPLE_RATE });
    return { ok: true, sampleCount: allSamples.length };
  }

  function status() {
    return { available: porcupineAvailable, active };
  }

  return { startRecording, stopRecording, status, isAvailable };
}

module.exports = { createWakeWordEngine, createPushToTalk, porcupineAvailable };
