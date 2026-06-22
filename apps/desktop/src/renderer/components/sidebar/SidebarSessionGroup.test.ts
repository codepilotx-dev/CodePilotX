import { expect, test } from "bun:test";
import { getSidebarSessionDisplayGroups } from "./SidebarSessionGroup.js";

test("getSidebarSessionDisplayGroups keeps the first five sessions static", () => {
  const sessions = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

  expect(getSidebarSessionDisplayGroups(sessions, false)).toEqual({
    baseSessions: ["s1", "s2", "s3", "s4", "s5"],
    extraSessions: [],
    hasOverflow: true,
  });
});

test("getSidebarSessionDisplayGroups exposes overflow sessions when expanded", () => {
  const sessions = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

  expect(getSidebarSessionDisplayGroups(sessions, true)).toEqual({
    baseSessions: ["s1", "s2", "s3", "s4", "s5"],
    extraSessions: ["s6", "s7"],
    hasOverflow: true,
  });
});

test("getSidebarSessionDisplayGroups does not show a toggle for short groups", () => {
  const sessions = ["s1", "s2"];

  expect(getSidebarSessionDisplayGroups(sessions, true)).toEqual({
    baseSessions: ["s1", "s2"],
    extraSessions: [],
    hasOverflow: false,
  });
});
