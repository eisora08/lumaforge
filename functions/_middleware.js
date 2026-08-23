// Cloudflare Pages Function: catalog.json API key protection
// index.html is public; catalog.json requires X-LumaForge-Key header
// The VALID_KEY secret is set via: wrangler pages secret put VALID_KEY

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "X-LumaForge-Key",
  "Access-Control-Max-Age": "86400",
};

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  const VALID_KEY = context.env.VALID_KEY;

  // Only gate catalog.json
  if (url.pathname === "/catalog.json" || url.pathname.endsWith("/catalog.json")) {
    // Handle OPTIONS preflight — no auth check needed
    if (context.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!VALID_KEY) {
      return new Response(JSON.stringify({ error: "Server config error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const key = context.request.headers.get("X-LumaForge-Key");

    if (key !== VALID_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // Valid key — serve the file with CORS
    const response = await context.next();
    const newResponse = new Response(response.body, response);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => newResponse.headers.set(k, v));
    newResponse.headers.set("Cache-Control", "public, max-age=300");
    return newResponse;
  }

  // All other files (index.html, etc.) — public, no auth
  return context.next();
};
