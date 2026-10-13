// Safari rejects getUserMedia({ audio: true }) in a playback-only session.
// Keep capture enabled through permission prompts and sound-unlock taps.
let microphoneUsers = 0;

export function prepareAudioPlayback() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = microphoneUsers ? 'play-and-record' : 'playback';
  } catch (_) { /* Browsers without a usable Audio Session API choose their own mode. */ }
}

export function acquireMicrophoneAudioSession() {
  microphoneUsers++;
  prepareAudioPlayback();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    microphoneUsers--;
    prepareAudioPlayback();
  };
}
