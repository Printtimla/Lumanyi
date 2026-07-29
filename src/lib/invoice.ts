/** MG-3.1: Invoice draft / approve / send + SA-6.4 cap enforcement. */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { AppUser } from "./auth";
import { canSeeOfficeTools } from "./access";
import {
	discountExceedsMaxPct,
	discountRequiresOwnerApproval,
	getDiscountCapSettings,
	type DiscountCapSettings,
	writeoffExceedsMax,
} from "./discount-caps";
import { money, escapeHtml } from "./html";
import { newId } from "./ids";
import { dollarsToCents } from "./price-list";

export const INVOICE_STATUSES = ["draft", "approved", "sent"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceSource = "field" | "print";

export type InvoiceRow = {
	id: string;
	source: InvoiceSource;
	job_id: string | null;
	print_job_id: string | null;
	status: InvoiceStatus;
	subtotal_cents: number;
	discount_pct: number;
	discount_cents: number;
	writeoff_cents: number;
	total_cents: number;
	notes: string | null;
	created_by: string | null;
	approved_by: string | null;
	approved_at: string | null;
	sent_by: string | null;
	sent_at: string | null;
	created_at: string;
	updated_at: string;
};

export type InvoiceLineRow = {
	id: string;
	invoice_id: string;
	description: string;
	quantity: number;
	unit: string;
	unit_cents: number;
	sort_order: number;
};

export type InvoiceLineInput = {
	description: string;
	quantity: number;
	unit: string;
	unit_cents: number;
};

export function canManageInvoices(user: AppUser): boolean {
	return canSeeOfficeTools(user);
}

export function computeInvoiceTotals(opts: {
	subtotalCents: number;
	discountPct: number;
	writeoffCents: number;
}): { discountCents: number; totalCents: number } {
	const subtotal = Math.max(0, Math.round(opts.subtotalCents));
	const pct = Math.max(0, opts.discountPct);
	const discountCents = Math.min(
		subtotal,
		Math.round((subtotal * pct) / 100),
	);
	const writeoff = Math.max(0, Math.round(opts.writeoffCents));
	const totalCents = Math.max(0, subtotal - discountCents - writeoff);
	return { discountCents, totalCents };
}

export function sumLineSubtotal(lines: InvoiceLineInput[]): number {
	return Math.round(
		lines.reduce((sum, l) => sum + l.quantity * l.unit_cents, 0),
	);
}

/**
 * Enforce SA-6.4 caps.
 * - Hard max discount % / write-off always blocked.
 * - Owner-approval threshold blocks non-owners on approve (and send).
 */
export function validateInvoiceDiscounts(opts: {
	user: AppUser;
	settings: DiscountCapSettings;
	discountPct: number;
	writeoffCents: number;
	action: "save" | "approve" | "send";
}): { ok: true } | { ok: false; error: string } {
	const { user, settings, discountPct, writeoffCents, action } = opts;
	if (discountExceedsMaxPct(discountPct, settings)) {
		return {
			ok: false,
			error: `Discount ${discountPct}% exceeds Owner max (${settings.max_discount_pct}%).`,
		};
	}
	if (writeoffExceedsMax(writeoffCents, settings)) {
		return {
			ok: false,
			error: `Write-off exceeds Owner max ($${(settings.max_writeoff_cents / 100).toFixed(2)}).`,
		};
	}
	if (
		(action === "approve" || action === "send") &&
		discountRequiresOwnerApproval(discountPct, settings) &&
		user.role !== "owner"
	) {
		return {
			ok: false,
			error: `Discount ${discountPct}% requires Owner approval (≥${settings.owner_approval_pct}%).`,
		};
	}
	return { ok: true };
}

export function parseInvoiceDiscountForm(form: Record<string, unknown>):
	| { ok: true; discountPct: number; writeoffCents: number; notes: string | null }
	| { ok: false; error: string } {
	const discountPct = parseFloat(String(form.discount_pct ?? "0"));
	if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
		return { ok: false, error: "Discount % must be 0–100" };
	}
	const writeoffRaw = String(form.writeoff_dollars ?? "").trim();
	const writeoffCents =
		writeoffRaw === "" ? 0 : dollarsToCents(writeoffRaw);
	if (writeoffCents == null) {
		return { ok: false, error: "Write-off $ must be ≥ 0" };
	}
	const notes = String(form.notes || "").trim() || null;
	return { ok: true, discountPct, writeoffCents, notes };
}

export async function getLatestInvoiceForJob(
	db: D1Database,
	jobId: string,
): Promise<InvoiceRow | null> {
	return db
		.prepare(
			`SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at DESC LIMIT 1`,
		)
		.bind(jobId)
		.first<InvoiceRow>();
}

export async function getLatestInvoiceForPrintJob(
	db: D1Database,
	printJobId: string,
): Promise<InvoiceRow | null> {
	return db
		.prepare(
			`SELECT * FROM invoices WHERE print_job_id = ? ORDER BY created_at DESC LIMIT 1`,
		)
		.bind(printJobId)
		.first<InvoiceRow>();
}

export async function getInvoiceById(
	db: D1Database,
	id: string,
): Promise<InvoiceRow | null> {
	return db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first<InvoiceRow>();
}

export async function listInvoiceLines(
	db: D1Database,
	invoiceId: string,
): Promise<InvoiceLineRow[]> {
	const res = await db
		.prepare(
			`SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, description`,
		)
		.bind(invoiceId)
		.all<InvoiceLineRow>();
	return res.results ?? [];
}

async function insertInvoiceWithLines(
	db: D1Database,
	opts: {
		source: InvoiceSource;
		jobId: string | null;
		printJobId: string | null;
		createdBy: string;
		lines: InvoiceLineInput[];
		notes?: string | null;
	},
): Promise<InvoiceRow> {
	const subtotal = sumLineSubtotal(opts.lines);
	const { discountCents, totalCents } = computeInvoiceTotals({
		subtotalCents: subtotal,
		discountPct: 0,
		writeoffCents: 0,
	});
	const id = newId("inv");
	await db
		.prepare(
			`INSERT INTO invoices (
        id, source, job_id, print_job_id, status,
        subtotal_cents, discount_pct, discount_cents, writeoff_cents, total_cents,
        notes, created_by
      ) VALUES (?, ?, ?, ?, 'draft', ?, 0, ?, 0, ?, ?, ?)`,
		)
		.bind(
			id,
			opts.source,
			opts.jobId,
			opts.printJobId,
			subtotal,
			discountCents,
			totalCents,
			opts.notes ?? null,
			opts.createdBy,
		)
		.run();

	let sort = 0;
	for (const line of opts.lines) {
		await db
			.prepare(
				`INSERT INTO invoice_lines (
          id, invoice_id, description, quantity, unit, unit_cents, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				newId("inl"),
				id,
				line.description,
				line.quantity,
				line.unit,
				Math.round(line.unit_cents),
				sort++,
			)
			.run();
	}

	const row = await getInvoiceById(db, id);
	if (!row) throw new Error("invoice insert failed");
	return row;
}

export async function createFieldInvoiceFromEstimate(
	db: D1Database,
	jobId: string,
	createdBy: string,
): Promise<InvoiceRow> {
	const lines = await db
		.prepare(
			`SELECT description, quantity, unit, unit_cents FROM estimate_lines
       WHERE job_id = ? ORDER BY sort_order, description`,
		)
		.bind(jobId)
		.all<InvoiceLineInput>();
	let items = lines.results ?? [];
	if (!items.length) {
		const job = await db
			.prepare(
				`SELECT title, estimate_cents, invoice_cents FROM jobs WHERE id = ?`,
			)
			.bind(jobId)
			.first<{
				title: string;
				estimate_cents: number | null;
				invoice_cents: number | null;
			}>();
		const cents = job?.invoice_cents ?? job?.estimate_cents ?? 0;
		items = [
			{
				description: job?.title ? `Services — ${job.title}` : "Services",
				quantity: 1,
				unit: "ea",
				unit_cents: Math.max(0, Math.round(cents)),
			},
		];
	}
	return insertInvoiceWithLines(db, {
		source: "field",
		jobId,
		printJobId: null,
		createdBy,
		lines: items,
	});
}

export async function createPrintInvoiceFromQuote(
	db: D1Database,
	printJobId: string,
	createdBy: string,
): Promise<InvoiceRow> {
	const lines = await db
		.prepare(
			`SELECT description, quantity, unit, unit_cents FROM print_quote_lines
       WHERE print_job_id = ? ORDER BY sort_order, description`,
		)
		.bind(printJobId)
		.all<InvoiceLineInput>();
	let items = lines.results ?? [];
	if (!items.length) {
		const job = await db
			.prepare(
				`SELECT title, estimate_cents FROM print_jobs WHERE id = ?`,
			)
			.bind(printJobId)
			.first<{ title: string; estimate_cents: number | null }>();
		items = [
			{
				description: job?.title ? `Print — ${job.title}` : "Print services",
				quantity: 1,
				unit: "ea",
				unit_cents: Math.max(0, Math.round(job?.estimate_cents ?? 0)),
			},
		];
	}
	return insertInvoiceWithLines(db, {
		source: "print",
		jobId: null,
		printJobId,
		createdBy,
		lines: items,
	});
}

export async function updateInvoiceDraft(
	db: D1Database,
	invoice: InvoiceRow,
	opts: {
		user: AppUser;
		discountPct: number;
		writeoffCents: number;
		notes: string | null;
	},
): Promise<{ ok: true; invoice: InvoiceRow } | { ok: false; error: string }> {
	if (invoice.status !== "draft") {
		return { ok: false, error: "Only draft invoices can be edited." };
	}
	const settings = await getDiscountCapSettings(db);
	const caps = validateInvoiceDiscounts({
		user: opts.user,
		settings,
		discountPct: opts.discountPct,
		writeoffCents: opts.writeoffCents,
		action: "save",
	});
	if (!caps.ok) return caps;

	const { discountCents, totalCents } = computeInvoiceTotals({
		subtotalCents: invoice.subtotal_cents,
		discountPct: opts.discountPct,
		writeoffCents: opts.writeoffCents,
	});

	await db
		.prepare(
			`UPDATE invoices SET
        discount_pct = ?, discount_cents = ?, writeoff_cents = ?, total_cents = ?,
        notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
		)
		.bind(
			opts.discountPct,
			discountCents,
			opts.writeoffCents,
			totalCents,
			opts.notes,
			invoice.id,
		)
		.run();

	const updated = await getInvoiceById(db, invoice.id);
	if (!updated) return { ok: false, error: "Update failed." };
	return { ok: true, invoice: updated };
}

export async function approveInvoice(
	db: D1Database,
	invoice: InvoiceRow,
	user: AppUser,
): Promise<{ ok: true; invoice: InvoiceRow } | { ok: false; error: string }> {
	if (invoice.status !== "draft") {
		return { ok: false, error: "Only draft invoices can be approved." };
	}
	const settings = await getDiscountCapSettings(db);
	const caps = validateInvoiceDiscounts({
		user,
		settings,
		discountPct: invoice.discount_pct,
		writeoffCents: invoice.writeoff_cents,
		action: "approve",
	});
	if (!caps.ok) return caps;

	await db
		.prepare(
			`UPDATE invoices SET
        status = 'approved', approved_by = ?, approved_at = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`,
		)
		.bind(user.id, invoice.id)
		.run();

	const updated = await getInvoiceById(db, invoice.id);
	if (!updated) return { ok: false, error: "Approve failed." };
	return { ok: true, invoice: updated };
}

export async function sendInvoice(
	db: D1Database,
	invoice: InvoiceRow,
	user: AppUser,
): Promise<{ ok: true; invoice: InvoiceRow } | { ok: false; error: string }> {
	if (invoice.status !== "approved" && invoice.status !== "draft") {
		return { ok: false, error: "Invoice already sent." };
	}
	// Allow send from approved; if still draft, require approve path first.
	if (invoice.status === "draft") {
		const approved = await approveInvoice(db, invoice, user);
		if (!approved.ok) return approved;
		invoice = approved.invoice;
	}

	const settings = await getDiscountCapSettings(db);
	const caps = validateInvoiceDiscounts({
		user,
		settings,
		discountPct: invoice.discount_pct,
		writeoffCents: invoice.writeoff_cents,
		action: "send",
	});
	if (!caps.ok) return caps;

	await db
		.prepare(
			`UPDATE invoices SET
        status = 'sent', sent_by = ?, sent_at = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`,
		)
		.bind(user.id, invoice.id)
		.run();

	if (invoice.source === "field" && invoice.job_id) {
		await db
			.prepare(
				`UPDATE jobs SET
          status = 'invoiced', invoice_cents = ?, updated_at = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
			)
			.bind(invoice.total_cents, invoice.job_id)
			.run();
	}

	const updated = await getInvoiceById(db, invoice.id);
	if (!updated) return { ok: false, error: "Send failed." };
	return { ok: true, invoice: updated };
}

export type InvoicePdfInput = {
	title: string;
	customerName: string;
	siteLine: string;
	invoiceId: string;
	status: string;
	lines: Array<{
		description: string;
		quantity: number;
		unit: string;
		unit_cents: number;
	}>;
	subtotalCents: number;
	discountPct: number;
	discountCents: number;
	writeoffCents: number;
	totalCents: number;
	notes: string | null;
};

export async function buildInvoicePdf(
	input: InvoicePdfInput,
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	let page = doc.addPage([612, 792]);
	let y = 752;

	const draw = (text: string, size = 11, useBold = false) => {
		if (y < 56) {
			page = doc.addPage([612, 792]);
			y = 752;
		}
		page.drawText(text, {
			x: 48,
			y,
			size,
			font: useBold ? bold : font,
			color: rgb(0.1, 0.1, 0.1),
		});
		y -= size + 6;
	};

	draw("Lumanyi — Invoice", 16, true);
	draw(`Status: ${input.status}`, 9);
	draw(`Invoice ID: ${input.invoiceId}`, 9);
	y -= 4;
	draw(input.title, 13, true);
	draw(`Customer: ${input.customerName}`);
	if (input.siteLine) draw(`Site / job: ${input.siteLine}`);
	y -= 8;

	draw("Line items", 12, true);
	for (const line of input.lines) {
		const amount = line.quantity * line.unit_cents;
		const row = `${line.description} - ${line.quantity} ${line.unit} @ ${money(line.unit_cents)} = ${money(amount)}`;
		draw(row.slice(0, 95), 10);
	}

	y -= 8;
	draw(`Subtotal: ${money(input.subtotalCents)}`, 11, true);
	if (input.discountCents > 0) {
		draw(
			`Discount (${input.discountPct}%): -${money(input.discountCents)}`,
			10,
		);
	}
	if (input.writeoffCents > 0) {
		draw(`Write-off: -${money(input.writeoffCents)}`, 10);
	}
	draw(`Total due: ${money(input.totalCents)}`, 13, true);

	if (input.notes) {
		y -= 8;
		draw("Notes", 12, true);
		draw(input.notes.replace(/[^\x20-\x7E]/g, "?").slice(0, 90), 10);
	}

	y -= 16;
	draw(`Generated ${new Date().toISOString().slice(0, 10)}`, 9);
	draw("(Email / ACH / A/R ledger come in later MG-3 slices.)", 8);

	return doc.save();
}

export function invoiceStatusLabel(status: string): string {
	if (status === "draft") return "Draft";
	if (status === "approved") return "Approved";
	if (status === "sent") return "Sent";
	return status;
}

/** Shared invoice workspace HTML for field/print job pages. */
export function renderInvoiceWorkspaceHtml(opts: {
	backHref: string;
	backLabel: string;
	actionBase: string;
	pdfHref: string;
	jobTitle: string;
	customerName: string;
	invoice: InvoiceRow | null;
	lines: InvoiceLineRow[];
	capNotice: string;
	flash?: string | null;
	canManage: boolean;
}): string {
	const {
		backHref,
		backLabel,
		actionBase,
		pdfHref,
		jobTitle,
		customerName,
		invoice,
		lines,
		capNotice,
		flash,
		canManage,
	} = opts;

	if (!canManage) {
		return `<h1>Invoice</h1>
      <p class="muted">Invoices are for Owner / Manager / Dispatch.</p>
      <p><a href="${escapeHtml(backHref)}">${escapeHtml(backLabel)}</a></p>`;
	}

	const flashHtml = flash
		? `<div class="flash" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">${escapeHtml(flash)}</div>`
		: "";

	if (!invoice) {
		return `${flashHtml}
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Invoice</h1>
        <p class="muted" style="margin:0.35rem 0 0">${escapeHtml(jobTitle)} · ${escapeHtml(customerName)}</p>
      </div>
      <a class="btn secondary" href="${escapeHtml(backHref)}">${escapeHtml(backLabel)}</a>
    </div>
    <p class="muted">${escapeHtml(capNotice)}</p>
    <form method="post" action="${escapeHtml(actionBase)}/create" class="panel stack">
      <p>No invoice yet. Create a <strong>draft</strong> from estimate/quote lines (or a single services line if none).</p>
      <button class="btn" type="submit">Create draft invoice</button>
    </form>`;
	}

	const lineRows =
		lines
			.map((l) => {
				const total = Math.round(l.quantity * l.unit_cents);
				return `<tr>
          <td>${escapeHtml(l.description)}</td>
          <td>${escapeHtml(String(l.quantity))} ${escapeHtml(l.unit)}</td>
          <td>${escapeHtml(money(l.unit_cents))}</td>
          <td>${escapeHtml(money(total))}</td>
        </tr>`;
			})
			.join("") || `<tr><td colspan="4" class="muted">No lines</td></tr>`;

	const isDraft = invoice.status === "draft";
	const isApproved = invoice.status === "approved";
	const isSent = invoice.status === "sent";

	const editForm = isDraft
		? `<form method="post" action="${escapeHtml(actionBase)}" class="panel stack">
        <div class="row">
          <div><label for="discount_pct">Discount %</label>
            <input id="discount_pct" name="discount_pct" type="number" step="0.01" min="0" max="100"
              value="${escapeHtml(String(invoice.discount_pct))}" /></div>
          <div><label for="writeoff_dollars">Write-off ($)</label>
            <input id="writeoff_dollars" name="writeoff_dollars" type="number" step="0.01" min="0"
              value="${escapeHtml((invoice.writeoff_cents / 100).toFixed(2))}" /></div>
        </div>
        <div><label for="notes">Notes</label>
          <textarea id="notes" name="notes">${escapeHtml(invoice.notes)}</textarea></div>
        <button class="btn secondary" type="submit">Save draft</button>
      </form>`
		: `<div class="panel stack">
        <div><span class="muted">Discount</span><br>${escapeHtml(String(invoice.discount_pct))}% (−${escapeHtml(money(invoice.discount_cents))})</div>
        <div><span class="muted">Write-off</span><br>−${escapeHtml(money(invoice.writeoff_cents))}</div>
        ${invoice.notes ? `<div><span class="muted">Notes</span><br>${escapeHtml(invoice.notes)}</div>` : ""}
      </div>`;

	const actions: string[] = [];
	if (isDraft) {
		actions.push(
			`<form method="post" action="${escapeHtml(actionBase)}/approve" class="inline"><button class="btn" type="submit">Approve</button></form>`,
		);
	}
	if (isDraft || isApproved) {
		actions.push(
			`<form method="post" action="${escapeHtml(actionBase)}/send" class="inline" onsubmit="return confirm('Mark this invoice as sent?');"><button class="btn" type="submit">Mark sent</button></form>`,
		);
	}
	actions.push(
		`<a class="btn secondary" href="${escapeHtml(pdfHref)}">Download PDF</a>`,
	);
	if (isSent) {
		actions.push(
			`<form method="post" action="${escapeHtml(actionBase)}/create" class="inline"><button class="btn secondary" type="submit">New draft</button></form>`,
		);
	}

	return `${flashHtml}
    <div class="toolbar">
      <div class="grow">
        <h1 style="margin:0">Invoice</h1>
        <p class="muted" style="margin:0.35rem 0 0">
          ${escapeHtml(jobTitle)} · ${escapeHtml(customerName)}
          · <span class="badge">${escapeHtml(invoiceStatusLabel(invoice.status))}</span>
          · <code style="font-size:0.8rem">${escapeHtml(invoice.id)}</code>
        </p>
      </div>
      <a class="btn secondary" href="${escapeHtml(backHref)}">${escapeHtml(backLabel)}</a>
    </div>
    <p class="muted">${escapeHtml(capNotice)}</p>
    <div class="toolbar">${actions.join("\n")}</div>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <p><strong>Subtotal</strong> ${escapeHtml(money(invoice.subtotal_cents))}
      · <strong>Total due</strong> ${escapeHtml(money(invoice.total_cents))}</p>
    ${editForm}`;
}
