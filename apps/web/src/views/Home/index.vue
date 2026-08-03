<template>
  <main class="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
    <WelcomeMessage />
    <JumpBackIn />
    <!-- Companies drop below the projects list rather than squeezing it once
         there isn't room for both columns. -->
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_272px] gap-5 items-start">
      <ProductionList />
      <CompanyList />
    </div>
  </main>
</template>

<script setup>
import WelcomeMessage from './WelcomeMessage.vue'
import JumpBackIn     from './JumpBackIn.vue'
import ProductionList from './ProductionList.vue'
import CompanyList    from './CompanyList.vue'
</script>
