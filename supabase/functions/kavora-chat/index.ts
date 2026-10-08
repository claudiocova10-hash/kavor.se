import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://kavor.se", "https://www.kavor.se", "http://127.0.0.1:4173", "http://127.0.0.1:4288", "http://localhost:4173", "http://localhost:4288"]);
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const systemPrompt = `You are Kavora, Kavor's clearly identified digital customer-service assistant. Reply in the user's language: Swedish, English or Spanish. Be concise, warm and factual.

Kavor is an iPhone and Android app for motorhome and caravan owners. It provides step-by-step guides for heating, 12 V/230 V electricity, water, and fridge/freezer; travel and winter-storage checklists; vehicle profiles; reports; and Learn & Understand diagrams for water, electricity and solar systems. It can work offline. The consumer subscription is currently 39 SEK/month with a 3-day free trial where the store presents it. Business licences are activated with a Kavor account and do not start automatic renewal.

Rules:
- Help with Kavor features, accounts, licences, subscription basics and safe high-level explanations of vehicle systems.
- Never invent a feature, price, compatibility, fault code, partnership or company policy. If uncertain, say so and offer personal help.
- Do not claim affiliation with Alde, Truma, Webasto, Dometic or another manufacturer.
- Never instruct the user to open, dismantle or repair gas, 230 V, battery packs or pressurised components. Do not give bypass instructions.
- If there is gas smell, smoke, fire risk, damaged wiring, unusual heat or immediate danger, tell the user to stop, leave the risk area if needed, turn off gas and 230 V only if safe, and contact emergency services or a qualified technician.
- Kavor is guidance before the workshop, not a replacement for manuals or qualified technicians.
- Never ask for payment-card data, passwords, full licence codes or other secrets.
- If the user needs account-specific help, cannot resolve the issue, or asks for a human, tell them to use “Contact Claudio” in the chat.`;

function cors(origin: string | null) {
  const safeOrigin = origin && allowedOrigins.has(origin) ? origin : "https://kavor.se";
  return { ...jsonHeaders, "Access-Control-Allow-Origin": safeOrigin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
function response(body: unknown, status = 200, origin: string | null = null) { return new Response(JSON.stringify(body), { status, headers: cors(origin) }); }
function clean(value: unknown, max: number) { return String(value ?? "").trim().slice(0, max); }
function validSession(value: unknown) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "")); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function extractOutput(data: any) { return (data?.output || []).filter((item: any) => item?.type === "message").flatMap((item: any) => item.content || []).filter((item: any) => item?.type === "output_text").map((item: any) => item.text || "").join("\n").trim(); }
function fallback(message: string, language: string) {
  const m = message.toLowerCase();
  const texts: Record<string, Record<string, string>> = {
    sv: { price:"Kavor kostar 39 kr per månad. Där App Store eller Google Play visar provperioden kan du testa gratis i 3 dagar.", account:"Företagslicenser aktiveras på kavor.se/activate.html. Logga sedan in i appen med samma e-postadress och lösenord. Dela aldrig ditt lösenord eller hela licenskoden här.", app:"Kavor hjälper med guider för värme, el, vatten samt kyl och frys, checklistor och Lär & förstå för vatten, el och solceller. Appen finns för iPhone och Android.", default:"Jag kan hjälpa med Kavor, konto, licens, pris och säker grundinformation. För ett personligt ärende använder du Kontakta Claudio." },
    en: { price:"Kavor costs SEK 39 per month. Where the App Store or Google Play presents the trial, you can try it free for 3 days.", account:"Business licences are activated at kavor.se/activate.html. Then sign in to the app with the same email and password. Never share your password or full licence code here.", app:"Kavor provides guides for heating, electricity, water and fridge/freezer, checklists, and Learn & Understand diagrams for water, electricity and solar. It is available for iPhone and Android.", default:"I can help with Kavor, accounts, licences, pricing and safe basic information. Use Contact Claudio for personal help." },
    es: { price:"Kavor cuesta 39 SEK al mes. Cuando App Store o Google Play muestre la prueba, puedes probarlo gratis durante 3 días.", account:"Las licencias empresariales se activan en kavor.se/activate.html. Después inicia sesión en la app con el mismo correo y contraseña. No compartas aquí tu contraseña ni el código completo.", app:"Kavor incluye guías de calefacción, electricidad, agua y frigorífico/congelador, listas y diagramas Aprende y comprende de agua, electricidad y energía solar. Está disponible para iPhone y Android.", default:"Puedo ayudar con Kavor, cuentas, licencias, precios e información básica segura. Usa Contactar con Claudio para ayuda personal." }
  };
  const t = texts[language] || texts.sv;
  if(/gas|rök|smoke|humo|brand|fire|incendio|skadad.*kabel|damaged.*wire|cable.*dañado/.test(m)) return language === "en" ? "Stop using the system. If safe, turn off gas and 230 V, leave the risk area if needed, and contact emergency services or a qualified technician." : language === "es" ? "Deja de usar el sistema. Si es seguro, corta el gas y 230 V, aléjate de la zona de riesgo y contacta con emergencias o personal cualificado." : "Avbryt användningen. Stäng av gasol och 230 V om det kan göras säkert, lämna riskområdet vid behov och kontakta räddningstjänst eller behörig tekniker.";
  if(/pris|price|precio|39|prov|trial|prueba/.test(m)) return t.price;
  if(/konto|account|cuenta|licen|logga|login|iniciar/.test(m)) return t.account;
  if(/kavor|funktion|funciona|work|guide/.test(m)) return t.app;
  return t.default;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origin not allowed" }, 403, origin);
  let body: any;
  try { body = await req.json(); } catch { return response({ error: "Invalid JSON" }, 400, origin); }
  if (!validSession(body.sessionId)) return response({ error: "Invalid session" }, 400, origin);
  const language = ["sv", "en", "es"].includes(body.language) ? body.language : "sv";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const sessionHash = await sha256(`${body.sessionId}:${ip}`);
  const now = new Date();
  const { data: rate } = await supabase.from("support_chat_rate_limits").select("window_start,request_count").eq("session_hash", sessionHash).maybeSingle();
  const oldWindow = !rate || now.getTime() - new Date(rate.window_start).getTime() > 10 * 60 * 1000;
  const nextCount = oldWindow ? 1 : Number(rate.request_count || 0) + 1;
  if (nextCount > 25) return response({ error: "Too many requests" }, 429, origin);
  await supabase.from("support_chat_rate_limits").upsert({ session_hash: sessionHash, window_start: oldWindow ? now.toISOString() : rate.window_start, request_count: nextCount }, { onConflict: "session_hash" });

  if (body.action === "handoff") {
    const name = clean(body.name, 100), email = clean(body.email, 200).toLowerCase(), subject = clean(body.subject, 1000);
    if (!body.consent || !name || !validEmail(email) || !subject) return response({ error: "Missing or invalid fields" }, 400, origin);
    const transcript = Array.isArray(body.messages) ? body.messages.slice(-12).map((item: any) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: clean(item?.content, 1200) })).filter((item: any) => item.content) : [];
    const { data, error } = await supabase.from("support_cases").insert({ session_id: body.sessionId, name, email, subject, initial_message: subject, transcript, language }).select("id").single();
    if (error) return response({ error: "Could not create case" }, 500, origin);
    return response({ ok: true, caseId: data.id }, 201, origin);
  }
  if (body.action !== "chat") return response({ error: "Invalid action" }, 400, origin);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-10).map((item: any) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: clean(item?.content, 800) })).filter((item: any) => item.content) : [];
  const latest = messages.filter((item: any) => item.role === "user").at(-1)?.content || "";
  if (!latest) return response({ error: "Empty message" }, 400, origin);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return response({ reply: fallback(latest, language), mode: "guided" }, 200, origin);
  const openaiResponse = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { ...jsonHeaders, Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") || "gpt-6-luna", store: false, instructions: systemPrompt, input: messages, max_output_tokens: 500, safety_identifier: sessionHash }) });
  const data = await openaiResponse.json().catch(() => ({}));
  if (!openaiResponse.ok) return response({ reply: fallback(latest, language), mode: "guided" }, 200, origin);
  return response({ reply: extractOutput(data) || fallback(latest, language), mode: "ai" }, 200, origin);
});
