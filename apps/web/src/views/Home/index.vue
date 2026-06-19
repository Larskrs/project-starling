<template>
  <main class="max-w-5xl flex flex-col mx-auto px-6 py-10">
    <WelcomeMessage />

    <div class="grid grid-cols-12 gap-6 mt-12">
      <div class="col-start-1 col-end-8">
        <CompanyList />
      </div>
      <div class="col-start-8 col-end-13 border rounded-lg">

      </div>
    </div>
  </main>
</template>

<script setup>
import WelcomeMessage from './WelcomeMessage.vue'
import CompanyList from './CompanyList.vue'
</script>
