<template>
  <div class="h-[100dvh] bg-gradient-to-t from-background grid grid-cols-1 lg:grid-cols-2">
    <div class="w-full flex flex-col justify-center items-center px-4">
      <slot />
    </div>
    <div class="h-full hidden lg:block bg-gradient-to-b from-primary/25 to-background">
      <div id="auth-panel" class="h-full" />
    </div>
  </div>
</template>
