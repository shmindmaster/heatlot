# Infra

The root `AGENTS.md` applies.

`infra/docker/Dockerfile` is the only image. Compose services change the command,
not the image. `fuzz.sh` must stay LF-only.

```text
docker compose run --build --rm verify
```
