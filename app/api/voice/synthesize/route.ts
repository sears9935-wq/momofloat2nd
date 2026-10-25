import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 20_000;

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

async function upstreamError(response: Response): Promise<NextResponse> {
  const message = (await response.text().catch(() => "")).slice(0, 800);
  return NextResponse.json({ error: "voice_synthesis_failed", message: message || `HTTP ${response.status}` }, { status: response.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const provider = clean(body.provider, 40);
  const apiKey = clean(body.apiKey, 500);
  const text = clean(body.text, MAX_TEXT_LENGTH);
  const voiceId = clean(body.voiceId, 300);
  const model = clean(body.model, 120);
  if (!apiKey || !text || !voiceId) return NextResponse.json({ error: "missing_voice_parameters" }, { status: 400 });

  let response: Response;
  if (provider === "FishAudio") {
    response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: model || "s2.1-pro",
      },
      body: JSON.stringify({ text, reference_id: voiceId, format: "mp3", mp3_bitrate: 128, normalize: true, latency: "normal" }),
      signal: AbortSignal.timeout(120_000),
    });
  } else if (provider === "ElevenLabs") {
    const speed = typeof body.speechSpeed === "number" && Number.isFinite(body.speechSpeed)
      ? Math.min(1.2, Math.max(0.7, body.speechSpeed))
      : 1;
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model || "eleven_multilingual_v2", voice_settings: { speed } }),
      signal: AbortSignal.timeout(120_000),
    });
  } else {
    return NextResponse.json({ error: "unsupported_voice_provider" }, { status: 400 });
  }

  if (!response.ok) return upstreamError(response);
  const audio = await response.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
