# Magnolia Manual

The online manual for Magnolia. It lives in this repo (`manual/`) and is
published to GitHub Pages at **https://caledavis.github.io/Magnolia/**.

Built with [VitePress](https://vitepress.dev/) — you write Markdown, it generates
a documentation site with a left-hand table of contents, search, and a per-page
outline.

```
manual/                  ← this folder
├── index.md             the manual home page
├── guide/               content pages (one .md file = one page)
│   ├── introduction.md
│   ├── installation.md
│   └── …
├── public/              static assets (fonts, favicon)
└── .vitepress/
    ├── config.mjs        site config + the sidebar (table of contents)
    └── theme/            Magnolia colours/fonts (matches caledavis.eu)
```

The built site is written to `manual/.vitepress/dist` and deployed by the
GitHub Action at `.github/workflows/manual.yml`. You never commit the `dist`
folder — the Action rebuilds it.

## Adding or editing content

1. **Edit an existing page:** open the relevant `.md` file in `guide/` and change
   the text (standard Markdown).

2. **Add a new page:**
   - Create a new file, e.g. `guide/exporting.md`, starting with a `# Title`.
   - Open `.vitepress/config.mjs` and add one line to the `sidebar` so it appears
     in the table of contents:
     ```js
     { text: 'Exporting', link: '/guide/exporting' },
     ```

3. **Add images:** put them next to your `.md` file (or in `guide/images/`) and
   reference them: `![alt text](./images/screenshot.png)`.

## Previewing as you write

```bash
cd manual
npm install        # first time only
npm run dev        # live preview at http://localhost:5173/Magnolia/
```

The preview reloads instantly as you save.

> ⚠️ **Don't open the built files directly** (double-clicking a file, a `file://…`
> URL). The site is built for the `/Magnolia/` path, so its CSS/JS live at
> `/Magnolia/assets/…`; over `file://` the browser can't find them and the page
> looks completely unstyled. Always view it through `npm run dev`, `npm run
> preview`, or the live site.

## Publishing

Just push to `main`. The Action rebuilds and redeploys whenever anything under
`manual/` changes — see [DEPLOY.md](./DEPLOY.md) for the one-time Pages setup.
