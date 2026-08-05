import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index'
import i18n from './i18n'
import './style.css'
import '@starling/ui/useColorMode'

createApp(App).use(router).use(i18n).mount('#app')
