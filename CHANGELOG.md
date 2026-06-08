# Changelog

All notable changes to Magnolia are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/).

## [1.2.0]

### Added
- **Studio panel toggle** — a new toolbar button to show or hide the workspace panels (Documents, Codes, Queries, Memos, Quotes, Analyses). On Windows and Linux, which have no menu bar, this is now the way to reopen a panel after you close it; it works on macOS too.

### Changed
- **Cleaner saved-query names.** Auto-suggested names now read like "Choice to study law (incl. subcodes)" and list the tags and documents you actually chose, instead of spelling out every matching subcode and every resolved document.
- **Live document filters.** Re-running a saved query now re-applies its document filter against your current data, so a query scoped to (say) "Female ∩ Domestic" picks up documents you tag that way later — matching how code filters already behave, and what the in-app live re-run already implied.

### Fixed
- **Saved queries reopen as you built them.** Reopening a saved query now restores the exact Document Selector and Query Builder you authored, instead of rebuilding a larger, altered version from the query's resolved output. A code with "And subcodes" stays a single ticked node rather than exploding into one node per subcode, and a document filter keeps its operators instead of collapsing to a union of every matched document.
- **Coding lands on the text you selected.** Applying a code to a selection no longer jumps to a different passage when the cursor passes over a code, memo, or quote label on its way to the codebook.
- **Stronger protection against data loss when saving.** Project files are now written atomically, so an interrupted save — a crash, or quitting mid-save — can no longer truncate or corrupt your project. Magnolia also refuses to overwrite a project with empty content, and simply opening a project no longer triggers an unnecessary full rewrite.

## [1.1.0]

### Added
- **Linux support** — Magnolia is now available for Linux as an AppImage and a Debian/Ubuntu `.deb` package, alongside macOS and Windows.
- **In-app update prompt** — when a new version is available, Magnolia now shows a dialog with the release notes and lets you Install Now, Remind Me Later, or Skip This Version.

### Fixed
- macOS updates now also install when you quit the app, not only when you choose "Restart now".

## [1.0.7]

### Fixed
- macOS auto-update now reliably installs and relaunches. Earlier versions downloaded the update but never applied it (a Squirrel.Mac issue on modern macOS). Users on 1.0.0–1.0.6 need to update manually once; updates are automatic from 1.0.7 onward.

## [1.0.1]

### Added
- Windows installer download.
- Minimise / maximise / close window controls in the toolbar on Windows and Linux, which have no native title bar.

## [1.0.0]

First public release of Magnolia.
