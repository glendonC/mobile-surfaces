# Security

Do not commit APNs keys, provisioning profiles, certificates, `.env` files, or generated Xcode signing artifacts.

For local APNs smoke tests, store keys outside the repo, for example under `~/.mobile-surfaces/`, and configure environment variables from `.env.example`.

If you find a security issue in this starter, please open a private advisory or contact the maintainer before filing a public issue.
