import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://kavor.se",
  "https://www.kavor.se",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:4288",
  "http://localhost:4173",
  "http://localhost:4288",
]);
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function cors(origin: string | null) {
  const safeOrigin = origin && allowedOrigins.has(origin) ? origin : "https://kavor.se";
  return {
    ...jsonHeaders,
    "Access-Control-Allow-Origin": safeOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodePem(pem: string) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createAppleToken(issuerId: string, keyId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePem(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origin not allowed" }, 403, origin);

  const authorization = req.headers.get("Authorization") || "";
  const userToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!userToken) return response({ error: "Du behöver logga in." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publicKey = req.headers.get("apikey")?.trim() || Deno.env.get("SUPABASE_ANON_KEY")!;
  const authClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(userToken);
  if (userError || !userData.user) return response({ error: "Inloggningen kunde inte verifieras." }, 401, origin);

  const { data: admin, error: adminError } = await authClient
    .from("kavor_admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (adminError) {
    console.error("Kavora admin check failed", {
      code: adminError.code,
      message: adminError.message,
      details: adminError.details,
      hint: adminError.hint,
    });
    return response({ error: `Admin-kontrollen misslyckades: ${adminError.message}` }, 500, origin);
  }
  if (!admin) return response({ error: "Kontot saknar administratörsbehörighet." }, 403, origin);

  const issuerId = Deno.env.get("APP_STORE_CONNECT_ISSUER_ID")?.trim();
  const keyId = Deno.env.get("APP_STORE_CONNECT_KEY_ID")?.trim();
  const privateKey = Deno.env.get("APP_STORE_CONNECT_PRIVATE_KEY")?.replace(/\\n/g, "\n").trim();
  if (!issuerId || !keyId || !privateKey) {
    return response({ error: "App Store Connect är inte färdigkonfigurerat på servern." }, 503, origin);
  }

  try {
    const token = await createAppleToken(issuerId, keyId, privateKey);
    const url = new URL("https://api.appstoreconnect.apple.com/v1/apps");
    url.searchParams.set("filter[bundleId]", "se.kavor.app");
    url.searchParams.set("fields[apps]", "name,bundleId,sku,primaryLocale");
    url.searchParams.set("limit", "1");
    const appleResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const appleData = await appleResponse.json().catch(() => ({}));
    if (!appleResponse.ok) {
      const detail = appleData?.errors?.[0]?.detail || appleData?.errors?.[0]?.title || `Apple svarade ${appleResponse.status}`;
      throw new Error(detail);
    }
    const app = appleData?.data?.[0];
    if (!app) throw new Error("Kavor hittades inte i App Store Connect.");
    const syncedAt = new Date().toISOString();
    const metadata = {
      app_id: app.id,
      name: app.attributes?.name || "Kavor",
      bundle_id: app.attributes?.bundleId || "se.kavor.app",
      sku: app.attributes?.sku || null,
      primary_locale: app.attributes?.primaryLocale || null,
      access: "Sales and Reports",
    };
    const { error: updateError } = await authClient
      .from("kavora_integrations")
      .update({ status: "connected", last_synced_at: syncedAt, last_error: null, metadata })
      .eq("provider", "app_store_connect");
    if (updateError) throw updateError;
    return response({ ok: true, provider: "app_store_connect", status: "connected", last_synced_at: syncedAt, metadata }, 200, origin);
  } catch (error) {
    const errorValue = error instanceof Error ? error.message : error;
    const rawMessage = typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue);
    const message = String(rawMessage || "Okänt synkroniseringsfel").slice(0, 500);
    console.error("App Store Connect sync failed", message);
    await authClient
      .from("kavora_integrations")
      .update({ status: "error", last_error: message })
      .eq("provider", "app_store_connect");
    return response({ error: message }, 502, origin);
  }
});
