/** Water-loss / drying documentation PDF (internal; S500-style records). */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { equipmentTypeLabel } from "./field-logs";

export type WaterLossPdfInput = {
	jobTitle: string;
	jobTypeLabel: string;
	customerName: string;
	siteLine: string;
	claimNumber: string | null;
	carrier: string | null;
	dateOfLoss: string | null;
	status: string;
	jobNotes: string | null;
	moisture: Array<{
		logged_at: string;
		area: string | null;
		reading: string | null;
		temp_f: number | null;
		rh_pct: number | null;
		grains: number | null;
		notes: string | null;
	}>;
	equipment: Array<{
		logged_at: string;
		area: string | null;
		equipment_type: string | null;
		equipment_count: number | null;
		notes: string | null;
	}>;
	fieldNotes: Array<{
		created_at: string;
		user_name: string | null;
		body: string;
	}>;
};

function fmtNum(n: number | null | undefined, suffix = ""): string {
	if (n == null || !Number.isFinite(n)) return "—";
	return `${n}${suffix}`;
}

export async function buildWaterLossPdf(
	input: WaterLossPdfInput,
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
		const safe = text.replace(/[^\x20-\x7E]/g, "?").slice(0, 100);
		page.drawText(safe, {
			x: 48,
			y,
			size,
			font: useBold ? bold : font,
			color: rgb(0.1, 0.1, 0.1),
		});
		y -= size + 6;
	};

	draw("Lumanyi - Water loss / drying report", 16, true);
	draw(
		"Internal documentation. Supports IICRC S500-style drying records; not a certification of compliance.",
		8,
	);
	y -= 4;
	draw(input.jobTitle, 13, true);
	draw(`Type: ${input.jobTypeLabel}  |  Status: ${input.status}`);
	draw(`Customer: ${input.customerName}`);
	if (input.siteLine) draw(`Site: ${input.siteLine}`);
	if (input.claimNumber) draw(`Claim #: ${input.claimNumber}`);
	if (input.carrier) draw(`Carrier: ${input.carrier}`);
	if (input.dateOfLoss) draw(`Date of loss: ${input.dateOfLoss}`);
	if (input.jobNotes) {
		y -= 4;
		draw("Job notes", 12, true);
		draw(input.jobNotes, 10);
	}
	y -= 8;

	draw("Moisture / psychrometric readings", 12, true);
	if (!input.moisture.length) {
		draw("No moisture readings logged.", 10);
	} else {
		for (const m of input.moisture) {
			const date = m.logged_at.slice(0, 10);
			const psycho = [
				m.temp_f != null ? `${fmtNum(m.temp_f)}F` : null,
				m.rh_pct != null ? `${fmtNum(m.rh_pct)}% RH` : null,
				m.grains != null ? `${fmtNum(m.grains)} gpp` : null,
			]
				.filter(Boolean)
				.join(", ");
			const row = `${date} | ${m.area || "-"} | ${m.reading || "-"} | ${psycho || "no ambient"} | ${m.notes || ""}`;
			draw(row, 9);
		}
	}
	y -= 8;

	draw("Equipment log", 12, true);
	if (!input.equipment.length) {
		draw("No equipment logged.", 10);
	} else {
		for (const e of input.equipment) {
			const date = e.logged_at.slice(0, 10);
			const row = `${date} | ${e.area || "-"} | ${equipmentTypeLabel(e.equipment_type)} x${e.equipment_count ?? "?"} | ${e.notes || ""}`;
			draw(row, 9);
		}
	}
	y -= 8;

	if (input.fieldNotes.length) {
		draw("Field notes (recent)", 12, true);
		for (const n of input.fieldNotes.slice(0, 20)) {
			const when = n.created_at.slice(0, 16).replace("T", " ");
			draw(`${when} - ${n.user_name || "Staff"}`, 9, true);
			draw(n.body, 9);
		}
	}

	y -= 12;
	draw(`Generated ${new Date().toISOString().slice(0, 10)}`, 9);

	return doc.save();
}

/** Parse optional numeric form field; empty -> null. */
export function parseOptionalNumber(raw: unknown): number | null {
	const s = String(raw ?? "").trim();
	if (!s) return null;
	const n = Number(s);
	if (!Number.isFinite(n)) return null;
	return n;
}
