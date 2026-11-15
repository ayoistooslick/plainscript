# Documentation site

The public documentation is a dependency-free static site generated from the repository's Markdown sources. Build it locally with:

```bash
npm run docs:build
```

The generated site is written to `docs/site/`. GitHub Pages uses the same output through `.github/workflows/docs.yml`; the workflow installs the locked Node dependencies, runs the build, uploads `docs/site`, and deploys it with the Pages artifact actions.

The site keeps the source Markdown files as the canonical content. Navigation groups the material into Start here, Language, Compiler, Guides, and Project. Search is client-side and generated from page titles and excerpts, so the site has no server requirement and remains compatible with project Pages URLs.

When adding a page, add it to the `pages` list in `scripts/build-docs-site.js`, give it a group and title, then run `npm run docs:build`. Do not edit generated files in `docs/site/` by hand.
