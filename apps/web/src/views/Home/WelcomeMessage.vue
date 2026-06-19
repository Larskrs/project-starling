<template>
    <div class="relative mb-8 flex flex-col">
        <h1 class="text-2xl mb-1 font-bold"><span class="text-muted-foreground mr-1.5">{{ hello }}</span>
            <span class="text-forground">{{ user?.first_name ?? user?.name }}!</span></h1>
        <p class="text-sm text-muted-foreground">Du kan opprette ditt eget produksjonsselskap for å komme i gang.</p>
    </div>
</template>

<script setup lang="ts">
import { useAuth } from '../../composables/useAuth';
import { helloOfDay } from '../../lib/utils';

const { user } = useAuth();
const hello = helloOfDay()
</script>
