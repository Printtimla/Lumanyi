/** Customer portal magic-link tokens and sessions. */

import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { newId } from "./ids";

export const PORTAL_COOKIE = "lumanyi_portal";
const PORTAL_SESSION_DAYS = 7;
const TOKEN_DAYS = 30;

export type PortalCustomer = {
	id: string;
	name: string;
	email: string | null;
	phone: string | null;
};

async function sha256Hex(value: string): Promise<string> {
	const data = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function randomToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create a portal access token. Returns the raw token once (store only the hash). */
export async function mintPortalToken(
	db: D1Database,
	customerId: string,
	createdBy: string | null,
	label?: string,
): Promise<{ tokenId: string; rawToken: string; expiresAt: string }> {
	const rawToken = randomToken();
	const tokenHash = await sha256Hex(rawToken);
	const tokenId = newId("ptok");
	const expires = new Date();
	expires.setDate(expires.getDate() + TOKEN_DAYS);
	const expiresAt = expires.toISOString();

	await db
		.prepare(
			`INSERT INTO portal_tokens (id, customer_id, token_hash, label, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			tokenId,
			customerId,
			tokenHash,
			label?.trim() || null,
			expiresAt,
			createdBy,
		)
		.run();

	return { tokenId, rawToken, expiresAt };
}

export async function createPortalSession(
	db: D1Database,
	rawToken: string,
): Promise<{ sessionId: string; customerId: string } | null> {
	const tokenHash = await sha256Hex(rawToken.trim());
	const token = await db
		.prepare(
			`SELECT id, customer_id, expires_at, revoked_at FROM portal_tokens WHERE token_hash = ?`,
		)
		.bind(tokenHash)
		.first<{
			id: string;
			customer_id: string;
			expires_at: string;
			revoked_at: string | null;
		}>();

	if (!token || token.revoked_at) return null;
	if (new Date(token.expires_at) < new Date()) return null;

	const sessionId = newId("pses");
	const expires = new Date();
	expires.setDate(expires.getDate() + PORTAL_SESSION_DAYS);

	await db.batch([
		db
			.prepare(
				`INSERT INTO portal_sessions (id, customer_id, token_id, expires_at) VALUES (?, ?, ?, ?)`,
			)
			.bind(sessionId, token.customer_id, token.id, expires.toISOString()),
		db
			.prepare(
				`UPDATE portal_tokens SET last_used_at = datetime('now') WHERE id = ?`,
			)
			.bind(token.id),
	]);

	return { sessionId, customerId: token.customer_id };
}

export function setPortalCookie(c: Context, sessionId: string): void {
	const secure = new URL(c.req.url).protocol === "https:";
	setCookie(c, PORTAL_COOKIE, sessionId, {
		httpOnly: true,
		secure,
		sameSite: "Lax",
		path: "/",
		maxAge: PORTAL_SESSION_DAYS * 24 * 60 * 60,
	});
}

export function clearPortalCookie(c: Context): void {
	deleteCookie(c, PORTAL_COOKIE, { path: "/" });
}

export async function getPortalCustomer(
	db: D1Database,
	sessionId: string | undefined,
): Promise<PortalCustomer | null> {
	if (!sessionId) return null;
	const row = await db
		.prepare(
			`SELECT c.id, c.name, c.email, c.phone, s.expires_at
       FROM portal_sessions s
       JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`,
		)
		.bind(sessionId)
		.first<{
			id: string;
			name: string;
			email: string | null;
			phone: string | null;
			expires_at: string;
		}>();

	if (!row) return null;
	if (new Date(row.expires_at) < new Date()) {
		await db
			.prepare(`DELETE FROM portal_sessions WHERE id = ?`)
			.bind(sessionId)
			.run();
		return null;
	}

	return {
		id: row.id,
		name: row.name,
		email: row.email,
		phone: row.phone,
	};
}

export async function destroyPortalSession(
	db: D1Database,
	sessionId: string | undefined,
): Promise<void> {
	if (!sessionId) return;
	await db
		.prepare(`DELETE FROM portal_sessions WHERE id = ?`)
		.bind(sessionId)
		.run();
}

export async function revokePortalToken(
	db: D1Database,
	tokenId: string,
	customerId: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE portal_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND customer_id = ? AND revoked_at IS NULL`,
		)
		.bind(tokenId, customerId)
		.run();
	await db
		.prepare(`DELETE FROM portal_sessions WHERE token_id = ?`)
		.bind(tokenId)
		.run();
}
