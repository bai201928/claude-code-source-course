# Container Demo

This directory provides a local container smoke test for the release-control contract. It does not claim to be a production cluster.

Run the credential-free release demo:

```powershell
docker compose -f deployment/docker-compose.yml up --build --abort-on-container-exit release-control-smoke
```

Run the real headless CLI only when `MINI_AGENT_API_KEY` is supplied by the parent process:

```powershell
$env:MINI_AGENT_API_KEY = '<provider key>'
docker compose -f deployment/docker-compose.yml --profile live run --rm agent-cli
```

Compose does not read or copy `.env.local`; `.dockerignore` excludes credential files. The live service still remains a single container using an in-memory reference runtime. Durable stores, distributed queue/quota, a real Sandbox, service discovery, health probes and orchestration are deployment adapters left outside this repository.
