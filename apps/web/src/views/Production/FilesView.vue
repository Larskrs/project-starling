<script setup>
import { inject } from 'vue'
import { StorageBrowser } from '../../components/storage'

const data = inject('production-data')
</script>

<template>
  <div class="p-6">
    <StorageBrowser :production-id="data.production.id" />
  </div>
</template>
