import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// --- Sidebar from catalogue.json ---------------------------------------------

interface CatalogueItem {
  title: string
  name: string
  path?: string
  children?: CatalogueItem[]
}

interface Catalogue {
  title: string
  repo_url: string
  branch: string
  items: CatalogueItem[]
}

const catalogue: Catalogue = JSON.parse(
  readFileSync(fileURLToPath(new URL('../catalogue.json', import.meta.url)), 'utf8'),
)

const REPO_URL = 'https://github.com/mablahblah/job-assistant'

// "onboarding/contributor-guide.md" -> "/onboarding/contributor-guide"
function toLink(path: string): string {
  return '/' + path.replace(/\.md$/, '')
}

function toSidebarItem(item: CatalogueItem): DefaultTheme.SidebarItem {
  if (item.children?.length) {
    return {
      text: item.title,
      collapsed: false,
      items: item.children.map(toSidebarItem),
    }
  }
  return { text: item.title, link: toLink(item.path ?? `${item.name}.md`) }
}

function firstLink(item: CatalogueItem): string | undefined {
  if (item.path) return toLink(item.path)
  for (const child of item.children ?? []) {
    const link = firstLink(child)
    if (link) return link
  }
  return undefined
}

const sidebar: DefaultTheme.SidebarItem[] = catalogue.items.map((section) => {
  const group = toSidebarItem(section)
  // Onboarding is always open and cannot be collapsed.
  if (section.name === 'onboarding') delete group.collapsed
  return group
})

const nav: DefaultTheme.NavItem[] = [
  { text: 'Home', link: '/' },
  ...catalogue.items.map((section) => ({
    text: section.title,
    link: firstLink(section) ?? '/',
  })),
]

// --- Site config -------------------------------------------------------------

export default withMermaid({
  title: 'Job Search Assistant Wiki',
  description:
    'How the Job Search Assistant finds, ranks and tracks jobs, and files the unemployment work log — a CLI pipeline driven by Claude Code skills.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: false,
  appearance: 'dark',
  srcExclude: ['**/AGENTS.md', '**/CLAUDE.md'],
  // Only links to a local dev server (localhost, 127.0.0.1) are allowed to dangle.
  ignoreDeadLinks: 'localhostLinks',

  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
      },
    ],
    ['meta', { name: 'theme-color', content: '#0d1117' }],
  ],

  markdown: {
    lineNumbers: false,
    theme: { light: 'github-light', dark: 'github-dark' },
  },

  themeConfig: {
    nav,
    sidebar,
    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },
    editLink: {
      pattern: `${REPO_URL}/edit/main/wiki/:path`,
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: REPO_URL }],
    docFooter: { prev: 'Previous', next: 'Next' },
  },

  mermaid: {
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      background: '#0d1117',
      primaryColor: '#2d333b',
      primaryTextColor: '#e6edf3',
      primaryBorderColor: '#6d5dfc',
      secondaryColor: '#2d333b',
      secondaryTextColor: '#e6edf3',
      secondaryBorderColor: '#6d5dfc',
      tertiaryColor: '#161b22',
      tertiaryTextColor: '#e6edf3',
      tertiaryBorderColor: '#30363d',
      mainBkg: '#2d333b',
      nodeBorder: '#6d5dfc',
      nodeTextColor: '#e6edf3',
      textColor: '#e6edf3',
      titleColor: '#e6edf3',
      lineColor: '#8b949e',
      clusterBkg: '#161b22',
      clusterBorder: '#30363d',
      edgeLabelBackground: '#161b22',
      // Sequence diagrams
      actorBkg: '#2d333b',
      actorBorder: '#6d5dfc',
      actorTextColor: '#e6edf3',
      actorLineColor: '#8b949e',
      signalColor: '#8b949e',
      signalTextColor: '#e6edf3',
      labelBoxBkgColor: '#2d333b',
      labelBoxBorderColor: '#6d5dfc',
      labelTextColor: '#e6edf3',
      loopTextColor: '#e6edf3',
      noteBkgColor: '#161b22',
      noteBorderColor: '#30363d',
      noteTextColor: '#e6edf3',
      activationBkgColor: '#30363d',
      activationBorderColor: '#6d5dfc',
      // State / class / ER diagrams
      labelColor: '#e6edf3',
      altBackground: '#161b22',
      attributeBackgroundColorOdd: '#2d333b',
      attributeBackgroundColorEven: '#22272e',
    },
  },
  mermaidPlugin: {
    class: 'mermaid',
  },
})
