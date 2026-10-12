// Side-effect module: enables the network guard's loopback test seam BEFORE
// the guard module is evaluated in the vitest process. Import order matters —
// this file must be imported before anything that imports
// android-net-guard.ts. The spawned adapter children get the same seam via
// their spawn env (see android-resources.test.ts); production never has it.
process.env.OMB_NETGUARD_ALLOW_LOOPBACK = "1";
export {};
