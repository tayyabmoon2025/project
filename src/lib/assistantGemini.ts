import type { UserRole } from '@/lib/auth';

// The browser side of the Google Gemini upgrade. The API key never appears here: the
// request goes to the school-assistant edge function, which holds it as a secret and
// talks to Google on our behalf.
//
// Every failure comes back as a `fallback` outcome rather than a thrown error, so the
// widget can drop to the local rule-based bot instead of showing a broken panel.

const FUNCTION_TIMEOUT_MS = 15000;
// A paper is a much longer answer, and the server gives itself a longer budget for it.
const PAPER_TIMEOUT_MS = 45000;

export type AiOutcome =
  | { status: 'ok'; reply: unknown }
  | { status: 'fallback'; rateLimited: boolean; daily: boolean; message: string };

export type PaperOutcome =
  | { status: 'ok'; paper: unknown }
  | { status: 'denied'; message: string }
  | { status: 'fallback'; rateLimited: boolean; daily: boolean; message: string };

// The exact wording shown when Google's free daily allowance for the day is spent. It is
// fixed here as well as on the server so the message the school asked for is what people
// actually see, whatever the server happens to send.
export const DAILY_LIMIT_MESSAGE = 'Daily AI limit reached, please try again tomorrow';

export type AiRequest = {
  question: string;
  role: UserRole;
  today: string;
  context: unknown;
  // A photo of a textbook page, already scaled down in the browser.
  image?: { mimeType: string; base64: string };
};

export type PaperRequest = {
  question: string;
  role: UserRole;
  today: string;
  image?: { mimeType: string; base64: string };
};

function endpoint(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  return `${url}/functions/v1/school-assistant`;
}

type ServerPayload = { reply?: unknown; paper?: unknown; error?: string; message?: string; daily?: boolean };

type CallResult = {
  ok: boolean;
  reason: 'success' | 'offline' | 'timeout' | 'network' | 'http';
  status: number;
  payload: ServerPayload;
};

// One place for the network call, the timeout and the error wording, shared by the
// question path and the paper path.
async function callFunction(body: unknown, timeoutMs: number): Promise<CallResult> {
  const url = endpoint();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return { ok: false, reason: 'offline', status: 0, payload: {} };

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network', status: 0, payload: {} };
  } finally {
    window.clearTimeout(timer);
  }

  let payload: ServerPayload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  return { ok: response.ok, reason: response.ok ? 'success' : 'http', status: response.status, payload };
}

function offlineMessage(): string {
  return 'The smart assistant is not connected on this device, so the built-in answers are being used.';
}

function networkMessage(reason: 'timeout' | 'network'): string {
  return reason === 'timeout'
    ? 'The smart assistant took too long to answer, so the built-in answer is shown.'
    : 'The smart assistant could not be reached, so the built-in answers are being used.';
}

function fallback(rateLimited: boolean, message: string, daily = false): AiOutcome {
  return { status: 'fallback', rateLimited, daily, message };
}

export async function askGemini(request: AiRequest): Promise<AiOutcome> {
  const result = await callFunction(request, FUNCTION_TIMEOUT_MS);
  if (!result.ok) {
    if (result.reason === 'offline') return fallback(false, offlineMessage());
    if (result.reason === 'timeout' || result.reason === 'network') return fallback(false, networkMessage(result.reason));
  }

  const { payload, status } = result;
  if (result.ok && payload.reply !== undefined) {
    return { status: 'ok', reply: payload.reply };
  }

  // A rate limit or an exhausted quota is the case the local bot exists for, so it is
  // reported separately from a genuine fault. A spent daily allowance gets its own
  // wording, so it never reads like a broken assistant.
  const rateLimited = status === 429 || payload.error === 'rate_limited';
  if (rateLimited) {
    if (payload.daily === true) return fallback(true, DAILY_LIMIT_MESSAGE, true);
    return fallback(true, payload.message ?? 'The smart assistant has reached its limit for now — the built-in answers are being used.');
  }
  if (status === 503 || payload.error === 'not_configured') {
    return fallback(false, 'The smart assistant key is not set up yet, so the built-in answers are being used.');
  }

  return fallback(false, payload.message ?? 'The smart assistant could not answer, so the built-in answer is shown.');
}

// Asks for a printable quiz paper. The role check also lives on the server, so a parent
// or student can never reach a paper even if this is called directly.
export async function requestPaper(request: PaperRequest): Promise<PaperOutcome> {
  const result = await callFunction({ ...request, task: 'paper' }, PAPER_TIMEOUT_MS);
  const { payload, status } = result;

  if (status === 403 || payload.error === 'forbidden') {
    return { status: 'denied', message: payload.message ?? 'this function is available for admins only.' };
  }
  if (result.ok && payload.paper !== undefined) {
    return { status: 'ok', paper: payload.paper };
  }
  if (result.reason === 'offline') {
    return { status: 'fallback', rateLimited: false, daily: false, message: offlineMessage() };
  }
  if (result.reason === 'timeout' || result.reason === 'network') {
    return { status: 'fallback', rateLimited: false, daily: false, message: networkMessage(result.reason) };
  }

  const rateLimited = status === 429 || payload.error === 'rate_limited';
  if (rateLimited) {
    if (payload.daily === true) return { status: 'fallback', rateLimited: true, daily: true, message: DAILY_LIMIT_MESSAGE };
    return { status: 'fallback', rateLimited: true, daily: false, message: payload.message ?? 'The smart assistant has reached its limit for now.' };
  }
  if (status === 503 || payload.error === 'not_configured') {
    return { status: 'fallback', rateLimited: false, daily: false, message: 'The smart assistant key is not set up yet.' };
  }

  return { status: 'fallback', rateLimited: false, daily: false, message: payload.message ?? 'The paper could not be generated. Please try again.' };
}
