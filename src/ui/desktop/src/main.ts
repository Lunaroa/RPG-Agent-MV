import { createApp } from 'vue'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// 本地打包字体（离线，不走联网 CDN）
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
// 设计系统必须在 Element Plus 默认样式之后导入，覆盖才生效
import './styles/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { createPinia } from 'pinia'
import router from './router'

const app = createApp(App)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(ElementPlus)
app.use(createPinia())
app.use(router)
app.mount('#app')
