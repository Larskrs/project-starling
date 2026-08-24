import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index'
import i18n from './i18n'
import './style.css'
import '@starling/ui/useColorMode'
// Registers the bundled MDI subset so <Icon> never round-trips to
// api.iconify.design. Must run before the first render.
import '@starling/ui/installIcons'

createApp(App).use(router).use(i18n).mount('#app')
