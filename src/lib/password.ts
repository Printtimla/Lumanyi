/** PBKDF2-SHA256 password hashing for internal auth (Web Crypto). */

/** Keep low enough for Cloudflare Workers CPU limits; iterations are stored in the hash. */
const ITERATIONS = 10_000;

function bufferToHex(bytes: Uint8Array): string {
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
		keyMaterial,
		256,
	);
	return `pbkdf2$${ITERATIONS}$${bufferToHex(salt)}$${bufferToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
	const iterations = Number(parts[1]);
	if (!Number.isFinite(iterations) || iterations < 1) return false;
	const salt = hexToBuffer(parts[2]);
	const expected = parts[3];
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: salt as BufferSource,
			iterations,
			hash: "SHA-256",
		},
		keyMaterial,
		256,
	);
	const actual = bufferToHex(new Uint8Array(bits));
	if (actual.length !== expected.length) return false;
	let mismatch = 0;
	for (let i = 0; i < actual.length; i++) {
		mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return mismatch === 0;
}
