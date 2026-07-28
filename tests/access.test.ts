import { describe, expect, it } from "vitest";
import {
	canAccessProduct,
	canReadFieldJob,
	canWriteFieldJob,
	parseProducts,
	serializeProducts,
} from "../src/lib/access";
import type { AppUser } from "../src/lib/auth";

function user(
	partial: Partial<AppUser> & Pick<AppUser, "role" | "products">,
): AppUser {
	return {
		id: partial.id ?? "usr_1",
		email: "t@example.com",
		name: "Test",
		designation: partial.role,
		mustChangePassword: false,
		...partial,
	};
}

describe("parseProducts", () => {
	it("defaults to all products when empty", () => {
		expect(parseProducts(null)).toEqual(["restoration", "floors", "print"]);
		expect(parseProducts("")).toEqual(["restoration", "floors", "print"]);
	});

	it("parses a subset", () => {
		expect(parseProducts("print,restoration")).toEqual([
			"restoration",
			"print",
		]);
	});

	it("round-trips serialize", () => {
		expect(serializeProducts(["floors", "print"])).toBe("floors,print");
	});
});

describe("field job access", () => {
	const job = {
		id: "job_1",
		status: "in_progress",
		assigned_user_id: "tech_1",
		job_type: "water_restoration",
	};

	it("lets owner read and write any job in product scope", () => {
		const owner = user({
			role: "owner",
			products: ["restoration", "floors", "print"],
		});
		expect(canReadFieldJob(owner, job)).toBe(true);
		expect(canWriteFieldJob(owner, job)).toBe(true);
	});

	it("lets assigned tech read/write open jobs", () => {
		const tech = user({
			id: "tech_1",
			role: "tech",
			products: ["restoration"],
		});
		expect(canReadFieldJob(tech, job)).toBe(true);
		expect(canWriteFieldJob(tech, job)).toBe(true);
	});

	it("blocks tech from other tech jobs", () => {
		const tech = user({
			id: "tech_2",
			role: "tech",
			products: ["restoration"],
		});
		expect(canReadFieldJob(tech, job)).toBe(false);
	});

	it("locks complete jobs for tech but not owner", () => {
		const locked = { ...job, status: "complete" };
		const tech = user({
			id: "tech_1",
			role: "tech",
			products: ["restoration"],
		});
		const owner = user({
			role: "owner",
			products: ["restoration"],
		});
		expect(canWriteFieldJob(tech, locked)).toBe(false);
		expect(canWriteFieldJob(owner, locked)).toBe(true);
	});

	it("blocks product scope", () => {
		const tech = user({
			id: "tech_1",
			role: "tech",
			products: ["print"],
		});
		expect(canAccessProduct(tech, "restoration")).toBe(false);
		expect(canReadFieldJob(tech, job)).toBe(false);
	});
});
