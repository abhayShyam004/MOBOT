# Bring your own engine

Two zero-code ways to run OpenMausBot bots on an engine the app doesn't ship.
Both live in `~/.openmausbot/config.json` under `"instances"`; restart the app
after editing (instance entries are read at boot).

## Provider icons

In **Settings → Engines**, expand an instance and choose its **Provider icon**.
The built-in choices include OpenAI, Anthropic, Google Gemini, Microsoft Azure,
Amazon Bedrock (AWS), xAI, DeepSeek, Meta, Mistral AI, Qwen, Moonshot AI,
Cohere, and OpenRouter. You can also upload a PNG, JPEG, or WebP image up to
128 KB and 1024 × 1024 pixels. **Reset** restores the default icon.

Each instance has its own icon, independent of its driver or API protocol.
Changes made in Settings apply immediately without restarting the engine.
For file-based configuration, add `"icon": { "kind": "preset", "preset": "azure" }`
alongside `driver` and `displayName`. Custom uploads are stored as embedded image
data; the app does not fetch remote icon URLs.

## Any ACP agent (a CLI you spawn)

If an agent CLI speaks [ACP](https://agentclientprotocol.com) over stdio —
`fx acp`, a Zed-style agent server, your own wrapper — point a `customAcp`
instance at it:

```json
{
  "instances": {
    "my-agent": {
      "driver": "customAcp",
      "displayName": "My Agent",
      "environment": { "MY_AGENT_TOKEN": "…" },
      "config": { "cli": "my-agent acp" }
    }
  }
}
```

- **`config.cli`** is the whole command, args included (`"npx -y some-agent acp"`
  works). You can also set it from the app: Settings → Engines → *Set CLI…* on
  the instance's row. An instance without a command shows up with exactly that
  hint instead of failing at first message.
- **Sign in first.** The driver has no auth flow of its own — run the CLI once
  in a terminal and log in there; OpenMausBot spawns it with your login intact.
- **Model choice stays inside the agent.** The picker shows a single
  "Agent default" entry; whatever the CLI is configured to run is what runs.
- **`environment`** is passed to the CLI child. Foreign provider keys
  (XAI_API_KEY, OPENAI_COMPAT_API_KEY, …) are deliberately stripped so a
  custom CLI can never bill against another engine's login.
- **Permissions** ride ACP's own `session/request_permission` — if your agent
  asks, the request becomes a normal approval card in chat.
- Multiple instances are fine — one per agent.

## Any OpenAI-compatible endpoint (no process at all)

The built-in `openai-compat` driver supports multiple instances, so a local
vLLM/LM Studio/Ollama-openai endpoint or any hosted compatible API is one
entry:

```json
{
  "instances": {
    "my-endpoint": {
      "driver": "openai-compat",
      "displayName": "My Endpoint",
      "environment": { "MY_ENDPOINT_KEY": "sk-…" },
      "config": {
        "url": "http://127.0.0.1:1234/v1",
        "apiKeyEnv": "MY_ENDPOINT_KEY",
        "model": "my-model"
      }
    }
  }
}
```

- `apiKeyEnv` names which `environment` value carries the key, so several
  instances can hold different keys without colliding.
- The driver lists the endpoint's `/models` when it can and keeps your
  `model` as a custom option either way.
- Honest limits: chat text + reasoning streams only — **no tool calls**, so
  bots on these instances answer and write, but don't operate computers or
  connected apps.

## One endpoint in front of every provider (Respan Gateway)

The [Respan Gateway](https://github.com/respanai/respan-gateway?utm_source=freebuff&utm_medium=paid&utm_campaign=respan-gateway&bfcid=bfc_1.eyJpZCI6IjU0ZDYxY2IwLTdjYjEtNDAzYS04NDExLWIzNTg5ZGYxZTczNyIsImMiOiIyMDM2ODZkZS1mMzg0LTQ4NTQtYmViNC1hYzBiYWRmNmM1NTUiLCJrIjoiM2IxMGE4YmUtNzgyOS00MmJhLWFmNmEtYmI0YWUxZTRhY2Y4IiwiaWF0IjoxNzkzMzAyMDAxfQ.4XrpI7tuu-ZdGLrGT1fYzytQSQEu45atpekVASnTcLc)
is an open-source LLM gateway: one OpenAI-compatible endpoint that routes each
model name to the provider that owns it (`claude-*` to Anthropic, `grok-*` to
xAI, everything else to the OpenAI-compatible endpoint you already configured).
The built-in `respanGateway` driver runs it as a loopback sidecar on this
machine and spends the keys already in `config.json` — no account, no hosted
credits, no tracing export.

Install its Python environment once (Python 3.10+, wheels only) and restart the
server with its usual command (`pnpm dev:server`, or `pnpm dev` for the UI as
well):

```sh
uv sync --directory gateway     # respan-gateway==0.3.0, pinned in gateway/pyproject.toml
```

Then one instance entry, under `"instances"` in `~/.openmausbot/config.json`:

```json
{
  "instances": {
    "respanGateway": {
      "driver": "respanGateway",
      "displayName": "Respan Gateway",
      "config": { "model": "claude-haiku-4-5" }
    }
  }
}
```

- **Keys are the workspace's own.** The driver hands the sidecar
  `anthropic.key`, `xai.key`, and — only when you set a URL beside it —
  `openaiCompat.key` with `RESPAN_OPENAI_BASE_URL`, so a router key is never
  sent to api.openai.com by guesswork. Cover more vendors through the
  instance's own `environment`, under the variable the gateway reads
  (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, …); nothing else in
  that block crosses into the sidecar.
- **Pick a model, get a route.** The picker lists every configured vendor's
  models, badged with the vendor the gateway will call: a `claude-*` turn leaves
  as Anthropic Messages, a `gpt-*` turn leaves as chat completions.
- **It stays local.** `server/drivers/respan-gateway.ts` starts
  `gateway/serve.py` on an ephemeral 127.0.0.1 port when the instance loads and
  stops it when the instance is disposed. `RESPAN_GATEWAY_PYTHON` points at
  another interpreter that already has the package, `RESPAN_GATEWAY_ROOT` at
  another checkout of the sidecar. A packaged desktop app ships no Python
  environment, so there the instance reports itself unavailable with that
  reason rather than failing mid-turn.
- **A `gateway.toml` at the repository root** is read by the gateway itself (its
  documented default) for provider settings this app does not model.

Observed result, offline: `npx vitest run server/drivers/respan-gateway.test.ts`
starts the real sidecar against two local fake providers and pins what this
section claims — one picker listing `gpt-fixture` (vendor `openai`) and
`claude-fixture` (vendor `anthropic`); a chat turn through the gateway reaching
the first as a streamed chat completion; a `claude-*` turn reaching the second
as `POST /v1/messages` while the first sees no Claude request at all; the
sidecar's port closed again after the instance is disposed. **No live provider
request was made or verified** here: this run had no provider keys, so every
request above went to a fixture — the same path a real key takes, but the key
test is yours to run.

## Notes

- `config.json` is written with mode 0600; values in `environment` are stored
  as plaintext in that file. Prefer keys scoped to the one engine.
- A typo'd `driver` or invalid `config` never breaks the app: the instance
  shows as unavailable with the reason, and the rest of the fleet loads.
