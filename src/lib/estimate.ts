import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { money } from "./html";

export type EstimatePdfInput = {
	jobTitle: string;
	customerName: string;
	siteLine: string;
	claimNumber: string | null;
	carrier: string | null;
	dateOfLoss: string | null;
	rooms: Array<{
		name: string;
		length_ft: number | null;
		width_ft: number | null;
		height_ft: number | null;
	}>;
	lines: Array<{
		roomName: string | null;
		description: string;
		quantity: number;
		unit: string;
		unit_cents: number;
	}>;
	totalCents: number;
};

function dimLabel(r: {
	length_ft: number | null;
	width_ft: number | null;
	height_ft: number | null;
}): string {
	const parts: string[] = [];
	if (r.length_ft != null) parts.push(`${r.length_ft}`);
	if (r.width_ft != null) parts.push(`${r.width_ft}`);
	if (r.height_ft != null) parts.push(`${r.height_ft}`);
	return parts.length ? `${parts.join(" × ")} ft` : "";
}

export async function buildEstimatePdf(
	input: EstimatePdfInput,
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

	draw("Lumanyi — Internal Estimate", 16, true);
	draw("(Not an Xactimate export)", 9);
	y -= 4;
	draw(input.jobTitle, 13, true);
	draw(`Customer: ${input.customerName}`);
	if (input.siteLine) draw(`Site: ${input.siteLine}`);
	if (input.claimNumber) draw(`Claim #: ${input.claimNumber}`);
	if (input.carrier) draw(`Carrier: ${input.carrier}`);
	if (input.dateOfLoss) draw(`Date of loss: ${input.dateOfLoss}`);
	y -= 8;

	if (input.rooms.length) {
		draw("Rooms / areas", 12, true);
		for (const room of input.rooms) {
			const dims = dimLabel(room);
			draw(`• ${room.name}${dims ? ` (${dims})` : ""}`);
		}
		y -= 6;
	}

	draw("Line items", 12, true);
	for (const line of input.lines) {
		const amount = line.quantity * line.unit_cents;
		const room = line.roomName ? `[${line.roomName}] ` : "";
		const row = `${room}${line.description} — ${line.quantity} ${line.unit} @ ${money(line.unit_cents)} = ${money(amount)}`;
		// pdf-lib winAnsi is limited; keep ASCII-ish
		draw(row.replace(/—/g, "-").slice(0, 95), 10);
	}

	y -= 10;
	draw(`Total: ${money(input.totalCents)}`, 13, true);
	y -= 16;
	draw(`Generated ${new Date().toISOString().slice(0, 10)}`, 9);

	return doc.save();
}

export async function syncJobEstimateTotal(
	db: D1Database,
	jobId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(quantity * unit_cents), 0) AS total
       FROM estimate_lines WHERE job_id = ?`,
		)
		.bind(jobId)
		.first<{ total: number }>();
	const total = Math.round(row?.total ?? 0);
	await db
		.prepare(
			`UPDATE jobs SET estimate_cents = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.bind(total, jobId)
		.run();
	return total;
}
