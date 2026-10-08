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
const defaultAdAccountId = "1077364248513157";

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

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function graphRequest(path: string, accessToken: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/v26.0/${path.replace(/^\/+/, "")}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const graphResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const graphData = await graphResponse.json().catch(() => ({}));
  if (!graphResponse.ok || graphData?.error) {
    throw new Error(graphData?.error?.message || `Meta svarade ${graphResponse.status}`);
  }
  return graphData;
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

  const accessToken = Deno.env.get("META_ADS_ACCESS_TOKEN")?.trim();
  const adAccountId = (Deno.env.get("META_AD_ACCOUNT_ID")?.trim() || defaultAdAccountId).replace(/^act_/, "");
  if (!accessToken) {
    return response({ error: "Meta Ads är inte färdigkonfigurerat på servern." }, 503, origin);
  }

  try {
    const accountPath = `act_${adAccountId}`;
    const [accountData, insightsData, campaignsData] = await Promise.all([
      graphRequest(accountPath, accessToken, {
        fields: "id,name,currency,account_status",
      }),
      graphRequest(`${accountPath}/insights`, accessToken, {
        fields: "spend,impressions,reach,clicks,ctr,cpc",
        date_preset: "last_30d",
        level: "account",
        limit: "1",
      }),
      graphRequest(`${accountPath}/campaigns`, accessToken, {
        fields: "id,name,status,effective_status",
        limit: "100",
      }),
    ]);

    const insight = Array.isArray(insightsData?.data) ? insightsData.data[0] || {} : {};
    const campaigns = Array.isArray(campaignsData?.data) ? campaignsData.data : [];
    const activeCampaignCount = campaigns.filter((campaign: { effective_status?: string; status?: string }) =>
      (campaign.effective_status || campaign.status) === "ACTIVE"
    ).length;
    const syncedAt = new Date().toISOString();
    const metadata = {
      name: accountData?.name || "Kavor",
      ad_account_id: adAccountId,
      currency: accountData?.currency || "SEK",
      account_status: accountData?.account_status ?? null,
      period: "last_30d",
      spend: numberValue(insight?.spend),
      impressions: numberValue(insight?.impressions),
      reach: numberValue(insight?.reach),
      clicks: numberValue(insight?.clicks),
      ctr: numberValue(insight?.ctr),
      cpc: numberValue(insight?.cpc),
      campaign_count: campaigns.length,
      active_campaign_count: activeCampaignCount,
      access: "ads_read only",
    };
    const { error: updateError } = await authClient
      .from("kavora_integrations")
      .update({ status: "connected", last_synced_at: syncedAt, last_error: null, metadata })
      .eq("provider", "meta_ads");
    if (updateError) throw updateError;

    return response({ ok: true, provider: "meta_ads", status: "connected", last_synced_at: syncedAt, metadata }, 200, origin);
  } catch (error) {
    const errorValue = error instanceof Error ? error.message : error;
    const rawMessage = typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue);
    const message = String(rawMessage || "Okänt synkroniseringsfel").slice(0, 500);
    console.error("Meta Ads sync failed", message);
    await authClient
      .from("kavora_integrations")
      .update({ status: "error", last_error: message })
      .eq("provider", "meta_ads");
    return response({ error: message }, 502, origin);
  }
});
