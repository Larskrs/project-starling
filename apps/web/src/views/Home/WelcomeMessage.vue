<template>
    <div class="relative mb-8 flex flex-col">
        <h1 class="text-2xl mb-1 text-foreground font-bold">Hei {{ user?.first_name ?? user?.name }}!</h1>
        <p class="text-sm text-muted-foreground">Du kan opprette ditt eget produksjonsselskap for å komme i gang.</p>
    </div>
</template>

<script setup lang="ts">
import { useAuth } from '../../composables/useAuth';

const { user } = useAuth();
</script>
