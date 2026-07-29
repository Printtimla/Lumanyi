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
import { canManageDiscountCaps } from "./discount-caps";

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

type NavLink = { href: string; label: string };

function navAnchor(item: NavLink): string {
	return `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;
}

function navDropdown(label: string, items: NavLink[]): string {
	if (!items.length) return "";
	const links = items.map(navAnchor).join("");
	return `<details class="nav-dd">
    <summary>${escapeHtml(label)}</summary>
    <div class="nav-dd-menu">${links}</div>
  </details>`;
}

/** Primary chrome: flat product/office links + grouped Ops / Admin / Settings. */
export function buildNavHtml(user: AppUser | null | undefined): string {
	if (!user) return "";

	const primary: NavLink[] = [{ href: "/", label: "Home" }];
	if (canAccessProduct(user, "restoration")) {
		primary.push({ href: "/restoration", label: "Restoration" });
	}
	if (canAccessProduct(user, "floors")) {
		primary.push({ href: "/floors", label: "Floors" });
	}
	if (canAccessProduct(user, "print")) {
		primary.push({ href: "/print", label: "Print" });
	}
	if (canSeeOfficeTools(user)) {
		primary.push({ href: "/customers", label: "Customers" });
	}
	primary.push({ href: "/calendar", label: "Calendar" });

	const ops: NavLink[] = [];
	if (canSeeOfficeTools(user)) {
		ops.push({ href: "/leads", label: "Leads" });
		ops.push({ href: "/reports", label: "Reports" });
	}
	ops.push({ href: "/inventory", label: "Inventory" });
	if (canAccessProduct(user, "floors") && canSeeOfficeTools(user)) {
		ops.push({ href: "/recurring", label: "Recurring" });
	}
	if (canAccessProduct(user, "print")) {
		ops.push({ href: "/print/board", label: "Press board" });
	}

	const admin: NavLink[] = [];
	if (canManageUsers(user)) {
		admin.push({ href: "/users", label: "Users" });
	}
	if (canAccessTrash(user)) {
		admin.push({ href: "/trash", label: "Trash" });
	}
	if (canViewAudit(user)) {
		admin.push({ href: "/audit", label: "Audit" });
	}

	const settings: NavLink[] = [];
	if (canManagePriceLists(user)) {
		settings.push({ href: "/settings/price-lists", label: "Price lists" });
	}
	if (canManagePrintMargins(user)) {
		settings.push({ href: "/settings/print-margins", label: "Print margins" });
	}
	if (canManageLaborRates(user)) {
		settings.push({ href: "/settings/labor-rates", label: "Labor rates" });
	}
	if (canManageDiscountCaps(user)) {
		settings.push({ href: "/settings/discount-caps", label: "Discount caps" });
	}

	const parts = [
		...primary.map(navAnchor),
		navDropdown("Ops", ops),
		navDropdown("Admin", admin),
		navDropdown("Settings", settings),
		navAnchor({ href: "/tech", label: "Tech" }),
	];

	return parts.filter(Boolean).join("");
}

export function layout(opts: {
	title: string;
	user?: AppUser | null;
	body: string;
	flash?: string | null;
}): string {
	const u = opts.user;
	const nav = buildNavHtml(u);

	const userBar = opts.user
		? `<details class="nav-dd account-dd">
        <summary>${escapeHtml(opts.user.name)} · ${escapeHtml(roleLabel(opts.user.designation || opts.user.role))}</summary>
        <div class="nav-dd-menu">
          <a href="/account/password">Password</a>
          <form method="post" action="/logout" class="inline">
            <button type="submit" class="linkish nav-dd-btn">Log out</button>
          </form>
        </div>
      </details>`
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
