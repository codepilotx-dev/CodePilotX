export const CHAT_HOME_HERO_TITLES = [
  '随时可以开始。',
  '今天想聊点什么？',
  '今天有什么安排？',
  '我们从哪里开始？',
] as const

export function createChatHomeHeroTitleRotation(): (
  locationKey: string,
) => (typeof CHAT_HOME_HERO_TITLES)[number] {
  let cursor = 0
  let lastLocationKey: string | null = null

  return locationKey => {
    if (lastLocationKey === null) {
      lastLocationKey = locationKey
    } else if (locationKey !== lastLocationKey) {
      lastLocationKey = locationKey
      cursor = (cursor + 1) % CHAT_HOME_HERO_TITLES.length
    }

    return CHAT_HOME_HERO_TITLES[cursor]
  }
}

const selectChatHomeHeroTitle = createChatHomeHeroTitleRotation()

export function getChatHomeHeroTitle(
  locationKey: string,
): (typeof CHAT_HOME_HERO_TITLES)[number] {
  return selectChatHomeHeroTitle(locationKey)
}
