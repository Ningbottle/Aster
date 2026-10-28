import { closeSync, openSync, writeFileSync } from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

/** Materialize a new persisted Pi session without adding a synthetic message. */
export async function materializeNewSession(sessionManager: SessionManager): Promise<void> {
	if (!sessionManager.isPersisted()) return;

	const sessionFile = sessionManager.getSessionFile();
	const header = sessionManager.getHeader();
	if (!sessionFile || !header) {
		throw new Error("Could not persist the new session: its native session file is unavailable.");
	}

	const contents = [header, ...sessionManager.getEntries()]
		.map((entry) => JSON.stringify(entry))
		.join("\n")
		.concat("\n");
	let fileDescriptor: number | undefined;
	try {
		fileDescriptor = openSync(sessionFile, "wx");
		writeFileSync(fileDescriptor, contents, "utf8");
		closeSync(fileDescriptor);
		fileDescriptor = undefined;
	} catch (cause) {
		let failure = cause;
		if (fileDescriptor !== undefined) {
			try {
				closeSync(fileDescriptor);
			} catch (closeError) {
				failure = new AggregateError([cause, closeError], "Writing and closing the native session file failed.");
			}
		}
		throw new Error("Could not persist the new session to its native session file.", { cause: failure });
	}
	try {
		// Reload through Pi's public API so the manager marks the file as flushed and
		// continues to append to it using its normal persistence path.
		sessionManager.setSessionFile(sessionFile);
	} catch (cause) {
		throw new Error("Could not reload the newly persisted native session file.", { cause });
	}
}
