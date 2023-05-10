export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      websiteName: 'ASCII Converter',

      defaultTitle: 'ASCII Converter',
      defaultDescription: 'Turn images or video into ASCII in any terminal',
      defaultKeywords: 'ASCII'
    }
  },
  vite: {
    css: {
      preprocessorOptions: {
        sass: {
          additionalData: '@import "@/assets/sass/variables.sass"'
        },
      },
    },
  },
  nitro: {
    plugins: [
      "~/server/db.js"
    ],
    compressPublicAssets: true
  },
  modules: [
    '@nuxt/image-edge',
    '@nuxtjs/fontaine',
    'nuxt-delay-hydration'
  ],
  delayHydration: {
    // enables nuxt-delay-hydration in dev mode for testing  
    debug: process.env.NODE_ENV === 'development',
    mode: 'mount'
  }
});