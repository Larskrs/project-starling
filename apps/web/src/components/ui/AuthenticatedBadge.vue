<template>
    <div class="flex items-center space-x-2 rounded px-2.5 py-1">
        <span class="text-sm font-medium text-muted-foreground">{{ user?.first_name ?? user?.name }}</span>
        <Button size="xs" variant="outline" @click="logout">Logg ut</Button>
    </div>
</template>

<script setup lang="ts">
import { useAuth } from '../../composables/useAuth'
import Button from './Button.vue';

const { user, logout } = useAuth()
</script>