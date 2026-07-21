import { createRouter, createWebHashHistory } from 'vue-router'

const WorkbenchView = () => import('../views/WorkbenchView.vue')
const ConsoleView = () => import('../views/ConsoleView.vue')

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
      redirect: '/console?page=story'
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/workbench'
    }
  ]
})

export default router
