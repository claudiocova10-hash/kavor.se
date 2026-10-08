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
const packageName = "se.kavor.app";

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

async function createGoogleAssertion(clientEmail: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePem(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(clientEmail: string, privateKey: string) {
  const assertion = await createGoogleAssertion(clientEmail, privateKey);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData?.access_token) {
    throw new Error(tokenData?.error_description || tokenData?.error || `Google OAuth svarade ${tokenResponse.status}`);
  }
  return tokenData.access_token as string;
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

  const rawServiceAccount = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")?.trim();
  if (!rawServiceAccount) {
    return response({ error: "Google Play är inte färdigkonfigurerat på servern." }, 503, origin);
  }

  try {
    const serviceAccount = JSON.parse(rawServiceAccount);
    const clientEmail = String(serviceAccount?.client_email || "").trim();
    const privateKey = String(serviceAccount?.private_key || "").replace(/\\n/g, "\n").trim();
    if (!clientEmail || !privateKey) throw new Error("Google Play-nyckeln saknar nödvändiga uppgifter.");

    const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
    const subscriptionsUrl = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/subscriptions`);
    subscriptionsUrl.searchParams.set("pageSize", "50");
    const googleResponse = await fetch(subscriptionsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const googleData = await googleResponse.json().catch(() => ({}));
    if (!googleResponse.ok) {
      throw new Error(googleData?.error?.message || `Google Play svarade ${googleResponse.status}`);
    }

    const subscriptions = Array.isArray(googleData?.subscriptions) ? googleData.subscriptions : [];
    const productIds = subscriptions
      .map((subscription: { productId?: string }) => subscription?.productId)
      .filter(Boolean)
      .slice(0, 20);
    const syncedAt = new Date().toISOString();
    const metadata = {
      name: "Kavor",
      package_name: packageName,
      service_account_email: clientEmail,
      subscription_count: subscriptions.length,
      product_ids: productIds,
      access: "Read-only app information and financial reports",
    };
    const { error: updateError } = await authClient
      .from("kavora_integrations")
      .update({ status: "connected", last_synced_at: syncedAt, last_error: null, metadata })
      .eq("provider", "google_play");
    if (updateError) throw updateError;
    return response({ ok: true, provider: "google_play", status: "connected", last_synced_at: syncedAt, metadata }, 200, origin);
  } catch (error) {
    const errorValue = error instanceof Error ? error.message : error;
    const rawMessage = typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue);
    const message = String(rawMessage || "Okänt synkroniseringsfel").slice(0, 500);
    console.error("Google Play sync failed", message);
    await authClient
      .from("kavora_integrations")
      .update({ status: "error", last_error: message })
      .eq("provider", "google_play");
    return response({ error: message }, 502, origin);
  }
});
