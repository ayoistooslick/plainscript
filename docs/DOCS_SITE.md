# Documentation site

The public documentation is a dependency-free static site generated from the repository's Markdown sources. Build it locally with:

```bash
npm run docs:build
```

The generated HTML, CSS, JavaScript, and `.nojekyll` marker are written directly to `docs/`, alongside the canonical Markdown sources. This layout is intentional: the repository currently uses GitHub Pages' legacy `main` → `/docs` source. `.github/workflows/docs.yml` uploads the same directory, so it also remains compatible if Pages is later switched to the GitHub Actions source.

The site keeps the source Markdown files as the canonical content. Navigation groups the material into Start here, Language, Compiler, Guides, and Project. The 2.2 and 2.3 pages include JSX and React, regular expressions, cross-language bridges, migrating to 2.2 and 2.3, the standard library and both capability audits. Search is client-side and generated from page titles and excerpts, so the site has no server requirement and remains compatible with project Pages URLs.

When adding a page, add it to the `pages` list in `scripts/build-docs-site.js`, give it a group and title, then run `npm run docs:build`. Do not edit generated HTML, CSS, or JavaScript in `docs/` by hand; edit the Markdown source instead.
