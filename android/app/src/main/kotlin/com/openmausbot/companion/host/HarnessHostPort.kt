package com.openmausbot.companion.host

import android.content.Context

/**
 * The loopback port this installation's host owns.
 *
 * A function, not a constant: two packages built from this repository can be
 * installed together, and both trust loopback. The official app keeps 18799;
 * a preview build listens on 18789 so the two can run at once without either
 * one taking the other's port. Identity is still decided by
 * [HostIdentity] — the port only keeps them from colliding.
 */
fun HarnessHostPort(context: Context): Int = StandalonePairing.portFor(context.packageName)
