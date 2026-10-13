import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { registerServiceWorker } from './services/sw-client'
import './styles/main.css'

createApp(App).use(router).mount('#app')

void registerServiceWorker()
