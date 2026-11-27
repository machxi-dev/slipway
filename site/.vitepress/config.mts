import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';

const plugin = JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const github: string = plugin.repository.replace(/\/$/, '');
const skills = ['plan', 'scope', 'build', 'ship', 'adr', 'init'];

// A project site on GitHub Pages lives under /<repo>/. A custom domain sets DOCS_BASE=/ in the workflow.
const base = process.env.DOCS_BASE ?? '/slipway/';

export default defineConfig({
  title: 'Slipway',
  description: plugin.description,
  base,
  srcDir: 'src',
  cleanUrls: true,
  lang: 'en',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#0f766e' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Slipway' }],
    ['meta', { property: 'og:description', content: plugin.description }],
  ],
  markdown: {
    // Sources use GitHub's anchors in places; keep VitePress's slugs close to them.
    anchor: { level: [2, 3] },
  },
  themeConfig: {
    logo: { src: '/logo.svg', alt: '' },
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Commands', link: '/commands/', activeMatch: '/commands/' },
      { text: 'Design', link: '/reference/design', activeMatch: '/reference/' },
      {
        text: `v${plugin.version}`,
        items: [
          { text: 'Changelog', link: '/reference/changelog' },
          { text: 'Releases', link: `${github}/releases` },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'The method', link: '/guide/method' },
          { text: 'Contributing', link: '/guide/contributing' },
        ],
      },
      {
        text: 'Commands',
        items: [
          { text: 'Overview', link: '/commands/' },
          ...skills.map((s) => ({ text: `/slipway:${s}`, link: `/commands/${s}` })),
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Design', link: '/reference/design' },
          { text: 'Measurements', link: '/reference/measurements' },
          { text: 'Changelog', link: '/reference/changelog' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: github }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    editLink: {
      // A generated page is edited at its source in the repository, which its frontmatter names. The function
      // is serialised into the client bundle, so it cannot close over anything: the URL is written out.
      pattern: ({ filePath, frontmatter }) =>
        `https://github.com/machxi-dev/slipway/edit/main/${frontmatter.source ?? `site/src/${filePath}`}`,
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: `Released under the <a href="${github}/blob/main/LICENSE">MIT License</a>.`,
      copyright: 'A Claude Code plugin by machxi-dev.',
    },
  },
});
