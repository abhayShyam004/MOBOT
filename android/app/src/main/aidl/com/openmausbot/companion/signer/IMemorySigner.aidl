// The entire signing surface. None of these calls can be made to sign arbitrary
// bytes, and none of them can move the rollback anchor without a canonical
// manifest:
//
//   protocolVersion()  — negotiate before anything else is sent.
//   requestEnrollment()— ask for a challenge; the signer mints one and delivers
//                        it to *this caller's package*, never to the caller.
//   enroll(p, nonce)   — present that challenge; the transaction's kernel pid
//                        becomes the one authorized client.
//   mac(...)           — MAC one bounded batch of *canonical memory payloads*
//                        for one of exactly two purposes, enrolled caller only.
//   describe()         — authorization state and Keystore security level, for
//                        the trust log.
//
// There is deliberately no `sign(byte[])`, no `rawMac(String)`, no way to ask
// for a key, and no way to nominate a pid: `enroll` takes no caller argument at
// all, so a process can only ever authorize *itself*, and only by presenting a
// challenge it could not have produced.

package com.openmausbot.companion.signer;

interface IMemorySigner {
    int protocolVersion();

    /**
     * Ask for an enrollment challenge. The value is not returned here — it is
     * delivered to the manifest receiver in the caller's own package, which is
     * why a competing same-UID process cannot read it. Returns false when the
     * authority is already enrolled to a live peer.
     */
    boolean requestEnrollment();

    /**
     * Present the challenge. The authorized pid is the kernel's caller pid of
     * this transaction. Returns true once this process holds the authority.
     */
    boolean enroll(int protocol, String nonce);

    /**
     * id is the caller's monotonically increasing request number; a value not
     * greater than the previous one on this authority is refused (replay).
     * Returns a JSON array of lowercase-hex MACs, one per payload.
     */
    String mac(int protocol, int id, String purpose, in String[] payloads);

    String describe();

    /**
     * The signer's committed freshness state for one store: a JSON object
     * `{generation, digest, pending?}`, or the string "none" when this store has
     * never been anchored. The anchor lives in the signer's own private files,
     * which the app UID — and therefore the agent shell — cannot read or write.
     */
    String anchorHead(int protocol, String storeKey);

    /**
     * The only way to obtain a manifest MAC under this authority. The digest and
     * generation are taken from the payload and recorded as the *pending* next
     * generation in the same transaction, so a caller cannot prepare one
     * candidate and then write a different one. A generation that is not exactly
     * the next one is refused.
     */
    String prepareManifest(int protocol, int id, String storeKey, String payload);

    /**
     * Promote the prepared candidate to the committed generation. Idempotent for
     * a pair that is already committed; anything else is refused.
     */
    boolean commitManifest(int protocol, String storeKey, long generation, String digest);

    /**
     * Establish the first anchor for a store that was sealed before anchoring
     * existed. The signer recomputes the manifest MAC itself before accepting it,
     * and refuses if this store already has an anchor.
     */
    boolean baselineManifest(int protocol, String storeKey, String payload, String mac);
}
