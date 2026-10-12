export interface PublishAttempt {
  /** Whether this process won the create-if-absent publication. */
  published: boolean;
  /** Non-null only for a symlink publication whose payload file must
   * outlive the candidate; null for a hard-link publication. */
  payloadPath: string | null;
}

/** Test hook: skip the hard-link route entirely and exercise the Android path. */
export const LEASE_FORCE_SYMLINK_ENV: string;

/** link(2) failures meaning "hard links unavailable here" (SELinux policy,
 * filesystem support, cross-device). */
export const LINK_UNSUPPORTED_CODES: Set<string>;

export function removeQuietly(path: string): void;
export function symlinkPublicationAllowed(directory: string): boolean;
export function readlinkTarget(path: string): string | null;
export function removeDanglingLease(path: string): void;
export function attemptPublish(candidatePath: string, path: string): PublishAttempt;
