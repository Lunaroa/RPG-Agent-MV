import { createRouter, createWebHashHistory } from 'vue-router'
import { useProductPluginsStore } from '../stores/productPlugins'
import { productPluginDisabledRedirect } from '../utils/projectManagementRoute'

const WorkbenchView = () => import('../views/WorkbenchView.vue')
const DatabaseView = () => import('../views/DatabaseView.vue')
const ProjectAssetsView = () => import('../views/ProjectAssetsView.vue')
const MapOverviewView = () => import('../views/MapOverviewView.vue')
const ConsoleView = () => import('../views/ConsoleView.vue')
const PluginMarketplaceView = () => import('../views/PluginMarketplaceView.vue')
const UiDesignerView = () => import('../views/UiDesignerView.vue')

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/workbench'
    },
    {
      path: '/workbench',
      name: 'workbench',
      component: WorkbenchView
    },
    {
      path: '/database',
      name: 'database',
      component: DatabaseView
    },
    {
      path: '/project-assets',
      name: 'project-assets',
      component: ProjectAssetsView
    },
    {
      path: '/map-overview',
      name: 'map-overview',
      component: MapOverviewView,
      beforeEnter: async (to) => {
        const productPlugins = useProductPluginsStore()
        await productPlugins.load()
        if (!productPlugins.isEnabled('map-overview')) {
          return productPluginDisabledRedirect('map-overview', to.fullPath)
        }
        return true
      },
    },
    {
      path: '/plugin-marketplace',
      name: 'plugin-marketplace',
      component: PluginMarketplaceView,
    },
    {
      path: '/ui-designer',
      name: 'ui-designer',
      component: UiDesignerView,
      beforeEnter: async (to) => {
        const productPlugins = useProductPluginsStore()
        await productPlugins.load()
        if (!productPlugins.isEnabled('ui-designer')) {
          return productPluginDisabledRedirect('ui-designer', to.fullPath)
        }
        return true
      },
    },
    {
      path: '/console',
      name: 'console',
      component: ConsoleView
    },
    {
      path: '/editor',
      redirect: (to) => ({ path: '/workbench', query: to.query })
    },
    {
      path: '/chat',
      redirect: '/workbench'
    },
    {
      path: '/settings',
      redirect: '/console?page=settings'
    },
    {
      path: '/story-graph',
      redirect: '/database'
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/workbench'
    }
  ]
})

export default router
