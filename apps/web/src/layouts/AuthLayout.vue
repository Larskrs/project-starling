<template>
  <div class="h-screen bg-background grid grid-cols-2">
    <div class="w-full flex flex-col justify-center items-center px-4">
      <slot />
    </div>
    <div id="auth-panel" class="h-full" />
  </div>
</template>
