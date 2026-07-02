<script setup>
import { Avatar } from '@starling/ui'

const props = defineProps({
  member: { type: Object, required: true },
  isSelf: { type: Boolean, default: false },
})

function displayName(member) {
  return member.user.firstName
    ? `${member.user.firstName} ${member.user.lastName ?? ''}`.trim()
    : member.user.name
}
</script>

<template>
  <li class="flex items-center gap-3 px-5 py-3">
    <Avatar :id="member.user?.avatarImageId" :created-at="member.user?.createdAt" :quality="25" class="size-8 rounded-full shrink-0">
      <span class="text-xs font-semibold">{{ (member.user?.firstName || member.user?.name || '?').charAt(0).toUpperCase() }}</span>
    </Avatar>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <p class="text-sm font-medium text-foreground truncate">{{ displayName(member) }}</p>
        <span v-if="isSelf" class="text-[10px] text-muted-foreground/60 font-medium shrink-0">{{ $t('members.you') }}</span>
      </div>
      <p class="text-xs text-muted-foreground truncate">{{ member.user.email }}</p>
    </div>

    <slot />
  </li>
</template>
