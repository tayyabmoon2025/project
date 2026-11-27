// School Assistant — Google Gemini proxy.
//
// The Gemini API key lives only here, as the GEMINI_API_KEY secret, so it is never
// shipped to the browser. The widget sends the question (and sometimes a photo of a
// textbook page) plus a small, already role-filtered summary of school data; this
// function turns that into one grounded answer or one printable quiz paper.
//
// Google retires models for new API keys without warning, so a request is tried against
// a short list of current models in order. Capacity errors (503) and retired models (404)
// move on to the next candidate instead of failing the answer.
//
// Rate limits and upstream failures are reported with their own status codes so the
// widget can fall back to its local rule-based bot instead of showing an error.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// Tried in order. The lite models come first because Google gives them the most generous
// free daily allowance, and each model has its own separate daily quota — so a spent lite
// allowance still leaves the walk somewhere to go rather than ending the answer.
//
// `gemini-2.5-flash-lite` is deliberately not listed: it is retired for this key and
// answers 404 ("no longer available to new users") pointing at `gemini-3.5-flash-lite`,
// which is listed below. A retired name only costs a wasted round trip on every request.
const MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.8-flash',
];

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Gemini answers a busy model with a fast 503 that very often succeeds on the next call,
// so a single attempt is not enough. These bounds keep the whole walk inside the widget's
// own patience: each attempt gives up after 6s (a paper, which is a longer answer, gets
// 15s), and the walk stops starting new attempts once the budget is spent.
const PER_ATTEMPT_TIMEOUT_MS = 6000;
const PAPER_ATTEMPT_TIMEOUT_MS = 15000;
const TOTAL_BUDGET_MS = 10500;
const PAPER_TOTAL_BUDGET_MS = 32000;
const ROUNDS = 2;

// The answer shape the widget renders for a normal question.
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
    stats: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
    table: {
      type: 'object',
      properties: {
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      },
      required: ['columns', 'rows'],
    },
    list: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, subtitle: { type: 'string' }, meta: { type: 'string' } },
        required: ['title'],
      },
    },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['title'],
};

// The shape of a generated paper. Sections let the model separate MCQs from short
// questions, which is exactly how the printed sheet is laid out.
const PAPER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subject: { type: 'string' },
    className: { type: 'string' },
    timeAllowed: { type: 'string' },
    totalMarks: { type: 'string' },
    instructions: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          instructions: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
                answer: { type: 'string' },
                marks: { type: 'string' },
              },
              required: ['question', 'answer'],
            },
          },
        },
        required: ['heading', 'questions'],
      },
    },
  },
  required: ['title', 'sections'],
};

const ROLE_NOTES: Record<string, string> = {
  admin: 'They are the administrator and may see the whole school.',
  office_assistant: 'They work in the school office: attendance, records and notices, but not fees.',
  teacher: 'They are a teacher and see only the classes they are attached to.',
  accountant: 'They work in the accounts office: fees, records and the exam datesheet, but not the register.',
  parent: 'They are a parent and may see ONLY their own child. Never mention any other student.',
  student: 'They are a student and may see ONLY their own record. Never mention any other student.',
};

function systemPrompt(role: string, today: string): string {
  return [
    'You are the School Assistant for Ujala Public School (Schooldesk).',
    'Answer in the language the person used: English, Roman Urdu, or a natural mix of the two.',
    'Keep the answer short and plain — this is a small chat panel, not a printed report.',
    '',
    'Ground rules:',
    '1. Use ONLY the data in the SCHOOL DATA block. It has already been filtered to what this person may see. Never invent a student, amount, date or figure, and never mention anything that is not in the block.',
    '2. If the block does not hold the answer, say so plainly and suggest what they can ask instead. Never guess.',
    '3. Never reveal a date of birth, and never show another student or another family.',
    '4. You only explain and show. Never say you saved, sent, changed or deleted anything. If they want something done, tell them which screen to open.',
    '5. Aim for under 90 words in total.',
    '6. Amounts are Pakistani rupees — write them like "Rs 12,500". Today is ' + today + '.',
    '',
    'Return JSON with:',
    '- title: a short heading, at most 8 words.',
    '- notes: 1 to 3 short sentences that actually answer the question. This is the main answer.',
    '- stats: optional, up to 4 cards of {label, value} for counts and totals.',
    '- table: optional {columns, rows} — only when comparing several students. At most 8 rows.',
    '- list: optional, up to 4 items of {title, subtitle, meta}.',
    '- followUps: optional 2 to 4 short questions in the same language the person used.',
    '',
    'Who is asking: ' + (ROLE_NOTES[role] ?? 'An unknown role — share nothing specific.'),
  ].join('\n');
}

// The paper is written for a teacher to hand out, so the wording is formal and the
// questions must be answerable from the page in the photo alone.
function paperPrompt(role: string, today: string, hasImage: boolean): string {
  return [
    'You are the School Assistant for Ujala Public School (Schooldesk), preparing a printable quiz paper for a teacher.',
    '',
    'Ground rules:',
    '1. Base every question ONLY on the subject matter in the material supplied' + (hasImage ? ' in the attached photo of a textbook or exercise page.' : ' in the request below.'),
    '2. Never invent facts, figures, names or dates that are not in that material.',
    '3. Write the paper in English. Keep the language simple and suited to a school class.',
    '4. Produce two sections: first "Multiple Choice Questions" (MCQs), then "Short Questions".',
    '5. Each MCQ must have exactly four options, and every question must have a correct answer in the answer key.',
    '6. Do not include any student name, marks obtained, or school-internal figure.',
    '7. Today is ' + today + '.',
    '',
    'Return JSON with:',
    '- title: the paper heading, e.g. "Class 6 Science — Chapter 3 Quiz".',
    '- subject, className, timeAllowed, totalMarks: short strings. Estimate the class from the material if it is not stated.',
    '- instructions: 2 to 4 short lines for the students.',
    '- sections: an array. Give each section a heading, an optional one-line instruction, and its questions.',
    '- Each question: question text, options (the four choices, only for MCQs), answer (the correct option or a model answer), marks (e.g. "2").',
    '',
    'Aim for about 10 MCQs and 5 short questions unless the material clearly suits fewer.',
    'Who is asking: ' + (ROLE_NOTES[role] ?? 'A member of school staff.'),
  ].join('\n');
}

// The incoming summary is trimmed before it reaches the model, so an oversized payload
// can neither blow the token budget nor slow the answer down.
function clampText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function summariseContext(context: unknown): string {
  if (!context || typeof context !== 'object') return 'No school data was supplied.';
  const ctx = context as Record<string, unknown>;
  const lines: string[] = [];

  const student = ctx.student;
  if (student && typeof student === 'object') {
    const s = student as Record<string, unknown>;
    lines.push('The record this person is asking about:');
    lines.push(`- Name: ${clampText(s.name, 60)}`);
    lines.push(`- Class: ${clampText(s.className, 20)}-${clampText(s.section, 10)} · Adm. no. ${clampText(s.admissionNumber, 20)}`);
    lines.push(`- Fee balance: ${clampText(s.feeBalance, 20)}`);
    if (s.attendance) lines.push(`- Attendance today: ${clampText(s.attendance, 20)}`);
  }

  const totals = ctx.totals;
  if (totals && typeof totals === 'object') {
    const t = totals as Record<string, unknown>;
    const pairs = Object.entries(t).filter(([, value]) => value !== null && value !== undefined && value !== '');
    if (pairs.length > 0) {
      lines.push('School figures:');
      for (const [key, value] of pairs.slice(0, 20)) {
        lines.push(`- ${clampText(key, 40)}: ${clampText(value, 40)}`);
      }
    }
  }

  const students = asArray(ctx.students).slice(0, 40);
  if (students.length > 0) {
    lines.push(`Students this person may see (${students.length} shown):`);
    for (const entry of students) {
      const s = (entry ?? {}) as Record<string, unknown>;
      lines.push(`- ${clampText(s.name, 60)} · ${clampText(s.className, 20)}-${clampText(s.section, 10)} · Adm. ${clampText(s.admissionNumber, 20)} · due ${clampText(s.feeBalance, 20)}`);
    }
  }

  const notices = asArray(ctx.notices).slice(0, 10);
  if (notices.length > 0) {
    lines.push('Recent notices:');
    for (const entry of notices) {
      const n = (entry ?? {}) as Record<string, unknown>;
      lines.push(`- ${clampText(n.date, 20)}: ${clampText(n.title, 80)} — ${clampText(n.body, 160)}`);
    }
  }

  const homework = asArray(ctx.homework).slice(0, 10);
  if (homework.length > 0) {
    lines.push('Recent homework:');
    for (const entry of homework) {
      const h = (entry ?? {}) as Record<string, unknown>;
      lines.push(`- ${clampText(h.date, 20)} · ${clampText(h.className, 20)}-${clampText(h.section, 10)} · ${clampText(h.subject, 30)}: ${clampText(h.detail, 160)}${h.due ? ` (due ${clampText(h.due, 20)})` : ''}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No school data was supplied.';
}

type Attempt = {
  status: number;
  reason: 'gone' | 'busy' | 'limited' | 'rejected' | 'bad' | 'timeout' | 'other';
  // True when the quota that ran out is the daily allowance rather than a short burst.
  daily?: boolean;
};

type GeminiResult = { reply: unknown } | Attempt;

// A teacher's photo arrives as base64. It is size-checked here as well as in the browser,
// so an oversized body can never be forwarded upstream.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type InlineImage = { mimeType: string; data: string };

function readImage(raw: unknown): { image: InlineImage | null; tooLarge: boolean } {
  if (!raw || typeof raw !== 'object') return { image: null, tooLarge: false };
  const row = raw as Record<string, unknown>;
  const mimeType = typeof row.mimeType === 'string' ? row.mimeType : '';
  const data = typeof row.base64 === 'string' ? row.base64 : '';
  if (!data || !ALLOWED_IMAGE_TYPES.includes(mimeType)) return { image: null, tooLarge: false };
  // Base64 carries 4 characters per 3 bytes.
  if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) return { image: null, tooLarge: true };
  return { image: { mimeType, data }, tooLarge: false };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `AbortSignal.timeout` is not available on every runtime this may be deployed to, and a
// missing timeout is far better than a broken answer, so it is used only when present.
function attemptSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

function requestBody(system: string, schema: unknown, text: string, image: InlineImage | null, maxTokens: number): string {
  const parts: Record<string, unknown>[] = [{ text }];
  // The image goes first so the model reads the page before the instruction that refers to it.
  if (image) parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.data } });

  return JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });
}

async function tryModel(
  model: string,
  apiKey: string,
  system: string,
  schema: unknown,
  prompt: string,
  image: InlineImage | null,
  maxTokens: number,
  timeoutMs: number,
): Promise<{ reply: unknown } | Attempt> {
  let response: Response;
  try {
    response = await fetch(endpointFor(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: requestBody(system, schema, prompt, image, maxTokens),
      signal: attemptSignal(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { status: 502, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'other' };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 502, reason: 'rejected' };
  }
  if (response.status === 404) {
    return { status: 502, reason: 'gone' };
  }
  if (response.status === 429) {
    const detail = await response.text().catch(() => '');
    return { status: 429, reason: 'limited', daily: /per day|per_day|PerDay|daily/i.test(detail) };
  }
  if (response.status === 503) {
    return { status: 503, reason: 'busy' };
  }
  if (response.status === 400) {
    const detail = await response.text().catch(() => '');
    // A 400 caused by a spent quota is still a rate limit as far as the widget cares.
    if (/quota|rate/i.test(detail)) {
      return { status: 429, reason: 'limited', daily: /per day|per_day|PerDay|daily/i.test(detail) };
    }
    return { status: 502, reason: 'bad' };
  }
  if (!response.ok) {
    return { status: 502, reason: 'other' };
  }

  let payload: {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  try {
    payload = await response.json();
  } catch {
    return { status: 502, reason: 'other' };
  }

  if (payload.promptFeedback?.blockReason) {
    return { status: 502, reason: 'bad' };
  }

  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    return { status: 502, reason: 'other' };
  }

  try {
    return { reply: JSON.parse(text) };
  } catch {
    // A model that ignores the schema still said something useful; hand the words back.
    return { reply: { title: 'School Assistant', notes: [text] } };
  }
}

// Walks the model list, twice if needed, until one answers or the budget runs out.
// Retired models and capacity spikes are routine, so they just move to the next
// candidate; only a rejected key stops the walk early.
//
// A rate limit does NOT stop the walk: the daily allowance is counted per model, so a
// model that has spent its quota is set aside and the next one — with its own untouched
// allowance — is tried. That is what keeps the assistant answering late in the day.
async function askGemini(
  apiKey: string,
  system: string,
  schema: unknown,
  prompt: string,
  image: InlineImage | null,
  maxTokens: number,
  timeoutMs: number,
  budgetMs: number,
): Promise<GeminiResult> {
  const attempts: Attempt[] = [];
  const dead = new Set<string>();
  const startedAt = Date.now();
  let stop = false;

  for (let round = 0; round < ROUNDS && !stop; round += 1) {
    for (const model of MODELS) {
      if (dead.has(model)) continue;
      if (Date.now() - startedAt > budgetMs) {
        stop = true;
        break;
      }
      const outcome = await tryModel(model, apiKey, system, schema, prompt, image, maxTokens, timeoutMs);
      if ('reply' in outcome) return outcome;
      attempts.push(outcome);
      // A retired model or a payload it refuses will behave the same next round.
      if (outcome.reason === 'gone' || outcome.reason === 'bad') dead.add(model);
      // A spent DAILY allowance will not refill in ten seconds, so that model is set
      // aside for good — but the walk carries on, because every model has its own
      // separate daily allowance. A short per-minute limit is left in place so the next
      // round can retry the same model.
      if (outcome.reason === 'limited' && outcome.daily) dead.add(model);
      // A rejected key is the one failure that repeating cannot fix.
      if (outcome.reason === 'rejected') {
        stop = true;
        break;
      }
    }
    if (!stop && round < ROUNDS - 1) await delay(250);
  }

  if (attempts.some((attempt) => attempt.reason === 'rejected')) {
    return { status: 502, error: 'unauthorized', message: 'The assistant key was rejected.' };
  }
  if (attempts.some((attempt) => attempt.reason === 'limited')) {
    if (attempts.some((attempt) => attempt.daily)) {
      return {
        status: 429,
        error: 'rate_limited',
        daily: true,
        message: 'Daily AI limit reached, please try again tomorrow',
      };
    }
    return { status: 429, error: 'rate_limited', message: 'The smart assistant has reached its limit for now — the built-in answers are being used.' };
  }
  if (attempts.some((attempt) => attempt.reason === 'busy' || attempt.reason === 'timeout')) {
    return { status: 429, error: 'rate_limited', message: 'The assistant is busy right now — please try again in a moment.' };
  }
  if (attempts.some((attempt) => attempt.reason === 'bad')) {
    return { status: 502, error: 'bad_request', message: 'The assistant could not read that request.' };
  }
  if (attempts.some((attempt) => attempt.reason === 'gone')) {
    return { status: 502, error: 'model_unavailable', message: 'The assistant model is no longer available.' };
  }
  return { status: 502, error: 'upstream', message: 'The assistant service could not be reached.' };
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Only staff who prepare teaching material may generate a paper. Everyone else is told
// plainly, in the exact wording the school asked for.
const PAPER_ROLES = ['admin', 'accountant', 'teacher'];
const PAPER_DENIED_MESSAGE = 'this function is available for admins only.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return json({ error: 'not_configured', message: 'The assistant key is not set up.' }, 503);
    }

    let body: { question?: unknown; role?: unknown; today?: unknown; context?: unknown; task?: unknown; image?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_request', message: 'No question was sent.' }, 400);
    }

    const role = typeof body.role === 'string' ? body.role : 'student';
    const today = clampText(body.today, 20) || new Date().toISOString().slice(0, 10);
    const task = body.task === 'paper' ? 'paper' : 'answer';

    if (task === 'paper' && !PAPER_ROLES.includes(role)) {
      return json({ error: 'forbidden', message: PAPER_DENIED_MESSAGE }, 403);
    }

    const { image, tooLarge } = readImage(body.image);
    if (tooLarge) {
      return json({ error: 'bad_request', message: 'That photo is too large. Please take it again.' }, 400);
    }

    if (task === 'paper') {
      const material = clampText(body.question, 1500).trim();
      if (!material && !image) {
        return json({ error: 'bad_request', message: 'Add a photo of the page or type the topic first.' }, 400);
      }
      const prompt = [
        'MATERIAL REQUEST',
        material || 'Generate the paper from the attached photo of the textbook or exercise page.',
        image ? '' : 'No photo was attached, so use only the request above.',
      ].filter((line) => line !== '').join('\n');

      const result = await askGemini(
        apiKey,
        paperPrompt(role, today, image !== null),
        PAPER_SCHEMA,
        prompt,
        image,
        4096,
        PAPER_ATTEMPT_TIMEOUT_MS,
        PAPER_TOTAL_BUDGET_MS,
      );
      if ('reply' in result) return json({ paper: result.reply }, 200);
      return json({ error: result.error, message: result.message }, result.status);
    }

    const question = clampText(body.question, 600).trim();
    if (!question) {
      return json({ error: 'bad_request', message: 'No question was sent.' }, 400);
    }

    const prompt = `SCHOOL DATA\n${summariseContext(body.context)}\n\nQUESTION\n${question}`;
    const result = await askGemini(
      apiKey,
      systemPrompt(role, today),
      REPLY_SCHEMA,
      prompt,
      image,
      900,
      PER_ATTEMPT_TIMEOUT_MS,
      TOTAL_BUDGET_MS,
    );
    if ('reply' in result) return json({ reply: result.reply }, 200);
    return json({ error: result.error, message: result.message }, result.status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected failure';
    return json({ error: 'server_error', message }, 500);
  }
});
