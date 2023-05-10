<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<script setup>
const config = useRuntimeConfig();

useHead({
  htmlAttrs: {
    lang: 'en'
  },
  title: config.public.defaultTitle,
  meta: [
    {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1'
    },
    {
      charset: 'utf-8'
    },
    {
      name: 'description',
      content: config.public.defaultDescription
    },
    {
      name: 'keywords',
      content: config.public.defaultKeywords
    },
    {
      name: 'application-name',
      content: config.public.websiteName
    },
    {
      'http-equiv': 'Content-Language',
      content: 'en_US'
    },
    {
      'http-equiv': 'X-UA-Compatible',
      content: 'IE=edge'
    },
    {
      'http-equiv': 'Content-Security-Policy',
      content: "base-uri 'self'"
    },
    {
      property: 'og:title',
      content: config.public.defaultTitle
    },
    {
      property: 'og:description',
      content: config.public.defaultDescription
    },
    {
      property: 'og:site_name',
      content: config.public.websiteName
    },
    {
      property: 'og:locale',
      content: 'en_US'
    },
    {
      property: 'og:type',
      content: 'website'
    },
    {
      property: 'og:logo',
      content: '/images/logo.png'
    },
    {
      property: 'og:logo:type',
      content: 'image/png'
    },
    {
      property: 'og:logo:width',
      content: '500'
    },
    {
      property: 'og:logo:height',
      content: '500'
    }
  ],
  link: [
    {
      rel: 'icon',
      href: '/favicon.ico',
      sizes: 'any'
    },
    {
      rel: 'icon',
      href: '/favicon.svg',
      type: 'image/svg+xml'
    },
    {
      rel: 'preload',
      href: '/fonts/Gotham-Book.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    },
    {
      rel: 'preload',
      href: '/fonts/Poppins-Bold-Comp.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous'
    }
  ]
});
</script>

<style lang="sass">
html
  scroll-behavior: smooth

body
  font-family: Gotham, sans-serif
  -webkit-font-smoothing: antialiased
  -moz-osx-font-smoothing: grayscale
  color: $color-1
  background-color: $white-2
  -webkit-tap-highlight-color: transparent
  margin: 0px

h1, h2, h3, h4, h5, h6
  font-family: Poppins, sans-serif

p
  font-size: 1em
  line-height: 1.25em

a
  font-size: 1em
</style>