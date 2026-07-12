// Deno Edge Function — transcribes a shopkeeper's voice note and extracts
// structured inventory entries from it.
//
// Replaces the old Lovable AI Gateway integration: LOVABLE_API_KEY is only
// available inside Lovable's own hosting, so this now runs on Groq's
// OpenAI-compatible API (genuinely free tier, no credit card) via a
// GROQ_API_KEY Supabase secret. Two calls, same as before:
//   1. audio -> transcript (Whisper)
//   2. transcript -> structured { product, quantity, expiry }[] (tool call)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROQ_BASE = "https://api.groq.com/openai/v1";

type ParsedItem = { product: string; quantity: number; expiry: string | null };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Same mapping as the previous voice-entry.functions.ts — ported over as-is.
function extToMime(mime: string) {
  const base = mime.split(";")[0];
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
  };
  return map[base] ?? "webm";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "GROQ_API_KEY not configured" }, 500);
  }

  let body: { audioBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const audioBase64 = body.audioBase64;
  const mimeType = body.mimeType ?? "audio/webm";
  if (!audioBase64 || typeof audioBase64 !== "string") {
    return jsonResponse({ error: "audioBase64 is required" }, 400);
  }

  // ---- 1. Transcription (Whisper via Groq) ---------------------------------
  let transcript = "";
  try {
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const ext = extToMime(mimeType);
    const blob = new Blob([bytes], { type: mimeType });

    const form = new FormData();
    form.append("model", "whisper-large-v3-turbo");
    form.append("file", blob, `recording.${ext}`);

    const sttRes = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!sttRes.ok) {
      const errText = await sttRes.text().catch(() => "");
      return jsonResponse({ error: `Transcription failed: ${sttRes.status} ${errText}` }, 502);
    }
    const sttJson = (await sttRes.json()) as { text?: string };
    transcript = (sttJson.text ?? "").trim();
  } catch (e) {
    return jsonResponse({ error: `Transcription failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  if (!transcript) {
    return jsonResponse({ transcript: "", items: [] as ParsedItem[] });
  }

  // ---- 2. Structured parsing (tool call via Groq chat completions) --------
  try {
    const chatRes = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "You extract inventory entries from a shopkeeper's spoken sentence (English, Hindi, or Marathi, possibly mixed). Return one entry per product mentioned. Quantity is an integer count of units. Expiry is an ISO date (YYYY-MM-DD) if the speaker mentions a date, month, or relative time (e.g. 'next month', '2 days'); otherwise null. Today is " +
              new Date().toISOString().slice(0, 10) +
              ". If nothing product-like is said, return an empty list.",
          },
          { role: "user", content: transcript },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "record_entries",
              description: "Record parsed inventory entries",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        product: { type: "string" },
                        quantity: { type: "integer" },
                        expiry: { type: ["string", "null"] },
                      },
                      required: ["product", "quantity", "expiry"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["items"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "record_entries" } },
      }),
    });

    if (!chatRes.ok) {
      const errText = await chatRes.text().catch(() => "");
      return jsonResponse({ error: `Parsing failed: ${chatRes.status} ${errText}` }, 502);
    }

    const chatJson = await chatRes.json();
    const call = chatJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let items: ParsedItem[] = [];
    if (call) {
      try {
        const parsed = JSON.parse(call);
        if (Array.isArray(parsed.items)) items = parsed.items;
      } catch {
        // malformed tool-call arguments — fall back to an empty list rather than failing the request
      }
    }

    return jsonResponse({ transcript, items });
  } catch (e) {
    return jsonResponse({ error: `Parsing failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
