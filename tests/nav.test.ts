import { describe, expect, it } from "vitest";
import { buildNavHtml } from "../src/lib/html";
import type { AppUser } from "../src/lib/auth";

function user(partial: Partial<AppUser> & Pick<AppUser, "role">): AppUser {
	return {
		id: "u1",
		email: "a@b.c",
		name: "Alex",
		designation: partial.designation ?? partial.role,
		products: partial.products ?? ["restoration", "floors", "print"],
		mustChangePassword: false,
		active: true,
		...partial,
	};
}

describe("grouped nav", () => {
	it("shows primary links and Ops for manager; hides Admin/Settings", () => {
		const html = buildNavHtml(
			user({ role: "manager", designation: "manager" }),
		);
		expect(html).toContain(">Home<");
		expect(html).toContain(">Customers<");
		expect(html).toContain(">Ops<");
		expect(html).toContain("/leads");
		expect(html).toContain("/inventory");
		expect(html).toContain(">Tech<");
		expect(html).not.toContain(">Admin<");
		expect(html).not.toContain(">Settings<");
		expect(html).not.toContain("/users");
		expect(html).not.toContain("/settings/price-lists");
	});

	it("shows Admin and Settings for owner", () => {
		const html = buildNavHtml(user({ role: "owner", designation: "owner" }));
		expect(html).toContain(">Admin<");
		expect(html).toContain(">Settings<");
		expect(html).toContain("/users");
		expect(html).toContain("/trash");
		expect(html).toContain("/audit");
		expect(html).toContain("/settings/discount-caps");
	});

	it("scopes product links for tech", () => {
		const html = buildNavHtml(
			user({
				role: "tech",
				designation: "print_tech",
				products: ["print"],
			}),
		);
		expect(html).toContain(">Print<");
		expect(html).toContain("/print/board");
		expect(html).toContain(">Ops<");
		expect(html).toContain("/inventory");
		expect(html).not.toContain(">Restoration<");
		expect(html).not.toContain(">Customers<");
		expect(html).not.toContain("/leads");
		expect(html).not.toContain(">Admin<");
	});
});
