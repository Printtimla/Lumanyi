import { describe, expect, it } from "vitest";
import {
	canViewAudit,
	clientIpFromHeaders,
	requestIdFromHeaders,
} from "../src/lib/audit";
import type { AppUser } from "../src/lib/auth";

function user(role: AppUser["role"]): AppUser {
	return {
		id: "u1",
		email: "a@b.c",
		name: "A",
		role,
		designation: role,
		products: ["restoration", "floors", "print"],
		mustChangePassword: false,
		active: true,
	};
}

describe("SA-5 audit access", () => {
	it("only owner views audit", () => {
		expect(canViewAudit(user("owner"))).toBe(true);
		expect(canViewAudit(user("dispatcher"))).toBe(false);
		expect(canViewAudit(user("tech"))).toBe(false);
	});

	it("prefers cf-connecting-ip then x-forwarded-for", () => {
		expect(
			clientIpFromHeaders({
				get: (n) => (n === "cf-connecting-ip" ? "1.2.3.4" : null),
			}),
		).toBe("1.2.3.4");
		expect(
			clientIpFromHeaders({
				get: (n) =>
					n === "x-forwarded-for" ? "9.9.9.9, 8.8.8.8" : null,
			}),
		).toBe("9.9.9.9");
	});

	it("uses cf-ray or generates request id", () => {
		expect(
			requestIdFromHeaders({
				get: (n) => (n === "cf-ray" ? "abc-SJC" : null),
			}),
		).toBe("abc-SJC");
		expect(
			requestIdFromHeaders({ get: () => null }).startsWith("req_"),
		).toBe(true);
	});
});
