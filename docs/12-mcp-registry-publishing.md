# AXF MCP Registry Publishing

AXF publishes to the MCP Registry under the domain namespace
`dev.smartergpt/axf`.

That means publishing must use DNS auth for `smartergpt.dev`, not GitHub
auth.

## Namespace rule

- `dev.smartergpt/axf` is a domain namespace.
- `mcp-publisher` GitHub auth only authorizes `io.github.Guffawaffle/*`.
- GitHub auth is therefore insufficient for AXF MCP Registry publishing.

## Key material

- Existing key path: `/home/guff/mcp-keygen/mcp-registry-key.pem`
- The PEM may not parse with `ssh-keygen`.
- OpenSSL can read it and derive both the public key and the private-key hex.

Never print private key material.

Never commit private key material.

Never commit `.mcpregistry_*` token files.

## Version and identity checks

- `package.json` version and `server.json` version must match the npm package version.
- Registry name must remain `dev.smartergpt/axf`.
- npm package identifier must remain `@smartergpt/axf`.
- The package argument must remain positional `mcp`.

## Verification source of truth

Use the versioned, encoded endpoint for verification:

```sh
https://registry.modelcontextprotocol.io/v0.1/servers/dev.smartergpt%2Faxf/versions/<version>
```

The non-versioned `/servers/dev.smartergpt/axf` URL is not the verification source of truth.

## Safe DNS-auth recipe

The following pattern verifies the public key against DNS, derives the
private key into a shell variable without echoing it, logs in with DNS
auth, unsets the private key, publishes, and verifies the versioned
registry record.

```sh
KEY=/home/guff/mcp-keygen/mcp-registry-key.pem

PUB="$(openssl pkey -in "$KEY" -pubout -outform DER 2>/dev/null | tail -c 32 | base64 -w0)"
DNS="$(dig TXT smartergpt.dev +short | tr -d '"' | sed -n 's/^v=MCPv1; k=ed25519; p=//p')"
test "$PUB" = "$DNS"

PRIVATE_KEY="$(openssl pkey -in "$KEY" -text -noout 2>/dev/null | awk '/priv:/{capture=1; next} capture && /^[[:space:]]+[0-9a-f:]+$/{gsub(/[^0-9a-f]/, ""); printf "%s", $0; next} capture {exit}' | cut -c1-64)"
mcp-publisher login dns --domain smartergpt.dev --private-key "$PRIVATE_KEY"
unset PRIVATE_KEY

mcp-publisher publish

curl --path-as-is -fsSL 'https://registry.modelcontextprotocol.io/v0.1/servers/dev.smartergpt%2Faxf/versions/<version>'
```

## Cleanup

If registry token files are created in the repo root during local work,
remove them immediately:

```sh
rm -f .mcpregistry_github_token .mcpregistry_registry_token
```