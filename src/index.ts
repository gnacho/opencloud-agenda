import { computed } from 'vue'
import { defineWebApplication } from '@opencloud-eu/web-pkg'
import type { AppMenuItemExtension, Extension } from '@opencloud-eu/web-pkg'
import { urlJoin } from '@opencloud-eu/web-client'

function getAppName(): string {
  const lang = document.documentElement.lang || navigator.language || ''
  return lang.toLowerCase().startsWith('de') ? 'Termine' : 'Agenda'
}

export default defineWebApplication({
  setup() {
    const appInfo = {
      id: 'agenda',
      name: getAppName(),
      icon: 'calendar',
    }

    const routes = [
      {
        path: '/',
        redirect: `/${appInfo.id}/month`,
      },
      {
        name: 'agenda-month',
        path: '/month',
        component: () => import('./views/CalendarView.vue'),
        meta: { authContext: 'user', title: appInfo.name },
      },
      {
        name: 'agenda-week',
        path: '/week',
        component: () => import('./views/CalendarView.vue'),
        meta: { authContext: 'user', title: appInfo.name },
      },
      {
        name: 'agenda-day',
        path: '/day',
        component: () => import('./views/CalendarView.vue'),
        meta: { authContext: 'user', title: appInfo.name },
      },
      {
        name: 'agenda-help',
        path: '/help',
        component: () => import('./views/HelpView.vue'),
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
