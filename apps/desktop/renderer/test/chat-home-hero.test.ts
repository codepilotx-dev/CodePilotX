import { describe, expect, test } from 'bun:test'
import {
  CHAT_HOME_HERO_TITLES,
  createChatHomeHeroTitleRotation,
} from '../src/features/session/chatHomeHero.js'

describe('Chat 新建首页标题', () => {
  test('相同 location key 保持稳定，新 key 按四句循环', () => {
    const selectTitle = createChatHomeHeroTitleRotation()

    expect(selectTitle('location-a')).toBe(CHAT_HOME_HERO_TITLES[0])
    expect(selectTitle('location-a')).toBe(CHAT_HOME_HERO_TITLES[0])
    expect(selectTitle('location-b')).toBe(CHAT_HOME_HERO_TITLES[1])
    expect(selectTitle('location-c')).toBe(CHAT_HOME_HERO_TITLES[2])
    expect(selectTitle('location-d')).toBe(CHAT_HOME_HERO_TITLES[3])
    expect(selectTitle('location-e')).toBe(CHAT_HOME_HERO_TITLES[0])
  })
})
