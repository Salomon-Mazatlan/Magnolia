# Publishing the manual

The manual is published to GitHub Pages at **https://caledavis.github.io/Magnolia/**
by the GitHub Action at `.github/workflows/manual.yml`.

## One-time setup

In the GitHub repo: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**. That's the only switch to flip. (You do *not* need to pick a
branch — the Action publishes directly.)

## Day-to-day

Editing Markdown and pushing is all it takes:

```bash
# edit files under manual/ ...
git add manual
git commit -m "Manual: add exporting page"
git push
```

The Action runs automatically whenever a push to `main` touches anything under
`manual/`, rebuilds the site, and redeploys it. You can also trigger it manually
from the repo's **Actions** tab ("Deploy manual" → "Run workflow").

## Building locally (optional)

You don't need to build by hand — the Action does it — but to produce the static
site yourself:

```bash
cd manual
npm run build      # outputs manual/.vitepress/dist
npm run preview    # serve that build at http://localhost:4173/Magnolia/
```

## Notes

- `base` is set to `/Magnolia/` in `.vitepress/config.mjs` because GitHub Pages
  serves a project site under `/<repo-name>/`. If you ever move the manual to a
  custom domain (e.g. `docs.caledavis.eu`), change `base` to `/` and add a
  `CNAME` file in `manual/public/`.
- The repo name is case-sensitive: the path is `/Magnolia/`, not `/magnolia/`.
