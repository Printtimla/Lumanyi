import { newId } from "./ids";

const OTP_TTL_HOURS = 24;

export function normalizeOtp(raw: string): string {
	return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Create a single-use code like PASTE-AB12CD34 */
export async function issueLoginOtp(
	db: D1Database,
	userId: string,
): Promise<string> {
	const code = `PASTE-${newId("otp").slice(-8).toUpperCase()}`;
	const expires = new Date();
	expires.setHours(expires.getHours() + OTP_TTL_HOURS);
	await db
		.prepare(
			`INSERT INTO login_otps (code, user_id, expires_at, used) VALUES (?, ?, ?, 0)`,
		)
		.bind(code, userId, expires.toISOString())
		.run();
	return code;
}

/** Consume a valid unused OTP; returns user_id or null. */
export async function consumeLoginOtp(
	db: D1Database,
	codeRaw: string,
): Promise<string | null> {
	const code = normalizeOtp(codeRaw);
	if (!code) return null;
	const row = await db
		.prepare(
			`SELECT code, user_id, expires_at, used FROM login_otps WHERE code = ?`,
		)
		.bind(code)
		.first<{
			code: string;
			user_id: string;
			expires_at: string;
			used: number;
		}>();
	if (!row || row.used === 1) return null;
	if (new Date(row.expires_at) < new Date()) return null;
	await db
		.prepare(`UPDATE login_otps SET used = 1 WHERE code = ?`)
		.bind(row.code)
		.run();
	return row.user_id;
}
