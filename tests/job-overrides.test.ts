import { describe, expect, it } from "vitest";
import {
	canOverrideJobAssignment,
	canReopenFieldStatus,
	canReopenPrintStatus,
	FIELD_REOPEN_STATUS,
	normalizeOverrideReason,
	PRINT_REOPEN_STATUS,
	renderJobOverridePanels,
} from "../src/lib/job-overrides";
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

describe("MG-2 job overrides", () => {
	it("allows office roles to override; not tech", () => {
		expect(canOverrideJobAssignment(user("owner"))).toBe(true);
		expect(canOverrideJobAssignment(user("manager"))).toBe(true);
		expect(canOverrideJobAssignment(user("dispatcher"))).toBe(true);
		expect(canOverrideJobAssignment(user("tech"))).toBe(false);
	});

	it("reopens only locked field and delivered print statuses", () => {
		expect(canReopenFieldStatus("complete")).toBe(true);
		expect(canReopenFieldStatus("invoiced")).toBe(true);
		expect(canReopenFieldStatus("in_progress")).toBe(false);
		expect(canReopenPrintStatus("delivered")).toBe(true);
		expect(canReopenPrintStatus("cancelled")).toBe(false);
		expect(canReopenPrintStatus("in_production")).toBe(false);
		expect(FIELD_REOPEN_STATUS).toBe("in_progress");
		expect(PRINT_REOPEN_STATUS).toBe("in_production");
	});

	it("requires a short reopen reason", () => {
		expect(normalizeOverrideReason("")).toBeNull();
		expect(normalizeOverrideReason("ab")).toBeNull();
		expect(normalizeOverrideReason("  rework  ")).toBe("rework");
	});

	it("renders reopen only when locked and escapes titles", () => {
		const locked = renderJobOverridePanels({
			kind: "field",
			jobId: "job_<1>",
			status: "complete",
			assignedUserId: null,
			staffOptionsHtml: `<option value="t1">Tech</option>`,
			canOverride: true,
			archived: false,
		});
		expect(locked).toContain("Reopen (override)");
		expect(locked).toContain("/jobs/job_&lt;1&gt;/reopen");
		expect(locked).toContain("Reassign (override)");

		const open = renderJobOverridePanels({
			kind: "field",
			jobId: "job_1",
			status: "scheduled",
			assignedUserId: null,
			staffOptionsHtml: "",
			canOverride: true,
			archived: false,
		});
		expect(open).not.toContain("Reopen (override)");
		expect(open).toContain("Reassign (override)");

		expect(
			renderJobOverridePanels({
				kind: "field",
				jobId: "job_1",
				status: "complete",
				assignedUserId: null,
				staffOptionsHtml: "",
				canOverride: false,
				archived: false,
			}),
		).toBe("");
	});
});
