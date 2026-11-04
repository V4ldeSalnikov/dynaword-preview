# Dynaword domain migration

Repository: https://github.com/danish-foundation-models/scandinavian-dynaword-website

Target website: https://dynaword.foundationmodels.dk/

Until DNS is ready, the website uses
https://danish-foundation-models.github.io/scandinavian-dynaword-website/.

## Domain cutover

1. Coordinate with the administrator of `foundationmodels.dk`. Its authoritative
   nameservers are `ns61.domaincontrol.com` and `ns62.domaincontrol.com` (GoDaddy).
2. In this repository's Settings → Pages, save `dynaword.foundationmodels.dk`
   as the custom domain immediately before the DNS change. The default Pages
   address will redirect to that hostname, so coordinate these two steps.
3. In the DNS zone for `foundationmodels.dk`, add exactly this record:

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | CNAME | dynaword | danish-foundation-models.github.io | 1 hour |

   Do not include `https://` or a repository path in the value. The main website
   and email DNS records do not need to change.
4. Set the repository Actions variable `PAGES_ORIGIN` to
   `https://dynaword.foundationmodels.dk`. If unset, the deployment check uses
   the organization's default GitHub Pages origin.
5. Wait for GitHub Pages' DNS check and TLS certificate, then enable Enforce HTTPS.
   Verify the overview, comparisons, assets and hash navigation on the new URL.

GitHub Actions publishes this site. Its custom domain is configured in Pages
settings; a source `CNAME` file is not used by this deployment method.

## Intentionally paused API

The existing Hugging Face Space, `V4ldeLund/danish-dynaword-api`, is intentionally
paused. The migration does not resume it or change hardware, volumes or billing.
Static overview and comparison pages work independently. Record browsing and
search require the separate API and remain unavailable while it is paused.

For a static-only migration, manually dispatch **Validate and deploy GitHub
Pages** with **verify_public_api** disabled. All fixture tests, container startup
checks and the frontend build still run. Push deployments and normal manual
deployments retain the live API check. Keep `VITE_API_BASE_URL` set to
`https://v4ldelund-danish-dynaword-api.hf.space`.

Before intentionally resuming the API, merge these three origins into the
Space's `ALLOWED_ORIGINS` variable (the Space variable overrides Docker defaults):

```text
https://v4ldesalnikov.github.io,https://danish-foundation-models.github.io,https://dynaword.foundationmodels.dk
```

The source Dockerfile includes these origins for future builds. Updating this
GitHub repository does not change the Space's live variables or code. Verify
browser CORS and run `scripts/check_public_api.py` after the service is resumed.

## References

- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GoDaddy: add a CNAME](https://www.godaddy.com/help/add-a-cname-record-19236)
- [Repository transfers](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)

GitHub redirects the old repository URL after transfer, but does not automatically
redirect the old GitHub Pages website URL. Update published website links.
