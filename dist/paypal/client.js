// Minimal PayPal REST client: OAuth token + JSON calls.
export class PayPalError extends Error {
    status;
    body;
    constructor(status, body) {
        const name = body?.name ?? body?.error ?? "PAYPAL_ERROR";
        const msg = body?.message ?? body?.error_description ?? "";
        const d = body?.details?.[0];
        const detail = d ? ` (${[d.issue, d.field].filter(Boolean).join(" at ")})` : "";
        super(`PayPal ${status} ${name}${msg ? `: ${msg}` : ""}${detail}`);
        this.status = status;
        this.body = body;
    }
    get issue() {
        return this.body?.name ?? this.body?.details?.[0]?.issue;
    }
}
export function paypalConfigFromEnv(env = process.env) {
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (see .env.example).");
    }
    const mode = (env.PAYPAL_ENV ?? "sandbox").toLowerCase();
    if (mode !== "sandbox" && mode !== "live")
        throw new Error("PAYPAL_ENV must be sandbox or live.");
    return { clientId, clientSecret, env: mode };
}
export class PayPalClient {
    config;
    token;
    constructor(config) {
        this.config = config;
    }
    get baseUrl() {
        return this.config.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    }
    /** Fetches a token: throws if PayPal rejects the credentials. */
    async verify() {
        await this.accessToken();
    }
    async accessToken() {
        if (this.token && Date.now() < this.token.expiresAt - 60_000)
            return this.token.value;
        const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
        const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
            method: "POST",
            headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=client_credentials",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new PayPalError(res.status, body);
        this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
        return this.token.value;
    }
    async call(method, path, body, headers = {}) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${await this.accessToken()}`,
                "Content-Type": "application/json",
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        const json = text ? JSON.parse(text) : {};
        if (!res.ok)
            throw new PayPalError(res.status, json);
        return json;
    }
}
