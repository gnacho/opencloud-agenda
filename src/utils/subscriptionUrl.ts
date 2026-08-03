// `webcal://` is the conventional scheme for calendar subscriptions: Android
// offers it to a subscription app such as ICSx⁵ and iOS prompts to subscribe,
// whereas an https link is just a web link — the browser opens it and shows raw
// iCalendar text, which helps nobody.
//
// Subscriptions are always stored with http(s), because that is what fetch()
// needs; the scheme swap exists purely for handing the feed to another device.
export function toWebcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, 'webcal://')
}
