import { ghlConfig } from "@/lib/env";

// GHL API v2 (LeadConnector). Private integration token, scoped to one sub-account.
export const GHL_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface GhlClientOptions {
  token: string;
  locationId: string;
  fetchImpl?: typeof fetch;
}

export function createGhlClient(opts?: Partial<GhlClientOptions>) {
  const cfg = ghlConfig();
  const token = opts?.token ?? cfg.token;
  const locationId = opts?.locationId ?? cfg.locationId;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  if (!token || !locationId) throw new Error("GHL_PRIVATE_TOKEN and GHL_LOCATION_ID must be set");

  async function request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, GHL_BASE_URL);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (parsed as { message?: string } | null)?.message ?? res.statusText;
      throw new GhlError(`GHL ${method} ${path} failed (${res.status}): ${msg}`, res.status, parsed);
    }
    return parsed as T;
  }

  return {
    locationId,
    /** Health check: needs the locations.readonly scope. */
    getLocation: () => request<{ location: { id: string; name: string; timezone?: string } }>("GET", `/locations/${locationId}`),
    listPipelines: () =>
      request<{ pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[] }>(
        "GET",
        "/opportunities/pipelines",
        undefined,
        { locationId },
      ),
    upsertContact: (contact: { email?: string; phone?: string; firstName?: string; lastName?: string; tags?: string[]; source?: string }) =>
      request<{ contact: { id: string }; new: boolean }>("POST", "/contacts/upsert", { ...contact, locationId }),
    addContactTags: (contactId: string, tags: string[]) =>
      request<{ tags: string[] }>("POST", `/contacts/${contactId}/tags`, { tags }),
    createOpportunity: (opp: { pipelineId: string; pipelineStageId: string; contactId: string; name: string; monetaryValue?: number; status?: "open" | "won" | "lost" | "abandoned" }) =>
      request<{ opportunity: { id: string } }>("POST", "/opportunities/", { status: "open", ...opp, locationId }),
    updateOpportunity: (id: string, patch: { pipelineStageId?: string; status?: "open" | "won" | "lost" | "abandoned"; monetaryValue?: number; name?: string }) =>
      request<{ opportunity: { id: string } }>("PUT", `/opportunities/${id}`, patch),
  };
}

export type GhlClient = ReturnType<typeof createGhlClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
