<template>
  <div class="flex items-center gap-2 rounded px-2 py-1">
    <RouterLink to="/settings" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <Avatar :id="user?.avatarImageId" class="size-7 rounded-full shrink-0">
        <span class="text-xs font-semibold">{{ user?.first_name?.charAt(0)?.toUpperCase() }}</span>
      </Avatar>
      <span class="text-sm font-medium text-muted-foreground">{{ user?.first_name ?? user?.name }}</span>
    </RouterLink>
    <Button size="xs" variant="outline" @click="logout">{{ $t('nav.logOut') }}</Button>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAuth } from '../../composables/useAuth'
import Button from '@starling/ui/Button'
import Avatar from '@starling/ui/Avatar'

const { user, logout } = useAuth()
</script>
