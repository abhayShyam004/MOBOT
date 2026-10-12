// Create-if-absent file publication for locks, leases, and one-shot records.
//
// The protocol everywhere is: write the complete record to a private
// candidate path, publish it under its final name with ONE create-if-absent
// operation, and treat "name already taken" as losing the race. link(2) is
// that operation on desktop filesystems. Android denies hard links inside
// app storage (SELinux grants untrusted_app no file:link on its data files;
// the syscall fails with EACCES) while symlink(2) is permitted and keeps the
// same no-replace semantics — verified on device: raw symlink(2) onto an
// existing name returns EEXIST, never replaces.
//
// A symlink publication writes the payload file first (complete, flushed)
// and publishes a RELATIVE link to it, so records survive data-directory
// renames and the /data/data <-> /data/user/0 mount aliasing.
//
// This module is plain ESM so the Electron main process, the TypeScript
// harness server, and the data-dir lease all enforce one identical protocol.
import {
  linkSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** Test hook: skip the hard-link route entirely and exercise the Android path. */
export const LEASE_FORCE_SYMLINK_ENV = "OPENMAUSBOT_LEASE_FORCE_SYMLINK";

/** link(2) failures that mean "this filesystem/platform does not do hard
 * links here", not "the record cannot be published". EXDEV covers a candidate
 * on a different mount; the rest cover policy (SELinux/EDA/EMVIFS) and
 * kernel-less filesystems. EACCES is deliberately included: on Android the
 * denial is an allowlist decision, not a broken directory. */
export const LINK_UNSUPPORTED_CODES = new Set([
  "EACCES",
  "EPERM",
  "ENOSYS",
  "EOPNOTSUPP",
  "ENOTSUP",
  "EXDEV",
]);

export function removeQuietly(path) {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup of our own intermediate artifacts.
  }
}

const symlinkCapableDirectories = new Set();

/** Whether one create-if-absent symlink can be published in this directory.
 * Probed once per directory per process and cached; the probe publishes and
 * removes its own private pair. */
export function symlinkPublicationAllowed(directory) {
  if (symlinkCapableDirectories.has(directory)) return true;
  const probeToken = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const probePayload = join(directory, `.openmausbot-publish-probe-${probeToken}`);
  const probeLink = `${probePayload}.lnk`;
  let allowed = false;
  try {
    writeFileSync(probePayload, "openmausbot publish probe\n", { flag: "wx", mode: 0o600 });
    try {
      symlinkSync(`.openmausbot-publish-probe-${probeToken}`, probeLink);
      allowed = true;
    } catch {
      allowed = false;
    }
  } catch {
    allowed = false;
  } finally {
    removeQuietly(probeLink);
    removeQuietly(probePayload);
  }
  if (allowed) symlinkCapableDirectories.add(directory);
  return allowed;
}

/** Best-effort relative target of a symlink-published record, else null. */
export function readlinkTarget(path) {
  try {
    const target = readlinkSync(path);
    return typeof target === "string" && target.length > 0 && !target.includes("/") ? target : null;
  } catch {
    return null;
  }
}

/**
 * A symlink-published record whose payload file vanished reads back as
 * ENOENT — callers treating that as "no record" still find the NAME blocking
 * every create-if-absent publication. Retire such a dangling name (and the
 * payload it names, when identifiable) so a new owner can acquire. A regular
 * file never reaches this: unreadable or unparsable content throws upstream
 * and fails closed. Between the "name reads as absent" check and the unlink
 * no contender can publish, because the dangling name itself is what blocks
 * publication — the recovery has no window where it could retire a record
 * that turned live inside the check.
 */
export function removeDanglingLease(path) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return;
  } catch {
    return; // name vanished; the next publish attempt proceeds normally
  }
  // Re-verify the name still reads as absent so a record that turned live
  // inside this window is never unlinked.
  try {
    readFileSync(path);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
  const payload = readlinkTarget(path);
  try {
    unlinkSync(path);
  } catch {
    return;
  }
  if (payload !== null) removeQuietly(join(dirname(path), payload));
}

/**
 * Publish the complete record already written at candidatePath under path.
 * Returns { published: true, payloadPath } when this process won the name
 * (payloadPath is non-null only for a symlink publication, whose payload
 * file must outlive the candidate); { published: false, payloadPath: null }
 * when the name was already taken. Throws for every other failure, with the
 * original errno on `code`.
 */
export function attemptPublish(candidatePath, path) {
  if (process.env[LEASE_FORCE_SYMLINK_ENV] === "1" && symlinkPublicationAllowed(dirname(path))) {
    return publishBySymlink(candidatePath, path);
  }
  try {
    linkSync(candidatePath, path);
    return { published: true, payloadPath: null };
  } catch (error) {
    if (error?.code === "EEXIST") return { published: false, payloadPath: null };
    if (!LINK_UNSUPPORTED_CODES.has(error?.code) || !symlinkPublicationAllowed(dirname(path))) {
      throw error;
    }
  }
  return publishBySymlink(candidatePath, path);
}

function publishBySymlink(candidatePath, path) {
  const payloadPath = `${path}.payload-${process.pid}-${Math.random().toString(36).slice(2)}`;
  // Complete payload first: nothing observable at the lease name until the
  // no-replace symlink below succeeds.
  writeFileSync(payloadPath, readFileSync(candidatePath), { flag: "wx", mode: 0o600, flush: true });
  try {
    symlinkSync(basename(payloadPath), path);
    return { published: true, payloadPath };
  } catch (error) {
    removeQuietly(payloadPath);
    if (error?.code === "EEXIST") return { published: false, payloadPath: null };
    throw error;
  }
}
