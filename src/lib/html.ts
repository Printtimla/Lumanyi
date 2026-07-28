import type { AppUser } from "./auth";
import { roleLabel } from "./roles";
import {
	canAccessProduct,
	canManageUsers,
	canSeeOfficeTools,
} from "./access";
import { canAccessTrash } from "./soft-delete";
import { canViewAudit } from "./audit";
import { canManagePriceLists } from "./price-list";
import { canManagePrintMargins } from "./print-margins";
import { canManageLaborRates } from "./labor-rates";

export function escapeHtml(value: string | number | null | undefined): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function money(cents: number | null | undefined): string {
	if (cents == null) return "—";
	return `$${(cents / 100).toFixed(2)}`;
}

export function layout(opts: {
	title: string;
	user?: AppUser | null;
	body: string;
	flash?: string | null;
}): string {
	const u = opts.user;
	const items: Array<{ href: string; label: string }> = [];
	if (u) {
		items.push({ href: "/", label: "Home" });
		if (canAccessProduct(u, "restoration")) {
			items.push({ href: "/restoration", label: "Restoration" });
		}
		if (canAccessProduct(u, "floors")) {
			items.push({ href: "/floors", label: "Floors" });
		}
		if (canAccessProduct(u, "print")) {
			items.push({ href: "/print", label: "Print" });
		}
		if (canSeeOfficeTools(u)) {
			items.push({ href: "/customers", label: "Customers" });
			items.push({ href: "/leads", label: "Leads" });
		}
		items.push({ href: "/calendar", label: "Calendar" });
		if (canManageUsers(u)) {
			items.push({ href: "/users", label: "Users" });
		}
		if (canAccessTrash(u)) {
			items.push({ href: "/trash", label: "Trash" });
			items.push({ href: "/audit", label: "Audit" });
		}
		if (canManagePriceLists(u)) {
			items.push({ href: "/settings/price-lists", label: "Price lists" });
		}
		if (canManagePrintMargins(u)) {
			items.push({ href: "/settings/print-margins", label: "Print margins" });
		}
		if (canManageLaborRates(u)) {
			items.push({ href: "/settings/labor-rates", label: "Labor rates" });
		}
		items.push({ href: "/inventory", label: "Inventory" });
		if (canSeeOfficeTools(u)) {
			items.push({ href: "/reports", label: "Reports" });
		}
		if (canAccessProduct(u, "floors") && canSeeOfficeTools(u)) {
			items.push({ href: "/recurring", label: "Recurring" });
		}
		if (canAccessProduct(u, "print")) {
			items.push({ href: "/print/board", label: "Press board" });
		}
		items.push({ href: "/tech", label: "Tech" });
	}

	const nav = items
		.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`)
		.join("");

	const userBar = opts.user
		? `<div class="userbar">
        <span>${escapeHtml(opts.user.name)} · ${escapeHtml(roleLabel(opts.user.designation || opts.user.role))}</span>
        <a href="/account/password">Password</a>
        <form method="post" action="/logout" class="inline">
          <button type="submit" class="linkish">Log out</button>
        </form>
      </div>`
		: "";

	const flash = opts.flash
		? `<div class="flash">${escapeHtml(opts.flash)}</div>`
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)} · Lumanyi</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="top">
    <div class="brand"><a href="/">Lumanyi</a></div>
    <nav class="nav">${nav}</nav>
    ${userBar}
  </header>
  <main class="main">
    ${flash}
    ${opts.body}
  </main>
  <footer class="foot">
    <span>Lumanyi · build ${escapeHtml(new Date().toISOString().slice(0, 10))}</span>
  </footer>
</body>
</html>`;
}

export function statusLabel(status: string): string {
	return status.replace(/_/g, " ");
}
