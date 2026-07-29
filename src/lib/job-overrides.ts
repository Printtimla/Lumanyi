/** MG-2: office reopen / reassign overrides for locked jobs. */

import type { AppUser } from "./auth";
import { canReopenJobs, isPrintStatusLocked, isStatusLocked } from "./access";
import { escapeHtml } from "./html";

const MIN_REASON = 3;
const MAX_REASON = 500;

export const FIELD_REOPEN_STATUS = "in_progress" as const;
export const PRINT_REOPEN_STATUS = "in_production" as const;

/** Office staff may use explicit reopen / reassign overrides. */
export function canOverrideJobAssignment(user: AppUser): boolean {
	return canReopenJobs(user);
}

export function canReopenFieldStatus(status: string): boolean {
	return isStatusLocked(status);
}

export function canReopenPrintStatus(status: string): boolean {
	return status === "delivered";
}

/** Trim + length-check override reason. Returns null if invalid. */
export function normalizeOverrideReason(raw: unknown): string | null {
	const reason = String(raw ?? "")
		.trim()
		.replace(/\s+/g, " ");
	if (reason.length < MIN_REASON || reason.length > MAX_REASON) return null;
	return reason;
}

export type StaffOption = {
	id: string;
	name: string;
	role: string;
};

/** HTML panel: reopen locked job + always-available reassign for office. */
export function renderJobOverridePanels(opts: {
	kind: "field" | "print";
	jobId: string;
	status: string;
	assignedUserId: string | null;
	staffOptionsHtml: string;
	canOverride: boolean;
	archived: boolean;
}): string {
	if (!opts.canOverride || opts.archived) return "";

	const isField = opts.kind === "field";
	const base = isField ? `/jobs/${opts.jobId}` : `/print/${opts.jobId}`;
	const showReopen = isField
		? canReopenFieldStatus(opts.status)
		: canReopenPrintStatus(opts.status);
	const reopenTo = isField ? FIELD_REOPEN_STATUS : PRINT_REOPEN_STATUS;
	const reopenLabel = isField
		? "Reopen to In progress"
		: "Reopen to In production";

	const reopenBlock = showReopen
		? `<div class="panel stack override-panel">
      <h2 style="margin:0">Reopen (override)</h2>
      <p class="muted" style="margin:0">Unlocks this job for field/press work. Techs stay blocked until status is open again.</p>
      <form method="post" action="${escapeHtml(base)}/reopen" class="stack">
        <div>
          <label for="reopen_reason">Reason (required)</label>
          <input id="reopen_reason" name="reason" required minlength="${MIN_REASON}" maxlength="${MAX_REASON}"
            placeholder="e.g. customer requested rework" />
        </div>
        <button class="btn" type="submit">${escapeHtml(reopenLabel)}</button>
        <input type="hidden" name="to_status" value="${escapeHtml(reopenTo)}" />
      </form>
    </div>`
		: "";

	const reassignBlock = `<div class="panel stack override-panel">
    <h2 style="margin:0">Reassign (override)</h2>
    <p class="muted" style="margin:0">Works even when the job is locked. Does not change status.</p>
    <form method="post" action="${escapeHtml(base)}/reassign" class="stack">
      <div>
        <label for="override_assigned_user_id">Assigned to</label>
        <select id="override_assigned_user_id" name="assigned_user_id">
          <option value="">Unassigned</option>
          ${opts.staffOptionsHtml}
        </select>
      </div>
      <div>
        <label for="reassign_reason">Reason (optional)</label>
        <input id="reassign_reason" name="reason" maxlength="${MAX_REASON}"
          placeholder="e.g. coverage swap" />
      </div>
      <button class="btn secondary" type="submit">Save assignment</button>
    </form>
  </div>`;

	return `<div class="override-grid">${reopenBlock}${reassignBlock}</div>`;
}

export function officeLockBannerCopy(kind: "field" | "print"): string {
	if (kind === "field") {
		return "This job is locked (complete / invoiced). Use Reopen below, or ask Owner / Manager / Dispatch.";
	}
	return "This print job is locked (delivered). Use Reopen below, or ask Owner / Manager / Dispatch.";
}

/** True when print status blocks tech writes (delivered or cancelled). */
export function printNeedsOfficeUnlock(status: string): boolean {
	return isPrintStatusLocked(status);
}
