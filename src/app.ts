import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
	SESSION_COOKIE,
	clearSessionCookie,
	countActiveOwners,
	createSession,
	destroySession,
	destroySessionsForUser,
	ensureSeedUser,
	getSessionUser,
	setSessionCookie,
	type AppUser,
} from "./lib/auth";
import { checklistFor } from "./lib/checklists";
import {
	escapeHtml,
	layout,
	money,
	statusLabel,
} from "./lib/html";
import { newId } from "./lib/ids";
import { hashPassword, verifyPassword } from "./lib/password";
import { generateDueRecurringJobs } from "./lib/recurring";
import {
	approveInvoice,
	buildInvoicePdf,
	canManageInvoices,
	createFieldInvoiceFromEstimate,
	createPrintInvoiceFromQuote,
	getLatestInvoiceForJob,
	getLatestInvoiceForPrintJob,
	listInvoiceLines,
	parseInvoiceDiscountForm,
	renderInvoiceWorkspaceHtml,
	sendInvoice,
	updateInvoiceDraft,
} from "./lib/invoice";
import { buildEstimatePdf, syncJobEstimateTotal } from "./lib/estimate";
import {
	PRINT_BOARD_COLUMNS,
	PRINT_FILE_KINDS,
	PRINT_PRODUCT_TYPES,
	PRINT_STATUSES,
	printProductLabel,
	printStatusLabel,
	printTypesForSelect,
	syncPrintQuoteTotal,
} from "./lib/print";
import { consumeLoginOtp } from "./lib/otp";
import {
	FLOOR_TYPES,
	FLOOR_TYPE_VALUES,
	PRODUCTS,
	RESTORATION_TYPES,
	isRestorationType,
	isValidFieldJobType,
	jobTypeLabel,
	normalizeJobType,
	productForJobType,
	type ProductKey,
} from "./lib/products";
import {
	assigneeOptionLabel,
	dbRoleForStorage,
	defaultProductsForDesignation,
	isValidUserRole,
	LEAST_PRIVILEGE_DESIGNATION,
	permissionRoleFor,
	roleLabel,
	SUPER_ADMIN_SEAT_LIMIT,
	USER_ROLES,
} from "./lib/roles";
import {
	EQUIPMENT_TYPES,
	equipmentTypeLabel,
	resolveGrains,
	type FieldLogRow,
} from "./lib/field-logs";
import { csvResponse } from "./lib/csv";
import {
	ASSET_STATUSES,
	assetStatusLabel,
	isValidAssetStatus,
	isValidEquipmentType,
	type AssetRow,
} from "./lib/inventory";

import {
	PORTAL_COOKIE,
	clearPortalCookie,
	createPortalSession,
	destroyPortalSession,
	getPortalCustomer,
	mintPortalToken,
	revokePortalToken,
	setPortalCookie,
	type PortalCustomer,
} from "./lib/portal";
import {
	LEAD_SOURCES,
	followUpDateValue,
	isFollowUpOverdue,
	leadSourceLabel,
	normalizeLeadSource,
} from "./lib/leads";
import {
	COST_CATEGORIES,
	costCategoryLabel,
	defaultUnitForCategory,
	isValidCostCategory,
	lineTotalCents,
	loadJobCostLines,
	marginCents,
	sumCostCents,
} from "./lib/job-costs";
import { buildWaterLossPdf, parseOptionalNumber } from "./lib/water-loss";
import {
	canOverrideJobAssignment,
	canReopenFieldStatus,
	canReopenPrintStatus,
	FIELD_REOPEN_STATUS,
	normalizeOverrideReason,
	officeLockBannerCopy,
	PRINT_REOPEN_STATUS,
	renderJobOverridePanels,
} from "./lib/job-overrides";
import {
	ALL_PRODUCTS,
	appendFieldJobListFilters,
	canAccessProduct,
	canManageUsers,
	canReadFieldJob,
	canReadPrintJob,
	canReopenJobs,
	canSeeOfficeTools,
	canWriteFieldJob,
	canWritePrintJob,
	isPrintStatusLocked,
	isStatusLocked,
	jobTypeAllowedForUser,
	fieldJobVisibility,
	parseProducts,
	printJobVisibility,
	productLabel,
	productsFromForm,
	productsSelectedFromForm,
	serializeProducts,
	type FieldJobAccess,
	type PrintJobAccess,
} from "./lib/access";
import {
	loadBottleneckSections,
	printBottleneckFilters,
	renderBottleneckStrip,
} from "./lib/bottlenecks";
import {
	canAccessTrash,
	canSoftDelete,
} from "./lib/soft-delete";
import {
	canHardDelete,
	hardDeleteCustomer,
	hardDeleteFieldJob,
	hardDeletePrintJob,
	verifyOwnerPasswordForHardDelete,
} from "./lib/hard-delete";
import {
	canViewAudit,
	clientIpFromHeaders,
	listAuditEvents,
	requestIdFromHeaders,
	writeAuditEvent,
	type AuditAction,
	type AuditEntityType,
} from "./lib/audit";
import {
	canManagePriceLists,
	centsToDollarsInput,
	dollarsToCents,
	getPriceItem,
	listActivePriceItemsForProduct,
	listPriceItems,
	parsePriceListForm,
	priceListCategoryLabel,
	priceListProductLabel,
	PRICE_LIST_PRODUCTS,
} from "./lib/price-list";
import {
	canManagePrintMargins,
	getPrintMarginSettings,
	parseMarginSettingsForm,
	serializeVolumeTiers,
	suggestedSellUnitCents,
	summarizeMarginSettings,
} from "./lib/print-margins";
import {
	activeHourlyCents,
	canManageLaborRates,
	getLaborRate,
	laborCostPrefill,
	laborRateDesignations,
	listLaborRates,
	parseLaborRateForm,
} from "./lib/labor-rates";
import {
	canManageDiscountCaps,
	discountCapNoticeHtml,
	getDiscountCapSettings,
	parseDiscountCapForm,
	summarizeDiscountCaps,
} from "./lib/discount-caps";
import {
	canSetAssetStatusWithOpenAssignment,
	canVoidClaimData,
	normalizeVoidReason,
	NOT_VOIDED_SQL,
} from "./lib/void-data";

const RESTORATION_SQL_TYPES = [
	...RESTORATION_TYPES.map((t) => t.value),
	"restoration",
] as const;

export type Env = {
	DB: D1Database;
	ASSETS: Fetcher;
	UPLOADS: R2Bucket;
};

type Variables = {
	user?: AppUser;
	portalCustomer: PortalCustomer | null;
	flash: string | null;
	fieldJobAccess?: FieldJobAccess;
	printJobAccess?: PrintJobAccess;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
	await ensureSeedUser(c.env.DB);
	c.set("flash", null);
	c.set("portalCustomer", null);
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

function forbiddenHtml(
	c: { get: (key: "user" | "flash") => unknown },
	message = "You do not have access to this.",
) {
	return page(
		c,
		"Forbidden",
		`<h1>Forbidden</h1><p class="muted">${escapeHtml(message)}</p>`,
	);
}

/** SA-3: Void / Incorrect form — reason required; row stays. */
function voidActionForm(action: string, buttonLabel = "Void"): string {
	return `<form method="post" action="${action}" class="stack" style="gap:0.35rem;margin-top:0.35rem"
    onsubmit="return confirm('Mark as void / incorrect? The row stays for claim history.');">
    <input name="void_reason" required minlength="3" maxlength="500" placeholder="Reason (required)"
      style="max-width:14rem;font-size:0.85rem" />
    <button class="linkish" type="submit">${escapeHtml(buttonLabel)}</button>
  </form>`;
}

/** SA-4: Owner break-glass hard delete — password re-entry required. */
function hardDeleteForm(action: string, confirmMessage: string): string {
	return `<form method="post" action="${action}" class="stack" style="gap:0.35rem;min-width:11rem"
    onsubmit="return confirm(${JSON.stringify(confirmMessage)});">
    <input type="password" name="owner_password" required autocomplete="current-password"
      placeholder="Your password" style="font-size:0.85rem" />
    <button type="submit" class="btn secondary" style="border-color:#b91c1c;color:#991b1b">Delete forever</button>
  </form>`;
}

async function requireHardDeletePassword(
	c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Response | null> {
	const user = c.get("user")!;
	if (!canHardDelete(user)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	const row = await c.env.DB.prepare(
		`SELECT password_hash FROM users WHERE id = ?`,
	)
		.bind(user.id)
		.first<{ password_hash: string }>();
	if (
		!row ||
		!(await verifyOwnerPasswordForHardDelete(form.owner_password, row.password_hash))
	) {
		return c.text("Password incorrect — hard delete cancelled.", 403);
	}
	return null;
}

function auditMeta(c: Context<{ Bindings: Env; Variables: Variables }>) {
	const headers = {
		get: (name: string) => c.req.header(name) ?? null,
	};
	return {
		actorUserId: c.get("user")!.id,
		ip: clientIpFromHeaders(headers),
		requestId: requestIdFromHeaders(headers),
	};
}

async function recordAudit(
	c: Context<{ Bindings: Env; Variables: Variables }>,
	input: {
		action: AuditAction;
		entityType: AuditEntityType;
		entityId: string;
		summary: string;
		detail?: Record<string, unknown> | null;
	},
) {
	const meta = auditMeta(c);
	await writeAuditEvent(c.env.DB, {
		...meta,
		action: input.action,
		entityType: input.entityType,
		entityId: input.entityId,
		summary: input.summary,
		detail: input.detail,
	});
}

async function loadFieldJobAccess(
	db: D1Database,
	id: string,
): Promise<FieldJobAccess | null> {
	return db
		.prepare(
			`SELECT id, status, assigned_user_id, job_type, deleted_at FROM jobs WHERE id = ?`,
		)
		.bind(id)
		.first<FieldJobAccess>();
}

async function loadPrintJobAccess(
	db: D1Database,
	id: string,
): Promise<PrintJobAccess | null> {
	return db
		.prepare(
			`SELECT id, status, assigned_user_id, deleted_at FROM print_jobs WHERE id = ?`,
		)
		.bind(id)
		.first<PrintJobAccess>();
}

function portalPage(title: string, customer: PortalCustomer, body: string) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · Customer portal</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="top">
    <div class="brand"><a href="/portal">Timla job portal</a></div>
    <div class="userbar">
      <span>${escapeHtml(customer.name)}</span>
      <form method="post" action="/portal/logout" class="inline">
        <button type="submit" class="linkish">Sign out</button>
      </form>
    </div>
  </header>
  <main class="main">${body}</main>
  <footer class="foot"><span>Read-only customer view</span></footer>
</body>
</html>`;
}

/** Auth gate for app pages (not login/static/portal). */
app.use("*", async (c, next) => {
	const path = new URL(c.req.url).pathname;
	if (
		path === "/login" ||
		path === "/logout" ||
		path === "/styles.css" ||
		path === "/health" ||
		path === "/portal" ||
		path.startsWith("/portal/")
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

/** Portal session gate for /portal except enter/logout. */
app.use("/portal/*", async (c, next) => {
	const path = new URL(c.req.url).pathname;
	if (
		path === "/portal/enter" ||
		path === "/portal/logout" ||
		path === "/portal"
	) {
		// /portal itself handled in route (may redirect)
		return next();
	}
	const customer = await getPortalCustomer(
		c.env.DB,
		getCookie(c, PORTAL_COOKIE),
	);
	if (!customer) {
		return c.redirect("/portal/enter");
	}
	c.set("portalCustomer", customer);
	return next();
});

/** Field job RLS + status lock for /jobs/:id and nested routes. */
async function enforceFieldJobRoute(
	c: Context<{ Bindings: Env; Variables: Variables }>,
	next: Next,
) {
	const id = c.req.param("id");
	if (!id || id === "new" || id === "export.csv") return next();
	const user = c.get("user");
	if (!user) return next();
	const job = await loadFieldJobAccess(c.env.DB, id);
	if (!job) return c.notFound();
	const method = c.req.method.toUpperCase();
	const readOnly = method === "GET" || method === "HEAD";
	if (readOnly) {
		if (!canReadFieldJob(user, job)) {
			return c.html(
				forbiddenHtml(
					c,
					"You can only open field jobs assigned to you (for your products).",
				),
				403,
			);
		}
	} else if (!canWriteFieldJob(user, job)) {
		const locked = isStatusLocked(job.status);
		const archived = !!job.deleted_at;
		return c.html(
			forbiddenHtml(
				c,
				archived
					? "This job is in the Owner trash. Restore it from Trash to edit."
					: locked
						? "This job is locked (complete / invoiced). Owner / Manager / Dispatch can reopen it."
						: "You can only edit field jobs assigned to you.",
			),
			403,
		);
	}
	c.set("fieldJobAccess", job);
	return next();
}

app.use("/jobs/:id", enforceFieldJobRoute);
app.use("/jobs/:id/*", enforceFieldJobRoute);

/** Print job RLS + status lock for /print/:id and nested routes. */
async function enforcePrintJobRoute(
	c: Context<{ Bindings: Env; Variables: Variables }>,
	next: Next,
) {
	const id = c.req.param("id");
	if (!id || id === "new" || id === "board") return next();
	const user = c.get("user");
	if (!user) return next();
	if (!canAccessProduct(user, "print")) {
		return c.html(
			forbiddenHtml(c, "Your account does not include Print Ops."),
			403,
		);
	}
	const job = await loadPrintJobAccess(c.env.DB, id);
	if (!job) return c.notFound();
	const method = c.req.method.toUpperCase();
	const readOnly = method === "GET" || method === "HEAD";
	if (readOnly) {
		if (!canReadPrintJob(user, job)) {
			return c.html(
				forbiddenHtml(
					c,
					"You can only open print jobs assigned to you.",
				),
				403,
			);
		}
	} else if (!canWritePrintJob(user, job)) {
		return c.html(
			forbiddenHtml(
				c,
				job.deleted_at
					? "This print job is in the Owner trash. Restore it from Trash to edit."
					: "This print job is locked or not assigned to you. Owner / Manager / Dispatch can reopen delivered jobs.",
			),
			403,
		);
	}
	c.set("printJobAccess", job);
	return next();
}

app.use("/print/:id", enforcePrintJobRoute);
app.use("/print/:id/*", enforcePrintJobRoute);

app.get("/health", (c) => c.json({ ok: true, app: "lumanyi" }));

app.get("/portal", async (c) => {
	const customer = await getPortalCustomer(
		c.env.DB,
		getCookie(c, PORTAL_COOKIE),
	);
	if (!customer) return c.redirect("/portal/enter");
	return c.redirect("/portal/jobs");
});

app.get("/portal/enter", async (c) => {
	const existing = await getPortalCustomer(
		c.env.DB,
		getCookie(c, PORTAL_COOKIE),
	);
	if (existing) return c.redirect("/portal/jobs");
	const prefill = c.req.query("t") || "";
	const body = `
    <div class="login-wrap">
      <div class="panel stack">
        <h1>Customer portal</h1>
        <p class="muted">Enter the access link code Timla sent you. Read-only job status view.</p>
        <form method="post" action="/portal/enter" class="stack">
          <div>
            <label for="token">Access code</label>
            <input id="token" name="token" type="text" required autocomplete="off" value="${escapeHtml(prefill)}" />
          </div>
          <button class="btn" type="submit">Open my jobs</button>
        </form>
      </div>
    </div>`;
	return c.html(
		layout({ title: "Customer portal", body, user: null }),
	);
});

app.post("/portal/enter", async (c) => {
	const form = await c.req.parseBody();
	const raw = String(form.token || "").trim();
	const session = await createPortalSession(c.env.DB, raw);
	if (!session) {
		const body = `
      <div class="login-wrap">
        <div class="panel stack">
          <h1>Customer portal</h1>
          <div class="flash" style="background:#fef2f2;border-color:#fecaca;color:#991b1b">Invalid or expired access code.</div>
          <form method="post" action="/portal/enter" class="stack">
            <div>
              <label for="token">Access code</label>
              <input id="token" name="token" type="text" required autocomplete="off" />
            </div>
            <button class="btn" type="submit">Open my jobs</button>
          </form>
        </div>
      </div>`;
		return c.html(layout({ title: "Customer portal", body, user: null }), 400);
	}
	setPortalCookie(c, session.sessionId);
	return c.redirect("/portal/jobs");
});

app.post("/portal/logout", async (c) => {
	await destroyPortalSession(c.env.DB, getCookie(c, PORTAL_COOKIE));
	clearPortalCookie(c);
	return c.redirect("/portal/enter");
});

app.get("/portal/jobs", async (c) => {
	const customer =
		c.get("portalCustomer") ||
		(await getPortalCustomer(c.env.DB, getCookie(c, PORTAL_COOKIE)));
	if (!customer) return c.redirect("/portal/enter");

	const jobs = await c.env.DB.prepare(
		`SELECT id, title, job_type, status, scheduled_start, claim_number
     FROM jobs WHERE customer_id = ? AND status != 'cancelled' AND deleted_at IS NULL
     ORDER BY COALESCE(scheduled_start, created_at) DESC LIMIT 50`,
	)
		.bind(customer.id)
		.all<{
			id: string;
			title: string;
			job_type: string;
			status: string;
			scheduled_start: string | null;
			claim_number: string | null;
		}>();

	const rows =
		jobs.results
			?.map(
				(j) => `<tr>
        <td><a href="/portal/jobs/${escapeHtml(j.id)}">${escapeHtml(j.title)}</a></td>
        <td>${escapeHtml(jobTypeLabel(j.job_type))}</td>
        <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span></td>
        <td>${escapeHtml(j.scheduled_start ? j.scheduled_start.slice(0, 16).replace("T", " ") : "—")}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="4" class="muted">No jobs to show.</td></tr>`;

	const body = `
    <h1>Your jobs</h1>
    <p class="muted">Hello ${escapeHtml(customer.name)} — status and schedule only.</p>
    <table>
      <thead><tr><th>Job</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

	return c.html(portalPage("Your jobs", customer, body));
});

app.get("/portal/jobs/:id", async (c) => {
	const customer =
		c.get("portalCustomer") ||
		(await getPortalCustomer(c.env.DB, getCookie(c, PORTAL_COOKIE)));
	if (!customer) return c.redirect("/portal/enter");

	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, j.scheduled_end,
      j.claim_number, j.carrier, j.date_of_loss, j.notes, j.estimate_cents, j.estimate_accepted_at,
      s.address_line1, s.city, s.state, s.postal_code
     FROM jobs j
     LEFT JOIN sites s ON s.id = j.site_id
     WHERE j.id = ? AND j.customer_id = ? AND j.deleted_at IS NULL`,
	)
		.bind(id, customer.id)
		.first<{
			id: string;
			title: string;
			job_type: string;
			status: string;
			scheduled_start: string | null;
			scheduled_end: string | null;
			claim_number: string | null;
			carrier: string | null;
			date_of_loss: string | null;
			notes: string | null;
			estimate_cents: number | null;
			estimate_accepted_at: string | null;
			address_line1: string | null;
			city: string | null;
			state: string | null;
			postal_code: string | null;
		}>();
	if (!job) return c.notFound();

	const notes = await c.env.DB.prepare(
		`SELECT body, created_at FROM job_notes WHERE job_id = ? ORDER BY created_at DESC LIMIT 10`,
	)
		.bind(id)
		.all<{ body: string; created_at: string }>();

	const moisture = isRestorationType(job.job_type)
		? await c.env.DB.prepare(
				`SELECT logged_at, area, reading, temp_f, rh_pct, grains, notes FROM job_field_logs
         WHERE job_id = ? AND kind = 'moisture' AND ${NOT_VOIDED_SQL}
         ORDER BY logged_at DESC LIMIT 20`,
			)
				.bind(id)
				.all<{
					logged_at: string;
					area: string | null;
					reading: string | null;
					temp_f: number | null;
					rh_pct: number | null;
					grains: number | null;
					notes: string | null;
				}>()
		: {
				results: [] as Array<{
					logged_at: string;
					area: string | null;
					reading: string | null;
					temp_f: number | null;
					rh_pct: number | null;
					grains: number | null;
					notes: string | null;
				}>,
			};

	const noteItems =
		notes.results
			?.map(
				(n) => `<div class="panel" style="padding:0.75rem">
        <div class="muted" style="font-size:0.8rem">${escapeHtml(n.created_at.slice(0, 16).replace("T", " "))}</div>
        <div>${escapeHtml(n.body)}</div>
      </div>`,
			)
			.join("") || `<p class="muted">No field notes shared.</p>`;

	const moistureRows =
		moisture.results
			?.map((m) => {
				const ambient = [
					m.temp_f != null ? `${m.temp_f}°F` : null,
					m.rh_pct != null ? `${m.rh_pct}%` : null,
					m.grains != null ? `${m.grains} gpp` : null,
				]
					.filter(Boolean)
					.join(" · ");
				return `<tr>
        <td>${escapeHtml(m.logged_at.slice(0, 10))}</td>
        <td>${escapeHtml(m.area) || "—"}</td>
        <td>${escapeHtml(m.reading) || "—"}</td>
        <td>${escapeHtml(ambient) || "—"}</td>
        <td>${escapeHtml(m.notes) || "—"}</td>
      </tr>`;
			})
			.join("") || "";

	const moistureSection =
		isRestorationType(job.job_type) && moistureRows
			? `<h2>Moisture readings</h2>
    <table>
      <thead><tr><th>Date</th><th>Area</th><th>Reading</th><th>Ambient</th><th>Notes</th></tr></thead>
      <tbody>${moistureRows}</tbody>
    </table>`
			: isRestorationType(job.job_type)
				? `<h2>Moisture readings</h2><p class="muted">No readings logged yet.</p>`
				: "";

	const canAcceptEstimate =
		!job.estimate_accepted_at &&
		(job.status === "estimate" ||
			(job.status === "lead" && job.estimate_cents != null && job.estimate_cents > 0));

	const acceptSection = job.estimate_accepted_at
		? `<div class="panel" style="margin-top:1rem">
      <strong>Estimate accepted</strong>
      <p class="muted" style="margin:0.35rem 0 0">Accepted on ${escapeHtml(job.estimate_accepted_at.slice(0, 16).replace("T", " "))} UTC.</p>
    </div>`
		: canAcceptEstimate
			? `<div class="panel stack" style="margin-top:1rem">
      <div><span class="muted">Estimate</span><br><strong>${escapeHtml(money(job.estimate_cents))}</strong></div>
      <p class="muted" style="margin:0">Accepting moves this job to scheduled so Timla can proceed.</p>
      <form method="post" action="/portal/jobs/${escapeHtml(id)}/accept-estimate"
        onsubmit="return confirm('Accept this estimate and schedule the work?');">
        <button class="btn" type="submit">Accept estimate</button>
      </form>
    </div>`
			: job.estimate_cents != null
				? `<div class="panel" style="margin-top:1rem"><span class="muted">Estimate</span><br>${escapeHtml(money(job.estimate_cents))}</div>`
				: "";

	const body = `
    <p><a href="/portal/jobs">← All jobs</a></p>
    <h1>${escapeHtml(job.title)}</h1>
    <p class="muted">${escapeHtml(jobTypeLabel(job.job_type))} ·
      <span class="badge ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span></p>
    <div class="panel stack">
      <div><span class="muted">Site</span><br>
        ${job.address_line1 ? `${escapeHtml(job.address_line1)}, ${escapeHtml(job.city)}, ${escapeHtml(job.state)} ${escapeHtml(job.postal_code)}` : "—"}
      </div>
      <div><span class="muted">Schedule</span><br>
        ${escapeHtml(job.scheduled_start ? job.scheduled_start.slice(0, 16).replace("T", " ") : "Not scheduled")}
        ${job.scheduled_end ? ` → ${escapeHtml(job.scheduled_end.slice(0, 16).replace("T", " "))}` : ""}
      </div>
      ${job.claim_number ? `<div><span class="muted">Claim #</span><br>${escapeHtml(job.claim_number)}</div>` : ""}
      ${job.carrier ? `<div><span class="muted">Carrier</span><br>${escapeHtml(job.carrier)}</div>` : ""}
      ${job.date_of_loss ? `<div><span class="muted">Date of loss</span><br>${escapeHtml(job.date_of_loss)}</div>` : ""}
      ${job.notes ? `<div><span class="muted">Job notes</span><br>${escapeHtml(job.notes)}</div>` : ""}
    </div>
    ${acceptSection}
    ${moistureSection}
    <h2>Recent notes</h2>
    <div class="stack">${noteItems}</div>`;

	return c.html(portalPage(job.title, customer, body));
});

app.post("/portal/jobs/:id/accept-estimate", async (c) => {
	const customer =
		c.get("portalCustomer") ||
		(await getPortalCustomer(c.env.DB, getCookie(c, PORTAL_COOKIE)));
	if (!customer) return c.redirect("/portal/enter");

	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT id, status, estimate_cents, estimate_accepted_at
     FROM jobs WHERE id = ? AND customer_id = ? AND deleted_at IS NULL`,
	)
		.bind(id, customer.id)
		.first<{
			id: string;
			status: string;
			estimate_cents: number | null;
			estimate_accepted_at: string | null;
		}>();
	if (!job) return c.notFound();
	if (job.estimate_accepted_at) {
		return c.redirect(`/portal/jobs/${id}`);
	}
	const allowed =
		job.status === "estimate" ||
		(job.status === "lead" &&
			job.estimate_cents != null &&
			job.estimate_cents > 0);
	if (!allowed) {
		return c.text("This estimate cannot be accepted in its current status.", 400);
	}

	await c.env.DB.prepare(
		`UPDATE jobs SET
      estimate_accepted_at = datetime('now'),
      status = 'scheduled',
      updated_at = datetime('now')
     WHERE id = ? AND customer_id = ?`,
	)
		.bind(id, customer.id)
		.run();

	return c.redirect(`/portal/jobs/${id}`);
});

app.get("/login", async (c) => {
	const user = await getSessionUser(c.env.DB, getCookie(c, SESSION_COOKIE));
	if (user) {
		return c.redirect(user.mustChangePassword ? "/account/password" : "/");
	}
	const body = `
    <div class="login-wrap">
      <div class="panel stack">
        <h1>Sign in</h1>
        <p class="muted">Lumanyi — Restoration, Floors, and Print Ops.</p>
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
		`SELECT id, email, name, role, password_hash, must_change_password,
      COALESCE(active, 1) AS active
     FROM users WHERE email = ?`,
	)
		.bind(email)
		.first<{
			id: string;
			email: string;
			name: string;
			role: AppUser["role"];
			password_hash: string;
			must_change_password: number;
			active: number;
		}>();

	if (!row) {
		return renderLoginError("Invalid email or password.");
	}
	if (row.active !== 1) {
		return renderLoginError(
			"This account is deactivated. Contact a Super Admin.",
		);
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
	const user = c.get("user")!;
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
	const user = c.get("user")!;
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
	if (!canManageUsers(c.get("user")!)) {
		return c.html(
			page(c, "Users", `<h1>Users</h1><p class="muted">Super Admin / Owner access only.</p>`),
			403,
		);
	}
	const me = c.get("user")!;
	const ownerSeats = await countActiveOwners(c.env.DB);
	const list = await c.env.DB.prepare(
		`SELECT id, name, email, role, COALESCE(designation, role) AS designation,
      products, must_change_password, COALESCE(active, 1) AS active, created_at
     FROM users ORDER BY name COLLATE NOCASE`,
	).all<{
		id: string;
		name: string;
		email: string;
		role: string;
		designation: string;
		products: string | null;
		must_change_password: number;
		active: number;
		created_at: string;
	}>();

	const rows =
		list.results
			?.map((u) => {
				const prods = parseProducts(u.products)
					.map((p) => productLabel(p))
					.join(", ");
				const checks = ALL_PRODUCTS.map((p) => {
					const on = parseProducts(u.products).includes(p);
					return `<label style="margin-right:0.75rem;font-weight:400">
              <input type="checkbox" name="product_${p}" ${on ? "checked" : ""} /> ${escapeHtml(productLabel(p))}
            </label>`;
				}).join("");
				const designationOptions = USER_ROLES.map(
					(r) =>
						`<option value="${escapeHtml(r.value)}" ${u.designation === r.value ? "selected" : ""}>${escapeHtml(r.label)}</option>`,
				).join("");
				const isActive = u.active === 1;
				const statusCell = isActive
					? `<span class="badge scheduled">Active</span>`
					: `<span class="badge cancelled">Deactivated</span>`;
				const toggleLabel = isActive ? "Deactivate" : "Reactivate";
				const toggleValue = isActive ? "0" : "1";
				const selfNote = u.id === me.id ? " (you)" : "";
				return `<tr>
        <td>${escapeHtml(u.name)}${escapeHtml(selfNote)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <form method="post" action="/users/${escapeHtml(u.id)}/designation" class="inline" style="display:flex;gap:0.35rem;align-items:center">
            <select name="role" required>${designationOptions}</select>
            <button class="btn secondary" type="submit" style="padding:0.25rem 0.5rem;font-size:0.85rem">Save</button>
          </form>
        </td>
        <td>${escapeHtml(prods)}</td>
        <td>${statusCell}</td>
        <td>${u.must_change_password ? "Must change" : "OK"}</td>
        <td>
          <form method="post" action="/users/${escapeHtml(u.id)}/products" class="inline" style="display:flex;flex-wrap:wrap;gap:0.25rem;align-items:center">
            ${checks}
            <button class="btn secondary" type="submit" style="padding:0.25rem 0.5rem;font-size:0.85rem">Save</button>
          </form>
        </td>
        <td>
          <form method="post" action="/users/${escapeHtml(u.id)}/active" class="inline"
            onsubmit="return confirm('${isActive ? "Deactivate this employee? They will be signed out and removed from assignee lists. History stays." : "Reactivate this employee?"}');">
            <input type="hidden" name="active" value="${toggleValue}" />
            <button class="linkish" type="submit">${toggleLabel}</button>
          </form>
        </td>
      </tr>`;
			})
			.join("") || "";

	const defaultProds = defaultProductsForDesignation(LEAST_PRIVILEGE_DESIGNATION);
	const createProductChecks = ALL_PRODUCTS.map(
		(p) =>
			`<label style="margin-right:1rem;font-weight:400">
        <input type="checkbox" name="product_${p}" ${defaultProds.includes(p) ? "checked" : ""} /> ${escapeHtml(productLabel(p))}
      </label>`,
	).join("");

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Users</h1>
        <p class="muted" style="margin:0.35rem 0 0">Super Admin seats: ${ownerSeats}/${SUPER_ADMIN_SEAT_LIMIT} active. Deactivate offboards staff without deleting history.</p>
      </div>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Designation</th><th>Products</th><th>Status</th><th>Password</th><th>Edit products</th><th>Offboard</th></tr></thead>
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
          <label for="role">Designation</label>
          <select id="role" name="role" required>
            ${USER_ROLES.map(
							(r) =>
								`<option value="${escapeHtml(r.value)}" ${r.value === LEAST_PRIVILEGE_DESIGNATION ? "selected" : ""}>${escapeHtml(r.label)}</option>`,
						).join("")}
          </select>
        </div>
        <div>
          <label for="temp_password">Temporary password</label>
          <input id="temp_password" name="temp_password" type="text" required minlength="8" value="Lumanyi1!" />
        </div>
      </div>
      <div>
        <span class="muted">Products (department pin). Leave unchecked to use designation defaults.</span><br />
        ${createProductChecks}
      </div>
      <p class="muted">New users must change password on first login. Only Super Admins can create or promote Super Admins (max ${SUPER_ADMIN_SEAT_LIMIT}). Default designation is least privilege (Mitigation Tech).</p>
      <button class="btn" type="submit">Create user</button>
    </form>`;

	return c.html(page(c, "Users", body));
});

app.post("/users", async (c) => {
	if (!canManageUsers(c.get("user")!)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	const name = String(form.name || "").trim();
	const email = String(form.email || "")
		.trim()
		.toLowerCase();
	const rawRole = String(form.role || "").trim();
	const designation = isValidUserRole(rawRole)
		? rawRole
		: LEAST_PRIVILEGE_DESIGNATION;
	const tempPassword = String(form.temp_password || "");
	if (!name || !email || tempPassword.length < 8) {
		return c.text("Name, email, and password (8+ chars) required", 400);
	}
	const existing = await c.env.DB.prepare(
		`SELECT id FROM users WHERE email = ?`,
	)
		.bind(email)
		.first();
	if (existing) return c.text("Email already exists", 400);

	const permissionRole = permissionRoleFor(designation);
	const storedRole = dbRoleForStorage(permissionRole);
	if (permissionRole === "owner") {
		const seats = await countActiveOwners(c.env.DB);
		if (seats >= SUPER_ADMIN_SEAT_LIMIT) {
			return c.text(
				`Super Admin / Owner seats full (${seats}/${SUPER_ADMIN_SEAT_LIMIT}).`,
				400,
			);
		}
	}

	const selected = productsSelectedFromForm(form as Record<string, unknown>);
	const products = serializeProducts(
		selected.length
			? selected
			: defaultProductsForDesignation(designation),
	);
	const passwordHash = await hashPassword(tempPassword);
	const newUserId = newId("usr");
	await c.env.DB.prepare(
		`INSERT INTO users (id, email, name, password_hash, role, designation, products, must_change_password, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
	)
		.bind(
			newUserId,
			email,
			name,
			passwordHash,
			storedRole,
			designation,
			products,
		)
		.run();
	await recordAudit(c, {
		action: "user_create",
		entityType: "user",
		entityId: newUserId,
		summary: `Created user ${email} (${designation})`,
		detail: { email, designation, permissionRole, storedRole, products },
	});
	return c.redirect("/users");
});

app.post("/users/:id/products", async (c) => {
	if (!canManageUsers(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const selected = productsSelectedFromForm(form as Record<string, unknown>);
	const row = await c.env.DB.prepare(
		`SELECT id, products, COALESCE(designation, role) AS designation FROM users WHERE id = ?`,
	)
		.bind(id)
		.first<{ id: string; products: string | null; designation: string }>();
	if (!row) return c.notFound();
	const products = serializeProducts(
		selected.length
			? selected
			: defaultProductsForDesignation(row.designation),
	);
	await c.env.DB.prepare(`UPDATE users SET products = ? WHERE id = ?`)
		.bind(products, id)
		.run();
	await recordAudit(c, {
		action: "user_products",
		entityType: "user",
		entityId: id,
		summary: `Updated products for user ${id}`,
		detail: { before: row.products, after: products },
	});
	return c.redirect("/users");
});

app.post("/users/:id/designation", async (c) => {
	if (!canManageUsers(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const rawRole = String(form.role || "").trim();
	if (!isValidUserRole(rawRole)) return c.text("Invalid designation", 400);

	const row = await c.env.DB.prepare(
		`SELECT id, role, COALESCE(designation, role) AS designation, COALESCE(active, 1) AS active FROM users WHERE id = ?`,
	)
		.bind(id)
		.first<{ id: string; role: string; designation: string; active: number }>();
	if (!row) return c.notFound();

	const nextPermission = permissionRoleFor(rawRole);
	const storedRole = dbRoleForStorage(nextPermission);
	const wasOwner = row.role === "owner";
	const willBeOwner = nextPermission === "owner";

	if (willBeOwner && !wasOwner) {
		const seats = await countActiveOwners(c.env.DB);
		if (seats >= SUPER_ADMIN_SEAT_LIMIT) {
			return c.text(
				`Super Admin / Owner seats full (${seats}/${SUPER_ADMIN_SEAT_LIMIT}).`,
				400,
			);
		}
	}
	if (wasOwner && !willBeOwner && row.active === 1) {
		const remaining = await countActiveOwners(c.env.DB, id);
		if (remaining < 1) {
			return c.text(
				"Cannot demote the last active Super Admin / Owner.",
				400,
			);
		}
	}

	await c.env.DB.prepare(
		`UPDATE users SET role = ?, designation = ? WHERE id = ?`,
	)
		.bind(storedRole, rawRole, id)
		.run();
	await recordAudit(c, {
		action: "user_designation",
		entityType: "user",
		entityId: id,
		summary: `Changed designation ${row.designation} → ${rawRole}`,
		detail: {
			before: { designation: row.designation, role: row.role },
			after: {
				designation: rawRole,
				permissionRole: nextPermission,
				storedRole,
			},
		},
	});
	return c.redirect("/users");
});

app.post("/users/:id/active", async (c) => {
	if (!canManageUsers(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const me = c.get("user")!;
	const form = await c.req.parseBody();
	const nextActive = String(form.active || "") === "1" ? 1 : 0;

	const row = await c.env.DB.prepare(
		`SELECT id, role, COALESCE(active, 1) AS active FROM users WHERE id = ?`,
	)
		.bind(id)
		.first<{ id: string; role: string; active: number }>();
	if (!row) return c.notFound();

	if (nextActive === 0) {
		if (id === me.id) {
			return c.text("You cannot deactivate your own account.", 400);
		}
		if (row.role === "owner" && row.active === 1) {
			const remaining = await countActiveOwners(c.env.DB, id);
			if (remaining < 1) {
				return c.text(
					"Cannot deactivate the last active Super Admin / Owner.",
					400,
				);
			}
		}
		await c.env.DB.prepare(`UPDATE users SET active = 0 WHERE id = ?`)
			.bind(id)
			.run();
		await destroySessionsForUser(c.env.DB, id);
		await recordAudit(c, {
			action: "user_deactivate",
			entityType: "user",
			entityId: id,
			summary: `Deactivated user ${id}`,
			detail: { role: row.role },
		});
	} else {
		if (row.role === "owner") {
			const seats = await countActiveOwners(c.env.DB);
			if (row.active !== 1 && seats >= SUPER_ADMIN_SEAT_LIMIT) {
				return c.text(
					`Super Admin / Owner seats full (${seats}/${SUPER_ADMIN_SEAT_LIMIT}).`,
					400,
				);
			}
		}
		await c.env.DB.prepare(`UPDATE users SET active = 1 WHERE id = ?`)
			.bind(id)
			.run();
		await recordAudit(c, {
			action: "user_reactivate",
			entityType: "user",
			entityId: id,
			summary: `Reactivated user ${id}`,
			detail: { role: row.role },
		});
	}
	return c.redirect("/users");
});

app.post("/customers/:id/archive", async (c) => {
	if (!canSoftDelete(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const row = await c.env.DB.prepare(
		`SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(id)
		.first();
	if (!row) return c.notFound();
	await c.env.DB.prepare(
		`UPDATE customers SET deleted_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "soft_delete",
		entityType: "customer",
		entityId: id,
		summary: `Archived customer ${id}`,
	});
	return c.redirect("/trash");
});

app.post("/jobs/:id/archive", async (c) => {
	if (!canSoftDelete(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const row = await c.env.DB.prepare(
		`SELECT id FROM jobs WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(id)
		.first();
	if (!row) return c.notFound();
	await c.env.DB.prepare(
		`UPDATE jobs SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "soft_delete",
		entityType: "job",
		entityId: id,
		summary: `Archived field job ${id}`,
	});
	return c.redirect("/trash");
});

app.post("/print/:id/archive", async (c) => {
	if (!canSoftDelete(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const row = await c.env.DB.prepare(
		`SELECT id FROM print_jobs WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(id)
		.first();
	if (!row) return c.notFound();
	await c.env.DB.prepare(
		`UPDATE print_jobs SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "soft_delete",
		entityType: "print_job",
		entityId: id,
		summary: `Archived print job ${id}`,
	});
	return c.redirect("/trash");
});

app.get("/trash", async (c) => {
	if (!canAccessTrash(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Trash is Super Admin / Owner only."),
			403,
		);
	}
	const customers = await c.env.DB.prepare(
		`SELECT id, name, deleted_at FROM customers
     WHERE deleted_at IS NOT NULL
     ORDER BY deleted_at DESC LIMIT 100`,
	).all<{ id: string; name: string; deleted_at: string }>();
	const jobs = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.deleted_at, c.name AS customer_name
     FROM jobs j
     LEFT JOIN customers c ON c.id = j.customer_id
     WHERE j.deleted_at IS NOT NULL
     ORDER BY j.deleted_at DESC LIMIT 100`,
	).all<{
		id: string;
		title: string;
		job_type: string;
		deleted_at: string;
		customer_name: string | null;
	}>();
	const prints = await c.env.DB.prepare(
		`SELECT p.id, p.title, p.product_type, p.deleted_at, c.name AS customer_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.deleted_at IS NOT NULL
     ORDER BY p.deleted_at DESC LIMIT 100`,
	).all<{
		id: string;
		title: string;
		product_type: string;
		deleted_at: string;
		customer_name: string | null;
	}>();

	const custRows =
		customers.results
			?.map(
				(r) => `<tr>
        <td><a href="/customers/${escapeHtml(r.id)}">${escapeHtml(r.name)}</a></td>
        <td>${escapeHtml(r.deleted_at.slice(0, 16).replace("T", " "))}</td>
        <td>
          <form method="post" action="/trash/customers/${escapeHtml(r.id)}/restore" class="inline">
            <button class="btn secondary" type="submit">Restore</button>
          </form>
        </td>
        <td>${hardDeleteForm(
					`/trash/customers/${escapeHtml(r.id)}/hard-delete`,
					"PERMANENTLY delete this customer and ALL their field jobs, print jobs, sites, and portal links? This cannot be undone.",
				)}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="4" class="muted">No archived customers.</td></tr>`;

	const jobRows =
		jobs.results
			?.map(
				(r) => `<tr>
        <td><a href="/jobs/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></td>
        <td>${escapeHtml(r.customer_name) || "—"}</td>
        <td>${escapeHtml(jobTypeLabel(r.job_type))}</td>
        <td>${escapeHtml(r.deleted_at.slice(0, 16).replace("T", " "))}</td>
        <td>
          <form method="post" action="/trash/jobs/${escapeHtml(r.id)}/restore" class="inline">
            <button class="btn secondary" type="submit">Restore</button>
          </form>
        </td>
        <td>${hardDeleteForm(
					`/trash/jobs/${escapeHtml(r.id)}/hard-delete`,
					"PERMANENTLY delete this field job, logs, photos, and maps? This cannot be undone.",
				)}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="6" class="muted">No archived field jobs.</td></tr>`;

	const printRows =
		prints.results
			?.map(
				(r) => `<tr>
        <td><a href="/print/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a></td>
        <td>${escapeHtml(r.customer_name) || "—"}</td>
        <td>${escapeHtml(printProductLabel(r.product_type))}</td>
        <td>${escapeHtml(r.deleted_at.slice(0, 16).replace("T", " "))}</td>
        <td>
          <form method="post" action="/trash/print/${escapeHtml(r.id)}/restore" class="inline">
            <button class="btn secondary" type="submit">Restore</button>
          </form>
        </td>
        <td>${hardDeleteForm(
					`/trash/print/${escapeHtml(r.id)}/hard-delete`,
					"PERMANENTLY delete this print job and its files? This cannot be undone.",
				)}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="6" class="muted">No archived print jobs.</td></tr>`;

	const body = `
    <h1>Trash / Archive</h1>
    <p class="muted">Soft-deleted records. Restore returns them to daily lists.
      <strong>Delete forever</strong> is Owner-only, requires your password, and cannot be undone.
      Deleting a customer also wipes every field/print job under that customer (privacy wipe).
      These actions are recorded in the <a href="/audit">Audit log</a>.</p>
    <h2>Customers</h2>
    <table>
      <thead><tr><th>Name</th><th>Archived</th><th>Restore</th><th>Hard delete</th></tr></thead>
      <tbody>${custRows}</tbody>
    </table>
    <h2>Field jobs</h2>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Type</th><th>Archived</th><th>Restore</th><th>Hard delete</th></tr></thead>
      <tbody>${jobRows}</tbody>
    </table>
    <h2>Print jobs</h2>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Product</th><th>Archived</th><th>Restore</th><th>Hard delete</th></tr></thead>
      <tbody>${printRows}</tbody>
    </table>`;

	return c.html(page(c, "Trash", body));
});

app.post("/trash/customers/:id/restore", async (c) => {
	if (!canAccessTrash(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	await c.env.DB.prepare(
		`UPDATE customers SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "restore",
		entityType: "customer",
		entityId: id,
		summary: `Restored customer ${id}`,
	});
	return c.redirect(`/customers/${id}`);
});

app.post("/trash/jobs/:id/restore", async (c) => {
	if (!canAccessTrash(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	await c.env.DB.prepare(
		`UPDATE jobs SET deleted_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NOT NULL`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "restore",
		entityType: "job",
		entityId: id,
		summary: `Restored field job ${id}`,
	});
	return c.redirect(`/jobs/${id}`);
});

app.post("/trash/print/:id/restore", async (c) => {
	if (!canAccessTrash(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	await c.env.DB.prepare(
		`UPDATE print_jobs SET deleted_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NOT NULL`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "restore",
		entityType: "print_job",
		entityId: id,
		summary: `Restored print job ${id}`,
	});
	return c.redirect(`/print/${id}`);
});

app.post("/trash/customers/:id/hard-delete", async (c) => {
	const denied = await requireHardDeletePassword(c);
	if (denied) return denied;
	const id = c.req.param("id");
	const result = await hardDeleteCustomer(c.env.DB, c.env.UPLOADS, id);
	if (!result.ok) return c.text(result.error, result.status);
	await recordAudit(c, {
		action: "hard_delete",
		entityType: "customer",
		entityId: id,
		summary: `Hard-deleted customer ${id} (and related jobs)`,
	});
	return c.redirect("/trash");
});

app.post("/trash/jobs/:id/hard-delete", async (c) => {
	const denied = await requireHardDeletePassword(c);
	if (denied) return denied;
	const id = c.req.param("id");
	const result = await hardDeleteFieldJob(c.env.DB, c.env.UPLOADS, id);
	if (!result.ok) return c.text(result.error, result.status);
	await recordAudit(c, {
		action: "hard_delete",
		entityType: "job",
		entityId: id,
		summary: `Hard-deleted field job ${id}`,
	});
	return c.redirect("/trash");
});

app.post("/trash/print/:id/hard-delete", async (c) => {
	const denied = await requireHardDeletePassword(c);
	if (denied) return denied;
	const id = c.req.param("id");
	const result = await hardDeletePrintJob(c.env.DB, c.env.UPLOADS, id);
	if (!result.ok) return c.text(result.error, result.status);
	await recordAudit(c, {
		action: "hard_delete",
		entityType: "print_job",
		entityId: id,
		summary: `Hard-deleted print job ${id}`,
	});
	return c.redirect("/trash");
});

app.get("/audit", async (c) => {
	if (!canViewAudit(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Audit log is Super Admin / Owner only."),
			403,
		);
	}
	const events = await listAuditEvents(c.env.DB, 200);
	const rows =
		events
			.map(
				(e) => `<tr>
        <td class="muted" style="white-space:nowrap">${escapeHtml(e.created_at.slice(0, 19).replace("T", " "))}</td>
        <td>${escapeHtml(e.actor_name) || `<span class="muted">${escapeHtml(e.actor_user_id) || "—"}</span>`}</td>
        <td>${escapeHtml(e.action)}</td>
        <td>${escapeHtml(e.entity_type)}<br><code style="font-size:0.75rem">${escapeHtml(e.entity_id)}</code></td>
        <td>${escapeHtml(e.summary)}</td>
        <td class="muted" style="font-size:0.8rem">${escapeHtml(e.ip) || "—"}<br>${escapeHtml(e.request_id) || "—"}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="6" class="muted">No audit events yet.</td></tr>`;

	const body = `
    <h1>Audit log</h1>
    <p class="muted">Append-only ledger of Super Admin governance actions (soft/hard delete, restore, void, user create/deactivate/role/products, price lists).
      Rows cannot be edited or deleted — even by Owners. Showing latest 200.</p>
    <table>
      <thead><tr><th>When (UTC)</th><th>Actor</th><th>Action</th><th>Entity</th><th>Summary</th><th>IP / Request</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
	return c.html(page(c, "Audit", body));
});

app.get("/settings/price-lists", async (c) => {
	if (!canManagePriceLists(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Price lists are Super Admin / Owner only."),
			403,
		);
	}
	const productFilter = String(c.req.query("product") || "");
	const showInactive = c.req.query("inactive") === "1";
	const items = await listPriceItems(c.env.DB, {
		product:
			productFilter === "restoration" || productFilter === "floors"
				? productFilter
				: "",
		activeOnly: !showInactive,
	});

	const filterLinks = [
		{ href: "/settings/price-lists", label: "All active", on: !productFilter && !showInactive },
		{
			href: "/settings/price-lists?product=restoration",
			label: "Mitigation",
			on: productFilter === "restoration" && !showInactive,
		},
		{
			href: "/settings/price-lists?product=floors",
			label: "Floors",
			on: productFilter === "floors" && !showInactive,
		},
		{
			href: "/settings/price-lists?inactive=1",
			label: "Include inactive",
			on: showInactive && !productFilter,
		},
	]
		.map(
			(l) =>
				`<a href="${l.href}"${l.on ? ' style="font-weight:700"' : ""}>${escapeHtml(l.label)}</a>`,
		)
		.join(" · ");

	const categoryOptions = COST_CATEGORIES.map(
		(cat) =>
			`<option value="${escapeHtml(cat.value)}">${escapeHtml(cat.label)}</option>`,
	).join("");
	const productOptions = PRICE_LIST_PRODUCTS.map(
		(p) =>
			`<option value="${escapeHtml(p.value)}">${escapeHtml(p.label)}</option>`,
	).join("");

	const rows =
		items
			.map(
				(item) => `<tr${item.active ? "" : ' style="opacity:0.55"'}>
        <td>${escapeHtml(priceListProductLabel(item.product))}</td>
        <td>${escapeHtml(priceListCategoryLabel(item.category))}</td>
        <td><a href="/settings/price-lists/${escapeHtml(item.id)}">${escapeHtml(item.name)}</a>${item.active ? "" : " <span class=\"muted\">(inactive)</span>"}</td>
        <td>${escapeHtml(item.unit)}</td>
        <td>${escapeHtml(money(item.unit_cents))}</td>
        <td class="muted">${escapeHtml(item.sort_order)}</td>
      </tr>`,
			)
			.join("") ||
		`<tr><td colspan="6" class="muted">No rates yet — add your first below. No seeded prices (Owner sets real rates).</td></tr>`;

	const body = `
    <h1>Price lists</h1>
    <p class="muted">Owner rate matrix for mitigation and hard-floor estimates. Staff can pick a rate on the estimate form to prefill description, unit, and unit price.
      Print margin rules and labor-rate tables are later SA-6 slices.</p>
    <p>${filterLinks}</p>
    <table>
      <thead><tr><th>Product</th><th>Category</th><th>Name</th><th>Unit</th><th>Unit $</th><th>Sort</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Add rate</h2>
    <form method="post" action="/settings/price-lists" class="panel stack">
      <div class="row">
        <div><label for="product">Product</label>
          <select id="product" name="product" required>${productOptions}</select></div>
        <div><label for="category">Category</label>
          <select id="category" name="category" required>${categoryOptions}</select></div>
        <div class="grow"><label for="name">Name</label>
          <input id="name" name="name" required maxlength="200" placeholder="Air mover — daily" /></div>
      </div>
      <div class="row">
        <div><label for="unit">Unit</label>
          <input id="unit" name="unit" value="ea" required maxlength="32" /></div>
        <div><label for="unit_dollars">Unit price ($)</label>
          <input id="unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" required value="0" /></div>
        <div><label for="sort_order">Sort</label>
          <input id="sort_order" name="sort_order" type="number" step="1" value="0" /></div>
      </div>
      <div><label for="notes">Notes</label>
        <input id="notes" name="notes" placeholder="Optional internal note" /></div>
      <button class="btn" type="submit">Add to price list</button>
    </form>`;
	return c.html(page(c, "Price lists", body));
});

app.post("/settings/price-lists", async (c) => {
	if (!canManagePriceLists(c.get("user")!)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	const parsed = parsePriceListForm(form as Record<string, unknown>);
	if (!parsed.ok) return c.text(parsed.error, 400);
	const id = newId("pli");
	await c.env.DB.prepare(
		`INSERT INTO price_list_items (
      id, product, category, name, unit, unit_cents, active, sort_order, notes
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
	)
		.bind(
			id,
			parsed.product,
			parsed.category,
			parsed.name,
			parsed.unit,
			parsed.unitCents,
			parsed.sortOrder,
			parsed.notes,
		)
		.run();
	await recordAudit(c, {
		action: "price_list_create",
		entityType: "price_list_item",
		entityId: id,
		summary: `Created price list item ${parsed.name}`,
		detail: {
			product: parsed.product,
			category: parsed.category,
			unit: parsed.unit,
			unit_cents: parsed.unitCents,
		},
	});
	return c.redirect("/settings/price-lists");
});

app.get("/settings/price-lists/:id", async (c) => {
	if (!canManagePriceLists(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Price lists are Super Admin / Owner only."),
			403,
		);
	}
	const id = c.req.param("id");
	const item = await getPriceItem(c.env.DB, id);
	if (!item) return c.notFound();

	const categoryOptions = COST_CATEGORIES.map(
		(cat) =>
			`<option value="${escapeHtml(cat.value)}"${cat.value === item.category ? " selected" : ""}>${escapeHtml(cat.label)}</option>`,
	).join("");
	const productOptions = PRICE_LIST_PRODUCTS.map(
		(p) =>
			`<option value="${escapeHtml(p.value)}"${p.value === item.product ? " selected" : ""}>${escapeHtml(p.label)}</option>`,
	).join("");

	const activeForm = item.active
		? `<form method="post" action="/settings/price-lists/${escapeHtml(id)}/active" class="inline"
        onsubmit="return confirm('Deactivate this rate? It will hide from estimate pickers.');">
        <input type="hidden" name="active" value="0" />
        <button class="btn secondary" type="submit">Deactivate</button>
      </form>`
		: `<form method="post" action="/settings/price-lists/${escapeHtml(id)}/active" class="inline">
        <input type="hidden" name="active" value="1" />
        <button class="btn" type="submit">Reactivate</button>
      </form>`;

	const body = `
    <p><a href="/settings/price-lists">← Price lists</a></p>
    <h1>${escapeHtml(item.name)}</h1>
    <p class="muted">${item.active ? "Active" : "Inactive"} · used as a default on estimates; line items stay editable after pick.</p>
    <form method="post" action="/settings/price-lists/${escapeHtml(id)}" class="panel stack">
      <div class="row">
        <div><label for="product">Product</label>
          <select id="product" name="product" required>${productOptions}</select></div>
        <div><label for="category">Category</label>
          <select id="category" name="category" required>${categoryOptions}</select></div>
        <div class="grow"><label for="name">Name</label>
          <input id="name" name="name" required maxlength="200" value="${escapeHtml(item.name)}" /></div>
      </div>
      <div class="row">
        <div><label for="unit">Unit</label>
          <input id="unit" name="unit" required maxlength="32" value="${escapeHtml(item.unit)}" /></div>
        <div><label for="unit_dollars">Unit price ($)</label>
          <input id="unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" required
            value="${escapeHtml(centsToDollarsInput(item.unit_cents))}" /></div>
        <div><label for="sort_order">Sort</label>
          <input id="sort_order" name="sort_order" type="number" step="1" value="${escapeHtml(item.sort_order)}" /></div>
      </div>
      <div><label for="notes">Notes</label>
        <input id="notes" name="notes" value="${escapeHtml(item.notes)}" /></div>
      <button class="btn" type="submit">Save</button>
    </form>
    <div class="toolbar" style="margin-top:1rem">${activeForm}</div>`;
	return c.html(page(c, item.name, body));
});

app.post("/settings/price-lists/:id", async (c) => {
	if (!canManagePriceLists(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const existing = await getPriceItem(c.env.DB, id);
	if (!existing) return c.notFound();
	const form = await c.req.parseBody();
	const parsed = parsePriceListForm(form as Record<string, unknown>);
	if (!parsed.ok) return c.text(parsed.error, 400);
	await c.env.DB.prepare(
		`UPDATE price_list_items SET
      product = ?, category = ?, name = ?, unit = ?, unit_cents = ?,
      sort_order = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
	)
		.bind(
			parsed.product,
			parsed.category,
			parsed.name,
			parsed.unit,
			parsed.unitCents,
			parsed.sortOrder,
			parsed.notes,
			id,
		)
		.run();
	await recordAudit(c, {
		action: "price_list_update",
		entityType: "price_list_item",
		entityId: id,
		summary: `Updated price list item ${parsed.name}`,
		detail: {
			before: {
				name: existing.name,
				unit_cents: existing.unit_cents,
				product: existing.product,
			},
			after: {
				name: parsed.name,
				unit_cents: parsed.unitCents,
				product: parsed.product,
			},
		},
	});
	return c.redirect(`/settings/price-lists/${id}`);
});

app.post("/settings/price-lists/:id/active", async (c) => {
	if (!canManagePriceLists(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const existing = await getPriceItem(c.env.DB, id);
	if (!existing) return c.notFound();
	const form = await c.req.parseBody();
	const nextActive = String(form.active || "") === "1" ? 1 : 0;
	await c.env.DB.prepare(
		`UPDATE price_list_items SET active = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(nextActive, id)
		.run();
	await recordAudit(c, {
		action: nextActive ? "price_list_reactivate" : "price_list_deactivate",
		entityType: "price_list_item",
		entityId: id,
		summary: `${nextActive ? "Reactivated" : "Deactivated"} price list item ${existing.name}`,
	});
	return c.redirect(`/settings/price-lists/${id}`);
});

app.get("/settings/print-margins", async (c) => {
	if (!canManagePrintMargins(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Print margin rules are Super Admin / Owner only."),
			403,
		);
	}
	const settings = await getPrintMarginSettings(c.env.DB);
	const tierRows = [1, 2, 3, 4, 5]
		.map((i) => {
			const tier = settings.volume_tiers[i - 1];
			return `<div class="row">
        <div><label for="tier_${i}_min">Tier ${i} min qty</label>
          <input id="tier_${i}_min" name="tier_${i}_min" type="number" step="1" min="0"
            value="${tier ? escapeHtml(tier.min_qty) : ""}" placeholder="e.g. 500" /></div>
        <div><label for="tier_${i}_pct">Extra markup %</label>
          <input id="tier_${i}_pct" name="tier_${i}_pct" type="number" step="0.1"
            value="${tier ? escapeHtml(tier.markup_pct) : ""}" placeholder="e.g. 5" /></div>
      </div>`;
		})
		.join("");

	const body = `
    <p><a href="/settings/price-lists">← Price lists</a></p>
    <h1>Print margin rules</h1>
    <p class="muted">Owner defaults for Print Ops quotes. When staff enter a <strong>unit cost</strong> and check
      <em>Apply margin rules</em>, sell unit price is suggested as:
      cost × (1+cost-plus%) × (1+material%) × (1+volume tier%) + setup÷qty.
      Suggested price stays editable. No market rates are invented here — you set the percentages.</p>
    <p class="muted">Current: ${escapeHtml(summarizeMarginSettings(settings))}</p>
    <form method="post" action="/settings/print-margins" class="panel stack">
      <div class="row">
        <div><label for="cost_plus_pct">Cost-plus markup %</label>
          <input id="cost_plus_pct" name="cost_plus_pct" type="number" step="0.1" min="0" max="1000"
            required value="${escapeHtml(settings.cost_plus_pct)}" /></div>
        <div><label for="material_markup_pct">Material markup %</label>
          <input id="material_markup_pct" name="material_markup_pct" type="number" step="0.1" min="0" max="1000"
            required value="${escapeHtml(settings.material_markup_pct)}" /></div>
        <div><label for="setup_fee_dollars">Setup fee ($)</label>
          <input id="setup_fee_dollars" name="setup_fee_dollars" type="number" step="0.01" min="0"
            required value="${escapeHtml(centsToDollarsInput(settings.setup_fee_cents))}" /></div>
      </div>
      <h2>Volume tiers (optional)</h2>
      <p class="muted">Highest matching min qty wins. Leave blank to skip.</p>
      ${tierRows}
      <button class="btn" type="submit">Save print margins</button>
    </form>`;
	return c.html(page(c, "Print margins", body));
});

app.post("/settings/print-margins", async (c) => {
	if (!canManagePrintMargins(c.get("user")!)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	const parsed = parseMarginSettingsForm(form as Record<string, unknown>);
	if (!parsed.ok) return c.text(parsed.error, 400);
	const before = await getPrintMarginSettings(c.env.DB);
	await c.env.DB.prepare(
		`INSERT INTO print_margin_settings (
      id, cost_plus_pct, material_markup_pct, setup_fee_cents, volume_tiers_json, updated_at, updated_by
    ) VALUES ('default', ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET
      cost_plus_pct = excluded.cost_plus_pct,
      material_markup_pct = excluded.material_markup_pct,
      setup_fee_cents = excluded.setup_fee_cents,
      volume_tiers_json = excluded.volume_tiers_json,
      updated_at = datetime('now'),
      updated_by = excluded.updated_by`,
	)
		.bind(
			parsed.cost_plus_pct,
			parsed.material_markup_pct,
			parsed.setup_fee_cents,
			serializeVolumeTiers(parsed.volume_tiers),
			c.get("user")!.id,
		)
		.run();
	await recordAudit(c, {
		action: "print_margin_update",
		entityType: "print_margin_settings",
		entityId: "default",
		summary: "Updated print margin rules",
		detail: {
			before: {
				cost_plus_pct: before.cost_plus_pct,
				material_markup_pct: before.material_markup_pct,
				setup_fee_cents: before.setup_fee_cents,
				volume_tiers: before.volume_tiers,
			},
			after: {
				cost_plus_pct: parsed.cost_plus_pct,
				material_markup_pct: parsed.material_markup_pct,
				setup_fee_cents: parsed.setup_fee_cents,
				volume_tiers: parsed.volume_tiers,
			},
		},
	});
	return c.redirect("/settings/print-margins");
});

app.get("/settings/labor-rates", async (c) => {
	if (!canManageLaborRates(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Labor rates are Super Admin / Owner only."),
			403,
		);
	}
	const rates = await listLaborRates(c.env.DB);
	const byDesignation = new Map(rates.map((r) => [r.designation, r]));
	const rows = laborRateDesignations()
		.map((d) => {
			const row = byDesignation.get(d.value);
			const hourly = row?.hourly_cents ?? 0;
			const active = row?.active ?? 1;
			return `<tr${active ? "" : ' style="opacity:0.55"'}>
        <td>${escapeHtml(d.label)}${active ? "" : ' <span class="muted">(inactive)</span>'}</td>
        <td>
          <form method="post" action="/settings/labor-rates" class="toolbar" style="align-items:end;gap:0.5rem">
            <input type="hidden" name="designation" value="${escapeHtml(d.value)}" />
            <div>
              <label for="hourly_${escapeHtml(d.value)}">$/hr</label>
              <input id="hourly_${escapeHtml(d.value)}" name="hourly_dollars" type="number" step="0.01" min="0"
                required value="${escapeHtml((hourly / 100).toFixed(2))}" style="max-width:7rem" />
            </div>
            <label style="font-weight:400">
              <input type="checkbox" name="active" value="1"${active ? " checked" : ""} /> Active
            </label>
            <button class="btn secondary" type="submit">Save</button>
          </form>
        </td>
      </tr>`;
		})
		.join("");

	const body = `
    <p><a href="/settings/print-margins">← Print margins</a> · <a href="/settings/price-lists">Price lists</a></p>
    <h1>Labor rates</h1>
    <p class="muted">Internal hourly rates by designation for job-cost margin math.
      <strong>Not payroll</strong> — staff pay is not stored or calculated here.
      On a field job, use <em>Use labor rate</em> to prefill a labor cost line.</p>
    <table>
      <thead><tr><th>Designation</th><th>Internal rate</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
	return c.html(page(c, "Labor rates", body));
});

app.post("/settings/labor-rates", async (c) => {
	if (!canManageLaborRates(c.get("user")!)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	// Checkbox omitted when unchecked — treat missing active as 0.
	if (!("active" in form)) {
		(form as Record<string, unknown>).active = "0";
	}
	const parsed = parseLaborRateForm(form as Record<string, unknown>);
	if (!parsed.ok) return c.text(parsed.error, 400);
	const before = await getLaborRate(c.env.DB, parsed.designation);
	await c.env.DB.prepare(
		`INSERT INTO labor_rates (designation, hourly_cents, active, updated_at, updated_by)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(designation) DO UPDATE SET
       hourly_cents = excluded.hourly_cents,
       active = excluded.active,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
	)
		.bind(
			parsed.designation,
			parsed.hourly_cents,
			parsed.active,
			c.get("user")!.id,
		)
		.run();
	await recordAudit(c, {
		action: "labor_rate_update",
		entityType: "labor_rate",
		entityId: parsed.designation,
		summary: `Updated labor rate for ${roleLabel(parsed.designation)}`,
		detail: {
			before: before
				? { hourly_cents: before.hourly_cents, active: before.active }
				: null,
			after: {
				hourly_cents: parsed.hourly_cents,
				active: parsed.active,
			},
		},
	});
	return c.redirect("/settings/labor-rates");
});

app.get("/settings/discount-caps", async (c) => {
	if (!canManageDiscountCaps(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Discount caps are Super Admin / Owner only."),
			403,
		);
	}
	const settings = await getDiscountCapSettings(c.env.DB);
	const body = `
    <p><a href="/settings/labor-rates">← Labor rates</a> · <a href="/settings/price-lists">Price lists</a></p>
    <h1>Discount / write-off caps</h1>
    <p class="muted">Owner policy for invoice discounts &amp; write-offs. <strong>Enforced</strong> on invoice save / approve / send (MG-3.1).
      Hard max blocks everyone; Owner-approval threshold blocks non-Owners on approve/send.</p>
    <p class="muted">Current: ${escapeHtml(summarizeDiscountCaps(settings))}</p>
    <form method="post" action="/settings/discount-caps" class="panel stack">
      <div class="row">
        <div><label for="max_discount_pct">Max discount %</label>
          <input id="max_discount_pct" name="max_discount_pct" type="number" step="0.1" min="0" max="100"
            required value="${escapeHtml(settings.max_discount_pct)}" /></div>
        <div><label for="max_writeoff_dollars">Max write-off ($)</label>
          <input id="max_writeoff_dollars" name="max_writeoff_dollars" type="number" step="0.01" min="0"
            required value="${escapeHtml((settings.max_writeoff_cents / 100).toFixed(2))}" /></div>
        <div><label for="owner_approval_pct">Owner approval at ≥ %</label>
          <input id="owner_approval_pct" name="owner_approval_pct" type="number" step="0.1" min="0" max="100"
            required value="${escapeHtml(settings.owner_approval_pct)}"
            title="Discounts at or above this % require Owner approval on invoice approve/send" /></div>
      </div>
      <p class="muted" style="margin:0;font-size:0.85rem">Use 0 to mean “unset / not limited” for that field until you choose a real cap.</p>
      <button class="btn" type="submit">Save discount caps</button>
    </form>`;
	return c.html(page(c, "Discount caps", body));
});

app.post("/settings/discount-caps", async (c) => {
	if (!canManageDiscountCaps(c.get("user")!)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	const parsed = parseDiscountCapForm(form as Record<string, unknown>);
	if (!parsed.ok) return c.text(parsed.error, 400);
	const before = await getDiscountCapSettings(c.env.DB);
	await c.env.DB.prepare(
		`INSERT INTO discount_cap_settings (
      id, max_discount_pct, max_writeoff_cents, owner_approval_pct, updated_at, updated_by
    ) VALUES ('default', ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET
      max_discount_pct = excluded.max_discount_pct,
      max_writeoff_cents = excluded.max_writeoff_cents,
      owner_approval_pct = excluded.owner_approval_pct,
      updated_at = datetime('now'),
      updated_by = excluded.updated_by`,
	)
		.bind(
			parsed.max_discount_pct,
			parsed.max_writeoff_cents,
			parsed.owner_approval_pct,
			c.get("user")!.id,
		)
		.run();
	await recordAudit(c, {
		action: "discount_cap_update",
		entityType: "discount_cap_settings",
		entityId: "default",
		summary: "Updated discount / write-off caps",
		detail: {
			before: {
				max_discount_pct: before.max_discount_pct,
				max_writeoff_cents: before.max_writeoff_cents,
				owner_approval_pct: before.owner_approval_pct,
			},
			after: parsed,
		},
	});
	return c.redirect("/settings/discount-caps");
});

app.get("/", async (c) => {
	const user = c.get("user")!;
	const today = new Date().toISOString().slice(0, 10);
	const office = canSeeOfficeTools(user);
	const vis = fieldJobVisibility(user);
	const fieldWhere = ["status != 'cancelled'", "deleted_at IS NULL"];
	const fieldBinds: string[] = [];
	if (vis.sql !== "1=1") {
		fieldWhere.push(vis.sql.replace(/^j\./, ""));
		fieldBinds.push(...vis.binds);
	}
	const hasR = canAccessProduct(user, "restoration");
	const hasF = canAccessProduct(user, "floors");
	if (!hasR && !hasF) {
		fieldWhere.push("0=1");
	} else if (!(hasR && hasF)) {
		if (hasR) {
			fieldWhere.push(
				`job_type IN (${RESTORATION_SQL_TYPES.map(() => "?").join(",")})`,
			);
			fieldBinds.push(...RESTORATION_SQL_TYPES);
		} else {
			fieldWhere.push(
				`job_type IN (${FLOOR_TYPE_VALUES.map(() => "?").join(",")})`,
			);
			fieldBinds.push(...FLOOR_TYPE_VALUES);
		}
	}

	const fieldCountsStmt = c.env.DB.prepare(
		`SELECT
      SUM(CASE WHEN status = 'lead' THEN 1 ELSE 0 END) AS lead_n,
      SUM(CASE WHEN status = 'estimate' THEN 1 ELSE 0 END) AS estimate_n,
      SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_n,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS active_n,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS complete_n,
      SUM(CASE WHEN status = 'invoiced' THEN 1 ELSE 0 END) AS invoiced_n
     FROM jobs WHERE ${fieldWhere.join(" AND ")}`,
	);
	const fieldCounts = await (
		fieldBinds.length ? fieldCountsStmt.bind(...fieldBinds) : fieldCountsStmt
	).first<{
		lead_n: number;
		estimate_n: number;
		scheduled_n: number;
		active_n: number;
		complete_n: number;
		invoiced_n: number;
	}>();

	const printVis = printJobVisibility(user);
	let printCounts: {
		intake_n: number;
		proof_n: number;
		press_n: number;
		ready_n: number;
	} | null = null;
	if (canAccessProduct(user, "print")) {
		const printWhere = ["status != 'cancelled'", "deleted_at IS NULL"];
		const printBinds: string[] = [];
		if (printVis.sql !== "1=1") {
			printWhere.push(printVis.sql.replace(/^p\./, ""));
			printBinds.push(...printVis.binds);
		}
		const printStmt = c.env.DB.prepare(
			`SELECT
        SUM(CASE WHEN status = 'intake' THEN 1 ELSE 0 END) AS intake_n,
        SUM(CASE WHEN status = 'proof' THEN 1 ELSE 0 END) AS proof_n,
        SUM(CASE WHEN status IN ('approved','in_production') THEN 1 ELSE 0 END) AS press_n,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_n
       FROM print_jobs WHERE ${printWhere.join(" AND ")}`,
		);
		printCounts = await (printBinds.length
			? printStmt.bind(...printBinds)
			: printStmt
		).first();
	}

	const listWhere: string[] = [];
	const listBinds: string[] = [];
	appendFieldJobListFilters(
		user,
		listWhere,
		listBinds,
		RESTORATION_SQL_TYPES,
		FLOOR_TYPE_VALUES,
	);
	const listFilter =
		listWhere.length > 0 ? `AND ${listWhere.join(" AND ")}` : "";

	let bottleneckHtml = "";
	if (office) {
		const fieldFilters =
			hasR || hasF
				? {
						whereSql: listWhere.join(" AND "),
						binds: [...listBinds],
					}
				: null;
		const printFilters = canAccessProduct(user, "print")
			? printBottleneckFilters(printVis)
			: null;
		const sections = await loadBottleneckSections(c.env.DB, {
			today,
			field: fieldFilters,
			print: printFilters,
		});
		bottleneckHtml = renderBottleneckStrip(sections);
	}

	const todayJobs = await (listBinds.length
		? c.env.DB.prepare(
				`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name
         FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         WHERE j.status IN ('scheduled','in_progress')
           AND j.scheduled_start IS NOT NULL
           AND date(j.scheduled_start) = date(?)
           ${listFilter}
         ORDER BY j.scheduled_start ASC
         LIMIT 12`,
			).bind(today, ...listBinds)
		: c.env.DB.prepare(
				`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name
         FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         WHERE j.status IN ('scheduled','in_progress')
           AND j.scheduled_start IS NOT NULL
           AND date(j.scheduled_start) = date(?)
           ${listFilter}
         ORDER BY j.scheduled_start ASC
         LIMIT 12`,
			).bind(today)
	).all<{
		id: string;
		title: string;
		job_type: string;
		status: string;
		scheduled_start: string | null;
		customer_name: string;
	}>();

	const upcoming = await (listBinds.length
		? c.env.DB.prepare(
				`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name
         FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         WHERE j.status IN ('scheduled','in_progress')
           AND (j.scheduled_start IS NULL OR date(j.scheduled_start) > date(?))
           ${listFilter}
         ORDER BY COALESCE(j.scheduled_start, '9999') ASC
         LIMIT 8`,
			).bind(today, ...listBinds)
		: c.env.DB.prepare(
				`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name
         FROM jobs j
         JOIN customers c ON c.id = j.customer_id
         WHERE j.status IN ('scheduled','in_progress')
           AND (j.scheduled_start IS NULL OR date(j.scheduled_start) > date(?))
           ${listFilter}
         ORDER BY COALESCE(j.scheduled_start, '9999') ASC
         LIMIT 8`,
			).bind(today)
	).all<{
		id: string;
		title: string;
		job_type: string;
		status: string;
		scheduled_start: string | null;
		customer_name: string;
	}>();

	const todayRows =
		todayJobs.results
			?.map(
				(j) => `<tr>
        <td><a href="/jobs/${escapeHtml(j.id)}">${escapeHtml(j.title)}</a></td>
        <td>${escapeHtml(j.customer_name)}</td>
        <td>${escapeHtml(jobTypeLabel(j.job_type))}</td>
        <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span></td>
        <td>${escapeHtml(j.scheduled_start ? j.scheduled_start.slice(0, 16).replace("T", " ") : "—")}</td>
      </tr>`,
			)
			.join("") ||
		`<tr><td colspan="5" class="muted">Nothing scheduled for today.</td></tr>`;

	const upcomingRows =
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
			.join("") ||
		`<tr><td colspan="5" class="muted">No later scheduled jobs.</td></tr>`;

	const productCards = PRODUCTS.filter((p) => canAccessProduct(user, p.key))
		.map(
			(p) => `<a class="product-card" href="${escapeHtml(p.href)}">
      <h2>${escapeHtml(p.title)}</h2>
      <p class="muted">${escapeHtml(p.blurb)}</p>
      ${p.siteHint ? `<p class="muted" style="font-size:0.85rem">${escapeHtml(p.siteHint)}</p>` : ""}
      <span class="btn">Open</span>
    </a>`,
		)
		.join("");

	const fc = fieldCounts;
	const pc = printCounts;

	const quickLinks: string[] = [];
	if (office) quickLinks.push(`<a href="/leads">Leads</a>`);
	quickLinks.push(`<a href="/calendar">Calendar</a>`);
	if (hasR) quickLinks.push(`<a href="/restoration">Restoration</a>`);
	if (hasF) quickLinks.push(`<a href="/floors">Floors</a>`);
	if (canAccessProduct(user, "print")) {
		quickLinks.push(`<a href="/print/board">Press board</a>`);
	}
	if (office) quickLinks.push(`<a href="/reports">Reports</a>`);
	quickLinks.push(`<a href="/inventory">Inventory</a>`);
	if (office) quickLinks.push(`<a href="/customers/new">New customer</a>`);
	quickLinks.push(`<a href="/tech">My day</a>`);

	const fieldStats =
		hasR || hasF
			? `<h2 style="margin-top:0.5rem">Field jobs</h2>
    <div class="grid" style="margin-bottom:1rem">
      ${office ? `<a class="stat" href="/leads?stage=lead"><div class="n">${fc?.lead_n ?? 0}</div><div class="l">Lead</div></a>
      <a class="stat" href="/leads?stage=estimate"><div class="n">${fc?.estimate_n ?? 0}</div><div class="l">Estimate</div></a>` : ""}
      <a class="stat" href="/jobs?status=scheduled"><div class="n">${fc?.scheduled_n ?? 0}</div><div class="l">Scheduled</div></a>
      <a class="stat" href="/jobs?status=in_progress"><div class="n">${fc?.active_n ?? 0}</div><div class="l">In progress</div></a>
      <a class="stat" href="/jobs?status=complete"><div class="n">${fc?.complete_n ?? 0}</div><div class="l">Complete</div></a>
      <a class="stat" href="/jobs?status=invoiced"><div class="n">${fc?.invoiced_n ?? 0}</div><div class="l">Invoiced</div></a>
    </div>`
			: "";

	const printStats = canAccessProduct(user, "print")
		? `<h2>Print jobs</h2>
    <div class="grid" style="margin-bottom:1rem">
      <a class="stat" href="/print?status=intake"><div class="n">${pc?.intake_n ?? 0}</div><div class="l">Intake</div></a>
      <a class="stat" href="/print?status=proof"><div class="n">${pc?.proof_n ?? 0}</div><div class="l">Proof</div></a>
      <a class="stat" href="/print/board"><div class="n">${pc?.press_n ?? 0}</div><div class="l">Approved / press</div></a>
      <a class="stat" href="/print?status=ready"><div class="n">${pc?.ready_n ?? 0}</div><div class="l">Ready</div></a>
    </div>`
		: "";

	const newJobBtns: string[] = [];
	if (hasR && office) {
		newJobBtns.push(
			`<a class="btn" href="/jobs/new?product=restoration">New restoration job</a>`,
		);
	}
	if (hasF && office) {
		newJobBtns.push(
			`<a class="btn secondary" href="/jobs/new?product=floors">New floor job</a>`,
		);
	}
	if (canAccessProduct(user, "print") && office) {
		newJobBtns.push(`<a class="btn secondary" href="/print/new">New print job</a>`);
	}

	const body = `
    <h1>Ops dashboard</h1>
    <p class="muted">Live snapshot for ${escapeHtml(today)}. ${office ? "Product shells below." : "Showing jobs assigned to you."}</p>

    <div class="quick-links">
      ${quickLinks.join("\n      ")}
    </div>

    ${bottleneckHtml}
    ${fieldStats}
    ${printStats}

    <h2>Today's schedule</h2>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${todayRows}</tbody>
    </table>

    <h2>Up next</h2>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${upcomingRows}</tbody>
    </table>

    ${
			productCards
				? `<h2>Products</h2>
    <div class="product-grid">${productCards}</div>`
				: ""
		}
    ${
			newJobBtns.length
				? `<div class="toolbar">${newJobBtns.join("\n      ")}</div>`
				: ""
		}`;

	return c.html(page(c, "Dashboard", body));
});

app.get("/restoration", async (c) => {
	if (!canAccessProduct(c.get("user")!, "restoration")) {
		return c.html(
			forbiddenHtml(c, "Your account does not include Restoration."),
			403,
		);
	}
	const q = new URLSearchParams(c.req.query());
	q.set("product", "restoration");
	return c.redirect(`/jobs?${q.toString()}`);
});

app.get("/floors", async (c) => {
	if (!canAccessProduct(c.get("user")!, "floors")) {
		return c.html(
			forbiddenHtml(c, "Your account does not include Floors."),
			403,
		);
	}
	const q = new URLSearchParams(c.req.query());
	q.set("product", "floors");
	return c.redirect(`/jobs?${q.toString()}`);
});

app.get("/customers", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Customer directory is for owner / dispatcher."),
			403,
		);
	}
	const q = (c.req.query("q") || "").trim();
	const list = q
		? await c.env.DB.prepare(
				`SELECT id, name, phone, email, created_at FROM customers
         WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
         ORDER BY name COLLATE NOCASE LIMIT 100`,
			)
				.bind(`%${q}%`, `%${q}%`, `%${q}%`)
				.all()
		: await c.env.DB.prepare(
				`SELECT id, name, phone, email, created_at FROM customers
         WHERE deleted_at IS NULL
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
	if (!canSeeOfficeTools(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Customer directory is for owner / dispatcher."),
			403,
		);
	}
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
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
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
	if (!canSeeOfficeTools(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Customer directory is for owner / dispatcher."),
			403,
		);
	}
	const id = c.req.param("id");
	const user = c.get("user")!;
	const customer = await c.env.DB.prepare(
		`SELECT id, name, phone, email, notes, deleted_at FROM customers WHERE id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			name: string;
			phone: string | null;
			email: string | null;
			notes: string | null;
			deleted_at: string | null;
		}>();
	if (!customer) return c.notFound();
	if (customer.deleted_at && !canAccessTrash(user)) {
		return c.notFound();
	}

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
     WHERE customer_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
	)
		.bind(id)
		.all<{
			id: string;
			title: string;
			job_type: string;
			status: string;
			scheduled_start: string | null;
		}>();

	const tokens = await c.env.DB.prepare(
		`SELECT id, label, expires_at, created_at, revoked_at, last_used_at
     FROM portal_tokens WHERE customer_id = ?
     ORDER BY created_at DESC LIMIT 10`,
	)
		.bind(id)
		.all<{
			id: string;
			label: string | null;
			expires_at: string;
			created_at: string;
			revoked_at: string | null;
			last_used_at: string | null;
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

	const tokenRows =
		tokens.results
			?.map((t) => {
				const status = t.revoked_at
					? "Revoked"
					: new Date(t.expires_at) < new Date()
						? "Expired"
						: "Active";
				return `<tr>
        <td>${escapeHtml(t.label) || "—"}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(t.expires_at.slice(0, 10))}</td>
        <td>${t.last_used_at ? escapeHtml(t.last_used_at.slice(0, 16).replace("T", " ")) : "—"}</td>
        <td>${
					!t.revoked_at && new Date(t.expires_at) >= new Date()
						? `<form method="post" action="/customers/${escapeHtml(id)}/portal/${escapeHtml(t.id)}/revoke" class="inline" onsubmit="return confirm('Revoke this portal link?');">
            <button class="linkish" type="submit">Revoke</button>
          </form>`
						: ""
				}</td>
      </tr>`;
			})
			.join("") || `<tr><td colspan="5" class="muted">No portal links yet.</td></tr>`;

	const minted = c.req.query("minted") || "";
	const mintedFlash = minted
		? `<div class="flash">
        Portal link created. Copy now — it won’t be shown again.<br>
        <code style="word-break:break-all">/portal/enter?t=${escapeHtml(minted)}</code><br>
        Or code: <code style="word-break:break-all">${escapeHtml(minted)}</code>
      </div>`
		: "";

	const body = `
    ${
			customer.deleted_at
				? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">This customer is archived (soft-deleted) on ${escapeHtml(customer.deleted_at.slice(0, 16).replace("T", " "))}. Restore from Trash to use in daily lists.</div>`
				: ""
		}
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">${escapeHtml(customer.name)}</h1></div>
      ${
				customer.deleted_at
					? canAccessTrash(c.get("user")!)
						? `<form method="post" action="/trash/customers/${escapeHtml(customer.id)}/restore" class="inline"><button class="btn" type="submit">Restore</button></form>`
						: ""
					: canSoftDelete(c.get("user")!)
						? `<form method="post" action="/customers/${escapeHtml(customer.id)}/archive" class="inline" onsubmit="return confirm('Archive this customer? Hidden from lists; Super Admin can restore from Trash.');"><button class="btn secondary" type="submit">Archive</button></form>`
						: ""
			}
      ${
				customer.deleted_at
					? ""
					: `<a class="btn" href="/jobs/new?product=restoration&customer_id=${escapeHtml(customer.id)}">New restoration</a>
      <a class="btn secondary" href="/jobs/new?product=floors&customer_id=${escapeHtml(customer.id)}">New floor job</a>`
			}
    </div>
    ${mintedFlash}
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
    </table>
    <h2>Customer portal</h2>
    <p class="muted">Read-only magic link — customer sees job status, schedule, notes, and moisture summary.</p>
    <form method="post" action="/customers/${escapeHtml(id)}/portal" class="panel toolbar" style="align-items:end">
      <div class="grow">
        <label for="label">Label (optional)</label>
        <input id="label" name="label" placeholder="Homeowner text link" />
      </div>
      <button class="btn" type="submit">Create portal link</button>
    </form>
    <table>
      <thead><tr><th>Label</th><th>Status</th><th>Expires</th><th>Last used</th><th></th></tr></thead>
      <tbody>${tokenRows}</tbody>
    </table>`;

	return c.html(page(c, customer.name, body));
});

app.post("/customers/:id/portal", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const customer = await c.env.DB.prepare(
		`SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL`,
	)
		.bind(id)
		.first();
	if (!customer) return c.notFound();
	const form = await c.req.parseBody();
	const minted = await mintPortalToken(
		c.env.DB,
		id,
		c.get("user")!.id ?? null,
		String(form.label || ""),
	);
	return c.redirect(
		`/customers/${id}?minted=${encodeURIComponent(minted.rawToken)}`,
	);
});

app.post("/customers/:id/portal/:tokenId/revoke", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const tokenId = c.req.param("tokenId");
	await revokePortalToken(c.env.DB, tokenId, id);
	return c.redirect(`/customers/${id}`);
});

app.get("/leads", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) {
		return c.html(
			forbiddenHtml(c, "Lead pipeline is for owner / dispatcher."),
			403,
		);
	}
	const product = c.req.query("product") || "";
	const tech = c.req.query("tech") || "";
	const stage = c.req.query("stage") || ""; // lead | estimate | ""

	const where: string[] = ["j.status IN ('lead', 'estimate')"];
	const binds: string[] = [];
	appendFieldJobListFilters(
		c.get("user")!,
		where,
		binds,
		RESTORATION_SQL_TYPES,
		FLOOR_TYPE_VALUES,
	);

	if (product === "restoration") {
		where.push(
			`j.job_type IN (${RESTORATION_SQL_TYPES.map(() => "?").join(",")})`,
		);
		binds.push(...RESTORATION_SQL_TYPES);
	} else if (product === "floors") {
		where.push(
			`j.job_type IN (${FLOOR_TYPE_VALUES.map(() => "?").join(",")})`,
		);
		binds.push(...FLOOR_TYPE_VALUES);
	}
	if (tech) {
		where.push("j.assigned_user_id = ?");
		binds.push(tech);
	}
	if (stage === "lead" || stage === "estimate") {
		where.push("j.status = ?");
		binds.push(stage);
	}

	const sql = `SELECT j.id, j.title, j.job_type, j.status, j.lead_source, j.follow_up_at,
      j.estimate_cents, j.created_at, j.updated_at,
      c.name AS customer_name, u.name AS assignee_name
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN users u ON u.id = j.assigned_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE WHEN j.follow_up_at IS NULL THEN 1 ELSE 0 END,
       j.follow_up_at ASC,
       j.updated_at DESC
     LIMIT 200`;

	const stmt = c.env.DB.prepare(sql);
	const leads = binds.length
		? await stmt.bind(...binds).all<{
				id: string;
				title: string;
				job_type: string;
				status: string;
				lead_source: string | null;
				follow_up_at: string | null;
				estimate_cents: number | null;
				created_at: string;
				updated_at: string;
				customer_name: string;
				assignee_name: string | null;
			}>()
		: await stmt.all<{
				id: string;
				title: string;
				job_type: string;
				status: string;
				lead_source: string | null;
				follow_up_at: string | null;
				estimate_cents: number | null;
				created_at: string;
				updated_at: string;
				customer_name: string;
				assignee_name: string | null;
			}>();

	const staff = await c.env.DB.prepare(
		`SELECT id, name, COALESCE(designation, role) AS role FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string }>();

	const today = new Date().toISOString().slice(0, 10);

	const card = (j: {
		id: string;
		title: string;
		job_type: string;
		status: string;
		lead_source: string | null;
		follow_up_at: string | null;
		estimate_cents: number | null;
		customer_name: string;
		assignee_name: string | null;
	}) => {
		const overdue = isFollowUpOverdue(j.follow_up_at, today);
		const followLabel = j.follow_up_at
			? j.follow_up_at.slice(0, 10)
			: "Not set";
		return `<div class="panel stack" style="padding:0.9rem">
      <div>
        <a href="/jobs/${escapeHtml(j.id)}"><strong>${escapeHtml(j.title)}</strong></a>
        <div class="muted" style="font-size:0.85rem;margin-top:0.25rem">
          ${escapeHtml(j.customer_name)} · ${escapeHtml(jobTypeLabel(j.job_type))}
        </div>
      </div>
      <div class="muted" style="font-size:0.85rem">
        Source: ${escapeHtml(leadSourceLabel(j.lead_source))}<br>
        Assigned: ${escapeHtml(j.assignee_name) || "Unassigned"}<br>
        Estimate: ${escapeHtml(money(j.estimate_cents))}<br>
        Follow-up: <span${overdue ? ' style="color:#991b1b;font-weight:600"' : ""}>${escapeHtml(followLabel)}${overdue ? " · overdue" : ""}</span>
      </div>
      <form method="post" action="/leads/${escapeHtml(j.id)}/follow-up" class="toolbar" style="align-items:end;gap:0.5rem">
        <div class="grow">
          <label for="fu_${escapeHtml(j.id)}">Follow-up</label>
          <input id="fu_${escapeHtml(j.id)}" name="follow_up_at" type="date"
            value="${escapeHtml(followUpDateValue(j.follow_up_at))}" />
        </div>
        <button class="btn secondary" type="submit">Save</button>
      </form>
      <div class="toolbar" style="gap:0.5rem">
        <a class="btn secondary" href="/jobs/${escapeHtml(j.id)}">Open</a>
        <form method="post" action="/leads/${escapeHtml(j.id)}/schedule" class="inline">
          <button class="btn" type="submit">Mark scheduled</button>
        </form>
      </div>
    </div>`;
	};

	const leadCards =
		leads.results
			?.filter((j) => j.status === "lead")
			.map(card)
			.join("") || `<p class="muted">No leads in this stage.</p>`;
	const estimateCards =
		leads.results
			?.filter((j) => j.status === "estimate")
			.map(card)
			.join("") || `<p class="muted">No estimates in this stage.</p>`;

	const techOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${tech === u.id ? "selected" : ""}>${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
			)
			.join("") || "";

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Lead pipeline</h1>
        <p class="muted" style="margin:0.35rem 0 0">Jobs in lead or estimate — set source and follow-up, then schedule.</p>
      </div>
      <a class="btn" href="/jobs/new">New job</a>
    </div>

    <form class="panel toolbar" method="get" action="/leads" style="align-items:end;margin-top:1rem">
      <div>
        <label for="product">Product</label>
        <select id="product" name="product">
          <option value="" ${!product ? "selected" : ""}>All field</option>
          <option value="restoration" ${product === "restoration" ? "selected" : ""}>Restoration</option>
          <option value="floors" ${product === "floors" ? "selected" : ""}>Floors</option>
        </select>
      </div>
      <div>
        <label for="tech">Assignee</label>
        <select id="tech" name="tech">
          <option value="">Anyone</option>
          ${techOptions}
        </select>
      </div>
      <div>
        <label for="stage">Stage</label>
        <select id="stage" name="stage">
          <option value="" ${!stage ? "selected" : ""}>Lead + estimate</option>
          <option value="lead" ${stage === "lead" ? "selected" : ""}>Lead only</option>
          <option value="estimate" ${stage === "estimate" ? "selected" : ""}>Estimate only</option>
        </select>
      </div>
      <button class="btn" type="submit">Filter</button>
      <a class="btn secondary" href="/leads">Clear</a>
    </form>

    <div class="row" style="margin-top:1.25rem;align-items:start">
      <div class="stack grow">
        <h2 style="margin:0">Lead <span class="muted">(${leads.results?.filter((j) => j.status === "lead").length ?? 0})</span></h2>
        ${stage === "estimate" ? `<p class="muted">Hidden by stage filter.</p>` : leadCards}
      </div>
      <div class="stack grow">
        <h2 style="margin:0">Estimate <span class="muted">(${leads.results?.filter((j) => j.status === "estimate").length ?? 0})</span></h2>
        ${stage === "lead" ? `<p class="muted">Hidden by stage filter.</p>` : estimateCards}
      </div>
    </div>`;

	return c.html(page(c, "Leads", body));
});

app.post("/leads/:id/follow-up", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const followUp = String(form.follow_up_at || "").trim() || null;
	const job = await c.env.DB.prepare(
		`SELECT id, status FROM jobs WHERE id = ?`,
	)
		.bind(id)
		.first<{ id: string; status: string }>();
	if (!job) return c.notFound();
	if (job.status !== "lead" && job.status !== "estimate") {
		return c.redirect(`/jobs/${id}`);
	}
	await c.env.DB.prepare(
		`UPDATE jobs SET follow_up_at = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(followUp, id)
		.run();
	return c.redirect("/leads");
});

app.post("/leads/:id/schedule", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT id, status FROM jobs WHERE id = ?`,
	)
		.bind(id)
		.first<{ id: string; status: string }>();
	if (!job) return c.notFound();
	if (job.status !== "lead" && job.status !== "estimate") {
		return c.redirect(`/jobs/${id}`);
	}
	await c.env.DB.prepare(
		`UPDATE jobs SET status = 'scheduled', updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.get("/jobs", async (c) => {
	const user = c.get("user")!;
	const status = c.req.query("status") || "";
	const tech = c.req.query("tech") || "";
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const product = c.req.query("product") || "";

	if (product === "restoration" && !canAccessProduct(user, "restoration")) {
		return c.html(forbiddenHtml(c, "Your account does not include Restoration."), 403);
	}
	if (product === "floors" && !canAccessProduct(user, "floors")) {
		return c.html(forbiddenHtml(c, "Your account does not include Floors."), 403);
	}
	if (!canAccessProduct(user, "restoration") && !canAccessProduct(user, "floors")) {
		return c.html(forbiddenHtml(c, "Your account has no field products."), 403);
	}

	const where: string[] = ["1=1"];
	const binds: string[] = [];
	appendFieldJobListFilters(user, where, binds, RESTORATION_SQL_TYPES, FLOOR_TYPE_VALUES);
	if (product === "restoration") {
		where.push(
			`j.job_type IN (${RESTORATION_SQL_TYPES.map(() => "?").join(",")})`,
		);
		binds.push(...RESTORATION_SQL_TYPES);
	} else if (product === "floors") {
		where.push(
			`j.job_type IN (${FLOOR_TYPE_VALUES.map(() => "?").join(",")})`,
		);
		binds.push(...FLOOR_TYPE_VALUES);
	}
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
		`SELECT id, name, COALESCE(designation, role) AS role FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string }>();

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

	const basePath = "/jobs";
	const withProduct = (q: URLSearchParams) => {
		if (product) q.set("product", product);
		return q;
	};

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
			const q = withProduct(new URLSearchParams());
			if (s) q.set("status", s);
			if (tech) q.set("tech", tech);
			if (from) q.set("from", from);
			if (to) q.set("to", to);
			const qs = q.toString();
			const href = qs ? `${basePath}?${qs}` : basePath;
			const active = status === s ? "btn" : "btn secondary";
			return `<a class="${active}" href="${href}">${escapeHtml(statusLabel(s || "all"))}</a>`;
		})
		.join(" ");

	const staffOptions =
		staff.results
			?.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${tech === u.id ? "selected" : ""}>${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
			)
			.join("") || "";

	const exportQ = withProduct(new URLSearchParams());
	if (status) exportQ.set("status", status);
	if (tech) exportQ.set("tech", tech);
	if (from) exportQ.set("from", from);
	if (to) exportQ.set("to", to);
	const exportHref = `/jobs/export.csv${exportQ.toString() ? `?${exportQ}` : ""}`;

	const clearHref = product ? `/jobs?product=${escapeHtml(product)}` : "/jobs";
	const heading =
		product === "restoration"
			? "Restoration & Remediation"
			: product === "floors"
				? "Hard Floor Cleaning"
				: "All field jobs";
	const newHref = product
		? `/jobs/new?product=${escapeHtml(product)}`
		: "/jobs/new";
	const blurb =
		product === "restoration"
			? "Water restoration, structural drying, microbial remediation, bio-hazard, odor removal."
			: product === "floors"
				? "Commercial hard-floor jobs — strip & wax, scrub & recoat, burnishing, sealing, epoxy, surfaces."
				: "All restoration and floor jobs. Use product nav to narrow.";

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">${escapeHtml(heading)}</h1></div>
      <a class="btn secondary" href="${escapeHtml(exportHref)}">Export CSV</a>
      <a class="btn" href="${escapeHtml(newHref)}">New job</a>
    </div>
    <p class="muted">${escapeHtml(blurb)}</p>
    <form class="panel toolbar" method="get" action="/jobs" style="align-items:end">
      ${product ? `<input type="hidden" name="product" value="${escapeHtml(product)}" />` : ""}
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
      <a class="btn secondary" href="${clearHref}">Clear</a>
    </form>
    <div class="toolbar">${statusFilters}</div>
    <table>
      <thead><tr><th>Job</th><th>Customer</th><th>Tech</th><th>Type</th><th>Status</th><th>When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

	return c.html(page(c, heading, body));
});

app.get("/jobs/export.csv", async (c) => {
	const user = c.get("user")!;
	const status = c.req.query("status") || "";
	const tech = c.req.query("tech") || "";
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const product = c.req.query("product") || "";

	if (!canAccessProduct(user, "restoration") && !canAccessProduct(user, "floors")) {
		return c.text("Forbidden", 403);
	}

	const where: string[] = ["1=1"];
	const binds: string[] = [];
	appendFieldJobListFilters(user, where, binds, RESTORATION_SQL_TYPES, FLOOR_TYPE_VALUES);
	if (product === "restoration") {
		where.push(
			`j.job_type IN (${RESTORATION_SQL_TYPES.map(() => "?").join(",")})`,
		);
		binds.push(...RESTORATION_SQL_TYPES);
	} else if (product === "floors") {
		where.push(
			`j.job_type IN (${FLOOR_TYPE_VALUES.map(() => "?").join(",")})`,
		);
		binds.push(...FLOOR_TYPE_VALUES);
	}
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
	const user = c.get("user")!;
	if (!canSeeOfficeTools(user)) {
		return c.html(forbiddenHtml(c, "Creating jobs is for owner / dispatcher."), 403);
	}
	const preselect = c.req.query("customer_id") || "";
	const product = c.req.query("product") || "";
	if (product === "restoration" && !canAccessProduct(user, "restoration")) {
		return c.html(forbiddenHtml(c, "Your account does not include Restoration."), 403);
	}
	if (product === "floors" && !canAccessProduct(user, "floors")) {
		return c.html(forbiddenHtml(c, "Your account does not include Floors."), 403);
	}
	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const staff = await c.env.DB.prepare(
		`SELECT id, name, COALESCE(designation, role) AS role FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
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
					`<option value="${escapeHtml(u.id)}" ${u.id === c.get("user")!.id ? "selected" : ""}>${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
			)
			.join("") || "";

	const typeOptions =
		product === "floors"
			? FLOOR_TYPES
			: product === "restoration"
				? RESTORATION_TYPES
				: [...RESTORATION_TYPES, ...FLOOR_TYPES];

	const typeSelect = typeOptions
		.map(
			(t, i) =>
				`<option value="${escapeHtml(t.value)}" ${i === 0 ? "selected" : ""}>${escapeHtml(t.label)}</option>`,
		)
		.join("");

	const heading =
		product === "restoration"
			? "New restoration job"
			: product === "floors"
				? "New floor job"
				: "New job";
	const placeholder =
		product === "floors"
			? "Lobby hard floor clean"
			: "Kitchen flood mitigation";

	const customerCount = customers.results?.length ?? 0;
	const customerBlock =
		customerCount > 0
			? `<div>
        <label for="customer_id">Existing customer</label>
        <select id="customer_id" name="customer_id">
          <option value="">Select…</option>
          ${options}
        </select>
      </div>
      <p class="muted" style="margin:0">Or create a new customer below (leave select blank).</p>`
			: `<div class="flash" style="margin:0">
        No customers yet — add one below to create this job.
        You can also manage customers from
        <a href="/customers/new">Customers → Add</a>.
      </div>`;

	const body = `
    <h1>${escapeHtml(heading)}</h1>
    <form method="post" action="/jobs" class="panel stack">
      ${product ? `<input type="hidden" name="product" value="${escapeHtml(product)}" />` : ""}
      ${customerBlock}
      <div class="row">
        <div><label for="new_customer_name">New customer name</label>
          <input id="new_customer_name" name="new_customer_name" ${customerCount === 0 ? "required" : ""} placeholder="Acme Property Mgmt" /></div>
        <div><label for="new_customer_phone">Phone</label>
          <input id="new_customer_phone" name="new_customer_phone" placeholder="916-555-0100" /></div>
      </div>
      <div class="row">
        <div><label for="new_site_address">Job site address</label>
          <input id="new_site_address" name="new_site_address" placeholder="123 Main St" ${customerCount === 0 ? "required" : ""} /></div>
        <div><label for="new_site_city">City</label>
          <input id="new_site_city" name="new_site_city" placeholder="Sacramento" ${customerCount === 0 ? "required" : ""} /></div>
        <div><label for="new_site_state">State</label>
          <input id="new_site_state" name="new_site_state" value="CA" /></div>
        <div><label for="new_site_zip">ZIP</label>
          <input id="new_site_zip" name="new_site_zip" /></div>
      </div>
      <div><label for="title">Title</label><input id="title" name="title" required placeholder="${escapeHtml(placeholder)}" /></div>
      <div class="row">
        <div>
          <label for="job_type">Service type</label>
          <select id="job_type" name="job_type" required>
            ${typeSelect}
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

	return c.html(page(c, heading, body));
});

app.post("/jobs", async (c) => {
	const user = c.get("user")!;
	if (!canSeeOfficeTools(user)) return c.text("Forbidden", 403);
	const form = await c.req.parseBody();
	let customerId = String(form.customer_id || "").trim();
	const newCustomerName = String(form.new_customer_name || "").trim();
	const rawType = String(form.job_type || "");
	if (!isValidFieldJobType(rawType)) {
		return c.text("Invalid job type", 400);
	}
	const jobType = normalizeJobType(rawType);
	if (!jobTypeAllowedForUser(user, jobType)) {
		return c.text("Your account cannot create this job type", 403);
	}

	const stmts: D1PreparedStatement[] = [];
	let siteId: string | null = null;

	if (!customerId) {
		if (!newCustomerName) {
			return c.text(
				"Pick an existing customer or enter a new customer name.",
				400,
			);
		}
		customerId = newId("cus");
		siteId = newId("sit");
		const address = String(form.new_site_address || "").trim() || "TBD";
		const city = String(form.new_site_city || "").trim() || "TBD";
		const state = String(form.new_site_state || "CA").trim() || "CA";
		stmts.push(
			c.env.DB.prepare(
				`INSERT INTO customers (id, name, phone, email, notes) VALUES (?, ?, ?, NULL, NULL)`,
			).bind(
				customerId,
				newCustomerName,
				String(form.new_customer_phone || "").trim() || null,
			),
			c.env.DB.prepare(
				`INSERT INTO sites (id, customer_id, label, address_line1, address_line2, city, state, postal_code)
         VALUES (?, ?, 'Primary', ?, NULL, ?, ?, ?)`,
			).bind(
				siteId,
				customerId,
				address,
				city,
				state,
				String(form.new_site_zip || "").trim() || null,
			),
		);
	} else {
		const site = await c.env.DB.prepare(
			`SELECT id FROM sites WHERE customer_id = ? ORDER BY created_at LIMIT 1`,
		)
			.bind(customerId)
			.first<{ id: string }>();
		siteId = site?.id ?? null;

		// Optional: attach a new site address when creating job for existing customer
		const address = String(form.new_site_address || "").trim();
		if (address) {
			siteId = newId("sit");
			stmts.push(
				c.env.DB.prepare(
					`INSERT INTO sites (id, customer_id, label, address_line1, address_line2, city, state, postal_code)
           VALUES (?, ?, 'Job site', ?, NULL, ?, ?, ?)`,
				).bind(
					siteId,
					customerId,
					address,
					String(form.new_site_city || "").trim() || "TBD",
					String(form.new_site_state || "CA").trim() || "CA",
					String(form.new_site_zip || "").trim() || null,
				),
			);
		}
	}

	const jobId = newId("job");
	const estimateRaw = String(form.estimate_dollars || "").trim();
	const estimateCents = estimateRaw
		? Math.round(parseFloat(estimateRaw) * 100)
		: null;

	stmts.push(
		c.env.DB.prepare(
			`INSERT INTO jobs (
        id, customer_id, site_id, title, job_type, status,
        scheduled_start, scheduled_end, estimate_cents, notes, assigned_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			jobId,
			customerId,
			siteId,
			String(form.title || "").trim(),
			jobType,
			String(form.status || "lead"),
			String(form.scheduled_start || "").trim() || null,
			String(form.scheduled_end || "").trim() || null,
			estimateCents,
			String(form.notes || "").trim() || null,
			String(form.assigned_user_id || "").trim() || null,
		),
	);

	checklistFor(jobType).forEach((label, i) => {
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
      a.name AS assignee_name, COALESCE(a.designation, a.role) AS assignee_role
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
			lead_source: string | null;
			follow_up_at: string | null;
			estimate_accepted_at: string | null;
			customer_id: string;
			customer_name: string;
			assigned_user_id: string | null;
			assignee_name: string | null;
			assignee_role: string | null;
			address_line1: string | null;
			city: string | null;
			state: string | null;
			postal_code: string | null;
		}>();
	if (!job) return c.notFound();

	const user = c.get("user")!;
	const accessJob: FieldJobAccess = {
		id: job.id,
		status: job.status,
		assigned_user_id: job.assigned_user_id,
		job_type: job.job_type,
	};
	const canWrite = canWriteFieldJob(user, accessJob);
	const canOverride = canOverrideJobAssignment(user);
	const isArchived = !!accessJob.deleted_at;
	const lockedBanner = isArchived
		? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">This job is archived (soft-deleted). Restore it from Trash to edit.</div>`
		: !canWrite
			? isStatusLocked(job.status)
				? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">${escapeHtml(officeLockBannerCopy("field"))}</div>`
				: `<div class="flash">Read-only — you can view this job but not edit it.</div>`
			: isStatusLocked(job.status)
				? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">Job is complete / invoiced. Use <strong>Reopen</strong> below to unlock tech edits (or change status in Update).</div>`
				: "";

	const jobProduct = productForJobType(job.job_type);
	const staff = await c.env.DB.prepare(
		`SELECT id, name, COALESCE(designation, role) AS role, products FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string; products: string | null }>();
	const staffForLane =
		staff.results?.filter((u) =>
			parseProducts(u.products).includes(jobProduct),
		) ?? [];

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
		`SELECT id, filename, content_type, created_at, voided_at, void_reason FROM job_photos
     WHERE job_id = ? ORDER BY created_at DESC`,
	)
		.bind(id)
		.all<{
			id: string;
			filename: string;
			content_type: string | null;
			created_at: string;
			voided_at: string | null;
			void_reason: string | null;
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
			?.map((p) => {
				const voided = !!p.voided_at;
				const voidBadge = voided
					? `<div style="color:#92400e;font-size:0.8rem;margin:0.35rem 0">VOIDED · ${escapeHtml(p.void_reason) || "incorrect"} · ${escapeHtml(p.voided_at!.slice(0, 16).replace("T", " "))}</div>`
					: "";
				const voidBtn =
					!voided && canWrite && canVoidClaimData(user)
						? voidActionForm(
								`/jobs/${escapeHtml(id)}/photos/${escapeHtml(p.id)}/void`,
							)
						: "";
				return `<div class="panel" style="padding:0.75rem${voided ? ";opacity:0.65" : ""}">
        <a href="/jobs/${escapeHtml(id)}/photos/${escapeHtml(p.id)}" target="_blank" rel="noopener">
          <img src="/jobs/${escapeHtml(id)}/photos/${escapeHtml(p.id)}" alt="${escapeHtml(p.filename)}"
            style="max-width:100%;max-height:220px;border-radius:8px;display:block;margin-bottom:0.5rem${voided ? ";filter:grayscale(0.6)" : ""}" />
        </a>
        <div class="muted" style="font-size:0.8rem">${escapeHtml(p.filename)} · ${escapeHtml(p.created_at.slice(0, 16).replace("T", " "))}</div>
        ${voidBadge}
        ${voidBtn}
      </div>`;
			})
			.join("") || `<p class="muted">No photos yet.</p>`;

	const isRestoration = isRestorationType(job.job_type);
	let fieldLogSection = "";
	if (isRestoration) {
		const logs = await c.env.DB.prepare(
			`SELECT l.id, l.kind, l.logged_at, l.area, l.reading, l.temp_f, l.rh_pct, l.grains,
        l.equipment_type, l.equipment_count, l.notes, l.created_at, l.voided_at, l.void_reason,
        u.name AS user_name
       FROM job_field_logs l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.job_id = ?
       ORDER BY l.logged_at DESC, l.created_at DESC`,
		)
			.bind(id)
			.all<FieldLogRow>();

		const today = new Date().toISOString().slice(0, 10);
		const equipmentOptions = EQUIPMENT_TYPES.map(
			(t) =>
				`<option value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</option>`,
		).join("");

		const moistureRows =
			logs.results
				?.filter((l) => l.kind === "moisture")
				.map((l) => {
					const psycho = [
						l.temp_f != null ? `${l.temp_f}°F` : null,
						l.rh_pct != null ? `${l.rh_pct}%` : null,
						l.grains != null ? `${l.grains} gpp` : null,
					]
						.filter(Boolean)
						.join(" · ");
					const voided = !!l.voided_at;
					const actionCell = voided
						? `<span style="color:#92400e;font-size:0.8rem">VOIDED · ${escapeHtml(l.void_reason) || "incorrect"}</span>`
						: canWrite && canVoidClaimData(user)
							? voidActionForm(
									`/jobs/${escapeHtml(id)}/logs/${escapeHtml(l.id)}/void`,
								)
							: "";
					return `<tr${voided ? ' style="opacity:0.55;text-decoration:line-through"' : ""}>
            <td>${escapeHtml(l.logged_at.slice(0, 10))}</td>
            <td>${escapeHtml(l.area) || "—"}</td>
            <td>${escapeHtml(l.reading) || "—"}</td>
            <td>${escapeHtml(psycho) || "—"}</td>
            <td>${escapeHtml(l.notes) || "—"}</td>
            <td class="muted">${escapeHtml(l.user_name) || "—"}</td>
            <td>${actionCell}</td>
          </tr>`;
				})
				.join("") ||
			`<tr><td colspan="7" class="muted">No moisture readings yet.</td></tr>`;

		const moistureMaps = await c.env.DB.prepare(
			`SELECT id, filename, content_type, label, created_at, voided_at, void_reason FROM job_moisture_maps
       WHERE job_id = ? ORDER BY created_at DESC`,
		)
			.bind(id)
			.all<{
				id: string;
				filename: string;
				content_type: string | null;
				label: string | null;
				created_at: string;
				voided_at: string | null;
				void_reason: string | null;
			}>();

		const moistureMapItems =
			moistureMaps.results
				?.map((m) => {
					const voided = !!m.voided_at;
					const voidBadge = voided
						? `<div style="color:#92400e;font-size:0.8rem;margin:0.35rem 0">VOIDED · ${escapeHtml(m.void_reason) || "incorrect"} · ${escapeHtml(m.voided_at!.slice(0, 16).replace("T", " "))}</div>`
						: "";
					const voidBtn =
						!voided && canWrite && canVoidClaimData(user)
							? voidActionForm(
									`/jobs/${escapeHtml(id)}/moisture-maps/${escapeHtml(m.id)}/void`,
								)
							: "";
					return `<div class="panel" style="padding:0.75rem${voided ? ";opacity:0.65" : ""}">
        <a href="/jobs/${escapeHtml(id)}/moisture-maps/${escapeHtml(m.id)}" target="_blank" rel="noopener">
          <img src="/jobs/${escapeHtml(id)}/moisture-maps/${escapeHtml(m.id)}" alt="${escapeHtml(m.label || m.filename)}"
            style="max-width:100%;max-height:280px;border-radius:8px;display:block;margin-bottom:0.5rem${voided ? ";filter:grayscale(0.6)" : ""}" />
        </a>
        <div class="muted" style="font-size:0.8rem">
          ${m.label ? `${escapeHtml(m.label)} · ` : ""}${escapeHtml(m.filename)}
          · ${escapeHtml(m.created_at.slice(0, 16).replace("T", " "))}
        </div>
        ${voidBadge}
        ${voidBtn}
      </div>`;
				})
				.join("") || `<p class="muted">No moisture maps yet.</p>`;

		const equipmentRows =
			logs.results
				?.filter((l) => l.kind === "equipment")
				.map((l) => {
					const voided = !!l.voided_at;
					const actionCell = voided
						? `<span style="color:#92400e;font-size:0.8rem">VOIDED · ${escapeHtml(l.void_reason) || "incorrect"}</span>`
						: canWrite && canVoidClaimData(user)
							? voidActionForm(
									`/jobs/${escapeHtml(id)}/logs/${escapeHtml(l.id)}/void`,
								)
							: "";
					return `<tr${voided ? ' style="opacity:0.55;text-decoration:line-through"' : ""}>
            <td>${escapeHtml(l.logged_at.slice(0, 10))}</td>
            <td>${escapeHtml(l.area) || "—"}</td>
            <td>${escapeHtml(equipmentTypeLabel(l.equipment_type))}</td>
            <td>${l.equipment_count != null ? escapeHtml(l.equipment_count) : "—"}</td>
            <td>${escapeHtml(l.notes) || "—"}</td>
            <td class="muted">${escapeHtml(l.user_name) || "—"}</td>
            <td>${actionCell}</td>
          </tr>`;
				})
				.join("") ||
			`<tr><td colspan="7" class="muted">No equipment logged yet.</td></tr>`;

		fieldLogSection = `
    <h2>Moisture readings</h2>
    <p class="muted">Restoration jobs — material readings plus optional ambient psychrometrics (temp, RH, grains). Supports IICRC S500-style drying records; not a certification of compliance.
      <a href="/jobs/${escapeHtml(id)}/water-loss.pdf">Download water-loss PDF</a></p>
    <form method="post" action="/jobs/${escapeHtml(id)}/logs/moisture" class="panel stack" style="margin-bottom:1rem">
      <div class="row">
        <div><label for="m_logged_at">Date</label>
          <input id="m_logged_at" name="logged_at" type="date" required value="${escapeHtml(today)}" /></div>
        <div><label for="m_area">Room / area</label>
          <input id="m_area" name="area" required placeholder="Kitchen — NW wall" /></div>
        <div><label for="m_reading">Material reading</label>
          <input id="m_reading" name="reading" required placeholder="18% or 0.45" /></div>
      </div>
      <div class="row">
        <div><label for="m_temp_f">Temp (°F)</label>
          <input id="m_temp_f" name="temp_f" type="number" step="0.1" placeholder="optional" /></div>
        <div><label for="m_rh_pct">RH (%)</label>
          <input id="m_rh_pct" name="rh_pct" type="number" step="0.1" min="0" max="100" placeholder="optional" /></div>
        <div><label for="m_grains">Grains (GPP)</label>
          <input id="m_grains" name="grains" type="number" step="0.1" min="0" placeholder="auto from temp+RH" /></div>
      </div>
      <p class="muted" style="margin:0;font-size:0.85rem">Grains auto-fills from temp + RH when left blank (sea-level approx). Enter a value to override. Helper only — not an S500 compliance claim.</p>
      <div><label for="m_notes">Notes</label>
        <input id="m_notes" name="notes" placeholder="Meter, material, class of water…" /></div>
      <button class="btn" type="submit">Add moisture reading</button>
    </form>
    <table>
      <thead><tr><th>Date</th><th>Area</th><th>Reading</th><th>Ambient</th><th>Notes</th><th>By</th><th></th></tr></thead>
      <tbody>${moistureRows}</tbody>
    </table>

    <h2>Moisture maps</h2>
    <p class="muted">Upload floor-plan or moisture-map photos (2D). Listed on the water-loss PDF by filename.</p>
    <form method="post" action="/jobs/${escapeHtml(id)}/moisture-maps" enctype="multipart/form-data" class="panel stack" style="margin-bottom:1rem">
      <div class="row">
        <div class="grow"><label for="map_file">Image (max 10 MB)</label>
          <input id="map_file" name="map" type="file" accept="image/*" required /></div>
        <div><label for="map_label">Label</label>
          <input id="map_label" name="label" placeholder="Day 1 floor plan" /></div>
      </div>
      <button class="btn" type="submit">Upload map</button>
    </form>
    <div class="stack">${moistureMapItems}</div>

    <h2>Equipment log</h2>
    <p class="muted">Air movers, dehumidifiers, and other drying equipment on site.</p>
    <form method="post" action="/jobs/${escapeHtml(id)}/logs/equipment" class="panel stack" style="margin-bottom:1rem">
      <div class="row">
        <div><label for="e_logged_at">Date</label>
          <input id="e_logged_at" name="logged_at" type="date" required value="${escapeHtml(today)}" /></div>
        <div><label for="e_area">Room / area</label>
          <input id="e_area" name="area" placeholder="Living room" /></div>
        <div><label for="e_type">Equipment</label>
          <select id="e_type" name="equipment_type" required>${equipmentOptions}</select></div>
        <div><label for="e_count">Count</label>
          <input id="e_count" name="equipment_count" type="number" min="1" step="1" value="1" required /></div>
      </div>
      <div><label for="e_notes">Notes</label>
        <input id="e_notes" name="notes" placeholder="Serial, placement, power…" /></div>
      <button class="btn" type="submit">Log equipment</button>
    </form>
    <table>
      <thead><tr><th>Date</th><th>Area</th><th>Type</th><th>Count</th><th>Notes</th><th>By</th><th></th></tr></thead>
      <tbody>${equipmentRows}</tbody>
    </table>`;

		const assigned = await c.env.DB.prepare(
			`SELECT je.id AS assignment_id, a.id AS asset_id, a.label, a.equipment_type, a.serial, je.assigned_at
       FROM job_equipment je
       JOIN equipment_assets a ON a.id = je.asset_id
       WHERE je.job_id = ? AND je.returned_at IS NULL
       ORDER BY je.assigned_at DESC`,
		)
			.bind(id)
			.all<{
				assignment_id: string;
				asset_id: string;
				label: string;
				equipment_type: string;
				serial: string | null;
				assigned_at: string;
			}>();

		const available = await c.env.DB.prepare(
			`SELECT id, label, equipment_type, serial FROM equipment_assets
       WHERE status = 'available'
       ORDER BY equipment_type, label COLLATE NOCASE`,
		).all<{
			id: string;
			label: string;
			equipment_type: string;
			serial: string | null;
		}>();

		const assignedRows =
			assigned.results
				?.map(
					(a) => `<tr>
            <td>${escapeHtml(a.label)}</td>
            <td>${escapeHtml(equipmentTypeLabel(a.equipment_type))}</td>
            <td>${escapeHtml(a.serial) || "—"}</td>
            <td>${escapeHtml(a.assigned_at.slice(0, 16).replace("T", " "))}</td>
            <td>
              <form method="post" action="/jobs/${escapeHtml(id)}/inventory/${escapeHtml(a.assignment_id)}/return" class="inline">
                <button class="linkish" type="submit">Return</button>
              </form>
            </td>
          </tr>`,
				)
				.join("") ||
			`<tr><td colspan="5" class="muted">No inventory units assigned.</td></tr>`;

		const availableOptions =
			available.results
				?.map(
					(a) =>
						`<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)} · ${escapeHtml(equipmentTypeLabel(a.equipment_type))}${a.serial ? ` · ${escapeHtml(a.serial)}` : ""}</option>`,
				)
				.join("") || "";

		fieldLogSection += `
    <h2>Inventory on this job</h2>
    <p class="muted">Assign tracked units from <a href="/inventory">Inventory</a>. Count-based log above stays for bulk notes.</p>
    ${
			availableOptions
				? `<form method="post" action="/jobs/${escapeHtml(id)}/inventory" class="panel toolbar" style="align-items:end;margin-bottom:1rem">
      <div class="grow">
        <label for="asset_id">Available unit</label>
        <select id="asset_id" name="asset_id" required>
          <option value="">Select…</option>
          ${availableOptions}
        </select>
      </div>
      <button class="btn" type="submit">Assign to job</button>
    </form>`
				: `<p class="muted">No available units. <a href="/inventory">Add inventory</a> first.</p>`
		}
    <table>
      <thead><tr><th>Unit</th><th>Type</th><th>Serial</th><th>Assigned</th><th></th></tr></thead>
      <tbody>${assignedRows}</tbody>
    </table>`;
	}

	const costLines = await loadJobCostLines(c.env.DB, id);
	const costTotal = sumCostCents(costLines);
	const jobMargin = marginCents(job.estimate_cents, costTotal);
	const costByCategory = COST_CATEGORIES.map((cat) => {
		const sub = sumCostCents(
			costLines.filter((l) => l.category === cat.value),
		);
		return { ...cat, sub };
	}).filter((c) => c.sub > 0);

	const costLaborDesignation = String(c.req.query("cost_labor") || "").trim();
	let prefillCost: {
		category: string;
		description: string;
		unit: string;
		unit_dollars: string;
	} | null = null;
	if (costLaborDesignation) {
		const hourly = await activeHourlyCents(c.env.DB, costLaborDesignation);
		if (hourly != null) {
			prefillCost = laborCostPrefill(costLaborDesignation, hourly);
		}
	}

	const costRows =
		costLines
			.map(
				(l) => `<tr>
        <td>${escapeHtml(costCategoryLabel(l.category))}</td>
        <td>${escapeHtml(l.description)}</td>
        <td>${escapeHtml(l.quantity)} ${escapeHtml(l.unit)}</td>
        <td>${escapeHtml(money(l.unit_cents))}</td>
        <td>${escapeHtml(money(lineTotalCents(l.quantity, l.unit_cents)))}</td>
        <td>
          <form method="post" action="/jobs/${escapeHtml(id)}/costs/${escapeHtml(l.id)}/delete" class="inline"
            onsubmit="return confirm('Delete this cost line?');">
            <button class="linkish" type="submit">Delete</button>
          </form>
        </td>
      </tr>`,
			)
			.join("") ||
		`<tr><td colspan="6" class="muted">No cost lines yet.</td></tr>`;

	const costCategoryOptions = COST_CATEGORIES.map(
		(c) =>
			`<option value="${escapeHtml(c.value)}"${prefillCost?.category === c.value ? " selected" : ""}>${escapeHtml(c.label)}</option>`,
	).join("");

	const costBreakdown =
		costByCategory
			.map(
				(c) =>
					`${escapeHtml(c.label)} ${escapeHtml(money(c.sub))}`,
			)
			.join(" · ") || "—";

	const laborRateOptions = laborRateDesignations()
		.map(
			(d) =>
				`<option value="${escapeHtml(d.value)}"${costLaborDesignation === d.value ? " selected" : ""}>${escapeHtml(d.label)}</option>`,
		)
		.join("");

	const laborPicker = `
    <form method="get" action="/jobs/${escapeHtml(id)}" class="panel toolbar" style="align-items:end;margin-bottom:0.75rem">
      <div class="grow">
        <label for="cost_labor">Use labor rate (internal — not payroll)</label>
        <select id="cost_labor" name="cost_labor">
          <option value="">Select designation…</option>
          ${laborRateOptions}
        </select>
      </div>
      <button class="btn secondary" type="submit">Use rate</button>
      ${canManageLaborRates(user) ? `<a class="btn secondary" href="/settings/labor-rates">Manage rates</a>` : ""}
    </form>
    <p class="muted" style="font-size:0.85rem;margin-top:0">Prefills category Labor, unit hr, and unit cost from Owner rates. Edit before saving.</p>`;

	const costSection = `
    <h2>Job costs</h2>
    <p class="muted">Track labor, materials, and equipment days against the estimate. Internal only — not payroll.</p>
    <div class="panel" style="margin-bottom:1rem">
      <strong>Cost total:</strong> ${escapeHtml(money(costTotal))}
      · <strong>Estimate:</strong> ${escapeHtml(money(job.estimate_cents))}
      · <strong>Margin:</strong> ${jobMargin == null ? "—" : escapeHtml(money(jobMargin))}
      <div class="muted" style="margin-top:0.35rem;font-size:0.85rem">${costBreakdown}</div>
    </div>
    ${laborPicker}
    <form method="post" action="/jobs/${escapeHtml(id)}/costs" class="panel stack" style="margin-bottom:1rem">
      <div class="row">
        <div><label for="cost_category">Category</label>
          <select id="cost_category" name="category" required>${costCategoryOptions}</select></div>
        <div class="grow"><label for="cost_description">Description</label>
          <input id="cost_description" name="description" required
            placeholder="Tech hours, poly sheeting, dehumidifier days…"
            value="${escapeHtml(prefillCost?.description)}" /></div>
      </div>
      <div class="row">
        <div><label for="cost_qty">Qty</label>
          <input id="cost_qty" name="quantity" type="number" step="0.01" min="0" value="1" required /></div>
        <div><label for="cost_unit">Unit</label>
          <input id="cost_unit" name="unit" placeholder="hr / ea / day"
            value="${escapeHtml(prefillCost?.unit || "")}" /></div>
        <div><label for="cost_unit_dollars">Unit cost ($)</label>
          <input id="cost_unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" required
            value="${escapeHtml(prefillCost?.unit_dollars || "")}" /></div>
      </div>
      <button class="btn" type="submit">Add cost line</button>
    </form>
    <table>
      <thead><tr><th>Category</th><th>Description</th><th>Qty</th><th>Unit $</th><th>Total</th><th></th></tr></thead>
      <tbody>${costRows}</tbody>
    </table>`;

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
		staffForLane
			.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${job.assigned_user_id === u.id ? "selected" : ""}>${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
			)
			.join("") || "";

	const overridePanels = renderJobOverridePanels({
		kind: "field",
		jobId: id,
		status: job.status,
		assignedUserId: job.assigned_user_id,
		staffOptionsHtml: staffOptions,
		canOverride,
		archived: isArchived,
	});

	const leadSourceOptions = [
		`<option value="">—</option>`,
		...LEAD_SOURCES.map(
			(s) =>
				`<option value="${escapeHtml(s.value)}" ${job.lead_source === s.value ? "selected" : ""}>${escapeHtml(s.label)}</option>`,
		),
	].join("");

	const body = `
    ${lockedBanner}
    ${overridePanels}
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
      ${canManageInvoices(user) ? `<a class="btn secondary" href="/jobs/${escapeHtml(id)}/invoice">Invoice</a>` : ""}
      ${isRestoration ? `<a class="btn secondary" href="/jobs/${escapeHtml(id)}/water-loss.pdf">Water-loss PDF</a>` : ""}
      ${
				isArchived && canAccessTrash(user)
					? `<form method="post" action="/trash/jobs/${escapeHtml(id)}/restore" class="inline"><button class="btn" type="submit">Restore</button></form>`
					: !isArchived && canSoftDelete(user)
						? `<form method="post" action="/jobs/${escapeHtml(id)}/archive" class="inline" onsubmit="return confirm('Archive this job? It leaves daily lists; Super Admin can restore from Trash.');"><button class="btn secondary" type="submit">Archive</button></form>`
						: ""
			}
    </div>

    <div class="row" style="margin-top:1rem">
      <div class="panel stack">
        <div><span class="muted">Site</span><br>
          ${job.address_line1 ? `${escapeHtml(job.address_line1)}, ${escapeHtml(job.city)}, ${escapeHtml(job.state)} ${escapeHtml(job.postal_code)}` : "—"}
        </div>
        <div><span class="muted">Assigned</span><br>${
					job.assignee_name
						? escapeHtml(
								assigneeOptionLabel(
									job.assignee_name,
									job.assignee_role || "tech",
								),
							)
						: "Unassigned"
				}</div>
        <div><span class="muted">Schedule</span><br>
          ${escapeHtml(job.scheduled_start ? job.scheduled_start.slice(0, 16).replace("T", " ") : "Not scheduled")}
          ${job.scheduled_end ? ` → ${escapeHtml(job.scheduled_end.slice(0, 16).replace("T", " "))}` : ""}
        </div>
        <div><span class="muted">Estimate</span><br>${escapeHtml(money(job.estimate_cents))} <a href="/jobs/${escapeHtml(id)}/estimate">edit lines</a></div>
        <div><span class="muted">Estimate accepted</span><br>${
					job.estimate_accepted_at
						? escapeHtml(job.estimate_accepted_at.slice(0, 16).replace("T", " "))
						: "—"
				}</div>
        <div><span class="muted">Job cost</span><br>${escapeHtml(money(costTotal))} · margin ${jobMargin == null ? "—" : escapeHtml(money(jobMargin))}</div>
        <div><span class="muted">Invoice</span><br>${escapeHtml(money(job.invoice_cents))}</div>
        <div><span class="muted">Claim #</span><br>${escapeHtml(job.claim_number) || "—"}</div>
        <div><span class="muted">Carrier</span><br>${escapeHtml(job.carrier) || "—"}</div>
        <div><span class="muted">Date of loss</span><br>${escapeHtml(job.date_of_loss) || "—"}</div>
        <div><span class="muted">Lead source</span><br>${escapeHtml(leadSourceLabel(job.lead_source))}</div>
        <div><span class="muted">Follow-up</span><br>${
					job.follow_up_at
						? escapeHtml(job.follow_up_at.slice(0, 10)) +
							(isFollowUpOverdue(job.follow_up_at) ? " · overdue" : "")
						: "—"
				} · <a href="/leads">pipeline</a></div>
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
          <h2 style="margin:0.5rem 0 0">Lead</h2>
          <div class="row">
            <div><label for="lead_source">Source</label>
              <select id="lead_source" name="lead_source">${leadSourceOptions}</select></div>
            <div><label for="follow_up_at">Follow-up</label>
              <input id="follow_up_at" name="follow_up_at" type="date"
                value="${escapeHtml(followUpDateValue(job.follow_up_at))}" /></div>
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

    ${costSection}

    ${fieldLogSection}

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

app.post("/jobs/:id/reopen", async (c) => {
	const user = c.get("user")!;
	if (!canReopenJobs(user)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const job = await loadFieldJobAccess(c.env.DB, id);
	if (!job) return c.notFound();
	if (job.deleted_at) return c.text("Restore from Trash first.", 400);
	if (!canReopenFieldStatus(job.status)) {
		return c.text("Job is not locked (complete / invoiced).", 400);
	}
	if (!canAccessProduct(user, productForJobType(job.job_type))) {
		return c.text("Forbidden", 403);
	}
	const form = await c.req.parseBody();
	const reason = normalizeOverrideReason(form.reason);
	if (!reason) return c.text("Reopen reason required (3–500 chars).", 400);
	const toStatus = FIELD_REOPEN_STATUS;
	await c.env.DB.prepare(
		`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(toStatus, id)
		.run();
	await recordAudit(c, {
		action: "job_reopen",
		entityType: "job",
		entityId: id,
		summary: `Reopened field job ${id} (${job.status} → ${toStatus})`,
		detail: { from: job.status, to: toStatus, reason },
	});
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/reassign", async (c) => {
	const user = c.get("user")!;
	if (!canOverrideJobAssignment(user)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const job = await loadFieldJobAccess(c.env.DB, id);
	if (!job) return c.notFound();
	if (job.deleted_at) return c.text("Restore from Trash first.", 400);
	if (!canAccessProduct(user, productForJobType(job.job_type))) {
		return c.text("Forbidden", 403);
	}
	const form = await c.req.parseBody();
	const nextAssignee = String(form.assigned_user_id || "").trim() || null;
	if (nextAssignee) {
		const assignee = await c.env.DB.prepare(
			`SELECT id, products FROM users WHERE id = ? AND COALESCE(active, 1) = 1`,
		)
			.bind(nextAssignee)
			.first<{ id: string; products: string | null }>();
		if (!assignee) return c.text("Assignee not found.", 400);
		if (!parseProducts(assignee.products).includes(productForJobType(job.job_type))) {
			return c.text("Assignee is not on this product lane.", 400);
		}
	}
	const reasonRaw = String(form.reason || "").trim();
	const reason =
		reasonRaw.length > 0 ? normalizeOverrideReason(reasonRaw) : null;
	if (reasonRaw.length > 0 && !reason) {
		return c.text("Reassign reason must be 3–500 characters if provided.", 400);
	}
	await c.env.DB.prepare(
		`UPDATE jobs SET assigned_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(nextAssignee, id)
		.run();
	await recordAudit(c, {
		action: "job_reassign",
		entityType: "job",
		entityId: id,
		summary: `Reassigned field job ${id}`,
		detail: {
			from: job.assigned_user_id,
			to: nextAssignee,
			reason: reason ?? null,
			locked: isStatusLocked(job.status),
		},
	});
	return c.redirect(`/jobs/${id}`);
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
      lead_source = ?,
      follow_up_at = ?,
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
			normalizeLeadSource(String(form.lead_source || "")),
			String(form.follow_up_at || "").trim() || null,
			id,
		)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/costs", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(`SELECT id FROM jobs WHERE id = ?`)
		.bind(id)
		.first();
	if (!job) return c.notFound();

	const form = await c.req.parseBody();
	const category = String(form.category || "").trim();
	if (!isValidCostCategory(category)) {
		return c.text("Invalid cost category", 400);
	}
	const description = String(form.description || "").trim();
	if (!description) return c.text("Description required", 400);

	const qty = parseFloat(String(form.quantity || "1"));
	if (!Number.isFinite(qty) || qty < 0) {
		return c.text("Invalid quantity", 400);
	}
	const unitRaw = String(form.unit || "").trim();
	const unit = unitRaw || defaultUnitForCategory(category);
	const dollars = parseFloat(String(form.unit_dollars || "0"));
	if (!Number.isFinite(dollars) || dollars < 0) {
		return c.text("Invalid unit cost", 400);
	}
	const unitCents = Math.round(dollars * 100);

	const count = await c.env.DB.prepare(
		`SELECT COUNT(*) AS c FROM job_cost_lines WHERE job_id = ?`,
	)
		.bind(id)
		.first<{ c: number }>();

	await c.env.DB.prepare(
		`INSERT INTO job_cost_lines (id, job_id, category, description, quantity, unit, unit_cents, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("cost"),
			id,
			category,
			description,
			qty,
			unit,
			unitCents,
			count?.c ?? 0,
		)
		.run();

	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();

	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/costs/:lineId/delete", async (c) => {
	const id = c.req.param("id");
	const lineId = c.req.param("lineId");
	await c.env.DB.prepare(
		`DELETE FROM job_cost_lines WHERE id = ? AND job_id = ?`,
	)
		.bind(lineId, id)
		.run();
	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

async function requireRestorationJob(
	db: D1Database,
	jobId: string,
): Promise<{ id: string } | Response> {
	const job = await db
		.prepare(`SELECT id, job_type FROM jobs WHERE id = ?`)
		.bind(jobId)
		.first<{ id: string; job_type: string }>();
	if (!job) {
		return new Response("Not found", { status: 404 });
	}
	if (!isRestorationType(job.job_type)) {
		return new Response("Moisture / equipment logs are for restoration jobs only", {
			status: 400,
		});
	}
	return { id: job.id };
}

app.post("/jobs/:id/logs/moisture", async (c) => {
	const id = c.req.param("id");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const form = await c.req.parseBody();
	const loggedAt = String(form.logged_at || "").slice(0, 10);
	const area = String(form.area || "").trim();
	const reading = String(form.reading || "").trim();
	if (!loggedAt || !area || !reading) {
		return c.text("Date, area, and reading required", 400);
	}

	const tempF = parseOptionalNumber(form.temp_f);
	const rhPct = parseOptionalNumber(form.rh_pct);
	const grains = resolveGrains(tempF, rhPct, parseOptionalNumber(form.grains));

	await c.env.DB.prepare(
		`INSERT INTO job_field_logs (
      id, job_id, kind, logged_at, area, reading, temp_f, rh_pct, grains, notes, created_by
    ) VALUES (?, ?, 'moisture', ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("flog"),
			id,
			loggedAt,
			area,
			reading,
			tempF,
			rhPct,
			grains,
			String(form.notes || "").trim() || null,
			c.get("user")!.id,
		)
		.run();
	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/logs/equipment", async (c) => {
	const id = c.req.param("id");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const form = await c.req.parseBody();
	const loggedAt = String(form.logged_at || "").slice(0, 10);
	const equipmentType = String(form.equipment_type || "");
	const count = Number(form.equipment_count || 0);
	if (
		!loggedAt ||
		!EQUIPMENT_TYPES.some((t) => t.value === equipmentType) ||
		!Number.isFinite(count) ||
		count < 1
	) {
		return c.text("Date, equipment type, and count required", 400);
	}

	await c.env.DB.prepare(
		`INSERT INTO job_field_logs (
      id, job_id, kind, logged_at, area, equipment_type, equipment_count, notes, created_by
    ) VALUES (?, ?, 'equipment', ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("flog"),
			id,
			loggedAt,
			String(form.area || "").trim() || null,
			equipmentType,
			count,
			String(form.notes || "").trim() || null,
			c.get("user")!.id,
		)
		.run();
	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/logs/:logId/void", async (c) => {
	const id = c.req.param("id");
	const logId = c.req.param("logId");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const user = c.get("user")!;
	if (!canVoidClaimData(user)) return c.text("Forbidden", 403);

	const form = await c.req.parseBody();
	const reason = normalizeVoidReason(form.void_reason);
	if (!reason) return c.text("Void reason required (at least 3 characters)", 400);

	const result = await c.env.DB.prepare(
		`UPDATE job_field_logs
     SET voided_at = datetime('now'), voided_by = ?, void_reason = ?
     WHERE id = ? AND job_id = ? AND voided_at IS NULL`,
	)
		.bind(user.id, reason, logId, id)
		.run();
	if (!result.meta.changes) return c.text("Log not found or already voided", 404);

	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "void",
		entityType: "field_log",
		entityId: logId,
		summary: `Voided field log on job ${id}`,
		detail: { jobId: id, reason },
	});
	return c.redirect(`/jobs/${id}`);
});

app.get("/jobs/:id/estimate", async (c) => {
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.estimate_cents, j.claim_number, j.carrier, j.date_of_loss,
      c.name AS customer_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			title: string;
			job_type: string;
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

	const product = productForJobType(job.job_type);
	const priceItems =
		product === "restoration" || product === "floors"
			? await listActivePriceItemsForProduct(c.env.DB, product)
			: [];
	const fromPriceId = String(c.req.query("from_price") || "").trim();
	const prefillItem =
		fromPriceId && priceItems.find((p) => p.id === fromPriceId)
			? priceItems.find((p) => p.id === fromPriceId)!
			: null;
	const discountCaps = await getDiscountCapSettings(c.env.DB);

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

	const priceOptions =
		priceItems
			.map(
				(p) =>
					`<option value="${escapeHtml(p.id)}"${prefillItem?.id === p.id ? " selected" : ""}>${escapeHtml(p.name)} · ${escapeHtml(money(p.unit_cents))}/${escapeHtml(p.unit)}</option>`,
			)
			.join("") || "";

	const pricePicker =
		priceOptions
			? `<form method="get" action="/jobs/${escapeHtml(id)}/estimate" class="panel toolbar" style="align-items:end;margin-top:0.75rem">
      <div class="grow">
        <label for="from_price">From price list (${escapeHtml(priceListProductLabel(product))})</label>
        <select id="from_price" name="from_price">
          <option value="">Select a rate…</option>
          ${priceOptions}
        </select>
      </div>
      <button class="btn secondary" type="submit">Use rate</button>
      ${canManagePriceLists(c.get("user")!) ? `<a class="btn secondary" href="/settings/price-lists">Manage lists</a>` : ""}
    </form>
    <p class="muted" style="font-size:0.85rem">Use rate prefills the add-line form below — you can still edit before saving.</p>`
			: `<p class="muted" style="margin-top:0.75rem">No active ${escapeHtml(priceListProductLabel(product))} rates yet.
      ${canManagePriceLists(c.get("user")!) ? `<a href="/settings/price-lists">Add price list items</a>` : "Ask an Owner to add rates."}</p>`;

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
      <p class="muted" style="margin:0;font-size:0.85rem">${escapeHtml(discountCapNoticeHtml(discountCaps))}
        ${canManageDiscountCaps(c.get("user")!) ? ` <a href="/settings/discount-caps">Edit caps</a>` : ""}</p>
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
    ${pricePicker}
    <form method="post" action="/jobs/${escapeHtml(id)}/estimate/lines" class="panel stack" style="margin-top:0.75rem">
      <div class="row">
        <div>
          <label for="room_id">Room</label>
          <select id="room_id" name="room_id">
            <option value="">None</option>
            ${roomOptions}
          </select>
        </div>
        <div><label for="description">Description</label>
          <input id="description" name="description" required placeholder="Water extraction"
            value="${escapeHtml(prefillItem?.name)}" /></div>
      </div>
      <div class="row">
        <div><label for="quantity">Quantity</label><input id="quantity" name="quantity" type="number" step="0.01" min="0" value="1" required /></div>
        <div><label for="unit">Unit</label>
          <input id="unit" name="unit" value="${escapeHtml(prefillItem?.unit || "ea")}" required /></div>
        <div><label for="unit_dollars">Unit price ($)</label>
          <input id="unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" required
            value="${escapeHtml(prefillItem ? centsToDollarsInput(prefillItem.unit_cents) : "0")}" /></div>
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

app.get("/jobs/:id/invoice", async (c) => {
	const user = c.get("user")!;
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, c.name AS customer_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = ?`,
	)
		.bind(id)
		.first<{ id: string; title: string; job_type: string; customer_name: string }>();
	if (!job) return c.notFound();
	if (!canAccessProduct(user, productForJobType(job.job_type))) {
		return c.text("Forbidden", 403);
	}
	const invoice = await getLatestInvoiceForJob(c.env.DB, id);
	const lines = invoice ? await listInvoiceLines(c.env.DB, invoice.id) : [];
	const caps = await getDiscountCapSettings(c.env.DB);
	const flash = c.req.query("err") || null;
	const body = renderInvoiceWorkspaceHtml({
		backHref: `/jobs/${id}`,
		backLabel: "← Job",
		actionBase: `/jobs/${id}/invoice`,
		pdfHref: `/jobs/${id}/invoice.pdf`,
		jobTitle: job.title,
		customerName: job.customer_name,
		invoice,
		lines,
		capNotice: discountCapNoticeHtml(caps),
		flash,
		canManage: canManageInvoices(user),
	});
	return c.html(page(c, "Invoice", body));
});

app.post("/jobs/:id/invoice/create", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const job = await loadFieldJobAccess(c.env.DB, id);
	if (!job || job.deleted_at) return c.notFound();
	if (!canAccessProduct(user, productForJobType(job.job_type))) {
		return c.text("Forbidden", 403);
	}
	const inv = await createFieldInvoiceFromEstimate(c.env.DB, id, user.id);
	await recordAudit(c, {
		action: "invoice_create",
		entityType: "invoice",
		entityId: inv.id,
		summary: `Created field invoice draft for job ${id}`,
		detail: { jobId: id, total_cents: inv.total_cents },
	});
	return c.redirect(`/jobs/${id}/invoice`);
});

app.post("/jobs/:id/invoice", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const invoice = await getLatestInvoiceForJob(c.env.DB, id);
	if (!invoice || invoice.job_id !== id) return c.notFound();
	const form = await c.req.parseBody();
	const parsed = parseInvoiceDiscountForm(form as Record<string, unknown>);
	if (!parsed.ok) return c.redirect(`/jobs/${id}/invoice?err=${encodeURIComponent(parsed.error)}`);
	const result = await updateInvoiceDraft(c.env.DB, invoice, {
		user,
		discountPct: parsed.discountPct,
		writeoffCents: parsed.writeoffCents,
		notes: parsed.notes,
	});
	if (!result.ok) {
		return c.redirect(`/jobs/${id}/invoice?err=${encodeURIComponent(result.error)}`);
	}
	await recordAudit(c, {
		action: "invoice_update",
		entityType: "invoice",
		entityId: invoice.id,
		summary: `Updated field invoice draft ${invoice.id}`,
		detail: {
			discount_pct: parsed.discountPct,
			writeoff_cents: parsed.writeoffCents,
			total_cents: result.invoice.total_cents,
		},
	});
	return c.redirect(`/jobs/${id}/invoice`);
});

app.post("/jobs/:id/invoice/approve", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const invoice = await getLatestInvoiceForJob(c.env.DB, id);
	if (!invoice || invoice.job_id !== id) return c.notFound();
	const result = await approveInvoice(c.env.DB, invoice, user);
	if (!result.ok) {
		return c.redirect(`/jobs/${id}/invoice?err=${encodeURIComponent(result.error)}`);
	}
	await recordAudit(c, {
		action: "invoice_approve",
		entityType: "invoice",
		entityId: invoice.id,
		summary: `Approved field invoice ${invoice.id}`,
		detail: { total_cents: result.invoice.total_cents },
	});
	return c.redirect(`/jobs/${id}/invoice`);
});

app.post("/jobs/:id/invoice/send", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user)) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const invoice = await getLatestInvoiceForJob(c.env.DB, id);
	if (!invoice || invoice.job_id !== id) return c.notFound();
	const result = await sendInvoice(c.env.DB, invoice, user);
	if (!result.ok) {
		return c.redirect(`/jobs/${id}/invoice?err=${encodeURIComponent(result.error)}`);
	}
	await recordAudit(c, {
		action: "invoice_send",
		entityType: "invoice",
		entityId: invoice.id,
		summary: `Sent field invoice ${invoice.id}`,
		detail: { total_cents: result.invoice.total_cents, job_status: "invoiced" },
	});
	return c.redirect(`/jobs/${id}/invoice`);
});

app.get("/jobs/:id/invoice.pdf", async (c) => {
	const user = c.get("user")!;
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, c.name AS customer_name,
      s.address_line1, s.city, s.state, s.postal_code
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     WHERE j.id = ?`,
	)
		.bind(id)
		.first<{
			id: string;
			title: string;
			job_type: string;
			customer_name: string;
			address_line1: string | null;
			city: string | null;
			state: string | null;
			postal_code: string | null;
		}>();
	if (!job) return c.notFound();
	if (!canAccessProduct(user, productForJobType(job.job_type))) {
		return c.text("Forbidden", 403);
	}
	const invoice = await getLatestInvoiceForJob(c.env.DB, id);
	if (!invoice) return c.text("No invoice yet", 404);
	const lines = await listInvoiceLines(c.env.DB, invoice.id);
	const siteLine = job.address_line1
		? `${job.address_line1}, ${job.city}, ${job.state} ${job.postal_code || ""}`.trim()
		: "";
	const bytes = await buildInvoicePdf({
		title: job.title,
		customerName: job.customer_name,
		siteLine,
		invoiceId: invoice.id,
		status: invoice.status,
		lines,
		subtotalCents: invoice.subtotal_cents,
		discountPct: invoice.discount_pct,
		discountCents: invoice.discount_cents,
		writeoffCents: invoice.writeoff_cents,
		totalCents: invoice.total_cents,
		notes: invoice.notes,
	});
	return new Response(bytes, {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="invoice-${invoice.id}.pdf"`,
		},
	});
});

app.get("/jobs/:id/water-loss.pdf", async (c) => {
	const id = c.req.param("id");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const job = await c.env.DB.prepare(
		`SELECT j.title, j.job_type, j.status, j.notes, j.claim_number, j.carrier, j.date_of_loss,
      c.name AS customer_name,
      s.address_line1, s.city, s.state, s.postal_code
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     WHERE j.id = ?`,
	)
		.bind(id)
		.first<{
			title: string;
			job_type: string;
			status: string;
			notes: string | null;
			claim_number: string | null;
			carrier: string | null;
			date_of_loss: string | null;
			customer_name: string;
			address_line1: string | null;
			city: string | null;
			state: string | null;
			postal_code: string | null;
		}>();
	if (!job) return c.notFound();

	const logs = await c.env.DB.prepare(
		`SELECT kind, logged_at, area, reading, temp_f, rh_pct, grains,
      equipment_type, equipment_count, notes
     FROM job_field_logs WHERE job_id = ? AND ${NOT_VOIDED_SQL}
     ORDER BY logged_at ASC, created_at ASC`,
	)
		.bind(id)
		.all<{
			kind: string;
			logged_at: string;
			area: string | null;
			reading: string | null;
			temp_f: number | null;
			rh_pct: number | null;
			grains: number | null;
			equipment_type: string | null;
			equipment_count: number | null;
			notes: string | null;
		}>();

	const fieldNotes = await c.env.DB.prepare(
		`SELECT n.body, n.created_at, u.name AS user_name
     FROM job_notes n LEFT JOIN users u ON u.id = n.user_id
     WHERE n.job_id = ? ORDER BY n.created_at DESC LIMIT 20`,
	)
		.bind(id)
		.all<{ body: string; created_at: string; user_name: string | null }>();

	const moistureMaps = await c.env.DB.prepare(
		`SELECT filename, label FROM job_moisture_maps
     WHERE job_id = ? AND ${NOT_VOIDED_SQL} ORDER BY created_at ASC`,
	)
		.bind(id)
		.all<{ filename: string; label: string | null }>();

	const siteLine = job.address_line1
		? `${job.address_line1}, ${job.city}, ${job.state} ${job.postal_code || ""}`.trim()
		: "";

	const all = logs.results || [];
	const bytes = await buildWaterLossPdf({
		jobTitle: job.title,
		jobTypeLabel: jobTypeLabel(job.job_type),
		customerName: job.customer_name,
		siteLine,
		claimNumber: job.claim_number,
		carrier: job.carrier,
		dateOfLoss: job.date_of_loss,
		status: statusLabel(job.status),
		jobNotes: job.notes,
		moisture: all
			.filter((l) => l.kind === "moisture")
			.map((l) => ({
				logged_at: l.logged_at,
				area: l.area,
				reading: l.reading,
				temp_f: l.temp_f,
				rh_pct: l.rh_pct,
				grains: l.grains,
				notes: l.notes,
			})),
		equipment: all
			.filter((l) => l.kind === "equipment")
			.map((l) => ({
				logged_at: l.logged_at,
				area: l.area,
				equipment_type: l.equipment_type,
				equipment_count: l.equipment_count,
				notes: l.notes,
			})),
		fieldNotes: fieldNotes.results || [],
		moistureMaps: moistureMaps.results || [],
	});

	return new Response(bytes, {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="water-loss-${id}.pdf"`,
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
		.bind(newId("note"), id, c.get("user")!.id, body)
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
			c.get("user")!.id,
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

app.post("/jobs/:id/photos/:photoId/void", async (c) => {
	const id = c.req.param("id");
	const photoId = c.req.param("photoId");
	const user = c.get("user")!;
	if (!canVoidClaimData(user)) return c.text("Forbidden", 403);

	const form = await c.req.parseBody();
	const reason = normalizeVoidReason(form.void_reason);
	if (!reason) return c.text("Void reason required (at least 3 characters)", 400);

	const result = await c.env.DB.prepare(
		`UPDATE job_photos
     SET voided_at = datetime('now'), voided_by = ?, void_reason = ?
     WHERE id = ? AND job_id = ? AND voided_at IS NULL`,
	)
		.bind(user.id, reason, photoId, id)
		.run();
	if (!result.meta.changes) return c.text("Photo not found or already voided", 404);

	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "void",
		entityType: "job_photo",
		entityId: photoId,
		summary: `Voided photo on job ${id}`,
		detail: { jobId: id, reason },
	});
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/moisture-maps", async (c) => {
	const id = c.req.param("id");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const form = await c.req.parseBody();
	const file = form.map;
	if (!file || !(file instanceof File)) {
		return c.text("Map image required", 400);
	}
	if (!file.type.startsWith("image/")) {
		return c.text("Only image uploads are allowed", 400);
	}
	if (file.size > MAX_PHOTO_BYTES) {
		return c.text("Image must be 10 MB or smaller", 400);
	}

	const mapId = newId("mmap");
	const safeName =
		file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "moisture-map.jpg";
	const r2Key = `jobs/${id}/moisture-maps/${mapId}/${safeName}`;
	const bytes = new Uint8Array(await file.arrayBuffer());
	await c.env.UPLOADS.put(r2Key, bytes, {
		httpMetadata: { contentType: file.type },
		customMetadata: { jobId: id, mapId, filename: safeName },
	});
	await c.env.DB.prepare(
		`INSERT INTO job_moisture_maps (id, job_id, r2_key, filename, content_type, size_bytes, label, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			mapId,
			id,
			r2Key,
			safeName,
			file.type || null,
			file.size,
			String(form.label || "").trim() || null,
			c.get("user")!.id,
		)
		.run();
	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect(`/jobs/${id}`);
});

app.get("/jobs/:id/moisture-maps/:mapId", async (c) => {
	const id = c.req.param("id");
	const mapId = c.req.param("mapId");
	const row = await c.env.DB.prepare(
		`SELECT r2_key, content_type, filename FROM job_moisture_maps WHERE id = ? AND job_id = ?`,
	)
		.bind(mapId, id)
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

app.post("/jobs/:id/moisture-maps/:mapId/void", async (c) => {
	const id = c.req.param("id");
	const mapId = c.req.param("mapId");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const user = c.get("user")!;
	if (!canVoidClaimData(user)) return c.text("Forbidden", 403);

	const form = await c.req.parseBody();
	const reason = normalizeVoidReason(form.void_reason);
	if (!reason) return c.text("Void reason required (at least 3 characters)", 400);

	const result = await c.env.DB.prepare(
		`UPDATE job_moisture_maps
     SET voided_at = datetime('now'), voided_by = ?, void_reason = ?
     WHERE id = ? AND job_id = ? AND voided_at IS NULL`,
	)
		.bind(user.id, reason, mapId, id)
		.run();
	if (!result.meta.changes) return c.text("Map not found or already voided", 404);

	await c.env.DB.prepare(
		`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(id)
		.run();
	await recordAudit(c, {
		action: "void",
		entityType: "moisture_map",
		entityId: mapId,
		summary: `Voided moisture map on job ${id}`,
		detail: { jobId: id, reason },
	});
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/inventory", async (c) => {
	const id = c.req.param("id");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const form = await c.req.parseBody();
	const assetId = String(form.asset_id || "").trim();
	if (!assetId) return c.text("Select a unit", 400);

	const asset = await c.env.DB.prepare(
		`SELECT id, status FROM equipment_assets WHERE id = ?`,
	)
		.bind(assetId)
		.first<{ id: string; status: string }>();
	if (!asset || asset.status !== "available") {
		return c.text("Unit is not available", 400);
	}

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO job_equipment (id, job_id, asset_id) VALUES (?, ?, ?)`,
		).bind(newId("jeq"), id, assetId),
		c.env.DB.prepare(
			`UPDATE equipment_assets SET status = 'on_job', updated_at = datetime('now') WHERE id = ?`,
		).bind(assetId),
		c.env.DB.prepare(
			`UPDATE jobs SET updated_at = datetime('now') WHERE id = ?`,
		).bind(id),
	]);
	return c.redirect(`/jobs/${id}`);
});

app.post("/jobs/:id/inventory/:assignmentId/return", async (c) => {
	const id = c.req.param("id");
	const assignmentId = c.req.param("assignmentId");
	const gate = await requireRestorationJob(c.env.DB, id);
	if (gate instanceof Response) return gate;

	const row = await c.env.DB.prepare(
		`SELECT asset_id FROM job_equipment
     WHERE id = ? AND job_id = ? AND returned_at IS NULL`,
	)
		.bind(assignmentId, id)
		.first<{ asset_id: string }>();
	if (!row) return c.text("Assignment not found", 404);

	await c.env.DB.batch([
		c.env.DB.prepare(
			`UPDATE job_equipment SET returned_at = datetime('now') WHERE id = ?`,
		).bind(assignmentId),
		c.env.DB.prepare(
			`UPDATE equipment_assets SET status = 'available', updated_at = datetime('now') WHERE id = ?`,
		).bind(row.asset_id),
	]);
	return c.redirect(`/jobs/${id}`);
});

app.get("/inventory", async (c) => {
	const status = c.req.query("status") || "";
	const list = status
		? await c.env.DB.prepare(
				`SELECT a.*,
          (SELECT j.title FROM job_equipment je
           JOIN jobs j ON j.id = je.job_id
           WHERE je.asset_id = a.id AND je.returned_at IS NULL
           LIMIT 1) AS job_title,
          (SELECT je.job_id FROM job_equipment je
           WHERE je.asset_id = a.id AND je.returned_at IS NULL
           LIMIT 1) AS job_id
         FROM equipment_assets a
         WHERE a.status = ?
         ORDER BY a.equipment_type, a.label COLLATE NOCASE`,
			)
				.bind(status)
				.all<
					AssetRow & { job_title: string | null; job_id: string | null }
				>()
		: await c.env.DB.prepare(
				`SELECT a.*,
          (SELECT j.title FROM job_equipment je
           JOIN jobs j ON j.id = je.job_id
           WHERE je.asset_id = a.id AND je.returned_at IS NULL
           LIMIT 1) AS job_title,
          (SELECT je.job_id FROM job_equipment je
           WHERE je.asset_id = a.id AND je.returned_at IS NULL
           LIMIT 1) AS job_id
         FROM equipment_assets a
         ORDER BY a.status, a.equipment_type, a.label COLLATE NOCASE`,
			).all<AssetRow & { job_title: string | null; job_id: string | null }>();

	const typeOptions = EQUIPMENT_TYPES.map(
		(t) =>
			`<option value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</option>`,
	).join("");
	const statusFilters = ["", ...ASSET_STATUSES.map((s) => s.value)]
		.map((s) => {
			const href = s ? `/inventory?status=${escapeHtml(s)}` : "/inventory";
			const active = status === s ? "btn" : "btn secondary";
			return `<a class="${active}" href="${href}">${escapeHtml(s ? assetStatusLabel(s) : "All")}</a>`;
		})
		.join(" ");

	const rows =
		list.results
			?.map((a) => {
				const jobCell = a.job_id
					? `<a href="/jobs/${escapeHtml(a.job_id)}">${escapeHtml(a.job_title || a.job_id)}</a>`
					: "—";
				return `<tr>
        <td><a href="/inventory/${escapeHtml(a.id)}">${escapeHtml(a.label)}</a></td>
        <td>${escapeHtml(equipmentTypeLabel(a.equipment_type))}</td>
        <td>${escapeHtml(a.serial) || "—"}</td>
        <td><span class="badge">${escapeHtml(assetStatusLabel(a.status))}</span></td>
        <td>${jobCell}</td>
      </tr>`;
			})
			.join("") ||
		`<tr><td colspan="5" class="muted">No equipment yet. Add a unit below.</td></tr>`;

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">Inventory</h1></div>
    </div>
    <p class="muted">Tracked drying equipment — assign units on restoration jobs.</p>
    <div class="toolbar">${statusFilters}</div>
    <table>
      <thead><tr><th>Unit</th><th>Type</th><th>Serial</th><th>Status</th><th>On job</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Add unit</h2>
    <form method="post" action="/inventory" class="panel stack">
      <div class="row">
        <div><label for="label">Label</label>
          <input id="label" name="label" required placeholder="AM-12" /></div>
        <div><label for="equipment_type">Type</label>
          <select id="equipment_type" name="equipment_type" required>${typeOptions}</select></div>
        <div><label for="serial">Serial</label>
          <input id="serial" name="serial" placeholder="Optional" /></div>
      </div>
      <div><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea></div>
      <button class="btn" type="submit">Add to inventory</button>
    </form>`;

	return c.html(page(c, "Inventory", body));
});

app.post("/inventory", async (c) => {
	const form = await c.req.parseBody();
	const label = String(form.label || "").trim();
	const equipmentType = String(form.equipment_type || "");
	if (!label || !isValidEquipmentType(equipmentType)) {
		return c.text("Label and type required", 400);
	}
	const id = newId("eq");
	await c.env.DB.prepare(
		`INSERT INTO equipment_assets (id, label, equipment_type, serial, status, notes)
     VALUES (?, ?, ?, ?, 'available', ?)`,
	)
		.bind(
			id,
			label,
			equipmentType,
			String(form.serial || "").trim() || null,
			String(form.notes || "").trim() || null,
		)
		.run();
	return c.redirect(`/inventory/${id}`);
});

app.get("/inventory/:id", async (c) => {
	const id = c.req.param("id");
	const asset = await c.env.DB.prepare(
		`SELECT * FROM equipment_assets WHERE id = ?`,
	)
		.bind(id)
		.first<AssetRow>();
	if (!asset) return c.notFound();

	const history = await c.env.DB.prepare(
		`SELECT je.id, je.assigned_at, je.returned_at, j.id AS job_id, j.title AS job_title
     FROM job_equipment je
     JOIN jobs j ON j.id = je.job_id
     WHERE je.asset_id = ?
     ORDER BY je.assigned_at DESC
     LIMIT 40`,
	)
		.bind(id)
		.all<{
			id: string;
			assigned_at: string;
			returned_at: string | null;
			job_id: string;
			job_title: string;
		}>();

	const typeOptions = EQUIPMENT_TYPES.map(
		(t) =>
			`<option value="${escapeHtml(t.value)}" ${asset.equipment_type === t.value ? "selected" : ""}>${escapeHtml(t.label)}</option>`,
	).join("");
	const statusOptions = ASSET_STATUSES.map(
		(s) =>
			`<option value="${escapeHtml(s.value)}" ${asset.status === s.value ? "selected" : ""}>${escapeHtml(s.label)}</option>`,
	).join("");

	const histRows =
		history.results
			?.map(
				(h) => `<tr>
        <td><a href="/jobs/${escapeHtml(h.job_id)}">${escapeHtml(h.job_title)}</a></td>
        <td>${escapeHtml(h.assigned_at.slice(0, 16).replace("T", " "))}</td>
        <td>${h.returned_at ? escapeHtml(h.returned_at.slice(0, 16).replace("T", " ")) : "Still out"}</td>
      </tr>`,
			)
			.join("") || `<tr><td colspan="3" class="muted">No job history yet.</td></tr>`;

	const body = `
    <div class="toolbar">
      <div class="grow"><h1 style="margin:0">${escapeHtml(asset.label)}</h1></div>
      <a class="btn secondary" href="/inventory">All inventory</a>
    </div>
    <form method="post" action="/inventory/${escapeHtml(id)}" class="panel stack">
      <div class="row">
        <div><label for="label">Label</label>
          <input id="label" name="label" required value="${escapeHtml(asset.label)}" /></div>
        <div><label for="equipment_type">Type</label>
          <select id="equipment_type" name="equipment_type" required>${typeOptions}</select></div>
        <div><label for="serial">Serial</label>
          <input id="serial" name="serial" value="${escapeHtml(asset.serial)}" /></div>
        <div><label for="status">Status</label>
          <select id="status" name="status" required>${statusOptions}</select></div>
      </div>
      <div><label for="notes">Notes</label>
        <textarea id="notes" name="notes">${escapeHtml(asset.notes)}</textarea></div>
      <p class="muted">While a unit is on a job, status must stay <strong>On job</strong>. Use Return on the job page before Available / Maintenance / Retired.</p>
      <button class="btn" type="submit">Save</button>
    </form>
    <h2>Assignment history</h2>
    <table>
      <thead><tr><th>Job</th><th>Assigned</th><th>Returned</th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;

	return c.html(page(c, asset.label, body));
});

app.post("/inventory/:id", async (c) => {
	const id = c.req.param("id");
	const form = await c.req.parseBody();
	const label = String(form.label || "").trim();
	const equipmentType = String(form.equipment_type || "");
	const status = String(form.status || "");
	if (!label || !isValidEquipmentType(equipmentType) || !isValidAssetStatus(status)) {
		return c.text("Label, type, and status required", 400);
	}

	const open = await c.env.DB.prepare(
		`SELECT id FROM job_equipment WHERE asset_id = ? AND returned_at IS NULL LIMIT 1`,
	)
		.bind(id)
		.first<{ id: string }>();
	if (!canSetAssetStatusWithOpenAssignment(status, !!open)) {
		return c.text(
			"Unit is assigned to an active job — return it on the job page before changing status off On job.",
			400,
		);
	}

	await c.env.DB.prepare(
		`UPDATE equipment_assets SET
      label = ?, equipment_type = ?, serial = ?, status = ?, notes = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
	)
		.bind(
			label,
			equipmentType,
			String(form.serial || "").trim() || null,
			status,
			String(form.notes || "").trim() || null,
			id,
		)
		.run();
	return c.redirect(`/inventory/${id}`);
});

app.get("/reports", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.html(forbiddenHtml(c, "Reports are for owner / manager / dispatcher."), 403);
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const q = new URLSearchParams();
	if (from) q.set("from", from);
	if (to) q.set("to", to);
	const qs = q.toString() ? `?${q}` : "";

	const body = `
    <h1>Reports</h1>
    <p class="muted">Date-range CSV exports for ops. Leave dates blank for all rows (capped).</p>
    <form class="panel toolbar" method="get" action="/reports" style="align-items:end">
      <div>
        <label for="from">From</label>
        <input id="from" name="from" type="date" value="${escapeHtml(from)}" />
      </div>
      <div>
        <label for="to">To</label>
        <input id="to" name="to" type="date" value="${escapeHtml(to)}" />
      </div>
      <button class="btn secondary" type="submit">Apply dates</button>
      <a class="btn secondary" href="/reports">Clear</a>
    </form>
    <div class="stack" style="margin-top:1rem">
      <div class="panel stack">
        <strong>Field jobs (rich)</strong>
        <p class="muted" style="margin:0">Customer, site, type, status, assignee, schedule, claim, estimate/invoice.</p>
        <div><a class="btn" href="/reports/jobs.csv${qs}">Download jobs CSV</a></div>
      </div>
      <div class="panel stack">
        <strong>Moisture &amp; equipment logs</strong>
        <p class="muted" style="margin:0">Field log entries by job (logged date filter).</p>
        <div><a class="btn" href="/reports/field-logs.csv${qs}">Download field logs CSV</a></div>
      </div>
      <div class="panel stack">
        <strong>Inventory assignments</strong>
        <p class="muted" style="margin:0">Unit check-out / return history (assigned date filter).</p>
        <div><a class="btn" href="/reports/inventory.csv${qs}">Download inventory CSV</a></div>
      </div>
      <div class="panel stack">
        <strong>Print jobs</strong>
        <p class="muted" style="margin:0">Print pipeline with product type, status, due, estimate (updated date filter).</p>
        <div><a class="btn" href="/reports/print.csv${qs}">Download print CSV</a></div>
      </div>
    </div>`;

	return c.html(page(c, "Reports", body));
});

app.get("/reports/jobs.csv", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const where: string[] = ["1=1"];
	const binds: string[] = [];
	if (from) {
		where.push("date(COALESCE(j.scheduled_start, j.created_at)) >= date(?)");
		binds.push(from);
	}
	if (to) {
		where.push("date(COALESCE(j.scheduled_start, j.created_at)) <= date(?)");
		binds.push(to);
	}

	const sql = `SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, j.scheduled_end,
      j.estimate_cents, j.invoice_cents, j.claim_number, j.carrier, j.date_of_loss, j.created_at,
      c.name AS customer_name, c.phone AS customer_phone,
      s.address_line1, s.city, s.state, s.postal_code,
      u.name AS assignee_name, COALESCE(u.designation, u.role) AS assignee_designation
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     LEFT JOIN users u ON u.id = j.assigned_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(j.scheduled_start, j.created_at) ASC
     LIMIT 5000`;

	const stmt = c.env.DB.prepare(sql);
	const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
	const rows = ((result.results || []) as Array<Record<string, unknown>>).map(
		(j) => [
			j.id as string,
			j.title as string,
			j.customer_name as string,
			j.customer_phone as string,
			[j.address_line1, j.city, j.state, j.postal_code].filter(Boolean).join(", "),
			j.job_type as string,
			j.status as string,
			j.assignee_name as string,
			j.assignee_designation as string,
			j.scheduled_start as string,
			j.scheduled_end as string,
			j.claim_number as string,
			j.carrier as string,
			j.date_of_loss as string,
			j.estimate_cents as number,
			j.invoice_cents as number,
			j.created_at as string,
		],
	);

	return csvResponse(
		"lumanyi-jobs-rich.csv",
		[
			"id",
			"title",
			"customer",
			"customer_phone",
			"site",
			"job_type",
			"status",
			"assignee",
			"assignee_designation",
			"scheduled_start",
			"scheduled_end",
			"claim_number",
			"carrier",
			"date_of_loss",
			"estimate_cents",
			"invoice_cents",
			"created_at",
		],
		rows,
	);
});

app.get("/reports/field-logs.csv", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const where: string[] = ["1=1"];
	const binds: string[] = [];
	if (from) {
		where.push("date(l.logged_at) >= date(?)");
		binds.push(from);
	}
	if (to) {
		where.push("date(l.logged_at) <= date(?)");
		binds.push(to);
	}

	const sql = `SELECT l.id, l.kind, l.logged_at, l.area, l.reading, l.equipment_type,
      l.equipment_count, l.notes, l.created_at, l.voided_at, l.void_reason,
      j.id AS job_id, j.title AS job_title, j.job_type,
      c.name AS customer_name, u.name AS logged_by
     FROM job_field_logs l
     JOIN jobs j ON j.id = l.job_id
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN users u ON u.id = l.created_by
     WHERE ${where.join(" AND ")}
     ORDER BY l.logged_at ASC, l.created_at ASC
     LIMIT 10000`;

	const stmt = c.env.DB.prepare(sql);
	const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
	const rows = ((result.results || []) as Array<Record<string, unknown>>).map(
		(r) => [
			r.id as string,
			r.job_id as string,
			r.job_title as string,
			r.job_type as string,
			r.customer_name as string,
			r.kind as string,
			r.logged_at as string,
			r.area as string,
			r.reading as string,
			r.equipment_type as string,
			r.equipment_count as number,
			r.notes as string,
			r.logged_by as string,
			r.created_at as string,
			r.voided_at as string,
			r.void_reason as string,
		],
	);

	return csvResponse(
		"lumanyi-field-logs.csv",
		[
			"id",
			"job_id",
			"job_title",
			"job_type",
			"customer",
			"kind",
			"logged_at",
			"area",
			"reading",
			"equipment_type",
			"equipment_count",
			"notes",
			"logged_by",
			"created_at",
			"voided_at",
			"void_reason",
		],
		rows,
	);
});

app.get("/reports/inventory.csv", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const where: string[] = ["1=1"];
	const binds: string[] = [];
	if (from) {
		where.push("date(je.assigned_at) >= date(?)");
		binds.push(from);
	}
	if (to) {
		where.push("date(je.assigned_at) <= date(?)");
		binds.push(to);
	}

	const sql = `SELECT je.id, je.assigned_at, je.returned_at, je.notes AS assignment_notes,
      a.label AS asset_label, a.equipment_type, a.serial, a.status AS asset_status,
      j.id AS job_id, j.title AS job_title, c.name AS customer_name
     FROM job_equipment je
     JOIN equipment_assets a ON a.id = je.asset_id
     JOIN jobs j ON j.id = je.job_id
     JOIN customers c ON c.id = j.customer_id
     WHERE ${where.join(" AND ")}
     ORDER BY je.assigned_at ASC
     LIMIT 10000`;

	const stmt = c.env.DB.prepare(sql);
	const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
	const rows = ((result.results || []) as Array<Record<string, unknown>>).map(
		(r) => [
			r.id as string,
			r.asset_label as string,
			r.equipment_type as string,
			r.serial as string,
			r.asset_status as string,
			r.job_id as string,
			r.job_title as string,
			r.customer_name as string,
			r.assigned_at as string,
			r.returned_at as string,
			r.assignment_notes as string,
		],
	);

	return csvResponse(
		"lumanyi-inventory-assignments.csv",
		[
			"assignment_id",
			"asset_label",
			"equipment_type",
			"serial",
			"asset_status",
			"job_id",
			"job_title",
			"customer",
			"assigned_at",
			"returned_at",
			"notes",
		],
		rows,
	);
});

app.get("/reports/print.csv", async (c) => {
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
	const from = c.req.query("from") || "";
	const to = c.req.query("to") || "";
	const where: string[] = ["1=1"];
	const binds: string[] = [];
	if (from) {
		where.push("date(p.updated_at) >= date(?)");
		binds.push(from);
	}
	if (to) {
		where.push("date(p.updated_at) <= date(?)");
		binds.push(to);
	}

	const sql = `SELECT p.id, p.title, p.product_type, p.status, p.quantity, p.due_date,
      p.estimate_cents, p.delivery_method, p.revise_count, p.created_at, p.updated_at,
      c.name AS customer_name, u.name AS assignee_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN users u ON u.id = p.assigned_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.updated_at ASC
     LIMIT 5000`;

	const stmt = c.env.DB.prepare(sql);
	const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
	const rows = ((result.results || []) as Array<Record<string, unknown>>).map(
		(r) => [
			r.id as string,
			r.title as string,
			r.customer_name as string,
			r.product_type as string,
			r.status as string,
			r.quantity as number,
			r.due_date as string,
			r.estimate_cents as number,
			r.delivery_method as string,
			r.revise_count as number,
			r.assignee_name as string,
			r.created_at as string,
			r.updated_at as string,
		],
	);

	return csvResponse(
		"lumanyi-print-jobs.csv",
		[
			"id",
			"title",
			"customer",
			"product_type",
			"status",
			"quantity",
			"due_date",
			"estimate_cents",
			"delivery_method",
			"revise_count",
			"assignee",
			"created_at",
			"updated_at",
		],
		rows,
	);
});

app.get("/recurring", async (c) => {
	const _u = c.get("user")!;
	if (!canSeeOfficeTools(_u) || !canAccessProduct(_u, "floors")) {
		return c.html(forbiddenHtml(c, "Recurring jobs are for owner / dispatcher with Floors access."), 403);
	}
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
		`SELECT id, name FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const staff = await c.env.DB.prepare(
		`SELECT id, name, COALESCE(designation, role) AS role FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string }>();

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
					`<option value="${escapeHtml(u.id)}">${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
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
    <p class="muted">Floor contracts by default. “Generate due jobs” creates scheduled jobs for templates whose next date is today or earlier.</p>
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
          <label for="job_type">Service type</label>
          <select id="job_type" name="job_type">
            ${FLOOR_TYPES.filter((t) => t.value !== "hard_floor")
							.map(
								(t, i) =>
									`<option value="${escapeHtml(t.value)}" ${i === 0 ? "selected" : ""}>${escapeHtml(t.label)}</option>`,
							)
							.join("")}
            ${RESTORATION_TYPES.map(
							(t) =>
								`<option value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</option>`,
						).join("")}
            <option value="hard_floor">Hard floor (general)</option>
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
	const _u = c.get("user")!;
	if (!canSeeOfficeTools(_u) || !canAccessProduct(_u, "floors")) {
		return c.text("Forbidden", 403);
	}
	const form = await c.req.parseBody();
	const customerId = String(form.customer_id || "");
	const rawType = String(form.job_type || "hard_floor");
	if (!isValidFieldJobType(rawType)) {
		return c.text("Invalid job type", 400);
	}
	const jobType = normalizeJobType(rawType);
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
	const _u = c.get("user")!;
	if (!canSeeOfficeTools(_u) || !canAccessProduct(_u, "floors")) {
		return c.text("Forbidden", 403);
	}
	const created = await generateDueRecurringJobs(c.env.DB);
	return c.html(
		page(
			c,
			"Recurring",
			`<h1>Generated</h1><p>Created ${created} job(s) from due templates.</p>
       <p><a class="btn" href="/recurring">Back</a> <a class="btn secondary" href="/floors?status=scheduled">View scheduled floors</a></p>`,
		),
	);
});

app.post("/recurring/:id/toggle", async (c) => {
	const _u = c.get("user")!;
	if (!canSeeOfficeTools(_u) || !canAccessProduct(_u, "floors")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	await c.env.DB.prepare(
		`UPDATE recurring_jobs SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?`,
	)
		.bind(id)
		.run();
	return c.redirect("/recurring");
});

app.get("/print", async (c) => {
	if (!canAccessProduct(c.get("user")!, "print")) return c.html(forbiddenHtml(c, "Your account does not include Print Ops."), 403);
	const user = c.get("user")!;
	const status = c.req.query("status") || "";
	const pVis = printJobVisibility(user);
	const pExtra = pVis.sql === "1=1" ? "" : ` AND ${pVis.sql}`;
	const list = status
		? await (pVis.binds.length
				? c.env.DB.prepare(
						`SELECT p.*, c.name AS customer_name
         FROM print_jobs p
         LEFT JOIN customers c ON c.id = p.customer_id
         WHERE p.status = ? AND p.deleted_at IS NULL${pExtra}
         ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
         LIMIT 100`,
					).bind(status, ...pVis.binds)
				: c.env.DB.prepare(
						`SELECT p.*, c.name AS customer_name
         FROM print_jobs p
         LEFT JOIN customers c ON c.id = p.customer_id
         WHERE p.status = ? AND p.deleted_at IS NULL
         ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
         LIMIT 100`,
					).bind(status)
			).all()
		: await (pVis.binds.length
				? c.env.DB.prepare(
						`SELECT p.*, c.name AS customer_name
         FROM print_jobs p
         LEFT JOIN customers c ON c.id = p.customer_id
         WHERE p.status != 'cancelled' AND p.deleted_at IS NULL${pExtra}
         ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
         LIMIT 100`,
					).bind(...pVis.binds)
				: c.env.DB.prepare(
						`SELECT p.*, c.name AS customer_name
         FROM print_jobs p
         LEFT JOIN customers c ON c.id = p.customer_id
         WHERE p.status != 'cancelled' AND p.deleted_at IS NULL
         ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
         LIMIT 100`,
					)
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
	if (!canAccessProduct(c.get("user")!, "print")) return c.html(forbiddenHtml(c, "Your account does not include Print Ops."), 403);
	const user = c.get("user")!;
	const pVis = printJobVisibility(user);
	const pExtra = pVis.sql === "1=1" ? "" : ` AND ${pVis.sql}`;
	const list = await (pVis.binds.length
		? c.env.DB.prepare(
				`SELECT p.id, p.title, p.product_type, p.status, p.quantity, p.due_date, p.revise_count,
      c.name AS customer_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.status IN ('intake','proof','approved','in_production','ready') AND p.deleted_at IS NULL${pExtra}
     ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
     LIMIT 200`,
			).bind(...pVis.binds)
		: c.env.DB.prepare(
				`SELECT p.id, p.title, p.product_type, p.status, p.quantity, p.due_date, p.revise_count,
      c.name AS customer_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.status IN ('intake','proof','approved','in_production','ready') AND p.deleted_at IS NULL
     ORDER BY COALESCE(p.due_date, '9999') ASC, p.updated_at DESC
     LIMIT 200`,
			)
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
	if (!canAccessProduct(c.get("user")!, "print")) return c.html(forbiddenHtml(c, "Your account does not include Print Ops."), 403);
	if (!canSeeOfficeTools(c.get("user")!)) return c.html(forbiddenHtml(c, "Creating print jobs is for owner / manager / dispatcher."), 403);
	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const staff = await c.env.DB.prepare(
		`SELECT id, name, COALESCE(designation, role) AS role FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string }>();

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
					`<option value="${escapeHtml(u.id)}">${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
			)
			.join("") || "";
	const productOptions = printTypesForSelect().map(
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
	if (!canAccessProduct(c.get("user")!, "print")) return c.text("Forbidden", 403);
	if (!canSeeOfficeTools(c.get("user")!)) return c.text("Forbidden", 403);
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
		`SELECT p.*, c.name AS customer_name, u.name AS assignee_name,
      COALESCE(u.designation, u.role) AS assignee_role
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
			assignee_role: string | null;
			deleted_at: string | null;
		}>();
	if (!job) return c.notFound();

	const user = c.get("user")!;
	const isArchived = !!job.deleted_at;
	const accessJob: PrintJobAccess = {
		id: job.id,
		status: job.status,
		assigned_user_id: job.assigned_user_id,
		deleted_at: job.deleted_at,
	};
	const canWrite = canWritePrintJob(user, accessJob);
	const canOverride = canOverrideJobAssignment(user);
	const lockedBanner = isArchived
		? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">This print job is archived (soft-deleted). Restore from Trash to edit.</div>`
		: !canWrite && canReopenPrintStatus(job.status)
			? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">${escapeHtml(officeLockBannerCopy("print"))}</div>`
			: canWrite && canReopenPrintStatus(job.status)
				? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">Print job is delivered. Use <strong>Reopen</strong> below to unlock press edits.</div>`
				: "";

	const staff = await c.env.DB.prepare(
		`SELECT id, name, COALESCE(designation, role) AS role, products FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string; role: string; products: string | null }>();
	const staffForPrint =
		staff.results?.filter((u) => parseProducts(u.products).includes("print")) ??
		[];
	const customers = await c.env.DB.prepare(
		`SELECT id, name FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
	).all<{ id: string; name: string }>();
	const files = await c.env.DB.prepare(
		`SELECT id, kind, filename, created_at FROM print_files
     WHERE print_job_id = ? ORDER BY created_at DESC`,
	)
		.bind(id)
		.all<{ id: string; kind: string; filename: string; created_at: string }>();
	const lines = await c.env.DB.prepare(
		`SELECT id, description, quantity, unit, unit_cents, cost_unit_cents
     FROM print_quote_lines WHERE print_job_id = ? ORDER BY sort_order, description`,
	)
		.bind(id)
		.all<{
			id: string;
			description: string;
			quantity: number;
			unit: string;
			unit_cents: number;
			cost_unit_cents: number | null;
		}>();

	const marginSettings = await getPrintMarginSettings(c.env.DB);
	const discountCaps = await getDiscountCapSettings(c.env.DB);

	const statusOptions = PRINT_STATUSES.map(
		(s) =>
			`<option value="${s.value}" ${job.status === s.value ? "selected" : ""}>${escapeHtml(s.label)}</option>`,
	).join("");
	const productOptions = printTypesForSelect(job.product_type).map(
		(p) =>
			`<option value="${p.value}" ${job.product_type === p.value ? "selected" : ""}>${escapeHtml(p.label)}</option>`,
	).join("");
	const staffOptions =
		staffForPrint
			.map(
				(u) =>
					`<option value="${escapeHtml(u.id)}" ${job.assigned_user_id === u.id ? "selected" : ""}>${escapeHtml(assigneeOptionLabel(u.name, u.role))}</option>`,
			)
			.join("") || "";
	const overridePanels = renderJobOverridePanels({
		kind: "print",
		jobId: id,
		status: job.status,
		assignedUserId: job.assigned_user_id,
		staffOptionsHtml: staffOptions,
		canOverride,
		archived: isArchived,
	});
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
        <td class="muted">${l.cost_unit_cents != null ? escapeHtml(money(l.cost_unit_cents)) : "—"}</td>
        <td>${escapeHtml(money(l.unit_cents))}</td>
        <td>${escapeHtml(money(total))}</td>
        <td>
          <form method="post" action="/print/${escapeHtml(id)}/quote/${escapeHtml(l.id)}/delete" class="inline">
            <button class="linkish" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
			})
			.join("") || `<tr><td colspan="6" class="muted">No quote lines yet.</td></tr>`;

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
    ${lockedBanner}
    ${overridePanels}
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
      ${canManageInvoices(user) ? `<a class="btn secondary" href="/print/${escapeHtml(id)}/invoice">Invoice</a>` : ""}
      ${
				isArchived && canAccessTrash(user)
					? `<form method="post" action="/trash/print/${escapeHtml(id)}/restore" class="inline"><button class="btn" type="submit">Restore</button></form>`
					: !isArchived && canSoftDelete(user)
						? `<form method="post" action="/print/${escapeHtml(id)}/archive" class="inline" onsubmit="return confirm('Archive this print job?');"><button class="btn secondary" type="submit">Archive</button></form>`
						: ""
			}
    </div>

    <h2>Proof &amp; production</h2>
    ${proofActions}

    <div class="row" style="margin-top:1rem">
      <div class="panel stack">
        <div><span class="muted">Customer</span><br>${escapeHtml(job.customer_name) || "—"}</div>
        <div><span class="muted">Assigned</span><br>${
					job.assignee_name
						? escapeHtml(
								assigneeOptionLabel(
									job.assignee_name,
									job.assignee_role || "tech",
								),
							)
						: "Unassigned"
				}</div>
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
    <p class="muted">Owner margin rules: ${escapeHtml(summarizeMarginSettings(marginSettings))}
      ${canManagePrintMargins(user) ? `· <a href="/settings/print-margins">Edit</a>` : ""}</p>
    <p class="muted" style="font-size:0.85rem">${escapeHtml(discountCapNoticeHtml(discountCaps))}
      ${canManageDiscountCaps(user) ? ` <a href="/settings/discount-caps">Edit caps</a>` : ""}</p>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit cost</th><th>Unit $</th><th>Total</th><th></th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <form method="post" action="/print/${escapeHtml(id)}/quote" class="panel stack" style="margin-top:0.75rem">
      <div class="row">
        <div class="grow"><label for="description">Description</label>
          <input id="description" name="description" required placeholder="4/4 100# cover, 5.5x8.5" /></div>
        <div><label for="quantity">Qty</label>
          <input id="quantity" name="quantity" type="number" step="0.01" min="0" value="1" required /></div>
        <div><label for="unit">Unit</label><input id="unit" name="unit" value="ea" required /></div>
      </div>
      <div class="row">
        <div><label for="cost_unit_dollars">Unit cost ($)</label>
          <input id="cost_unit_dollars" name="cost_unit_dollars" type="number" step="0.01" min="0" placeholder="optional" /></div>
        <div><label for="unit_dollars">Unit sell ($)</label>
          <input id="unit_dollars" name="unit_dollars" type="number" step="0.01" min="0" value="0" required /></div>
      </div>
      <label style="font-weight:400">
        <input type="checkbox" name="apply_margin" value="1" />
        Apply Owner margin rules to unit sell (uses unit cost + qty; overwrites unit sell)
      </label>
      <button class="btn" type="submit">Add line</button>
    </form>`;

	return c.html(page(c, job.title, body));
});

app.post("/print/:id/reopen", async (c) => {
	const user = c.get("user")!;
	if (!canReopenJobs(user) || !canAccessProduct(user, "print")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	const job = await loadPrintJobAccess(c.env.DB, id);
	if (!job) return c.notFound();
	if (job.deleted_at) return c.text("Restore from Trash first.", 400);
	if (!canReopenPrintStatus(job.status)) {
		return c.text("Print job is not delivered — nothing to reopen.", 400);
	}
	const form = await c.req.parseBody();
	const reason = normalizeOverrideReason(form.reason);
	if (!reason) return c.text("Reopen reason required (3–500 chars).", 400);
	const toStatus = PRINT_REOPEN_STATUS;
	await c.env.DB.prepare(
		`UPDATE print_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(toStatus, id)
		.run();
	await recordAudit(c, {
		action: "job_reopen",
		entityType: "print_job",
		entityId: id,
		summary: `Reopened print job ${id} (${job.status} → ${toStatus})`,
		detail: { from: job.status, to: toStatus, reason },
	});
	return c.redirect(`/print/${id}`);
});

app.post("/print/:id/reassign", async (c) => {
	const user = c.get("user")!;
	if (!canOverrideJobAssignment(user) || !canAccessProduct(user, "print")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	const job = await loadPrintJobAccess(c.env.DB, id);
	if (!job) return c.notFound();
	if (job.deleted_at) return c.text("Restore from Trash first.", 400);
	const form = await c.req.parseBody();
	const nextAssignee = String(form.assigned_user_id || "").trim() || null;
	if (nextAssignee) {
		const assignee = await c.env.DB.prepare(
			`SELECT id, products FROM users WHERE id = ? AND COALESCE(active, 1) = 1`,
		)
			.bind(nextAssignee)
			.first<{ id: string; products: string | null }>();
		if (!assignee) return c.text("Assignee not found.", 400);
		if (!parseProducts(assignee.products).includes("print")) {
			return c.text("Assignee is not on the Print product lane.", 400);
		}
	}
	const reasonRaw = String(form.reason || "").trim();
	const reason =
		reasonRaw.length > 0 ? normalizeOverrideReason(reasonRaw) : null;
	if (reasonRaw.length > 0 && !reason) {
		return c.text("Reassign reason must be 3–500 characters if provided.", 400);
	}
	await c.env.DB.prepare(
		`UPDATE print_jobs SET assigned_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
	)
		.bind(nextAssignee, id)
		.run();
	await recordAudit(c, {
		action: "job_reassign",
		entityType: "print_job",
		entityId: id,
		summary: `Reassigned print job ${id}`,
		detail: {
			from: job.assigned_user_id,
			to: nextAssignee,
			reason: reason ?? null,
			locked: isPrintStatusLocked(job.status),
		},
	});
	return c.redirect(`/print/${id}`);
});

app.get("/print/:id/invoice", async (c) => {
	const user = c.get("user")!;
	if (!canAccessProduct(user, "print")) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT p.id, p.title, c.name AS customer_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.id = ?`,
	)
		.bind(id)
		.first<{ id: string; title: string; customer_name: string | null }>();
	if (!job) return c.notFound();
	const invoice = await getLatestInvoiceForPrintJob(c.env.DB, id);
	const lines = invoice ? await listInvoiceLines(c.env.DB, invoice.id) : [];
	const caps = await getDiscountCapSettings(c.env.DB);
	const flash = c.req.query("err") || null;
	const body = renderInvoiceWorkspaceHtml({
		backHref: `/print/${id}`,
		backLabel: "← Print job",
		actionBase: `/print/${id}/invoice`,
		pdfHref: `/print/${id}/invoice.pdf`,
		jobTitle: job.title,
		customerName: job.customer_name || "Walk-in / TBD",
		invoice,
		lines,
		capNotice: discountCapNoticeHtml(caps),
		flash,
		canManage: canManageInvoices(user),
	});
	return c.html(page(c, "Invoice", body));
});

app.post("/print/:id/invoice/create", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user) || !canAccessProduct(user, "print")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	const job = await loadPrintJobAccess(c.env.DB, id);
	if (!job || job.deleted_at) return c.notFound();
	const inv = await createPrintInvoiceFromQuote(c.env.DB, id, user.id);
	await recordAudit(c, {
		action: "invoice_create",
		entityType: "invoice",
		entityId: inv.id,
		summary: `Created print invoice draft for job ${id}`,
		detail: { printJobId: id, total_cents: inv.total_cents },
	});
	return c.redirect(`/print/${id}/invoice`);
});

app.post("/print/:id/invoice", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user) || !canAccessProduct(user, "print")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	const invoice = await getLatestInvoiceForPrintJob(c.env.DB, id);
	if (!invoice || invoice.print_job_id !== id) return c.notFound();
	const form = await c.req.parseBody();
	const parsed = parseInvoiceDiscountForm(form as Record<string, unknown>);
	if (!parsed.ok) {
		return c.redirect(
			`/print/${id}/invoice?err=${encodeURIComponent(parsed.error)}`,
		);
	}
	const result = await updateInvoiceDraft(c.env.DB, invoice, {
		user,
		discountPct: parsed.discountPct,
		writeoffCents: parsed.writeoffCents,
		notes: parsed.notes,
	});
	if (!result.ok) {
		return c.redirect(
			`/print/${id}/invoice?err=${encodeURIComponent(result.error)}`,
		);
	}
	await recordAudit(c, {
		action: "invoice_update",
		entityType: "invoice",
		entityId: invoice.id,
		summary: `Updated print invoice draft ${invoice.id}`,
		detail: {
			discount_pct: parsed.discountPct,
			writeoff_cents: parsed.writeoffCents,
			total_cents: result.invoice.total_cents,
		},
	});
	return c.redirect(`/print/${id}/invoice`);
});

app.post("/print/:id/invoice/approve", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user) || !canAccessProduct(user, "print")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	const invoice = await getLatestInvoiceForPrintJob(c.env.DB, id);
	if (!invoice || invoice.print_job_id !== id) return c.notFound();
	const result = await approveInvoice(c.env.DB, invoice, user);
	if (!result.ok) {
		return c.redirect(
			`/print/${id}/invoice?err=${encodeURIComponent(result.error)}`,
		);
	}
	await recordAudit(c, {
		action: "invoice_approve",
		entityType: "invoice",
		entityId: invoice.id,
		summary: `Approved print invoice ${invoice.id}`,
		detail: { total_cents: result.invoice.total_cents },
	});
	return c.redirect(`/print/${id}/invoice`);
});

app.post("/print/:id/invoice/send", async (c) => {
	const user = c.get("user")!;
	if (!canManageInvoices(user) || !canAccessProduct(user, "print")) {
		return c.text("Forbidden", 403);
	}
	const id = c.req.param("id");
	const invoice = await getLatestInvoiceForPrintJob(c.env.DB, id);
	if (!invoice || invoice.print_job_id !== id) return c.notFound();
	const result = await sendInvoice(c.env.DB, invoice, user);
	if (!result.ok) {
		return c.redirect(
			`/print/${id}/invoice?err=${encodeURIComponent(result.error)}`,
		);
	}
	await recordAudit(c, {
		action: "invoice_send",
		entityType: "invoice",
		entityId: invoice.id,
		summary: `Sent print invoice ${invoice.id}`,
		detail: { total_cents: result.invoice.total_cents },
	});
	return c.redirect(`/print/${id}/invoice`);
});

app.get("/print/:id/invoice.pdf", async (c) => {
	const user = c.get("user")!;
	if (!canAccessProduct(user, "print")) return c.text("Forbidden", 403);
	const id = c.req.param("id");
	const job = await c.env.DB.prepare(
		`SELECT p.id, p.title, c.name AS customer_name
     FROM print_jobs p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.id = ?`,
	)
		.bind(id)
		.first<{ id: string; title: string; customer_name: string | null }>();
	if (!job) return c.notFound();
	const invoice = await getLatestInvoiceForPrintJob(c.env.DB, id);
	if (!invoice) return c.text("No invoice yet", 404);
	const lines = await listInvoiceLines(c.env.DB, invoice.id);
	const bytes = await buildInvoicePdf({
		title: job.title,
		customerName: job.customer_name || "Walk-in / TBD",
		siteLine: "Print Ops",
		invoiceId: invoice.id,
		status: invoice.status,
		lines,
		subtotalCents: invoice.subtotal_cents,
		discountPct: invoice.discount_pct,
		discountCents: invoice.discount_cents,
		writeoffCents: invoice.writeoff_cents,
		totalCents: invoice.total_cents,
		notes: invoice.notes,
	});
	return new Response(bytes, {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="invoice-${invoice.id}.pdf"`,
		},
	});
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
			c.get("user")!.id,
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
	const qty = Number.isFinite(quantity) ? quantity : 1;
	const costUnitCents = dollarsToCents(form.cost_unit_dollars);
	let unitCents = Number.isFinite(parseFloat(String(form.unit_dollars || "0")))
		? Math.round(parseFloat(String(form.unit_dollars || "0")) * 100)
		: 0;
	const applyMargin = String(form.apply_margin || "") === "1";
	if (applyMargin) {
		if (costUnitCents == null) {
			return c.text("Unit cost required when applying margin rules", 400);
		}
		const settings = await getPrintMarginSettings(c.env.DB);
		unitCents = suggestedSellUnitCents(costUnitCents, qty, settings);
	}
	const count = await c.env.DB.prepare(
		`SELECT COUNT(*) AS c FROM print_quote_lines WHERE print_job_id = ?`,
	)
		.bind(id)
		.first<{ c: number }>();
	await c.env.DB.prepare(
		`INSERT INTO print_quote_lines (
      id, print_job_id, description, quantity, unit, unit_cents, cost_unit_cents, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			newId("pql"),
			id,
			String(form.description || "").trim(),
			qty,
			String(form.unit || "ea").trim() || "ea",
			unitCents,
			costUnitCents,
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
	const user = c.get("user")!;
	const view = c.req.query("view") === "all" ? "all" : "today";
	const today = new Date().toISOString().slice(0, 10);

	const jobs = await c.env.DB.prepare(
		`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, c.name AS customer_name,
      s.address_line1, s.city,
      (SELECT COUNT(*) FROM job_checklist_items ci WHERE ci.job_id = j.id) AS checklist_total,
      (SELECT COUNT(*) FROM job_checklist_items ci WHERE ci.job_id = j.id AND ci.done = 1) AS checklist_done
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     LEFT JOIN sites s ON s.id = j.site_id
     WHERE j.assigned_user_id = ?
       AND j.deleted_at IS NULL
       AND j.status IN ('scheduled', 'in_progress', 'estimate')
     ORDER BY COALESCE(j.scheduled_start, '9999') ASC
     LIMIT 80`,
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
			checklist_total: number;
			checklist_done: number;
		}>();

	type TechJob = {
		id: string;
		title: string;
		job_type: string;
		status: string;
		scheduled_start: string | null;
		customer_name: string;
		address_line1: string | null;
		city: string | null;
		checklist_total: number;
		checklist_done: number;
	};

	const all = (jobs.results || []) as TechJob[];

	const bucket = (j: TechJob): "today" | "later" | "unscheduled" => {
		const day = j.scheduled_start?.slice(0, 10) || null;
		if (day && day > today) return "later";
		if (day && day === today) return "today";
		if (j.status === "in_progress") return "today";
		if (day && day < today) return "today"; // overdue still on day list
		return "unscheduled";
	};

	const todayJobs = all.filter((j) => bucket(j) === "today");
	const laterJobs = all.filter((j) => bucket(j) === "later");
	const unscheduledJobs = all.filter((j) => bucket(j) === "unscheduled");

	const card = (j: TechJob) => {
		const when = j.scheduled_start
			? j.scheduled_start.slice(0, 16).replace("T", " ")
			: "Unscheduled";
		const where = j.address_line1
			? `${j.address_line1}${j.city ? `, ${j.city}` : ""}`
			: "No address";
		const check =
			j.checklist_total > 0
				? `${j.checklist_done}/${j.checklist_total} checklist`
				: "No checklist";
		return `<a class="panel stack" href="/jobs/${escapeHtml(j.id)}" style="color:inherit;text-decoration:none">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:start">
        <strong>${escapeHtml(j.title)}</strong>
        <span class="badge ${escapeHtml(j.status)}">${escapeHtml(statusLabel(j.status))}</span>
      </div>
      <div class="muted">${escapeHtml(j.customer_name)} · ${escapeHtml(jobTypeLabel(j.job_type))}</div>
      <div>${escapeHtml(when)}</div>
      <div class="muted">${escapeHtml(where)}</div>
      <div class="muted" style="font-size:0.85rem">${escapeHtml(check)}</div>
    </a>`;
	};

	const section = (title: string, list: TechJob[], empty: string) => {
		const cards =
			list.map(card).join("") || `<p class="muted">${escapeHtml(empty)}</p>`;
		return `<h2 style="margin-top:1.25rem">${escapeHtml(title)} <span class="muted">(${list.length})</span></h2>
      <div class="stack">${cards}</div>`;
	};

	let sectionsHtml = "";
	if (view === "today") {
		sectionsHtml = section(
			"Today",
			todayJobs,
			"Nothing on your day list for today.",
		);
		if (laterJobs.length) {
			sectionsHtml += section("Later", laterJobs, "");
		}
		if (unscheduledJobs.length) {
			sectionsHtml += section("Unscheduled", unscheduledJobs, "");
		}
	} else {
		sectionsHtml =
			section("Today", todayJobs, "Nothing scheduled today.") +
			section("Later", laterJobs, "No later jobs.") +
			section("Unscheduled", unscheduledJobs, "No unscheduled open jobs.");
	}

	const body = `
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">My day</h1>
        <p class="muted" style="margin:0.35rem 0 0">Assigned to ${escapeHtml(user.name)} · ${escapeHtml(today)}. Tap a card for checklist, notes, and moisture.</p>
      </div>
    </div>
    <div class="quick-links">
      <a href="/tech"${view === "today" ? ' style="font-weight:700"' : ""}>Today</a>
      <a href="/tech?view=all"${view === "all" ? ' style="font-weight:700"' : ""}>All my open jobs</a>
      <a href="/calendar">Calendar</a>
    </div>
    ${sectionsHtml}`;

	return c.html(page(c, "Tech", body));
});

app.get("/calendar", async (c) => {
	const user = c.get("user")!;
	const where: string[] = [
		"j.scheduled_start IS NOT NULL",
		"j.status NOT IN ('cancelled')",
	];
	const binds: string[] = [];
	appendFieldJobListFilters(user, where, binds, RESTORATION_SQL_TYPES, FLOOR_TYPE_VALUES);
	const jobs = await (binds.length
		? c.env.DB.prepare(
				`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, j.scheduled_end, c.name AS customer_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id
     WHERE ${where.join(" AND ")}
     ORDER BY j.scheduled_start ASC
     LIMIT 60`,
			).bind(...binds)
		: c.env.DB.prepare(
				`SELECT j.id, j.title, j.job_type, j.status, j.scheduled_start, j.scheduled_end, c.name AS customer_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id
     WHERE ${where.join(" AND ")}
     ORDER BY j.scheduled_start ASC
     LIMIT 60`,
			)
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
      <a class="btn" href="/restoration">Restoration</a>
      <a class="btn secondary" href="/floors">Floors</a>
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
