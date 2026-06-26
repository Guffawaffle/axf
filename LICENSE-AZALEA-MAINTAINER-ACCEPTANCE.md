# Azalea Agreement Maintainer Acceptance and Signature Record

This file records Maintainer's digital acceptance and offer for
[`LICENSE-AZALEA.md`](./LICENSE-AZALEA.md).

I, Joseph Gustavson / Guffawaffle / SmarterGPT, affirm that I have reviewed and
agree to the terms in `LICENSE-AZALEA.md` as Maintainer. I intend my digital
signatures over `LICENSE-AZALEA.md` and over this acceptance record to evidence
the Maintainer offer, representations, and voluntary covenant described in
Section 22 of that Agreement.

This acceptance record does not by itself bind Azalea Health. Company acceptance
still requires Company signature or other written acceptance through an
authorized Company representative as described in the Agreement.

## Signed Material

| Item                            | Value                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Agreement file                  | `LICENSE-AZALEA.md`                                                |
| Agreement SHA-256               | `5f851dbf11061d4e75783476be8ee9e1e99cdfd47b64c2dba0f2303f1d408f16` |
| Agreement snapshot date         | 2026-06-26                                                         |
| Maintainer acceptance timestamp | 2026-06-26T10:29:29Z                                               |
| Covered Tooling snapshot tag    | `azalea-internal-use-snapshot-2026-06-26`                          |

## Signing Identity

| Item                   | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| Principal              | `joseph.gustavson@smartergpt.dev`                    |
| Maintainer             | Joseph Gustavson / Guffawaffle / SmarterGPT          |
| Signature tool         | OpenSSH `ssh-keygen -Y sign`                         |
| Signature namespace    | `smartergpt-license-agreement`                       |
| Public key algorithm   | ED25519                                              |
| Public key fingerprint | `SHA256:FRFbT4nWaGDUPLFc9KwtjQk1G6Yz4LV5aeQVKC5H2IA` |
| Allowed signers file   | `LICENSE-AZALEA.allowed-signers`                     |

## Signature Files

| Signed file                               | Detached signature                            |
| ----------------------------------------- | --------------------------------------------- |
| `LICENSE-AZALEA.md`                       | `LICENSE-AZALEA.md.sig`                       |
| `LICENSE-AZALEA-MAINTAINER-ACCEPTANCE.md` | `LICENSE-AZALEA-MAINTAINER-ACCEPTANCE.md.sig` |

## Verification

Verify the Agreement signature:

```sh
ssh-keygen -Y verify \
  -f LICENSE-AZALEA.allowed-signers \
  -I joseph.gustavson@smartergpt.dev \
  -n smartergpt-license-agreement \
  -s LICENSE-AZALEA.md.sig \
  < LICENSE-AZALEA.md
```

Verify this acceptance record signature:

```sh
ssh-keygen -Y verify \
  -f LICENSE-AZALEA.allowed-signers \
  -I joseph.gustavson@smartergpt.dev \
  -n smartergpt-license-agreement \
  -s LICENSE-AZALEA-MAINTAINER-ACCEPTANCE.md.sig \
  < LICENSE-AZALEA-MAINTAINER-ACCEPTANCE.md
```

Verify the signed Git snapshot tag:

```sh
git -c gpg.format=ssh \
  -c gpg.ssh.allowedSignersFile=LICENSE-AZALEA.allowed-signers \
  tag -v azalea-internal-use-snapshot-2026-06-26
```
