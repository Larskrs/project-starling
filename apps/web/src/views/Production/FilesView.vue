<script setup>
import { inject } from 'vue'
import FileExplorer from '../../components/storage/FileExplorer.vue'

const data = inject('production-data')
</script>

<template>
  <div class="p-6">
    <FileExplorer :production-id="data.production.id" />
  </div>
</template>
