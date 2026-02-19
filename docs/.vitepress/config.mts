import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hone',
  description: 'A CLI that hones your codebase one principle at a time',
  base: '/hone-cli/',
  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/installation' },
      { text: 'Reference', link: '/reference/cli-commands' },
      { text: 'GitHub', link: 'https://github.com/svetzal/hone-cli' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'First Iteration', link: '/getting-started/first-iteration' }
        ]
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Iteration Pipeline', link: '/concepts/iteration-pipeline' },
          { text: 'Agents & Principles', link: '/concepts/agents' },
          { text: 'Quality Gates', link: '/concepts/quality-gates' },
          { text: 'GitHub Mode', link: '/concepts/github-mode' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI Commands', link: '/reference/cli-commands' },
          { text: 'Configuration', link: '/reference/configuration' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/svetzal/hone-cli' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Mojility Inc.'
    },

    search: {
      provider: 'local'
    }
  }
})
