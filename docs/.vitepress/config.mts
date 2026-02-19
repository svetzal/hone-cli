import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hone',
  description: 'A CLI that hones your codebase one principle at a time',
  base: '/hone-cli/',
  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/concepts/iteration-pipeline' },
      { text: 'GitHub', link: 'https://github.com/svetzal/hone-cli' }
    ],

    sidebar: [
      {
        text: 'Overview',
        items: [
          { text: 'Home', link: '/' }
        ]
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Iteration Pipeline', link: '/concepts/iteration-pipeline' }
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
