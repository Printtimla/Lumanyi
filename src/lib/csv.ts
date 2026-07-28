/** CSV helpers for reports exports. */

export function escapeCsv(value: string | number | null | undefined): string {
	const s = String(value ?? "");
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

export function csvResponse(
	filename: string,
	header: string[],
	rows: Array<Array<string | number | null | undefined>>,
): Response {
	const lines = [header.map(escapeCsv).join(",")];
	for (const row of rows) {
		lines.push(row.map(escapeCsv).join(","));
	}
	return new Response(lines.join("\n") + "\n", {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
}
