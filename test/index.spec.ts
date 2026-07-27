import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("Lumanyi", () => {
	it("health endpoint returns ok", async () => {
		const request = new Request("http://example.com/health");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.json<{ ok: boolean; app: string }>();
		expect(body.ok).toBe(true);
		expect(body.app).toBe("lumanyi");
	});

	it("dashboard redirects to login when unauthenticated", async () => {
		const response = await SELF.fetch("http://example.com/", {
			redirect: "manual",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/login");
	});

	it("login page renders", async () => {
		const response = await SELF.fetch("http://example.com/login");
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("Sign in");
		expect(text).toContain("Lumanyi");
	});
});
