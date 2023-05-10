<template>
  <div>
    <section id="hero">
      <div id="center">
        <h1>Oops! We encountered an issue</h1>
        <p>Please report your issue through our <NuxtLink no-prefetch to="/contact">contact</NuxtLink> form.</p>
      </div>
    </section>
    <section id="bottom">
      <button @click="handleError">Go Back!</button>
    </section>
  </div>
</template>

<script setup>
const config = useRuntimeConfig();
const props = defineProps({
  error: Object
});

const handleError = () => clearError({ redirect: '/' });
</script>

<style lang="sass" scoped>
#hero
  position: relative
  width: 100%
  height: 45vh
  background-color: $color-2

  #center
    position: absolute
    width: 1200px
    height: auto
    left: 50%
    top: 50%
    transform: translate(-50%, -50%)
    
    @media screen and (max-width: 1300px)
      width: 80%
      
    @media screen and (max-width: 400px)
      width: 90%

    h1
      margin: 0px
      color: $color-4
      font-size: 3em
      
      @media screen and (max-width: 800px)
        font-size: 2.75em
      
      @media screen and (max-width: 600px)
        font-size: 2.25em
      
      @media screen and (max-width: 400px)
        font-size: 1.75em
        text-align: center

    p
      margin: 20px 0px 0px 2.5px
      color: $white-2
      font-weight: 400
      font-size: 1.2em
      
      @media screen and (max-width: 600px)
        font-size: 1.1em
      
      @media screen and (max-width: 400px)
        font-size: 1em
        text-align: center

    a
      color: $color-4
      transition: 0.25s

    a:hover
      color: $color-5

#bottom
  width: 100%
  height: 49vh

  button
    position: relative
    left: 50%
    top: 50%
    transform: translate(-50%, -50%)
    font-size: 1.25em
    padding: 25px 75px
    border: none
    transition: 0.25s
    background-color: $color-2
    color: $white-2
    border-radius: 5px
    margin: 0px

    @media screen and (max-width: 300px)
      padding: 20px 50px
      font-size: 1.2em

    @media screen and (max-width: 200px)
      padding: 15px 40px
      font-size: 1.1em

  button:hover
    cursor: pointer
    background-color: $color-3
</style>