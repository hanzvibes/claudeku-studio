// Provider AI custom (OpenAI-compatible) — HANYA disimpan di browser (localStorage).
// Tidak pernah dikirim ke repo, tidak pernah disimpan di server, tidak pernah di-log.
// Server hanya menerima key di dalam body request lalu langsung meneruskannya
// ke provider pengguna (dan tidak menyimpannya).
export type ProviderConfig = {
  baseUrl: string; // contoh: https://api.provider.com/v1 (tanpa /chat/completions)
  model: string;
  apiKey: string;
};

export const PROVIDER_STORAGE_KEY = "claudeku.provider";

export function loadProvider(): ProviderConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProviderConfig>;
    if (!parsed.baseUrl || !parsed.model) return null;
    return { baseUrl: parsed.baseUrl, model: parsed.model, apiKey: parsed.apiKey ?? "" };
  } catch {
    return null;
  }
}

export function saveProvider(cfg: ProviderConfig): void {
  window.localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(cfg));
}

export function clearProvider(): void {
  window.localStorage.removeItem(PROVIDER_STORAGE_KEY);
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}
