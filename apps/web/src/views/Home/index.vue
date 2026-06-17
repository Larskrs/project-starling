<template>
  <div class="max-w-5xl flex flex-col mx-auto px-6 py-10">
    <WelcomeMessage />
    <CompanyList />
  </div>
</template>

<script setup>
import WelcomeMessage from './WelcomeMessage.vue'
import CompanyList from './CompanyList.vue'
</script>
