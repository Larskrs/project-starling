<script setup lang="ts">
import { onMounted } from 'vue';
import AuthenticatedBadge from '../components/ui/AuthenticatedBadge.vue';
import { useAuth } from '../composables/useAuth';

const { fetchUser } = useAuth();

onMounted(async () => {
  await fetchUser();
});
</script>

<template>
  <div class="relative w-full flex flex-col h-full">
    <div class="max-w-5xl mx-auto">
      <div class="relative h-full px-6 py-3 flex flex-row gap-4 items-center">
        <a class="text-muted-foreground hover:text-foreground" href="/app/home">Hjem</a>  
        <a class="text-muted-foreground hover:text-foreground" href="/app/chat">Chat</a> 
        <a class="text-muted-foreground hover:text-foreground" href="/app/settings">Innstillinger</a>
        <authenticated-badge />
      </div>
    </div>
    <div class="">    
      <slot />
    </div>
  </div>
</template>
  