import { createApp } from 'vue'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import DocumentationView from './views/DocumentationView.vue'

const language = new URLSearchParams(window.location.search).get('language') === 'zh-CN' ? 'zh-CN' : 'en-US'

createApp(DocumentationView, { initialLanguage: language }).mount('#app')
