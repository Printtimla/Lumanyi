import { CHECKLISTS } from "./checklists";
import { newId } from "./ids";

export type RecurringRow = {
	id: string;
	customer_id: string;
	site_id: string | null;
	title: string;
	job_type: "restoration" | "hard_floor";
	interval_days: number;
	next_run_at: string;
	assigned_user_id: string | null;
	estimate_cents: number | null;
	notes: string | null;
};

function addDays(isoDate: string, days: number): string {
	const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Create jobs for every active recurring template that is due; advance next_run_at. */
export async function generateDueRecurringJobs(
	db: D1Database,
): Promise<number> {
	const today = new Date().toISOString().slice(0, 10);
	const due = await db
		.prepare(
			`SELECT * FROM recurring_jobs
       WHERE active = 1 AND date(next_run_at) <= date(?)
       ORDER BY next_run_at ASC
       LIMIT 50`,
		)
		.bind(today)
		.all<RecurringRow>();

	let created = 0;
	for (const row of due.results || []) {
		const jobId = newId("job");
		const scheduled = `${row.next_run_at.slice(0, 10)}T09:00`;
		const stmts = [
			db
				.prepare(
					`INSERT INTO jobs (
            id, customer_id, site_id, title, job_type, status,
            scheduled_start, assigned_user_id, estimate_cents, notes
          ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
				)
				.bind(
					jobId,
					row.customer_id,
					row.site_id,
					row.title,
					row.job_type,
					scheduled,
					row.assigned_user_id,
					row.estimate_cents,
					row.notes,
				),
			db
				.prepare(
					`UPDATE recurring_jobs SET next_run_at = ? WHERE id = ?`,
				)
				.bind(addDays(row.next_run_at, row.interval_days), row.id),
		];

		const labels =
			CHECKLISTS[row.job_type] || CHECKLISTS.hard_floor;
		labels.forEach((label, i) => {
			stmts.push(
				db
					.prepare(
						`INSERT INTO job_checklist_items (id, job_id, label, sort_order) VALUES (?, ?, ?, ?)`,
					)
					.bind(newId("chk"), jobId, label, i),
			);
		});

		await db.batch(stmts);
		created += 1;
	}
	return created;
}
