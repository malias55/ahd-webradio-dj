const getBaseUrl = () => {
  if (process.env.LOGTO_BASE_URL) return process.env.LOGTO_BASE_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "http://localhost:3000";
};

export const logtoConfig = {
  endpoint: process.env.LOGTO_ENDPOINT || "https://duxpom.logto.app/",
  appId: process.env.LOGTO_APP_ID || "",
  appSecret: process.env.LOGTO_APP_SECRET || "",
  baseUrl: getBaseUrl(),
  cookieSecret: process.env.LOGTO_COOKIE_SECRET || "",
  cookieSecure: process.env.NODE_ENV === "production",
  scopes: ["email", "profile"],
};
