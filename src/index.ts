import { computed } from 'vue'
import { defineWebApplication } from '@opencloud-eu/web-pkg'
import type { AppMenuItemExtension, Extension } from '@opencloud-eu/web-pkg'
import { urlJoin } from '@opencloud-eu/web-client'
import { APP_ID } from '@/constants'

function getAppName(): string {
  const lang = document.documentElement.lang || navigator.language || ''
  return lang.toLowerCase().startsWith('de') ? 'Termine' : 'Agenda'
}

export default defineWebApplication({
  setup() {
    const appInfo = {
      id: APP_ID,
      name: getAppName(),
      icon: 'calendar',
    }

    const routes = [
      {
        path: '/',
        redirect: `/${appInfo.id}/month`,
      },
      {
        name: `${APP_ID}-month`,
        path: '/month',
        component: () => import('./views/CalendarView.vue'),
        meta: { authContext: 'user', title: appInfo.name },
      },
      {
        name: `${APP_ID}-week`,
        path: '/week',
        component: () => import('./views/CalendarView.vue'),
        meta: { authContext: 'user', title: appInfo.name },
      },
      {
        name: `${APP_ID}-day`,
        path: '/day',
        component: () => import('./views/CalendarView.vue'),
        meta: { authContext: 'user', title: appInfo.name },
      },
    ]

    const extensions = computed<Extension[]>(() => {
      const menuItems: AppMenuItemExtension[] = [
        {
          id: `app.${appInfo.id}.menuItem`,
          type: 'appMenuItem',
          label: () => getAppName(),
          icon: appInfo.icon,
          path: urlJoin(appInfo.id),
        },
      ]
      return [...menuItems]
    })

    return {
      appInfo,
      routes,
      extensions,
    }
  },
})
