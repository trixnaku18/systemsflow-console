import { describe, expect, it, vi } from "vitest";
import { createGhlClient, GHL_API_VERSION, GhlError } from "./client";
import { normalizeEvent, verifySharedSecret } from "./webhook";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe("GHL client", () => {
  it("sends auth and version headers and scopes calls to the location", async () => {
    const f = fakeFetch(200, { pipelines: [] });
    const ghl = createGhlClient({ token: "tok", locationId: "loc1", fetchImpl: f as unknown as typeof fetch });
    await ghl.listPipelines();
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://services.leadconnectorhq.com/opportunities/pipelines?locationId=loc1");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok", Version: GHL_API_VERSION });
  });

  it("adds locationId to contact upserts", async () => {
    const f = fakeFetch(200, { contact: { id: "c1" }, new: true });
    const ghl = createGhlClient({ token: "tok", locationId: "loc1", fetchImpl: f as unknown as typeof fetch });
    await ghl.upsertContact({ email: "a@b.ph", tags: ["lead-ph"] });
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ email: "a@b.ph", tags: ["lead-ph"], locationId: "loc1" });
  });

  it("surfaces API errors with status", async () => {
    const f = fakeFetch(401, { message: "Invalid JWT" });
    const ghl = createGhlClient({ token: "bad", locationId: "loc1", fetchImpl: f as unknown as typeof fetch });
    await expect(ghl.getLocation()).rejects.toMatchObject({ status: 401 });
    await expect(ghl.getLocation()).rejects.toBeInstanceOf(GhlError);
  });

  it("refuses to run without credentials", () => {
    expect(() => createGhlClient({ token: "", locationId: "" })).toThrow(/must be set/);
  });
});

describe("GHL webhook", () => {
  it("checks the shared secret", () => {
    expect(verifySharedSecret("s3cret", "s3cret")).toBe(true);
    expect(verifySharedSecret("nope", "s3cret")).toBe(false);
    expect(verifySharedSecret(null, "s3cret")).toBe(false);
    expect(verifySharedSecret("anything", "")).toBe(false);
  });

  it("dedupes by event id, or by body hash when there is none", () => {
    expect(normalizeEvent({ id: "e1", type: "ContactCreate", locationId: "loc1" }, "{}")).toEqual({
      dedupeKey: "id:e1",
      eventType: "ContactCreate",
      locationId: "loc1",
    });
    const a = normalizeEvent({ location: { id: "loc1" } }, '{"x":1}');
    expect(a.dedupeKey).toMatch(/^sha256:/);
    expect(a.locationId).toBe("loc1");
    expect(normalizeEvent({}, '{"x":1}').dedupeKey).toBe(a.dedupeKey);
  });
});
