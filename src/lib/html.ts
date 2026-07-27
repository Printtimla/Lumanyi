import type { AppUser } from "./auth";

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
	const items: Array<{ href: string; label: string }> = opts.user
		? [
				{ href: "/", label: "Dashboard" },
				{ href: "/customers", label: "Customers" },
				{ href: "/jobs", label: "Jobs" },
				{ href: "/calendar", label: "Calendar" },
			]
		: [];
	if (opts.user?.role === "owner") {
		items.push({ href: "/users", label: "Users" });
	}
	if (opts.user) {
		items.push({ href: "/recurring", label: "Recurring" });
		items.push({ href: "/print", label: "Print" });
		items.push({ href: "/print/board", label: "Press board" });
		items.push({ href: "/tech", label: "Tech" });
	}

	const nav = items
		.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`)
		.join("");

	const userBar = opts.user
		? `<div class="userbar">
        <span>${escapeHtml(opts.user.name)} · ${escapeHtml(opts.user.role)}</span>
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
    <span>Internal Field Ops · build ${escapeHtml(new Date().toISOString().slice(0, 10))}</span>
  </footer>
</body>
</html>`;
}

export function statusLabel(status: string): string {
	return status.replace(/_/g, " ");
}

export function jobTypeLabel(type: string): string {
	if (type === "restoration") return "Water restoration";
	if (type === "hard_floor") return "Hard floor cleaning";
	return type;
}
