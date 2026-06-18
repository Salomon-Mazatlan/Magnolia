import { defineConfig } from 'vitepress'

// Magnolia online manual — VitePress config.
//
// Published as the Magnolia repo's GitHub Pages site at
// https://caledavis.github.io/Magnolia/ , so `base` must be '/Magnolia/'.
// The build output (.vitepress/dist) is deployed by .github/workflows/manual.yml.
//
// TO ADD A NEW PAGE:
//   1. Create a markdown file, e.g. guide/exporting.md
//   2. Add ONE line to the `sidebar` array below pointing at it.
// That's it — the left-hand table of contents updates automatically.

export default defineConfig({
  title: 'Magnolia Manual',
  description: 'The online manual for Magnolia — free, open-source QDA software.',
  lang: 'en-US',

  // GitHub Pages project site path (repo name is "Magnolia", case-sensitive)
  base: '/Magnolia/',

  // Clean URLs (/Magnolia/guide/coding instead of .../coding.html)
  cleanUrls: true,

  // Last-updated timestamps in the footer of each page
  lastUpdated: true,

  // Favicon (the icon lives in public/, served at /Magnolia/magnoliaicon.png)
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/Magnolia/magnoliaicon.png' }]
  ],

  themeConfig: {
    // Built-in local search — no external service needed
    search: {
      provider: 'local'
    },

    // Top navigation bar
    nav: [
      { text: 'Manual', link: '/guide/introduction' },
      { text: 'Magnolia site', link: 'https://www.caledavis.eu/magnolia.html' },
      { text: 'Download', link: 'https://github.com/caledavis/Magnolia/releases/latest' }
    ],

    // === LEFT-HAND TABLE OF CONTENTS ===
    // Each `items` entry is one page: { text: 'Shown in sidebar', link: '/path/to/file' }
    // Add new pages by adding a line here.
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Installation', link: '/guide/installation' }
        ]
      },
      {
        text: 'Using Magnolia',
        items: [
          { text: 'Coding your data', link: '/guide/coding' },
          { text: 'Querying', link: '/guide/querying' },
          { text: 'Relationship maps', link: '/guide/relationship-maps' },
          { text: 'Transcription', link: '/guide/transcription' },
          { text: 'Surveys', link: '/guide/surveys' }
        ]
      },
      {
        text: 'Analysis & output',
        items: [
          { text: 'The analysis suite', link: '/guide/analysis' },
          { text: 'Reports', link: '/guide/reports' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/caledavis/Magnolia' }
    ],

    editLink: {
      pattern: 'https://github.com/caledavis/Magnolia/edit/main/manual/:path',
      text: 'Suggest an edit to this page'
    },

    footer: {
      message: 'Released under the EUPL.',
      copyright: '© 2026 Cale Davis'
    }
  }
})
