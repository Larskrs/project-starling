<template>
  <main class="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-8">
    <WelcomeMessage />
    <RecentProductions />
    <div class="grid grid-cols-[1fr_272px] gap-5 items-start">
      <div class="flex flex-col gap-5">
        <RecentTimelines />
        <ProductionList />
      </div>
      <CompanyList />
    </div>
  </main>
</template>

<script setup>
import WelcomeMessage    from './WelcomeMessage.vue'
import RecentProductions from './RecentProductions.vue'
import RecentTimelines   from './RecentTimelines.vue'
import ProductionList    from './ProductionList.vue'
import CompanyList       from './CompanyList.vue'
</script>
