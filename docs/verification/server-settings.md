# Server provider sign-in and custom domain

Use an isolated fixture only. Never change the running user's provider account,
domain, or configuration to verify these controls.

## Automated checks

```sh
pnpm exec vitest run server/custom-domain.test.ts server/provider-auth-sessions.test.ts server/drivers/codex-native-auth.test.ts server/request-auth.test.ts server/config.test.ts src/components/CodexDeviceSignIn.test.ts src/components/CustomDomainSettings.test.ts src/components/EngineSetup.test.ts src/components/EnginesSettings.test.ts
pnpm typecheck
pnpm build
pnpm build:server
node scripts/smoke-packaged-server.mjs
```

The domain helper tests substitute DNS and HTTPS responses. They check public
address restrictions, pinned DNS, TLS options, redirects, deadlines, bounded
responses, the workspace identity, and the independent one-time proof. They do
not prove a customer's real DNS, certificate, or reverse proxy is configured.

## Real Settings UI with an offline provider

1. Follow the [fixture launcher](README.md#launch), retaining its printed URL,
   temporary data directory and persistent log path. Run Doctor against that
   explicit URL.
2. Start Vite on a separate free port with `OMB_PORT` set to the printed harness
   port. Do not let it proxy to the default port or the user's live app.
3. For domain UI, open Settings → Remote access → Connect your domain. Enter
   `bots.example.com`: confirm the Type/Name/Value rows and that copy buttons do
   not submit the form. Technical guidance must remain collapsed under
   **Advanced server setup**. The launcher deliberately strips operator
   environment variables. To test the copyable IP in browser automation,
   intercept only the fixture's GET `/api/settings/custom-domain` response and
   supply `serverIpv4: "8.8.8.8"`, preserving its other fields. Never point DNS
   at this synthetic address or intercept verification POSTs. Public-interface
   detection and the `OMB_PUBLIC_IPV4` override are covered by the helper tests.
   Without a public interface or override, confirm the UI asks the administrator
   for the IP and does not offer a fake value to copy. Expand the advanced guide
   and confirm its app and webhook ports match the fixture. Submit
   `http://bots.example.com` and confirm HTTPS validation appears without
   changing the current address. The real API must likewise reject localhost,
   IP addresses, and URLs containing pairing codes.
   At a 390px viewport, Settings uses a section dropdown instead of the sidebar.
   Switch sections, copy a DNS value, and confirm the form remains readable.
   Tab and Shift-Tab must stay inside the dialog, skipping the hidden sidebar
   and links inside the collapsed advanced guide.
4. Codex sign-in is the provider's own device and browser-redirect flow: the
   app calls `auth.openai.com` for a code, polls it, exchanges it, and binds a
   loopback port for the browser leg. Nothing is spawned, so the offline
   fake-CLI recipe this recipe used to describe — a fake Codex login CLI driven
   with `OMB_DEVICE_AUTH_FIXTURE=1` and an approved marker in the fixture's
   HOME — went away with it, and with it any way to walk the
   Connect ChatGPT dialog in Settings without a real account. That flow's
   coverage is `server/drivers/codex-native-auth.test.ts`, which scripts the
   transport against a disposable `CODEX_HOME`: code, poll and exchange, pending
   polls, an already-signed-in host, an expired code, a refused start,
   sign-out, the browser redirect and its state check, the fallback to the
   device flow when no loopback port binds, and a case asserting the module
   spawns no process at all. Run it; **never perform a real sign-in in a
   verification fixture and never enter a code at OpenAI.**
5. Stop the Vite process and interrupt the foreground fixture launcher. Only
   its owned child and disposable data are removed; retain the printed log.

For deployment acceptance, separately test an actual public domain and an
owner-initiated real provider sign-in. A green offline run must not be reported
as a real OpenAI account login or proof of public DNS/TLS reachability.
