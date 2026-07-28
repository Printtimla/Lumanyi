import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { newId } from "./ids";
import { hashPassword } from "./password";
import type { PermissionRole } from "./roles";
import type { ProductKey } from "./products";
import { parseProducts } from "./access";

export type AppUser = {
	id: string;
	email: string;
	name: string;
	role: PermissionRole;
	designation: string;
	products: ProductKey[];
	mustChangePassword: boolean;
	active: boolean;
};

const SESSION_COOKIE = "lumanyi_session";
const SESSION_DAYS = 14;

export async function ensureSeedUser(db: D1Database): Promise<void> {
	const row = await db
		.prepare("SELECT COUNT(*) AS c FROM users")
		.first<{ c: number }>();
	if (row && row.c > 0) return;

	const id = newId("usr");
	const passwordHash = await hashPassword("Lumanyi1!");
	await db
		.prepare(
			`INSERT INTO users (id, email, name, password_hash, role, designation, products, must_change_password, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
		)
		.bind(
			id,
			"owner@lumanyi.local",
			"Owner",
			passwordHash,
			"owner",
			"owner",
			"restoration,floors,print",
		)
		.run();
}

export async function createSession(
	db: D1Database,
	userId: string,
): Promise<string> {
	const id = newId("ses");
	const expires = new Date();
	expires.setDate(expires.getDate() + SESSION_DAYS);
	await db
		.prepare(
			`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
		)
		.bind(id, userId, expires.toISOString())
		.run();
	return id;
}

export function setSessionCookie(c: Context, sessionId: string): void {
	const secure = new URL(c.req.url).protocol === "https:";
	setCookie(c, SESSION_COOKIE, sessionId, {
		httpOnly: true,
		secure,
		sameSite: "Lax",
		path: "/",
		maxAge: SESSION_DAYS * 24 * 60 * 60,
	});
}

export function clearSessionCookie(c: Context): void {
	deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function getSessionUser(
	db: D1Database,
	sessionId: string | undefined,
): Promise<AppUser | null> {
	if (!sessionId) return null;

	const row = await db
		.prepare(
			`SELECT u.id, u.email, u.name, u.role,
        COALESCE(u.designation, u.role) AS designation,
        u.products,
        u.must_change_password,
        COALESCE(u.active, 1) AS active,
        s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
		)
		.bind(sessionId)
		.first<{
			id: string;
			email: string;
			name: string;
			role: string;
			designation: string;
			products: string | null;
			must_change_password: number;
			active: number;
			expires_at: string;
		}>();

	if (!row) return null;
	if (new Date(row.expires_at) < new Date()) {
		await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
		return null;
	}
	if (row.active !== 1) {
		await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
		return null;
	}

	const permissionRole: AppUser["role"] =
		row.role === "owner" || row.role === "dispatcher" ? row.role : "tech";

	return {
		id: row.id,
		email: row.email,
		name: row.name,
		role: permissionRole,
		designation: row.designation || permissionRole,
		products: parseProducts(row.products),
		mustChangePassword: row.must_change_password === 1,
		active: true,
	};
}

export async function destroySession(
	db: D1Database,
	sessionId: string | undefined,
): Promise<void> {
	if (!sessionId) return;
	await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

/** Kill all sessions for a user (deactivate / offboarding). */
export async function destroySessionsForUser(
	db: D1Database,
	userId: string,
): Promise<void> {
	await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

/** Active Super Admin seats (permission role = owner). */
export async function countActiveOwners(
	db: D1Database,
	exceptUserId?: string,
): Promise<number> {
	if (exceptUserId) {
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS c FROM users
         WHERE role = 'owner' AND COALESCE(active, 1) = 1 AND id != ?`,
			)
			.bind(exceptUserId)
			.first<{ c: number }>();
		return row?.c ?? 0;
	}
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS c FROM users
       WHERE role = 'owner' AND COALESCE(active, 1) = 1`,
		)
		.first<{ c: number }>();
	return row?.c ?? 0;
}

export { SESSION_COOKIE };
