// The entire signing surface. Nothing here can be made to sign arbitrary bytes,
// and nothing here can move the rollback anchor without a canonical manifest.
//
//   protocolVersion()  — negotiate before anything else is sent.
//   requestEnrollment()— ask for a challenge; the signer mints one and delivers
//                        it to *this caller's package*, never to the caller.
//   enroll(p, nonce)   — present that challenge; the transaction's kernel pid
//                        becomes the one authorized client.
//   mac(...)           — MAC one bounded batch of *canonical memory payloads*
//                        for one of exactly two purposes, enrolled caller only.
//                        Used to seal records and to *verify* existing ones.
//   describe()         — authorization state and Keystore security level.
//
// Rollback anchor, all enrolled-caller only and all keyed by a store identity:
//
//   anchorHead(store)          — read {generation, digest, pending} or "none".
//   prepareManifest(store,...) — the only way to obtain a manifest MAC: it
//                                records the candidate digest as *pending* and
//                                refuses any generation that is not the next one.
//   commitManifest(store,...)  — promote the pending candidate. Idempotent.
//   baselineManifest(store,..) — one-time initialization for a store that was
//                                sealed before anchoring existed; it verifies
//                                the manifest's own MAC first.
//
// There is no call that advances the anchor for an arbitrary digest: the MAC of
// a manifest and its preparation are the same operation.
package com.openmausbot.companion.signer;

interface IMemorySigner {
    int protocolVersion();

    boolean requestEnrollment();

    boolean enroll(int protocol, String nonce);

    String mac(int protocol, int id, String purpose, in String[] payloads);

    String describe();

    /** JSON `{generation, digest, pending?}` for [storeKey], or "none". */
    String anchorHead(int protocol, String storeKey);

    /** Prepares [storeKey]'s next generation and returns the manifest MAC. */
    String prepareManifest(int protocol, int id, String storeKey, String payload);

    /** Promotes the prepared generation. True when it is committed. */
    boolean commitManifest(int protocol, String storeKey, long generation, String digest);

    /** Establishes the first anchor for this store from a verified manifest. */
    boolean baselineManifest(int protocol, String storeKey, String payload, String mac);
}
