import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/webm"),
});

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

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

export const transcribeAndParseEntry = createServerFn({ method: "POST" })
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Decode base64 to bytes
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const ext = extToMime(data.mimeType);
    const blob = new Blob([bytes], { type: data.mimeType });

    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", blob, `recording.${ext}`);

    const sttRes = await fetch(`${GATEWAY}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!sttRes.ok) {
      const err = await sttRes.text().catch(() => "");
      throw new Error(`Transcription failed: ${sttRes.status} ${err}`);
    }
    const sttJson = (await sttRes.json()) as { text?: string };
    const transcript = (sttJson.text ?? "").trim();

    if (!transcript) {
      return { transcript: "", items: [] as ParsedItem[] };
    }

    // Parse transcript into structured items via chat completion + tool
    const chatRes = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
      const err = await chatRes.text().catch(() => "");
      throw new Error(`Parsing failed: ${chatRes.status} ${err}`);
    }
    const chatJson = await chatRes.json();
    const call =
      chatJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let items: ParsedItem[] = [];
    if (call) {
      try {
        const parsed = JSON.parse(call);
        if (Array.isArray(parsed.items)) items = parsed.items;
      } catch {
        // ignore
      }
    }
    return { transcript, items };
  });

export type ParsedItem = {
  product: string;
  quantity: number;
  expiry: string | null;
};
