import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is not in the DOM lib yet, and it is still vendor-prefixed in
// most browsers, so the shapes it needs are declared here rather than pulled from a
// package. Nothing leaves the browser: recognition runs on the device through the
// browser's own engine, which is what keeps the assistant free and private.
type SpeechAlternative = { transcript: string };

type SpeechResult = {
  isFinal: boolean;
  0: SpeechAlternative;
  length: number;
};

type SpeechResultList = {
  length: number;
  item(index: number): SpeechResult;
  [index: number]: SpeechResult;
};

type SpeechEvent = { resultIndex: number; results: SpeechResultList };

type RecognitionErrorEvent = { error: string; message?: string };

type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type RecognitionConstructor = new () => RecognitionInstance;

// Chromium and WebKit ship the prefixed constructor; Firefox does not ship one at all.
function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export type VoiceInput = {
  supported: boolean;
  listening: boolean;
  /** The words heard so far — final text plus the part still being spoken. */
  transcript: string;
  /** Set when the microphone could not be used, so the caller can explain why. */
  error: string | null;
  start: () => void;
  stop: () => void;
};

// Plain-language reasons for each way the microphone can fail, so the office sees
// something actionable instead of a raw error code.
const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow microphone access for this site in your browser settings, then try again.',
  'service-not-allowed': 'The browser refused to start voice input. Check the microphone permission for this site.',
  'audio-capture': 'No microphone was found. Connect a microphone and try again.',
  'no-speech': 'Nothing was heard. Tap the microphone and speak a little closer.',
  network: 'Voice input needs an internet connection to transcribe speech. Check your connection and try again.',
  aborted: '',
};

/**
 * Listens to the microphone and turns speech into text using the browser's built-in
 * speech recognition. The recognised words are handed back through onTranscript so the
 * caller can drop them into its own command box — no external service is involved.
 */
export function useVoiceInput({
  onTranscript,
  onFinal,
  language = 'en-US',
}: {
  onTranscript: (text: string) => void;
  onFinal?: (text: string) => void;
  language?: string;
}): VoiceInput {
  const supported = recognitionConstructor() !== null;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  // Kept in refs so the recognition callbacks always see the latest handlers without
  // the recognition instance being rebuilt on every render.
  const onTranscriptRef = useRef(onTranscript);
  const onFinalRef = useRef(onFinal);
  const heardRef = useRef('');

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);

  // A recognition session left running when the panel closes would keep the microphone
  // open, so it is always torn down on unmount.
  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = null;
    recognition.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError('This browser does not support voice input. Type your command instead — everything else works the same.');
      return;
    }
    if (recognitionRef.current) return;

    const recognition = new Constructor();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    heardRef.current = '';
    setTranscript('');
    setError(null);

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const words = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += words;
        else interimText += words;
      }
      if (finalText) heardRef.current = `${heardRef.current} ${finalText}`.trim();
      const combined = `${heardRef.current} ${interimText}`.trim();
      setTranscript(combined);
      onTranscriptRef.current(combined);
    };

    recognition.onerror = (event) => {
      const message = ERROR_MESSAGES[event.error] ?? 'Voice input stopped unexpectedly. Please try again.';
      if (message) setError(message);
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const heard = heardRef.current.trim();
      if (heard) onFinalRef.current?.(heard);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // start() throws if a previous session is still winding down.
      setError('Voice input could not start. Please try again in a moment.');
      recognitionRef.current = null;
      setListening(false);
    }
  }, [language]);

  return { supported, listening, transcript, error, start, stop };
}
