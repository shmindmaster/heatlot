set -eu
node bin/heatlot.mjs serve --port 4141 &
ok=0
i=0
while [ "$i" -lt 30 ]; do
  if node -e "fetch('http://127.0.0.1:4141/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ok=1
    break
  fi
  i=$((i + 1))
  sleep 1
done
test "$ok" -eq 1
st run docs/api/openapi.json --url http://127.0.0.1:4141 --checks all --max-examples 25
