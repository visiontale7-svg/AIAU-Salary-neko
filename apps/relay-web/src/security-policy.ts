export function relaySupabaseConnectSources(value?: string): string[] {
  if (!value) return ["'self'"];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search
      || url.hash) return ["'self'"];
    return ["'self'", url.origin, `wss://${url.host}`];
  } catch {
    return ["'self'"];
  }
}

export function relayContentSecurityPolicy(supabaseUrl?: string): string {
  const connectSources = relaySupabaseConnectSources(supabaseUrl).join(" ");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
