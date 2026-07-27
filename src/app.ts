import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
	SESSION_COOKIE,
	clearSessionCookie,
	createSession,
	destroySession,
	ensureSeedUser,
	getSessionUser,
	setSessionCookie,
	type AppUser,
} from "./lib/auth";
import { CHECKLISTS } from "./lib/checklists";
import {
	escapeHtml,
	jobTypeLabel,
	layout,
	money,
	statusLabel,
} from "./lib/html";
import { newId } from "./lib/ids";
import { hashPassword, verifyPassword } from "./lib/password";
import { generateDueRecurringJobs } from "./lib/recurring";
import { buildEstimatePdf, syncJobEstimateTotal } from "./lib/estimate";
import {
	PRINT_BOARD_COLUMNS,
	PRINT_FILE_KINDS,
	PRINT_PRODUCT_TYPES,
	PRINT_STATUSES,
	printProductLabel,
	printStatusLabel,
	syncPrintQuoteTotal,
} from "./lib/print";
import { consumeLoginOtp } from "./lib/otp";

export type Env = {
	DB: D1Database;
	ASSETS: Fetcher;
	UPLOADS: R2Bucket;
};

type Variables = {
	user: AppUser;
	flash: string | null;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
	await ensureSeedUser(c.env.DB);
	c.set("flash", null);
	await next();
});

function page(
	c: { get: (key: "user" | "flash") => unknown },
	title: string,
	body: string,
	user?: AppUser | null,
) {
	return layout({
		title,
		body,
		user: user ?? (c.get("user") as AppUser | null),
		flash: (c.get("flash") as string | null) ?? null,
	});
}

/** Auth gate for app pages (not login/static). */
app.use("*", async (c, next) => {
	const path = new URL(c.req.url).pathname;
	if (
		path === "/login" ||
		path === "/logout" ||
		path === "/styles.css" ||
		path === "/health"
	) {
		return next();
	}
	const user = await getSessionUser(c.env.DB, getCookie(c, SESSION_COOKIE));
	if (!user) {
		return c.redirect("/login");
	}
	c.set("user", user);
	const onPasswordPage = path === "/account/password";
	if (user.mustChangePassword && !onPasswordPage) {
		return c.redirect("/account/password");
	}
	return next();
});

app.get("/health", (c) => c.json({ ok: true, app: "lumanyi" }));

app.get("/login", async (c) => {
	const user = await getSessionUser(c.env.DB, getCookie(c, SESSION_COOKIE));
	if (user) {
		return c.redirect(user.mustChangePassword ? "/account/password" : "/");
	}
	const body = `
    <div class="login-wrap">
      <div class="panel stack">
        <h1>Sign in</h1>
        <p class="muted">Internal Field Ops — water restoration &amp; hard floor cleaning.</p>
        <form method="post" action="/login" class="stack">
          <div>
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required value="owner@lumanyi.local" />
          </div>
          <div>
            <label for="password">Password or one-time code</label>
            <input id="password" name="password" type="text" required autocomplete="off" />
          </div>
          <button class="btn" type="submit">Sign in</button>
        </form>
        <p class="muted">Email: owner@lumanyi.local — use your password, or a PASTE-… one-time code.</p>
      </div>
    </div>`;
	return c.html(layout({ title: "Sign in", body, user: null }));
});

app.post("/login", async (c) => {
	const form = await c.req.parseBody();
	const email = String(form.email || "")
		.trim()
		.toLowerCase();
	const password = String(form.password || "");

	const renderLoginError = (message: string) => {
		const body = `
      <div class="login-wrap">
        <div class="panel stack">
          <h1>Sign in</h1>
          <div class="flash" style="background:#fef2f2;border-color:#fecaca;color:#991b1b">${escapeHtml(message)}</div>
          <form method="post" action="/login" class="stack">
            <div>
              <label for="email">Email</label>
              <input id="email" name="email" type="email" required value="${escapeHtml(email)}" />
            </div>
            <div>
              <label for="password">Password or one-time code</label>
              <input id="password" name="password" type="text" required autocomplete="off" />
            </div>
            <button class="btn" type="submit">Sign in</button>
          </form>
        </div>
      </div>`;
		return c.html(layout({ title: "Sign in", body, user: null }), 401);
	};

	const row = await c.env.DB.prepare(
		`SELECT id, email, name, role, password_hash, must_change_password FROM users WHERE email = ?`,
	)
		.bind(email)
		.first<{
			id: string;
			email: string;
			name: string;
			role: AppUser["role"];
			password_hash: string;
			must_change_password: number;
		}>();

	if (!row) {
		return renderLoginError("Invalid email or password.");
	}

	let ok = await verifyPassword(password, row.password_hash);
	if (!ok) {
		const otpUserId = await consumeLoginOtp(c.env.DB, password);
		ok = otpUserId === row.id;
	}
	if (!ok) {
		return renderLoginError("Invalid email or password.");
	}

	const sessionId = await createSession(c.env.DB, row.id);
	setSessionCookie(c, sessionId);
	if (row.must_change_password === 1) {
		return c.redirect("/account/password");
	}
	return c.redirect("/");
});

app.post("/logout", async (c) => {
	await destroySession(c.env.DB, getCookie(c, SESSION_COOKIE));
	clearSessionCookie(c);
	return c.redirect("/login");
});

app.get("/account/password", (c) => {
	const user = c.get("user");
	const forced = user.mustChangePassword;
	const body = `
    <div class="login-wrap">
      <div class="panel stack">
        <h1>${forced ? "Change default password" : "Change password"}</h1>
        ${forced ? `<p class="muted">You must set a new password before using Lumanyi.</p>` : ""}
        <form method="post" action="/account/password" class="stack">
          ${forced ? "" : `<div>
            <label for="current_password">Current password</label>
            <input id="current_password" name="current_password" type="password" required />
          </div>`}
          <div>
            <label for="new_password">New password</label>
            <input id="new_password" name="new_password" type="password" required minlength="8" />
          </div>
          <div>
            <label for="confirm_password">Confirm new password</label>
            <input id="confirm_password" name="confirm_password" type="password" required minlength="8" />
          </div>
          <button class="btn" type="submit">Save password</button>
        </form>
      </div>
    </div>`;
	return c.html(page(c, "Change password", body));
});

app.post("/account/password", async (c) => {
	const user = c.get("user");
	const form = await c.req.parseBody();
	const newPassword = String(form.new_password || "");
	const confirm = String(form.confirm_password || "");
	const forced = user.mustChangePassword;

	const renderError = (message: string) => {
		const body = `
    <div class="login-wrap">
      <div class="panel stack">
        <h1>${forced ? "Change default password" : "Change password"}</h1>
        <div class="flash" style="background:#fef2f2;border-color:#fecaca;color:#991b1b">${escapeHtml(message)}</div>
        <form method="post" action="/account/password" class="stack">
          ${forced ? "" : `<div>
            <label for="current_password">Current password</label>
            <input id="current_password" name="current_password" type="password" required />
          </div>`}
          <div>
            <label for="new_password">New password</label>
            <input id="new_password" name="new_password" type="password" required minlength="8" />
          </div>
          <div>
            <label for="confirm_password">Confirm new password</label>
            <input id="confirm_password" name="confirm_password" type="password" required minlength="8" />
          </div>
          <button class="btn" type="submit">Save password</button>
        </form>
      </div>
    </div>`;
		return c.html(page(c, "Change password", body), 400);
	};

	if (newPassword.length < 8) {
		return renderError("Password must be at least 8 characters.");
	}
	if (newPassword !== confirm) {
		return renderError("New passwords do not match.");
	}
	if (newPassword === "changeme") {
		return renderError("Choose a password other than the default.");
	}

	const row = await c.env.DB.prepare(
		`SELECT password_hash, must_change_password FROM users WHERE id = ?`,
	)
		.bind(user.id)
		.first<{ password_hash: string; must_change_password: number }>();
	if (!row) return c.redirect("/login");

	if (row.must_change_password !== 1) {
		const current = String(form.current_password || "");
		if (!(await verifyPassword(current, row.password_hash))) {
			return renderError("Current password is incorrect.");
		}
	}

	let passwordHash: string;
	try {
		passwordHash = await hashPassword(newPassword);
	} catch (err) {
		console.error("password hash failed", err);
		return renderError("Could not hash password. Try a shorter password or try again.");
	}
	try {
		await c.env.DB.prepare(
			`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
		)
			.bind(passwordHash, user.id)
			.run();
	} catch (err) {
		console.error("password update failed", err);
		return renderError("Could not save password. Try again.");
	}
	return c.redirect("/");
});

app.get("/users", async (c) => {
	if (c.get("user").role !== "owner") {
		return c.html(
			page(c, "Users", `<h1>Users</h1><p class="muted">Owner access only.</p>`),
			403,
		);
	}
	const list = await c.env.DB.prepare(
		`SELECT id, name, email, role, must_change_password, created_at
     FROM users ORDER BY name COLLATE NOCASE`,
	).all<{
		id: string;
		name: string;
		email: string;
		role: string;
		must_change_password: number;
		created_at: string;
	}>();

	const rows =
		list.results
			?.map(
				(u) => `<tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>${u.must_change_password ? "Must change" : "OK"}</td>
      </tr>`,
			)
			.join("") || "";

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">Users</h1></div>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Add user</h2>
    <form method="post" action="/users" class="panel stack">
      <div class="row">
        <div><label for="name">Name</label><input id="name" name="name" required /></div>
        <div><label for="email">Email</label><input id="email" name="email" type="email" required /></div>
      </div>
      <div class="row">
        <div>
          <label for="role">Role</label>
          <select id="role" name="role" required>
            <option value="tech">Tech</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div>
          <label for="temp_password">Temporary password</label>
          <input id="temp_password" name="temp_password" type="text" required minlength="8" value="Lumanyi1!" />
        </div>
      </div>
      <p class="muted">New users must change password on first login.</p>
      <button class="btn" type="submit">Create user</button>
    </form>`;

	return c.html(page(c, "Users", body));
});

app.post("/users", async (c) => {
	if (c.get("user").role !== "owner") return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	const name = String(form.name || "").trim();
	const email = String(form.email || "")
		.trim()
		.toLowerCase();
	const role = String(form.role || "") as AppUser["role"];
	const tempPassword = String(form.temp_password || "");
	if (!name || !email || tempPassword.length < 8) {
		return c.text("Name, email, and password (8+ chars) required", 400);
	}
	if (!["owner", "dispatcher", "tech"].includes(role)) {
		return c.text("Invalid role", 400);
	}
	const existing = await c.env.DB.prepare(
		`SELECT id FROM users WHERE email = ?`,
	)
		.bind(email)
		.first();
	if (existing) return c.text("Email already exists", 400);

	const passwordHash = await hashPassword(tempPassword);
	await c.env.DB.prepare(
		`INSERT INTO users (id, email, name, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, 1)`,
	)
		.bind(newId("usr"), email, name, passwordHash, role)
		.run();
	return c.redirect("/users");
});

app.get("/", async (c) => {
	const counts = await c.env.DB.prepare(
		`SELECT
      SUM(CASE WHEN status IN ('lead','estimate') THEN 1 ELSE 0 END) AS pipeline,
      SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status IN ('complete','invoiced') THEN 1 ELSE 0 END) AS done
     FROM jobs WHERE status != 'cancelled'`,
	).first<{
		pipeline: number;
		scheduled: number;
		active: number;
		done: number;
	}>();

	const upcoming = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     WHERE j.status IN ('scheduled','in_progress')
     ORDER BY COALESCE(j.scheduled_start, '9999') ASC
     LIMIT 8`,
	).all<{
		id: string;
		title: string;
		job_type: string;
		status: string;
		scheduled_start: string | null;
		customer_name: string;
	}>();

	const rows =
		upcoming.results
			?.map(
				(j) => `<tr>
        <td><a href="/jobs/${escapeHtml(j.id)}">${escapeHtml(j.title)}</a></td>
        <td>${escapeHtml(j.customer_name)}</td>
        <td>${escapeHtml(jobTypeLabel(j.job_type))}</td>
        <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span></td>
        <td>${escapeHtml(j.scheduled_start ? j.scheduled_start.slice(0, 16).replace("T", " ") : "—")}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="5" class="muted">No scheduled jobs yet.</td></tr>`;

	const body = `
    <h1>Dashboard</h1>
    <p class="muted">Field Ops — restoration &amp; hard floor cleaning.</p>
    <div class="grid" style="margin:1rem 0 1.5rem">
      <div class="stat"><div class="n">${counts?.pipeline ?? 0}</div><div class="l">Pipeline</div></div>
      <div class="stat"><div class="n">${counts?.scheduled ?? 0}</div><div class="l">Scheduled</div></div>
      <div class="stat"><div class="n">${counts?.active ?? 0}</div><div class="l">In progress</div></div>
      <div class="stat"><div class="n">${counts?.done ?? 0}</div><div class="l">Complete / invoiced</div></div>
    </div>
    <div class="toolbar">
      <a class="btn" href="/jobs/new">New job</a>
      <a class="btn secondary" href="/customers/new">New customer</a>
    </div>
    <h2>Up next</h2>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

	return c.html(page(c, "Dashboard", body));
});

app.get("/customers", async (c) => {
	const q = (c.req.query("q") || "").trim();
	const list = q
		? await c.env.DB.prepare(
				`SELECT id, name, phone, email, created_at FROM customers
         WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?
         ORDER BY name COLLATE NOCASE LIMIT 100`,
			)
				.bind(`%${q}%`, `%${q}%`, `%${q}%`)
				.all()
		: await c.env.DB.prepare(
				`SELECT id, name, phone, email, created_at FROM customers
         ORDER BY name COLLATE NOCASE LIMIT 100`,
			).all();

	const rows =
		list.results
			?.map(
				(cust) => {
					const r = cust as {
						id: string;
						name: string;
						phone: string | null;
						email: string | null;
					};
					return `<tr>
        <td><a href="/customers/${escapeHtml(r.id)}">${escapeHtml(r.name)}</a></td>
        <td>${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(r.email)}</td>
      </tr>`;
				},
			)
			.join("") || `<tr><td colspan="3" class="muted">No customers yet.</td></tr>`;

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">Customers</h1></div>
      <a class="btn" href="/customers/new">Add customer</a>
    </div>
    <form class="toolbar" method="get" action="/customers">
      <div class="grow">
        <label for="q">Search</label>
        <input id="q" name="q" value="${escapeHtml(q)}" placeholder="Name, phone, email" />
      </div>
      <button class="btn secondary" type="submit">Search</button>
    </form>
    <table>
      <thead><tr><th>Name</th><th>Phone</th><th>Email</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

	return c.html(page(c, "Customers", body));
});

app.get("/customers/new", (c) => {
	const body = `
    <h1>New customer</h1>
    <form method="post" action="/customers" class="panel stack">
      <div><label for="name">Name</label><input id="name" name="name" required /></div>
      <div class="row">
        <div><label for="phone">Phone</label><input id="phone" name="phone" /></div>
        <div><label for="email">Email</label><input id="email" name="email" type="email" /></div>
      </div>
      <div><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea></div>
      <h2>Primary site</h2>
      <div><label for="address_line1">Address</label><input id="address_line1" name="address_line1" required /></div>
      <div><label for="address_line2">Address line 2</label><input id="address_line2" name="address_line2" /></div>
      <div class="row">
        <div><label for="city">City</label><input id="city" name="city" required /></div>
        <div><label for="state">State</label><input id="state" name="state" value="CA" required /></div>
        <div><label for="postal_code">ZIP</label><input id="postal_code" name="postal_code" /></div>
      </div>
      <button class="btn" type="submit">Save customer</button>
    </form>`;
	return c.html(page(c, "New customer", body));
});

app.post("/customers", async (c) => {
	const form = await c.req.parseBody();
	const customerId = newId("cus");
	const siteId = newId("sit");
	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO customers (id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)`,
		).bind(
			customerId,
			String(form.name || "").trim(),
			String(form.phone || "").trim() || null,
			String(form.email || "").trim() || null,
			String(form.notes || "").trim() || null,
		),
		c.env.DB.prepare(
			`INSERT INTO sites (id, customer_id, label, address_line1, address_line2, city, state, postal_code)
       VALUES (?, ?, 'Primary', ?, ?, ?, ?, ?)`,
		).bind(
			siteId,
			customerId,
			String(form.address_line1 || "").trim(),
			String(form.address_line2 || "").trim() || null,
			String(form.city || "").trim(),
			String(form.state || "CA").trim(),
			String(form.postal_code || "").trim() || null,
		),
	]);
	return c.redirect(`/customers/${customerId}`);
});

app.get("/customers/:id", async (c) => {
	const id = c.req.param("id");
	const customer = await c.env.DB.prepare(
		`SELECT * FROM customers WHERE id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			name: string;
			phone: string | null;
			email: string | null;
			notes: string | null;
		}>();
	if (!customer) return c.notFound();

	const sites = await c.env.DB.prepare(
		`SELECT * FROM sites WHERE customer_id = ? ORDER BY created_at`,
	)
		.bind(id)
		.all<{
			id: string;
			label: string;
			address_line1: string;
			city: string;
			state: string;
			postal_code: string | null;
		}>();

	const jobs = await c.env.DB.prepare(
		`SELECT id, title, job_type, status, scheduled_start FROM jobs
     WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
	)
		.bind(id)
		.all<{
			id: string;
			title: string;
			job_type: string;
			status: string;
			scheduled_start: string | null;
		}>();

	const siteRows =
		sites.results
			?.map(
				(s) => `<li><strong>${escapeHtml(s.label)}</strong> — ${escapeHtml(s.address_line1)}, ${escapeHtml(s.city)}, ${escapeHtml(s.state)} ${escapeHtml(s.postal_code)}</li>`,
			)
			.join("") || "<li class='muted'>No sites</li>";

	const jobRows =
		jobs.results
			?.map(
				(j) => `<tr>
        <td><a href="/jobs/${escapeHtml(j.id)}">${escapeHtml(j.title)}</a></td>
        <td>${escapeHtml(jobTypeLabel(j.job_type))}</td>
        <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span></td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="3" class="muted">No jobs yet.</td></tr>`;

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">${escapeHtml(customer.name)}</h1></div>
      <a class="btn" href="/jobs/new?customer_id=${escapeHtml(customer.id)}">New job</a>
    </div>
    <div class="panel stack">
      <div><span class="muted">Phone</span><br>${escapeHtml(customer.phone) || "—"}</div>
      <div><span class="muted">Email</span><br>${escapeHtml(customer.email) || "—"}</div>
      ${customer.notes ? `<div><span class="muted">Notes</span><br>${escapeHtml(customer.notes)}</div>` : ""}
      <div><span class="muted">Sites</span><ul>${siteRows}</ul></div>
    </div>
    <h2>Jobs</h2>
    <table>
      <thead><tr><th>Job</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>${jobRows}</tbody>
    </table>`;

	return c.html(page(c, customer.name, body));
});

app.get("/jobs", async (c) => {
	const status = c.req.query("status") || "";
	const tech = c.req.query("tech") || "";
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";

	const where: string[] = ["1=1"];
	const binds: string[] = [];
	if (status) {
		where.push("j.status = ?");
		binds.push(status);
	}
	if (tech) {
		where.push("j.assigned_user_id = ?");
		binds.push(tech);
	}
	if (from) {
		where.push("date(j.scheduled_start) >= date(?)");
		binds.push(from);
	}
	if (to) {
		where.push("date(j.scheduled_start) <= date(?)");
		binds.push(to);
	}

	const sql = `SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start,
      c.name AS customer_name, u.name AS assignee_name
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN users u ON u.id = j.assigned_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY j.updated_at DESC LIMIT 200`;

	const stmt = c.env.DB.prepare(sql);
	const jobs = binds.length
		? await stmt.bind(...binds).all<{
				id: string;
				title: string;
				job_type: string;
				status: string;
				scheduled_start: string | null;
				customer_name: string;
				assignee_name: string | null;
			}>()
		: await stmt.all<{
				id: string;
				title: string;
				job_type: string;
				status: string;
				scheduled_start: string | null;
				customer_name: string;
				assignee_name: string | null;
			}>();

	const staff = await c.env.DB.prepare(
		`SELECT id, name FROM users ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();

	const rows =
		jobs.results
			?.map(
				(j) => `<tr>
        <td><a href="/jobs/${escapeHtml(j.id)}">${escapeHtml(j.title)}</a></td>
        <td>${escapeHtml(j.customer_name)}</td>
        <td>${escapeHtml(j.assignee_name) || "—"}</td>
        <td>${escapeHtml(jobTypeLabel(j.job_type))}</td>
        <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span></td>
        <td>${escapeHtml(j.scheduled_start ? j.scheduled_start.slice(0, 16).replace("T", " ") : "—")}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="6" class="muted">No jobs match.</td></tr>`;

	const statusFilters = [
		"",
		"lead",
		"estimate",
		"scheduled",
		"in_progress",
		"complete",
		"invoiced",
	]
		.map((s) => {
			const q = new URLSearchParams();
			if (s) q.set("status", s);
			if (tech) q.set("tech", tech);
			if (from) q.set("from", from);
			if (to) q.set("to", to);
			const qs = q.toString();
			const href = qs ? `/jobs?${qs}` : "/jobs";
			const active = status === s ? "btn" : "btn secondary";
			return `<a class="${active}" href="${href}">${escapeHtml(statusLabel(s || "all"))}</a>`;
		})
		.join(" ");

	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${tech === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`,
			)
			.join("") || "";

	const exportQ = new URLSearchParams();
	if (status) exportQ.set("status", status);
	if (tech) exportQ.set("tech", tech);
	if (from) exportQ.set("from", from);
	if (to) exportQ.set("to", to);
	const exportHref = `/jobs/export.csv${exportQ.toString() ? `?${exportQ}` : ""}`;

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">Jobs</h1></div>
      <a class="btn secondary" href="${escapeHtml(exportHref)}">Export CSV</a>
      <a class="btn" href="/jobs/new">New job</a>
    </div>
    <form class="panel toolbar" method="get" action="/jobs" style="align-items:end">
      ${status ? `<input type="hidden" name="status" value="${escapeHtml(status)}" />` : ""}
      <div>
        <label for="tech">Tech</label>
        <select id="tech" name="tech">
          <option value="">All</option>
          ${staffOptions}
        </select>
      </div>
      <div>
        <label for="from">From</label>
        <input id="from" name="from" type="date" value="${escapeHtml(from)}" />
      </div>
      <div>
        <label for="to">To</label>
        <input id="to" name="to" type="date" value="${escapeHtml(to)}" />
      </div>
      <button class="btn secondary" type="submit">Apply</button>
      <a class="btn secondary" href="/jobs">Clear</a>
    </form>
    <div class="toolbar">${statusFilters}</div>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Tech</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

	return c.html(page(c, "Jobs", body));
});

app.get("/jobs/export.csv", async (c) => {
	const status = c.req.query("status") || "";
	const tech = c.req.query("tech") || "";
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";

	const where: string[] = ["1=1"];
	const binds: string[] = [];
	if (status) {
		where.push("j.status = ?");
		binds.push(status);
	}
	if (tech) {
		where.push("j.assigned_user_id = ?");
		binds.push(tech);
	}
	if (from) {
		where.push("date(j.scheduled_start) >= date(?)");
		binds.push(from);
	}
	if (to) {
		where.push("date(j.scheduled_start) <= date(?)");
		binds.push(to);
	}

	const sql = `SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start,
      j.estimate_cents, j.invoice_cents, c.name AS customer_name, u.name AS assignee_name
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN users u ON u.id = j.assigned_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY j.scheduled_start ASC, j.created_at DESC
     LIMIT 2000`;

	const stmt = c.env.DB.prepare(sql);
	const jobs = binds.length ? await stmt.bind(...binds).all() : await stmt.all();

	const escapeCsv = (value: string | number | null | undefined) => {
		const s = String(value ?? "");
		if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
		return s;
	};

	const lines = [
		[
			"id",
			"title",
			"customer",
			"tech",
			"type",
			"status",
			"scheduled_start",
			"estimate_cents",
			"invoice_cents",
		].join(","),
	];
	for (const j of (jobs.results || []) as Array<Record<string, unknown>>) {
		lines.push(
			[
				escapeCsv(j.id as string),
				escapeCsv(j.title as string),
				escapeCsv(j.customer_name as string),
				escapeCsv(j.assignee_name as string),
				escapeCsv(j.job_type as string),
				escapeCsv(j.status as string),
				escapeCsv(j.scheduled_start as string),
				escapeCsv(j.estimate_cents as number),
				escapeCsv(j.invoice_cents as number),
			].join(","),
		);
	}

	return new Response(lines.join("\n") + "\n", {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": 'attachment; filename="lumanyi-jobs.csv"',
		},
	});
});

app.get("/jobs/new", async (c) => {
	const preselect = c.req.query("customer_id") || "";
	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const staff = await c.env.DB.prepare(
		`SELECT id, name, role FROM users ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string }>();

	const options =
		customers.results
			?.map(
				(cu) =>
					`<option value="${escapeHtml(cu.id)}" ${cu.id === preselect ? "selected" : ""}>${escapeHtml(cu.name)}</option>`,
			)
			.join("") || "";

	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${u.id === c.get("user").id ? "selected" : ""}>${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`,
			)
			.join("") || "";

	const body = `
    <h1>New job</h1>
    <form method="post" action="/jobs" class="panel stack">
      <div>
        <label for="customer_id">Customer</label>
        <select id="customer_id" name="customer_id" required>
          <option value="">Select…</option>
          ${options}
        </select>
      </div>
      <div><label for="title">Title</label><input id="title" name="title" required placeholder="Kitchen flood mitigation" /></div>
      <div class="row">
        <div>
          <label for="job_type">Type</label>
          <select id="job_type" name="job_type" required>
            <option value="restoration">Water restoration</option>
            <option value="hard_floor">Hard floor cleaning</option>
          </select>
        </div>
        <div>
          <label for="status">Status</label>
          <select id="status" name="status">
            <option value="lead">Lead</option>
            <option value="estimate">Estimate</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </div>
      </div>
      <div>
        <label for="assigned_user_id">Assigned to</label>
        <select id="assigned_user_id" name="assigned_user_id">
          <option value="">Unassigned</option>
          ${staffOptions}
        </select>
      </div>
      <div class="row">
        <div><label for="scheduled_start">Start</label><input id="scheduled_start" name="scheduled_start" type="datetime-local" /></div>
        <div><label for="scheduled_end">End</label><input id="scheduled_end" name="scheduled_end" type="datetime-local" /></div>
      </div>
      <div><label for="estimate_dollars">Estimate ($)</label><input id="estimate_dollars" name="estimate_dollars" type="number" step="0.01" min="0" /></div>
      <div><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea></div>
      <button class="btn" type="submit">Create job</button>
    </form>`;

	return c.html(page(c, "New job", body));
});

app.post("/jobs", async (c) => {
	const form = await c.req.parseBody();
	const customerId = String(form.customer_id || "");
	const jobType = String(form.job_type || "") as "restoration" | "hard_floor";
	if (jobType !== "restoration" && jobType !== "hard_floor") {
		return c.text("Invalid job type", 400);
	}

	const site = await c.env.DB.prepare(
		`SELECT id FROM sites WHERE customer_id = ? ORDER BY created_at LIMIT 1`,
	)
		.bind(customerId)
		.first<{ id: string }>();

	const jobId = newId("job");
	const estimateRaw = String(form.estimate_dollars || "").trim();
	const estimateCents = estimateRaw
		? Math.round(parseFloat(estimateRaw) * 100)
		: null;

	const stmts = [
		c.env.DB.prepare(
			`INSERT INTO jobs (
        id, customer_id, site_id, title, job_type, status,
        scheduled_start, scheduled_end, estimate_cents, notes, assigned_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			jobId,
			customerId,
			site?.id ?? null,
			String(form.title || "").trim(),
			jobType,
			String(form.status || "lead"),
			String(form.scheduled_start || "").trim() || null,
			String(form.scheduled_end || "").trim() || null,
			estimateCents,
			String(form.notes || "").trim() || null,
			String(form.assigned_user_id || "").trim() || null,
		),
	];

	CHECKLISTS[jobType].forEach((label, i) => {
		stmts.push(
			c.env.DB.prepare(
				`INSERT INTO job_checklist_items (id, job_id, label, sort_order) VALUES (?, ?, ?, ?)`,
			).bind(newId("chk"), jobId, label, i),
		);
	});

	await c.env.DB.batch(stmts);
	return c.redirect(`/jobs/${jobId}`);
});

app.get("/jobs/:id", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.*, c.name AS customer_name,
      s.address_line1, s.city, s.state, s.postal_code,
      a.name AS assignee_name
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     LEFT JOIN users a ON a.id = j.assigned_user_id
     WHERE j.id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			title: string;
			job_type: string;
			status: string;
			scheduled_start: string | null;
			scheduled_end: string | null;
			estimate_cents: number | null;
			invoice_cents: number | null;
			notes: string | null;
			claim_number: string | null;
			carrier: string | null;
			date_of_loss: string | null;
			customer_id: string;
			customer_name: string;
			assigned_user_id: string | null;
			assignee_name: string | null;
			address_line1: string | null;
			city: string | null;
			state: string | null;
			postal_code: string | null;
		}>();
	if (!job) return c.notFound();

	const staff = await c.env.DB.prepare(
		`SELECT id, name, role FROM users ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string }>();

	const checklist = await c.env.DB.prepare(
		`SELECT id, label, done FROM job_checklist_items WHERE job_id = ? ORDER BY sort_order`,
	)
		.bind(id)
		.all<{ id: string; label: string; done: number }>();

	const notes = await c.env.DB.prepare(
		`SELECT n.body, n.created_at, u.name AS user_name
     FROM job_notes n LEFT JOIN users u ON u.id = n.user_id
     WHERE n.job_id = ? ORDER BY n.created_at DESC`,
	)
		.bind(id)
		.all<{ body: string; created_at: string; user_name: string | null }>();

	const photos = await c.env.DB.prepare(
		`SELECT id, filename, content_type, created_at FROM job_photos
     WHERE job_id = ? ORDER BY created_at DESC`,
	)
		.bind(id)
		.all<{
			id: string;
			filename: string;
			content_type: string | null;
			created_at: string;
		}>();

	const checkItems =
		checklist.results
			?.map(
				(item) => `<li>
        <form method="post" action="/jobs/${escapeHtml(id)}/checklist/${escapeHtml(item.id)}" class="inline">
          <input type="hidden" name="done" value="${item.done ? "0" : "1"}" />
          <button type="submit" class="linkish">${item.done ? "☑" : "☐"}</button>
        </form>
        <span>${escapeHtml(item.label)}</span>
      </li>`,
			)
			.join("") || "<li class='muted'>No checklist</li>";

	const noteItems =
		notes.results
			?.map(
				(n) => `<div class="panel" style="padding:0.75rem">
        <div class="muted" style="font-size:0.8rem">${escapeHtml(n.user_name || "Staff")} · ${escapeHtml(n.created_at.slice(0, 16).replace("T", " "))}</div>
        <div>${escapeHtml(n.body)}</div>
      </div>`,
			)
			.join("") || `<p class="muted">No notes yet.</p>`;

	const photoItems =
		photos.results
			?.map(
				(p) => `<div class="panel" style="padding:0.75rem">
        <a href="/jobs/${escapeHtml(id)}/photos/${escapeHtml(p.id)}" target="_blank" rel="noopener">
          <img src="/jobs/${escapeHtml(id)}/photos/${escapeHtml(p.id)}" alt="${escapeHtml(p.filename)}"
            style="max-width:100%;max-height:220px;border-radius:8px;display:block;margin-bottom:0.5rem" />
        </a>
        <div class="muted" style="font-size:0.8rem">${escapeHtml(p.filename)} · ${escapeHtml(p.created_at.slice(0, 16).replace("T", " "))}</div>
        <form method="post" action="/jobs/${escapeHtml(id)}/photos/${escapeHtml(p.id)}/delete" class="inline"
          onsubmit="return confirm('Delete this photo?');">
          <button class="linkish" type="submit">Delete</button>
        </form>
      </div>`,
			)
			.join("") || `<p class="muted">No photos yet.</p>`;

	const statusOptions = [
		"lead",
		"estimate",
		"scheduled",
		"in_progress",
		"complete",
		"invoiced",
		"cancelled",
	]
		.map(
			(s) =>
				`<option value="${s}" ${job.status === s ? "selected" : ""}>${escapeHtml(statusLabel(s))}</option>`,
		)
		.join("");

	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${job.assigned_user_id === u.id ? "selected" : ""}>${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`,
			)
			.join("") || "";

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">${escapeHtml(job.title)}</h1>
        <p class="muted" style="margin:0.35rem 0 0">
          <a href="/customers/${escapeHtml(job.customer_id)}">${escapeHtml(job.customer_name)}</a>
          · ${escapeHtml(jobTypeLabel(job.job_type))}
          · <span class="badge ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
        </p>
      </div>
      <a class="btn secondary" href="/jobs/${escapeHtml(id)}/estimate">Estimate</a>
      <a class="btn secondary" href="/jobs/${escapeHtml(id)}/estimate.pdf">PDF</a>
    </div>

    <div class="row" style="margin-top:1rem">
      <div class="panel stack">
        <div><span class="muted">Site</span><br>
          ${job.address_line1 ? `${escapeHtml(job.address_line1)}, ${escapeHtml(job.city)}, ${escapeHtml(job.state)} ${escapeHtml(job.postal_code)}` : "—"}
        </div>
        <div><span class="muted">Assigned</span><br>${escapeHtml(job.assignee_name) || "Unassigned"}</div>
        <div><span class="muted">Schedule</span><br>
          ${escapeHtml(job.scheduled_start ? job.scheduled_start.slice(0, 16).replace("T", " ") : "Not scheduled")}
          ${job.scheduled_end ? ` → ${escapeHtml(job.scheduled_end.slice(0, 16).replace("T", " "))}` : ""}
        </div>
        <div><span class="muted">Estimate</span><br>${escapeHtml(money(job.estimate_cents))} <a href="/jobs/${escapeHtml(id)}/estimate">edit lines</a></div>
        <div><span class="muted">Invoice</span><br>${escapeHtml(money(job.invoice_cents))}</div>
        <div><span class="muted">Claim #</span><br>${escapeHtml(job.claim_number) || "—"}</div>
        <div><span class="muted">Carrier</span><br>${escapeHtml(job.carrier) || "—"}</div>
        <div><span class="muted">Date of loss</span><br>${escapeHtml(job.date_of_loss) || "—"}</div>
        ${job.notes ? `<div><span class="muted">Job notes</span><br>${escapeHtml(job.notes)}</div>` : ""}
      </div>

      <div class="panel stack">
        <h2 style="margin:0">Update</h2>
        <form method="post" action="/jobs/${escapeHtml(id)}" class="stack">
          <div>
            <label for="status">Status</label>
            <select id="status" name="status">${statusOptions}</select>
          </div>
          <div>
            <label for="assigned_user_id">Assigned to</label>
            <select id="assigned_user_id" name="assigned_user_id">
              <option value="">Unassigned</option>
              ${staffOptions}
            </select>
          </div>
          <div class="row">
            <div><label for="scheduled_start">Start</label>
              <input id="scheduled_start" name="scheduled_start" type="datetime-local"
                value="${escapeHtml(job.scheduled_start ? job.scheduled_start.slice(0, 16) : "")}" /></div>
            <div><label for="scheduled_end">End</label>
              <input id="scheduled_end" name="scheduled_end" type="datetime-local"
                value="${escapeHtml(job.scheduled_end ? job.scheduled_end.slice(0, 16) : "")}" /></div>
          </div>
          <div class="row">
            <div><label for="estimate_dollars">Estimate ($)</label>
              <input id="estimate_dollars" name="estimate_dollars" type="number" step="0.01" min="0"
                value="${job.estimate_cents != null ? (job.estimate_cents / 100).toFixed(2) : ""}" /></div>
            <div><label for="invoice_dollars">Invoice ($)</label>
              <input id="invoice_dollars" name="invoice_dollars" type="number" step="0.01" min="0"
                value="${job.invoice_cents != null ? (job.invoice_cents / 100).toFixed(2) : ""}" /></div>
          </div>
          <h2 style="margin:0.5rem 0 0">Claim</h2>
          <div class="row">
            <div><label for="claim_number">Claim #</label>
              <input id="claim_number" name="claim_number" value="${escapeHtml(job.claim_number)}" /></div>
            <div><label for="carrier">Carrier</label>
              <input id="carrier" name="carrier" value="${escapeHtml(job.carrier)}" /></div>
            <div><label for="date_of_loss">Date of loss</label>
              <input id="date_of_loss" name="date_of_loss" type="date" value="${escapeHtml(job.date_of_loss)}" /></div>
          </div>
          <button class="btn" type="submit">Save</button>
        </form>
      </div>
    </div>

    <h2>Checklist</h2>
    <div class="panel"><ul class="checklist">${checkItems}</ul></div>

    <h2>Field notes</h2>
    <form method="post" action="/jobs/${escapeHtml(id)}/notes" class="panel stack" style="margin-bottom:1rem">
      <textarea name="body" required placeholder="Photos taken, moisture readings, customer instructions…"></textarea>
      <button class="btn" type="submit">Add note</button>
    </form>
    <div class="stack">${noteItems}</div>

    <h2>Photos</h2>
    <form method="post" action="/jobs/${escapeHtml(id)}/photos" enctype="multipart/form-data" class="panel stack" style="margin-bottom:1rem">
      <div>
        <label for="photo">Upload image (max 10 MB)</label>
        <input id="photo" name="photo" type="file" accept="image/*" required />
      </div>
      <button class="btn" type="submit">Upload photo</button>
    </form>
    <div class="stack">${photoItems}</div>`;

	return c.html(page(c, job.title, body));
});

app.post("/jobs/:id", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const estimateRaw = String(form.estimate_dollars || "").trim();
	const invoiceRaw = String(form.invoice_dollars || "").trim();
	await c.env.DB.prepare(
		`UPDATE jobs SET
      status = ?,
      assigned_user_id = ?,
      scheduled_start = ?,
      scheduled_end = ?,
      estimate_cents = ?,
      invoice_cents = ?,
      claim_number = ?,
      carrier = ?,
      date_of_loss = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
	)
		.bind(
			String(form.status || "lead"),
			String(form.assigned_user_id || "").trim() || null,
			String(form.scheduled_start || "").trim() || null,
			String(form.scheduled_end || "").trim() || null,
			estimateRaw ? Math.round(parseFloat(estimateRaw) * 100) : null,
			invoiceRaw ? Math.round(parseFloat(invoiceRaw) * 100) : null,
			String(form.claim_number || "").trim() || null,
			String(form.carrier || "").trim() || null,
			String(form.date_of_loss || "").trim() || null,
			id,
		)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.get("/jobs/:id/estimate", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.estimate_cents, j.claim_number, j.carrier, j.date_of_loss,
      c.name AS customer_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			title: string;
			estimate_cents: number | null;
			claim_number: string | null;
			carrier: string | null;
			date_of_loss: string | null;
			customer_name: string;
		}>();
	if (!job) return c.notFound();

	const rooms = await c.env.DB.prepare(
		`SELECT * FROM estimate_rooms WHERE job_id = ? ORDER BY sort_order, name`,
	)
		.bind(id)
		.all<{
			id: string;
			name: string;
			length_ft: number | null;
			width_ft: number | null;
			height_ft: number | null;
			notes: string | null;
		}>();

	const lines = await c.env.DB.prepare(
		`SELECT l.*, r.name AS room_name
     FROM estimate_lines l
     LEFT JOIN estimate_rooms r ON r.id = l.room_id
     WHERE l.job_id = ?
     ORDER BY l.sort_order, l.description`,
	)
		.bind(id)
		.all<{
			id: string;
			room_id: string | null;
			room_name: string | null;
			description: string;
			quantity: number;
			unit: string;
			unit_cents: number;
		}>();

	const roomRows =
		rooms.results
			?.map((r) => {
				const dims = [r.length_ft, r.width_ft, r.height_ft]
					.filter((v) => v != null)
					.join(" × ");
				return `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(dims || "—")}</td>
        <td>${escapeHtml(r.notes) || "—"}</td>
        <td>
          <form method="post" action="/jobs/${escapeHtml(id)}/estimate/rooms/${escapeHtml(r.id)}/delete" class="inline"
            onsubmit="return confirm('Delete room? Lines stay unassigned.');">
            <button class="linkish" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
			})
			.join("") || `<tr><td colspan="4" class="muted">No rooms yet.</td></tr>`;

	const lineRows =
		lines.results
			?.map((l) => {
				const total = Math.round(l.quantity * l.unit_cents);
				return `<tr>
        <td>${escapeHtml(l.room_name) || "—"}</td>
        <td>${escapeHtml(l.description)}</td>
        <td>${escapeHtml(l.quantity)} ${escapeHtml(l.unit)}</td>
        <td>${escapeHtml(money(l.unit_cents))}</td>
        <td>${escapeHtml(money(total))}</td>
        <td>
          <form method="post" action="/jobs/${escapeHtml(id)}/estimate/lines/${escapeHtml(l.id)}/delete" class="inline">
            <button class="linkish" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
			})
			.join("") || `<tr><td colspan="6" class="muted">No line items yet.</td></tr>`;

	const roomOptions =
		rooms.results
			?.map(
				(r) =>
					`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`,
			)
			.join("") || "";

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Estimate</h1>
        <p class="muted" style="margin:0.35rem 0 0">
          <a href="/jobs/${escapeHtml(id)}">${escapeHtml(job.title)}</a>
          · ${escapeHtml(job.customer_name)}
          · Internal (not Xactimate)
        </p>
      </div>
      <a class="btn secondary" href="/jobs/${escapeHtml(id)}/estimate.pdf">Download PDF</a>
      <a class="btn secondary" href="/jobs/${escapeHtml(id)}">Back to job</a>
    </div>

    <div class="panel stack" style="margin:1rem 0">
      <div class="row">
        <div><span class="muted">Claim #</span><br>${escapeHtml(job.claim_number) || "—"}</div>
        <div><span class="muted">Carrier</span><br>${escapeHtml(job.carrier) || "—"}</div>
        <div><span class="muted">Date of loss</span><br>${escapeHtml(job.date_of_loss) || "—"}</div>
        <div><span class="muted">Estimate total</span><br><strong>${escapeHtml(money(job.estimate_cents))}</strong></div>
      </div>
      <p class="muted" style="margin:0">Edit claim fields on the job page. Line totals sync to the job estimate.</p>
    </div>

    <h2>Rooms / areas</h2>
    <table>
      <thead><tr><th>Name</th><th>L × W × H (ft)</th><th>Notes</th><th></th></tr></thead>
      <tbody>${roomRows}</tbody>
    </table>
    <form method="post" action="/jobs/${escapeHtml(id)}/estimate/rooms" class="panel stack" style="margin-top:0.75rem">
      <div class="row">
        <div><label for="name">Room name</label><input id="name" name="name" required placeholder="Kitchen" /></div>
        <div><label for="length_ft">Length (ft)</label><input id="length_ft" name="length_ft" type="number" step="0.01" min="0" /></div>
        <div><label for="width_ft">Width (ft)</label><input id="width_ft" name="width_ft" type="number" step="0.01" min="0" /></div>
        <div><label for="height_ft">Height (ft)</label><input id="height_ft" name="height_ft" type="number" step="0.01" min="0" /></div>
      </div>
      <div><label for="notes">Notes</label><input id="notes" name="notes" /></div>
      <button class="btn" type="submit">Add room</button>
    </form>

    <h2>Line items</h2>
    <table>
      <thead><tr><th>Room</th><th>Description</th><th>Qty</th><th>Unit $</th><th>Total</th><th></th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <form method="post" action="/jobs/${escapeHtml(id)}/estimate/lines" class="panel stack" style="margin-top:0.75rem">
      <div class="row">
        <div>
          <label for="room_id">Room</label>
          <select id="room_id" name="room_id">
            <option value="">None</option>
            ${roomOptions}
          </select>
        </div>
        <div><label for="description">Description</label><input id="description" name="description" required placeholder="Water extraction" /></div>
      </div>
      <div class="row">
        <div><label for="quantity">Quantity</label><input id="quantity" name="quantity" type="number" step="0.01" min="0" value="1" required /></div>
        <div><label for="unit">Unit</label><input id="unit" name="unit" value="ea" required /></div>
        <div><label for="unit_dollars">Unit price ($)</label><input id="unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" value="0" required /></div>
      </div>
      <button class="btn" type="submit">Add line</button>
    </form>`;

	return c.html(page(c, `Estimate · ${job.title}`, body));
});

app.post("/jobs/:id/estimate/rooms", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const num = (key: string) => {
		const raw = String(form[key] || "").trim();
		if (!raw) return null;
		const n = parseFloat(raw);
		return Number.isFinite(n) ? n : null;
	};
	const count = await c.env.DB.prepare(
		`SELECT COUNT(*) AS c FROM estimate_rooms WHERE job_id = ?`,
	)
		.bind(id)
		.first<{ c: number }>();
	await c.env.DB.prepare(
		`INSERT INTO estimate_rooms (id, job_id, name, length_ft, width_ft, height_ft, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("erm"),
			id,
			String(form.name || "").trim(),
			num("length_ft"),
			num("width_ft"),
			num("height_ft"),
			String(form.notes || "").trim() || null,
			count?.c ?? 0,
		)
		.run();
	return c.redirect(`/jobs/${id}/estimate`);
});

app.post("/jobs/:id/estimate/rooms/:roomId/delete", async (c) => {
	const id = c.req.param("id");
	const roomId = c.req.param("roomId");
	await c.env.DB.prepare(
		`UPDATE estimate_lines SET room_id = NULL WHERE room_id = ? AND job_id = ?`,
	)
		.bind(roomId, id)
		.run();
	await c.env.DB.prepare(
		`DELETE FROM estimate_rooms WHERE id = ? AND job_id = ?`,
	)
		.bind(roomId, id)
		.run();
	return c.redirect(`/jobs/${id}/estimate`);
});

app.post("/jobs/:id/estimate/lines", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const quantity = parseFloat(String(form.quantity || "1"));
	const unitDollars = parseFloat(String(form.unit_dollars || "0"));
	const count = await c.env.DB.prepare(
		`SELECT COUNT(*) AS c FROM estimate_lines WHERE job_id = ?`,
	)
		.bind(id)
		.first<{ c: number }>();
	await c.env.DB.prepare(
		`INSERT INTO estimate_lines (id, job_id, room_id, description, quantity, unit, unit_cents, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("eln"),
			id,
			String(form.room_id || "").trim() || null,
			String(form.description || "").trim(),
			Number.isFinite(quantity) ? quantity : 1,
			String(form.unit || "ea").trim() || "ea",
			Number.isFinite(unitDollars) ? Math.round(unitDollars * 100) : 0,
			count?.c ?? 0,
		)
		.run();
	await syncJobEstimateTotal(c.env.DB, id);
	return c.redirect(`/jobs/${id}/estimate`);
});

app.post("/jobs/:id/estimate/lines/:lineId/delete", async (c) => {
	const id = c.req.param("id");
	const lineId = c.req.param("lineId");
	await c.env.DB.prepare(
		`DELETE FROM estimate_lines WHERE id = ? AND job_id = ?`,
	)
		.bind(lineId, id)
		.run();
	await syncJobEstimateTotal(c.env.DB, id);
	return c.redirect(`/jobs/${id}/estimate`);
});

app.get("/jobs/:id/estimate.pdf", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.*, c.name AS customer_name,
      s.address_line1, s.city, s.state, s.postal_code
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     WHERE j.id = ?`,
	)
		.bind(id)
		.first<{
			title: string;
			customer_name: string;
			claim_number: string | null;
			carrier: string | null;
			date_of_loss: string | null;
			estimate_cents: number | null;
			address_line1: string | null;
			city: string | null;
			state: string | null;
			postal_code: string | null;
		}>();
	if (!job) return c.notFound();

	const rooms = await c.env.DB.prepare(
		`SELECT name, length_ft, width_ft, height_ft FROM estimate_rooms
     WHERE job_id = ? ORDER BY sort_order, name`,
	)
		.bind(id)
		.all<{
			name: string;
			length_ft: number | null;
			width_ft: number | null;
			height_ft: number | null;
		}>();

	const lines = await c.env.DB.prepare(
		`SELECT l.description, l.quantity, l.unit, l.unit_cents, r.name AS room_name
     FROM estimate_lines l
     LEFT JOIN estimate_rooms r ON r.id = l.room_id
     WHERE l.job_id = ?
     ORDER BY l.sort_order, l.description`,
	)
		.bind(id)
		.all<{
			description: string;
			quantity: number;
			unit: string;
			unit_cents: number;
			room_name: string | null;
		}>();

	const total =
		job.estimate_cents ??
		Math.round(
			(lines.results || []).reduce(
				(sum, l) => sum + l.quantity * l.unit_cents,
				0,
			),
		);

	const siteLine = job.address_line1
		? `${job.address_line1}, ${job.city}, ${job.state} ${job.postal_code || ""}`.trim()
		: "";

	const bytes = await buildEstimatePdf({
		jobTitle: job.title,
		customerName: job.customer_name,
		siteLine,
		claimNumber: job.claim_number,
		carrier: job.carrier,
		dateOfLoss: job.date_of_loss,
		rooms: rooms.results || [],
		lines: (lines.results || []).map((l) => ({
			roomName: l.room_name,
			description: l.description,
			quantity: l.quantity,
			unit: l.unit,
			unit_cents: l.unit_cents,
		})),
		totalCents: total,
	});

	return new Response(bytes, {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="estimate-${id}.pdf"`,
		},
	});
});

app.post("/jobs/:id/checklist/:itemId", async (c) => {
	const id = c.req.param("id");
	const itemId = c.req.param("itemId");
	const form = await c.req.parseBody();
	const done = String(form.done || "0") === "1" ? 1 : 0;
	await c.env.DB.prepare(
		`UPDATE job_checklist_items SET done = ? WHERE id = ? AND job_id = ?`,
	)
		.bind(done, itemId, id)
		.run();
	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/notes", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const body = String(form.body || "").trim();
	if (!body) return c.redirect(`/jobs/${id}`);
	await c.env.DB.prepare(
		`INSERT INTO job_notes (id, job_id, user_id, body) VALUES (?, ?, ?, ?)`,
	)
		.bind(newId("note"), id, c.get("user").id, body)
		.run();
	return c.redirect(`/jobs/${id}`);
});

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

app.post("/jobs/:id/photos", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(`SELECT id FROM jobs WHERE id = ?`)
		.bind(id)
		.first();
	if (!job) return c.notFound();

	const form = await c.req.parseBody();
	const file = form.photo;
	if (!file || !(file instanceof File)) {
		return c.text("Photo file required", 400);
	}
	if (!file.type.startsWith("image/")) {
		return c.text("Only image uploads are allowed", 400);
	}
	if (file.size > MAX_PHOTO_BYTES) {
		return c.text("Image must be 10 MB or smaller", 400);
	}

	const photoId = newId("pho");
	const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "photo.jpg";
	const r2Key = `jobs/${id}/${photoId}/${safeName}`;
	const bytes = new Uint8Array(await file.arrayBuffer());
	await c.env.UPLOADS.put(r2Key, bytes, {
		httpMetadata: { contentType: file.type },
		customMetadata: { jobId: id, photoId, filename: safeName },
	});
	await c.env.DB.prepare(
		`INSERT INTO job_photos (id, job_id, r2_key, filename, content_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			photoId,
			id,
			r2Key,
			safeName,
			file.type || null,
			file.size,
			c.get("user").id,
		)
		.run();
	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.get("/jobs/:id/photos/:photoId", async (c) => {
	const id = c.req.param("id");
	const photoId = c.req.param("photoId");
	const row = await c.env.DB.prepare(
		`SELECT r2_key, content_type, filename FROM job_photos WHERE id = ? AND job_id = ?`,
	)
		.bind(photoId, id)
		.first<{ r2_key: string; content_type: string | null; filename: string }>();
	if (!row) return c.notFound();
	const obj = await c.env.UPLOADS.get(row.r2_key);
	if (!obj) return c.notFound();
	const headers = new Headers();
	headers.set(
		"Content-Type",
		row.content_type || obj.httpMetadata?.contentType || "application/octet-stream",
	);
	headers.set("Cache-Control", "private, max-age=3600");
	headers.set(
		"Content-Disposition",
		`inline; filename="${row.filename.replace(/"/g, "")}"`,
	);
	return new Response(obj.body, { headers });
});

app.post("/jobs/:id/photos/:photoId/delete", async (c) => {
	const id = c.req.param("id");
	const photoId = c.req.param("photoId");
	const row = await c.env.DB.prepare(
		`SELECT r2_key FROM job_photos WHERE id = ? AND job_id = ?`,
	)
		.bind(photoId, id)
		.first<{ r2_key: string }>();
	if (!row) return c.notFound();
	await c.env.UPLOADS.delete(row.r2_key);
	await c.env.DB.prepare(
		`DELETE FROM job_photos WHERE id = ? AND job_id = ?`,
	)
		.bind(photoId, id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.get("/recurring", async (c) => {
	const list = await c.env.DB.prepare(
		`SELECT r.*, c.name AS customer_name, u.name AS assignee_name
     FROM recurring_jobs r
     JOIN customers c ON c.id = r.customer_id
     LEFT JOIN users u ON u.id = r.assigned_user_id
     ORDER BY r.active DESC, r.next_run_at ASC`,
	).all<{
		id: string;
		title: string;
		job_type: string;
		interval_days: number;
		next_run_at: string;
		active: number;
		customer_name: string;
		assignee_name: string | null;
	}>();

	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const staff = await c.env.DB.prepare(
		`SELECT id, name FROM users ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();

	const rows =
		list.results
			?.map(
				(r) => `<tr>
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.customer_name)}</td>
        <td>${escapeHtml(jobTypeLabel(r.job_type))}</td>
        <td>Every ${r.interval_days} days</td>
        <td>${escapeHtml(r.next_run_at.slice(0, 10))}</td>
        <td>${escapeHtml(r.assignee_name) || "—"}</td>
        <td>${r.active ? "Active" : "Paused"}</td>
        <td>
          <form method="post" action="/recurring/${escapeHtml(r.id)}/toggle" class="inline">
            <button class="linkish" type="submit">${r.active ? "Pause" : "Resume"}</button>
          </form>
        </td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="8" class="muted">No recurring templates yet.</td></tr>`;

	const customerOptions =
		customers.results
			?.map(
				(cu) =>
					`<option value="${escapeHtml(cu.id)}">${escapeHtml(cu.name)}</option>`,
			)
			.join("") || "";
	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`,
			)
			.join("") || "";

	const today = new Date().toISOString().slice(0, 10);

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">Recurring</h1></div>
      <form method="post" action="/recurring/generate" class="inline">
        <button class="btn secondary" type="submit">Generate due jobs</button>
      </form>
    </div>
    <p class="muted">Hard-floor (and other) contracts. “Generate due jobs” creates scheduled jobs for templates whose next date is today or earlier.</p>
    <table>
      <thead><tr><th>Title</th><th>Customer</th><th>Type</th><th>Cadence</th><th>Next</th><th>Tech</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>New recurring job</h2>
    <form method="post" action="/recurring" class="panel stack">
      <div>
        <label for="customer_id">Customer</label>
        <select id="customer_id" name="customer_id" required>
          <option value="">Select…</option>
          ${customerOptions}
        </select>
      </div>
      <div><label for="title">Title</label><input id="title" name="title" required placeholder="Monthly hard floor clean" /></div>
      <div class="row">
        <div>
          <label for="job_type">Type</label>
          <select id="job_type" name="job_type">
            <option value="hard_floor" selected>Hard floor cleaning</option>
            <option value="restoration">Water restoration</option>
          </select>
        </div>
        <div>
          <label for="interval_days">Every N days</label>
          <input id="interval_days" name="interval_days" type="number" min="1" value="30" required />
        </div>
        <div>
          <label for="next_run_at">Next run date</label>
          <input id="next_run_at" name="next_run_at" type="date" value="${escapeHtml(today)}" required />
        </div>
      </div>
      <div class="row">
        <div>
          <label for="assigned_user_id">Assigned to</label>
          <select id="assigned_user_id" name="assigned_user_id">
            <option value="">Unassigned</option>
            ${staffOptions}
          </select>
        </div>
        <div>
          <label for="estimate_dollars">Estimate ($)</label>
          <input id="estimate_dollars" name="estimate_dollars" type="number" step="0.01" min="0" />
        </div>
      </div>
      <div><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea></div>
      <button class="btn" type="submit">Save recurring</button>
    </form>`;

	return c.html(page(c, "Recurring", body));
});

app.post("/recurring", async (c) => {
	const form = await c.req.parseBody();
	const customerId = String(form.customer_id || "");
	const jobType = String(form.job_type || "hard_floor") as
		| "restoration"
		| "hard_floor";
	if (jobType !== "restoration" && jobType !== "hard_floor") {
		return c.text("Invalid job type", 400);
	}
	const intervalDays = Number(form.interval_days || 0);
	if (!customerId || !Number.isFinite(intervalDays) || intervalDays < 1) {
		return c.text("Customer and interval required", 400);
	}
	const site = await c.env.DB.prepare(
		`SELECT id FROM sites WHERE customer_id = ? ORDER BY created_at LIMIT 1`,
	)
		.bind(customerId)
		.first<{ id: string }>();
	const estimateRaw = String(form.estimate_dollars || "").trim();
	await c.env.DB.prepare(
		`INSERT INTO recurring_jobs (
      id, customer_id, site_id, title, job_type, interval_days, next_run_at,
      assigned_user_id, estimate_cents, notes, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
	)
		.bind(
			newId("rec"),
			customerId,
			site?.id ?? null,
			String(form.title || "").trim(),
			jobType,
			intervalDays,
			String(form.next_run_at || "").slice(0, 10),
			String(form.assigned_user_id || "").trim() || null,
			estimateRaw ? Math.round(parseFloat(estimateRaw) * 100) : null,
			String(form.notes || "").trim() || null,
		)
		.run();
	return c.redirect("/recurring");
});

app.post("/recurring/generate", async (c) => {
	const created = await generateDueRecurringJobs(c.env.DB);
	return c.html(
		page(
			c,
			"Recurring",
			`<h1>Generated</h1><p>Created ${created} job(s) from due templates.</p>
       <p><a class="btn" href="/recurring">Back</a> <a class="btn secondary" href="/jobs?status=scheduled">View scheduled</a></p>`,
		),
	);
});

app.post("/recurring/:id/toggle", async (c) => {
	const id = c.req.param("id");
	await c.env.DB.prepare(
		`UPDATE recurring_jobs SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect("/recurring");
});

app.get("/print", async (c) => {
	const status = c.req.query("status") || "";
	const list = status
		? await c.env.DB.prepare(
				`SELECT p.*, c.name AS customer_name
         FROM print_jobs p
         LEFT JOIN customers c ON c.id = p.customer_id
         WHERE p.status = ?
         ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
         LIMIT 100`,
			)
				.bind(status)
				.all()
		: await c.env.DB.prepare(
				`SELECT p.*, c.name AS customer_name
         FROM print_jobs p
         LEFT JOIN customers c ON c.id = p.customer_id
         WHERE p.status != 'cancelled'
         ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
         LIMIT 100`,
			).all();

	const rows =
		(
			list.results as Array<{
				id: string;
				title: string;
				product_type: string;
				status: string;
				quantity: number | null;
				due_date: string | null;
				customer_name: string | null;
			}>
		)
			?.map(
				(p) => `<tr>
        <td><a href="/print/${escapeHtml(p.id)}">${escapeHtml(p.title)}</a></td>
        <td>${escapeHtml(p.customer_name) || "—"}</td>
        <td>${escapeHtml(printProductLabel(p.product_type))}</td>
        <td>${p.quantity ?? "—"}</td>
        <td><span class="badge ${escapeHtml(p.status)}">${escapeHtml(printStatusLabel(p.status))}</span></td>
        <td>${escapeHtml(p.due_date) || "—"}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="6" class="muted">No print jobs yet.</td></tr>`;

	const filters = ["", ...PRINT_STATUSES.map((s) => s.value)]
		.map((s) => {
			const href = s ? `/print?status=${s}` : "/print";
			const active = status === s ? "btn" : "btn secondary";
			const label = s ? printStatusLabel(s) : "All open";
			return `<a class="${active}" href="${href}">${escapeHtml(label)}</a>`;
		})
		.join(" ");

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Print Ops</h1>
        <p class="muted" style="margin:0.35rem 0 0">Proof → production → pickup/delivery. Separate from Field Ops.</p>
      </div>
      <a class="btn secondary" href="/print/board">Press board</a>
      <a class="btn" href="/print/new">New print job</a>
    </div>
    <div class="toolbar">${filters}</div>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Product</th><th>Qty</th><th>Status</th><th>Due</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

	return c.html(page(c, "Print Ops", body));
});

app.get("/print/board", async (c) => {
	const list = await c.env.DB.prepare(
		`SELECT p.id, p.title, p.product_type, p.status, p.quantity, p.due_date, p.revise_count,
      c.name AS customer_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.status IN ('intake','proof','approved','in_production','ready')
     ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
     LIMIT 200`,
	).all<{
		id: string;
		title: string;
		product_type: string;
		status: string;
		quantity: number | null;
		due_date: string | null;
		revise_count: number;
		customer_name: string | null;
	}>();

	const byStatus = new Map<string, typeof list.results>();
	for (const col of PRINT_BOARD_COLUMNS) byStatus.set(col, []);
	for (const job of list.results || []) {
		const bucket = byStatus.get(job.status);
		if (bucket) bucket.push(job);
	}

	const columns = PRINT_BOARD_COLUMNS.map((col) => {
		const cards = (byStatus.get(col) || [])
			.map(
				(j) => `<a class="panel stack" href="/print/${escapeHtml(j.id)}"
          style="color:inherit;text-decoration:none;padding:0.75rem;margin-bottom:0.5rem;display:block">
          <strong>${escapeHtml(j.title)}</strong>
          <div class="muted" style="font-size:0.85rem">${escapeHtml(j.customer_name) || "Walk-in"} · ${escapeHtml(printProductLabel(j.product_type))}</div>
          <div class="muted" style="font-size:0.85rem">Qty ${j.quantity ?? "—"} · Due ${escapeHtml(j.due_date) || "—"}</div>
          ${j.revise_count > 0 ? `<div class="muted" style="font-size:0.8rem">Revises: ${j.revise_count}</div>` : ""}
        </a>`,
			)
			.join("") || `<p class="muted" style="font-size:0.85rem">Empty</p>`;
		return `<div class="panel" style="min-width:180px;flex:1">
      <h2 style="margin:0 0 0.75rem;font-size:0.95rem">${escapeHtml(printStatusLabel(col))}</h2>
      ${cards}
    </div>`;
	}).join("");

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Press board</h1>
        <p class="muted" style="margin:0.35rem 0 0">Production queue by status.</p>
      </div>
      <a class="btn secondary" href="/print">List view</a>
      <a class="btn" href="/print/new">New print job</a>
    </div>
    <div style="display:flex;gap:0.75rem;overflow-x:auto;align-items:flex-start;margin-top:1rem">${columns}</div>`;

	return c.html(page(c, "Press board", body));
});

app.get("/print/new", async (c) => {
	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const staff = await c.env.DB.prepare(
		`SELECT id, name FROM users ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();

	const customerOptions =
		customers.results
			?.map(
				(cu) =>
					`<option value="${escapeHtml(cu.id)}">${escapeHtml(cu.name)}</option>`,
			)
			.join("") || "";
	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`,
			)
			.join("") || "";
	const productOptions = PRINT_PRODUCT_TYPES.map(
		(p) =>
			`<option value="${p.value}">${escapeHtml(p.label)}</option>`,
	).join("");

	const body = `
    <h1>New print job</h1>
    <form method="post" action="/print" class="panel stack">
      <div>
        <label for="customer_id">Customer (optional)</label>
        <select id="customer_id" name="customer_id">
          <option value="">Walk-in / TBD</option>
          ${customerOptions}
        </select>
      </div>
      <div><label for="title">Title</label><input id="title" name="title" required placeholder="Spring postcard drop" /></div>
      <div class="row">
        <div>
          <label for="product_type">Product</label>
          <select id="product_type" name="product_type" required>${productOptions}</select>
        </div>
        <div><label for="quantity">Quantity</label><input id="quantity" name="quantity" type="number" min="1" /></div>
        <div><label for="due_date">Due date</label><input id="due_date" name="due_date" type="date" /></div>
      </div>
      <div class="row">
        <div>
          <label for="assigned_user_id">Assigned to</label>
          <select id="assigned_user_id" name="assigned_user_id">
            <option value="">Unassigned</option>
            ${staffOptions}
          </select>
        </div>
        <div>
          <label for="delivery_method">Pickup / delivery</label>
          <select id="delivery_method" name="delivery_method">
            <option value="">TBD</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
      </div>
      <div><label for="specs">Specs</label><textarea id="specs" name="specs" placeholder="Size, stock, color, finish, fold…"></textarea></div>
      <div><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea></div>
      <button class="btn" type="submit">Create print job</button>
    </form>`;

	return c.html(page(c, "New print job", body));
});

app.post("/print", async (c) => {
	const form = await c.req.parseBody();
	const productType = String(form.product_type || "");
	if (!PRINT_PRODUCT_TYPES.some((p) => p.value === productType)) {
		return c.text("Invalid product type", 400);
	}
	const deliveryMethod = String(form.delivery_method || "").trim();
	if (deliveryMethod && deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
		return c.text("Invalid delivery method", 400);
	}
	const qtyRaw = String(form.quantity || "").trim();
	const id = newId("prj");
	await c.env.DB.prepare(
		`INSERT INTO print_jobs (
      id, customer_id, title, product_type, status, quantity, specs, due_date,
      notes, assigned_user_id, delivery_method
    ) VALUES (?, ?, ?, ?, 'intake', ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			String(form.customer_id || "").trim() || null,
			String(form.title || "").trim(),
			productType,
			qtyRaw ? Number(qtyRaw) : null,
			String(form.specs || "").trim() || null,
			String(form.due_date || "").trim() || null,
			String(form.notes || "").trim() || null,
			String(form.assigned_user_id || "").trim() || null,
			deliveryMethod || null,
		)
		.run();
	return c.redirect(`/print/${id}`);
});

app.get("/print/:id", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT p.*, c.name AS customer_name, u.name AS assignee_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN users u ON u.id = p.assigned_user_id
     WHERE p.id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			title: string;
			product_type: string;
			status: string;
			quantity: number | null;
			specs: string | null;
			due_date: string | null;
			estimate_cents: number | null;
			notes: string | null;
			proof_notes: string | null;
			delivery_method: string | null;
			delivery_notes: string | null;
			revise_count: number;
			customer_id: string | null;
			customer_name: string | null;
			assigned_user_id: string | null;
			assignee_name: string | null;
		}>();
	if (!job) return c.notFound();

	const staff = await c.env.DB.prepare(
		`SELECT id, name FROM users ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const files = await c.env.DB.prepare(
		`SELECT id, kind, filename, created_at FROM print_files
     WHERE print_job_id = ? ORDER BY created_at DESC`,
	)
		.bind(id)
		.all<{ id: string; kind: string; filename: string; created_at: string }>();
	const lines = await c.env.DB.prepare(
		`SELECT * FROM print_quote_lines WHERE print_job_id = ? ORDER BY sort_order, description`,
	)
		.bind(id)
		.all<{
			id: string;
			description: string;
			quantity: number;
			unit: string;
			unit_cents: number;
		}>();

	const statusOptions = PRINT_STATUSES.map(
		(s) =>
			`<option value="${s.value}" ${job.status === s.value ? "selected" : ""}>${escapeHtml(s.label)}</option>`,
	).join("");
	const productOptions = PRINT_PRODUCT_TYPES.map(
		(p) =>
			`<option value="${p.value}" ${job.product_type === p.value ? "selected" : ""}>${escapeHtml(p.label)}</option>`,
	).join("");
	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${job.assigned_user_id === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`,
			)
			.join("") || "";
	const customerOptions =
		customers.results
			?.map(
				(cu) =>
					`<option value="${escapeHtml(cu.id)}" ${job.customer_id === cu.id ? "selected" : ""}>${escapeHtml(cu.name)}</option>`,
			)
			.join("") || "";
	const kindOptions = PRINT_FILE_KINDS.map(
		(k) => `<option value="${k.value}">${escapeHtml(k.label)}</option>`,
	).join("");

	const fileItems =
		files.results
			?.map(
				(f) => `<li style="display:flex;gap:0.75rem;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--line)">
        <span class="badge">${escapeHtml(f.kind)}</span>
        <a href="/print/${escapeHtml(id)}/files/${escapeHtml(f.id)}" target="_blank" rel="noopener">${escapeHtml(f.filename)}</a>
        <form method="post" action="/print/${escapeHtml(id)}/files/${escapeHtml(f.id)}/delete" class="inline"
          onsubmit="return confirm('Delete this file?');">
          <button class="linkish" type="submit">Delete</button>
        </form>
      </li>`,
			)
			.join("") || `<li class="muted">No files yet.</li>`;

	const lineRows =
		lines.results
			?.map((l) => {
				const total = Math.round(l.quantity * l.unit_cents);
				return `<tr>
        <td>${escapeHtml(l.description)}</td>
        <td>${escapeHtml(l.quantity)} ${escapeHtml(l.unit)}</td>
        <td>${escapeHtml(money(l.unit_cents))}</td>
        <td>${escapeHtml(money(total))}</td>
        <td>
          <form method="post" action="/print/${escapeHtml(id)}/quote/${escapeHtml(l.id)}/delete" class="inline">
            <button class="linkish" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
			})
			.join("") || `<tr><td colspan="5" class="muted">No quote lines yet.</td></tr>`;

	const proofActions = `
    <div class="toolbar" style="flex-wrap:wrap">
      <form method="post" action="/print/${escapeHtml(id)}/workflow" class="inline">
        <input type="hidden" name="action" value="send_proof" />
        <button class="btn secondary" type="submit">Send to proof</button>
      </form>
      <form method="post" action="/print/${escapeHtml(id)}/workflow" class="inline">
        <input type="hidden" name="action" value="request_revise" />
        <button class="btn secondary" type="submit">Request revise</button>
      </form>
      <form method="post" action="/print/${escapeHtml(id)}/workflow" class="inline">
        <input type="hidden" name="action" value="approve" />
        <button class="btn secondary" type="submit">Approve proof</button>
      </form>
      <form method="post" action="/print/${escapeHtml(id)}/workflow" class="inline">
        <input type="hidden" name="action" value="start_production" />
        <button class="btn secondary" type="submit">Start production</button>
      </form>
      <form method="post" action="/print/${escapeHtml(id)}/workflow" class="inline">
        <input type="hidden" name="action" value="mark_ready" />
        <button class="btn secondary" type="submit">Mark ready</button>
      </form>
      <form method="post" action="/print/${escapeHtml(id)}/workflow" class="inline">
        <input type="hidden" name="action" value="mark_delivered" />
        <button class="btn" type="submit">Mark delivered / picked up</button>
      </form>
    </div>`;

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">${escapeHtml(job.title)}</h1>
        <p class="muted" style="margin:0.35rem 0 0">
          Print Ops · ${escapeHtml(printProductLabel(job.product_type))}
          · <span class="badge ${escapeHtml(job.status)}">${escapeHtml(printStatusLabel(job.status))}</span>
          ${job.revise_count > 0 ? ` · Revises: ${job.revise_count}` : ""}
        </p>
      </div>
      <a class="btn secondary" href="/print/board">Press board</a>
      <a class="btn secondary" href="/print">All print jobs</a>
    </div>

    <h2>Proof &amp; production</h2>
    ${proofActions}

    <div class="row" style="margin-top:1rem">
      <div class="panel stack">
        <div><span class="muted">Customer</span><br>${escapeHtml(job.customer_name) || "—"}</div>
        <div><span class="muted">Assigned</span><br>${escapeHtml(job.assignee_name) || "Unassigned"}</div>
        <div><span class="muted">Quantity</span><br>${job.quantity ?? "—"}</div>
        <div><span class="muted">Due</span><br>${escapeHtml(job.due_date) || "—"}</div>
        <div><span class="muted">Quote total</span><br>${escapeHtml(money(job.estimate_cents))}</div>
        <div><span class="muted">Pickup / delivery</span><br>${escapeHtml(job.delivery_method) || "TBD"}</div>
        ${job.specs ? `<div><span class="muted">Specs</span><br>${escapeHtml(job.specs)}</div>` : ""}
        ${job.proof_notes ? `<div><span class="muted">Proof notes</span><br>${escapeHtml(job.proof_notes)}</div>` : ""}
        ${job.delivery_notes ? `<div><span class="muted">Delivery notes</span><br>${escapeHtml(job.delivery_notes)}</div>` : ""}
        ${job.notes ? `<div><span class="muted">Notes</span><br>${escapeHtml(job.notes)}</div>` : ""}
      </div>
      <div class="panel stack">
        <h2 style="margin:0">Update</h2>
        <form method="post" action="/print/${escapeHtml(id)}" class="stack">
          <div><label for="title">Title</label><input id="title" name="title" required value="${escapeHtml(job.title)}" /></div>
          <div class="row">
            <div>
              <label for="product_type">Product</label>
              <select id="product_type" name="product_type">${productOptions}</select>
            </div>
            <div>
              <label for="status">Status</label>
              <select id="status" name="status">${statusOptions}</select>
            </div>
          </div>
          <div>
            <label for="customer_id">Customer</label>
            <select id="customer_id" name="customer_id">
              <option value="">Walk-in / TBD</option>
              ${customerOptions}
            </select>
          </div>
          <div>
            <label for="assigned_user_id">Assigned to</label>
            <select id="assigned_user_id" name="assigned_user_id">
              <option value="">Unassigned</option>
              ${staffOptions}
            </select>
          </div>
          <div class="row">
            <div><label for="quantity">Quantity</label>
              <input id="quantity" name="quantity" type="number" min="1" value="${job.quantity ?? ""}" /></div>
            <div><label for="due_date">Due date</label>
              <input id="due_date" name="due_date" type="date" value="${escapeHtml(job.due_date)}" /></div>
            <div>
              <label for="delivery_method">Pickup / delivery</label>
              <select id="delivery_method" name="delivery_method">
                <option value="" ${!job.delivery_method ? "selected" : ""}>TBD</option>
                <option value="pickup" ${job.delivery_method === "pickup" ? "selected" : ""}>Pickup</option>
                <option value="delivery" ${job.delivery_method === "delivery" ? "selected" : ""}>Delivery</option>
              </select>
            </div>
          </div>
          <div><label for="specs">Specs</label><textarea id="specs" name="specs">${escapeHtml(job.specs)}</textarea></div>
          <div><label for="proof_notes">Proof notes</label><textarea id="proof_notes" name="proof_notes" placeholder="Client feedback, revise instructions…">${escapeHtml(job.proof_notes)}</textarea></div>
          <div><label for="delivery_notes">Delivery / pickup notes</label><textarea id="delivery_notes" name="delivery_notes" placeholder="Address, contact, dock hours…">${escapeHtml(job.delivery_notes)}</textarea></div>
          <div><label for="notes">Internal notes</label><textarea id="notes" name="notes">${escapeHtml(job.notes)}</textarea></div>
          <button class="btn" type="submit">Save</button>
        </form>
      </div>
    </div>

    <h2>Files</h2>
    <form method="post" action="/print/${escapeHtml(id)}/files" enctype="multipart/form-data" class="panel stack" style="margin-bottom:0.75rem">
      <div class="row">
        <div>
          <label for="kind">Kind</label>
          <select id="kind" name="kind">${kindOptions}</select>
        </div>
        <div>
          <label for="file">File (max 25 MB)</label>
          <input id="file" name="file" type="file" required />
        </div>
      </div>
      <button class="btn" type="submit">Upload</button>
    </form>
    <ul class="checklist">${fileItems}</ul>

    <h2>Quote lines</h2>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit $</th><th>Total</th><th></th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <form method="post" action="/print/${escapeHtml(id)}/quote" class="panel stack" style="margin-top:0.75rem">
      <div class="row">
        <div><label for="description">Description</label><input id="description" name="description" required placeholder="4/4 100# cover, 5.5x8.5" /></div>
        <div><label for="quantity">Qty</label><input id="quantity" name="quantity" type="number" step="0.01" min="0" value="1" required /></div>
        <div><label for="unit">Unit</label><input id="unit" name="unit" value="ea" required /></div>
        <div><label for="unit_dollars">Unit price ($)</label><input id="unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" value="0" required /></div>
      </div>
      <button class="btn" type="submit">Add line</button>
    </form>`;

	return c.html(page(c, job.title, body));
});

app.post("/print/:id", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const productType = String(form.product_type || "");
	const status = String(form.status || "");
	const deliveryMethod = String(form.delivery_method || "").trim();
	if (!PRINT_PRODUCT_TYPES.some((p) => p.value === productType)) {
		return c.text("Invalid product type", 400);
	}
	if (!PRINT_STATUSES.some((s) => s.value === status)) {
		return c.text("Invalid status", 400);
	}
	if (deliveryMethod && deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
		return c.text("Invalid delivery method", 400);
	}
	const qtyRaw = String(form.quantity || "").trim();
	await c.env.DB.prepare(
		`UPDATE print_jobs SET
      customer_id = ?, title = ?, product_type = ?, status = ?, quantity = ?,
      specs = ?, due_date = ?, notes = ?, assigned_user_id = ?,
      proof_notes = ?, delivery_method = ?, delivery_notes = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
	)
		.bind(
			String(form.customer_id || "").trim() || null,
			String(form.title || "").trim(),
			productType,
			status,
			qtyRaw ? Number(qtyRaw) : null,
			String(form.specs || "").trim() || null,
			String(form.due_date || "").trim() || null,
			String(form.notes || "").trim() || null,
			String(form.assigned_user_id || "").trim() || null,
			String(form.proof_notes || "").trim() || null,
			deliveryMethod || null,
			String(form.delivery_notes || "").trim() || null,
			id,
		)
		.run();
	return c.redirect(`/print/${id}`);
});

app.post("/print/:id/workflow", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const action = String(form.action || "");
	const job = await c.env.DB.prepare(
		`SELECT status, revise_count FROM print_jobs WHERE id = ?`,
	)
		.bind(id)
		.first<{ status: string; revise_count: number }>();
	if (!job) return c.notFound();

	let status = job.status;
	let reviseCount = job.revise_count;
	switch (action) {
		case "send_proof":
			status = "proof";
			break;
		case "request_revise":
			status = "proof";
			reviseCount = (job.revise_count || 0) + 1;
			break;
		case "approve":
			status = "approved";
			break;
		case "start_production":
			status = "in_production";
			break;
		case "mark_ready":
			status = "ready";
			break;
		case "mark_delivered":
			status = "delivered";
			break;
		default:
			return c.text("Unknown action", 400);
	}

	await c.env.DB.prepare(
		`UPDATE print_jobs SET status = ?, revise_count = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(status, reviseCount, id)
		.run();
	return c.redirect(`/print/${id}`);
});

const MAX_PRINT_FILE_BYTES = 25 * 1024 * 1024;

app.post("/print/:id/files", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(`SELECT id FROM print_jobs WHERE id = ?`)
		.bind(id)
		.first();
	if (!job) return c.notFound();

	const form = await c.req.parseBody();
	const kind = String(form.kind || "artwork");
	if (!PRINT_FILE_KINDS.some((k) => k.value === kind)) {
		return c.text("Invalid file kind", 400);
	}
	const file = form.file;
	if (!file || !(file instanceof File)) {
		return c.text("File required", 400);
	}
	if (file.size > MAX_PRINT_FILE_BYTES) {
		return c.text("File must be 25 MB or smaller", 400);
	}

	const fileId = newId("pfl");
	const safeName =
		file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "upload.bin";
	const r2Key = `print/${id}/${fileId}/${safeName}`;
	const bytes = new Uint8Array(await file.arrayBuffer());
	await c.env.UPLOADS.put(r2Key, bytes, {
		httpMetadata: { contentType: file.type || "application/octet-stream" },
		customMetadata: { printJobId: id, fileId, filename: safeName, kind },
	});
	await c.env.DB.prepare(
		`INSERT INTO print_files (id, print_job_id, kind, r2_key, filename, content_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			fileId,
			id,
			kind,
			r2Key,
			safeName,
			file.type || null,
			file.size,
			c.get("user").id,
		)
		.run();
	await c.env.DB.prepare(
		`UPDATE print_jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/print/${id}`);
});

app.get("/print/:id/files/:fileId", async (c) => {
	const id = c.req.param("id");
	const fileId = c.req.param("fileId");
	const row = await c.env.DB.prepare(
		`SELECT r2_key, content_type, filename FROM print_files WHERE id = ? AND print_job_id = ?`,
	)
		.bind(fileId, id)
		.first<{ r2_key: string; content_type: string | null; filename: string }>();
	if (!row) return c.notFound();
	const obj = await c.env.UPLOADS.get(row.r2_key);
	if (!obj) return c.notFound();
	const headers = new Headers();
	headers.set(
		"Content-Type",
		row.content_type || obj.httpMetadata?.contentType || "application/octet-stream",
	);
	headers.set(
		"Content-Disposition",
		`inline; filename="${row.filename.replace(/"/g, "")}"`,
	);
	return new Response(obj.body, { headers });
});

app.post("/print/:id/files/:fileId/delete", async (c) => {
	const id = c.req.param("id");
	const fileId = c.req.param("fileId");
	const row = await c.env.DB.prepare(
		`SELECT r2_key FROM print_files WHERE id = ? AND print_job_id = ?`,
	)
		.bind(fileId, id)
		.first<{ r2_key: string }>();
	if (!row) return c.notFound();
	await c.env.UPLOADS.delete(row.r2_key);
	await c.env.DB.prepare(
		`DELETE FROM print_files WHERE id = ? AND print_job_id = ?`,
	)
		.bind(fileId, id)
		.run();
	return c.redirect(`/print/${id}`);
});

app.post("/print/:id/quote", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const quantity = parseFloat(String(form.quantity || "1"));
	const unitDollars = parseFloat(String(form.unit_dollars || "0"));
	const count = await c.env.DB.prepare(
		`SELECT COUNT(*) AS c FROM print_quote_lines WHERE print_job_id = ?`,
	)
		.bind(id)
		.first<{ c: number }>();
	await c.env.DB.prepare(
		`INSERT INTO print_quote_lines (id, print_job_id, description, quantity, unit, unit_cents, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("pql"),
			id,
			String(form.description || "").trim(),
			Number.isFinite(quantity) ? quantity : 1,
			String(form.unit || "ea").trim() || "ea",
			Number.isFinite(unitDollars) ? Math.round(unitDollars * 100) : 0,
			count?.c ?? 0,
		)
		.run();
	await syncPrintQuoteTotal(c.env.DB, id);
	return c.redirect(`/print/${id}`);
});

app.post("/print/:id/quote/:lineId/delete", async (c) => {
	const id = c.req.param("id");
	const lineId = c.req.param("lineId");
	await c.env.DB.prepare(
		`DELETE FROM print_quote_lines WHERE id = ? AND print_job_id = ?`,
	)
		.bind(lineId, id)
		.run();
	await syncPrintQuoteTotal(c.env.DB, id);
	return c.redirect(`/print/${id}`);
});

app.get("/tech", async (c) => {
	const user = c.get("user");
	const jobs = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name,
      s.address_line1, s.city
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     WHERE j.assigned_user_id = ?
       AND j.status IN ('scheduled', 'in_progress', 'estimate')
     ORDER BY COALESCE(j.scheduled_start, '9999') ASC
     LIMIT 40`,
	)
		.bind(user.id)
		.all<{
			id: string;
			title: string;
			job_type: string;
			status: string;
			scheduled_start: string | null;
			customer_name: string;
			address_line1: string | null;
			city: string | null;
		}>();

	const cards =
		jobs.results
			?.map((j) => {
				const when = j.scheduled_start
					? j.scheduled_start.slice(0, 16).replace("T", " ")
					: "Unscheduled";
				const where = j.address_line1
					? `${j.address_line1}${j.city ? `, ${j.city}` : ""}`
					: "No address";
				return `<a class="panel stack" href="/jobs/${escapeHtml(j.id)}" style="color:inherit;text-decoration:none">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:start">
          <strong>${escapeHtml(j.title)}</strong>
          <span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span>
        </div>
        <div class="muted">${escapeHtml(j.customer_name)} · ${escapeHtml(jobTypeLabel(j.job_type))}</div>
        <div>${escapeHtml(when)}</div>
        <div class="muted">${escapeHtml(where)}</div>
      </a>`;
			})
			.join("") || `<p class="muted">No jobs assigned to you.</p>`;

	const body = `
    <h1>My jobs</h1>
    <p class="muted">Assigned to ${escapeHtml(user.name)} — tap a card to update checklist and notes.</p>
    <div class="stack" style="margin-top:1rem">${cards}</div>`;

	return c.html(page(c, "Tech", body));
});

app.get("/calendar", async (c) => {
	const jobs = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, j.scheduled_end, c.name AS customer_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id
     WHERE j.scheduled_start IS NOT NULL
       AND j.status NOT IN ('cancelled')
     ORDER BY j.scheduled_start ASC
     LIMIT 60`,
	).all<{
		id: string;
		title: string;
		job_type: string;
		status: string;
		scheduled_start: string;
		scheduled_end: string | null;
		customer_name: string;
	}>();

	const byDay = new Map<string, typeof jobs.results>();
	for (const job of jobs.results || []) {
		const day = job.scheduled_start.slice(0, 10);
		const list = byDay.get(day) || [];
		list.push(job);
		byDay.set(day, list);
	}

	const sections = [...byDay.entries()]
		.map(([day, list]) => {
			const items = list
				.map(
					(j) => `<tr>
          <td>${escapeHtml(j.scheduled_start.slice(11, 16) || "—")}</td>
          <td><a href="/jobs/${escapeHtml(j.id)}">${escapeHtml(j.title)}</a></td>
          <td>${escapeHtml(j.customer_name)}</td>
          <td>${escapeHtml(jobTypeLabel(j.job_type))}</td>
          <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span></td>
        </tr>`,
				)
				.join("");
			return `<h2>${escapeHtml(day)}</h2>
        <table>
          <thead><tr><th>Time</th><th>Job</th><th>Customer</th><th>Type</th><th>Status</th></tr></thead>
          <tbody>${items}</tbody>
        </table>`;
		})
		.join("") || `<p class="muted">No scheduled jobs. Set a start time on a job to see it here.</p>`;

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">Calendar</h1></div>
      <a class="btn" href="/jobs/new">New job</a>
    </div>
    ${sections}`;

	return c.html(page(c, "Calendar", body));
});

app.onError((err, c) => {
	const requestId = crypto.randomUUID().slice(0, 8);
	console.error(`[${requestId}]`, err);
	const user = (() => {
		try {
			return c.get("user");
		} catch {
			return null;
		}
	})();
	return c.html(
		layout({
			title: "Error",
			user,
			body: `<h1>Something went wrong</h1>
        <p class="muted">Request id: <code>${escapeHtml(requestId)}</code></p>
        <p><a class="btn" href="/">Back to dashboard</a></p>`,
		}),
		500,
	);
});

/** Fall through to static assets (CSS, etc.). */
app.notFound(async (c) => {
	if (c.env.ASSETS) {
		const asset = await c.env.ASSETS.fetch(c.req.raw);
		if (asset.status !== 404) return asset;
	}
	return c.html(
		layout({
			title: "Not found",
			user: c.get("user") || null,
			body: `<h1>Not found</h1><p><a href="/">Back to dashboard</a></p>`,
		}),
		404,
	);
});

export default app;
