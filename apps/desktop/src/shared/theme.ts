import * as radixColors from "@radix-ui/colors";
import type {
  DesktopThemeCustomTheme,
  DesktopThemeConfigV1,
  DesktopThemeFontEntry,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from "./types.js";

export const CODEPILOTX_THEME_PREFIX = "codepilotx-theme-v1:";
export const DEFAULT_LIGHT_THEME_ID = "light-codepilotx";
export const DEFAULT_DARK_THEME_ID = "dark-codepilotx";

export const DEFAULT_UI_FONT: DesktopThemeFontEntry = {
  preset: "MiSans VF Regular",
  fallback: "MiSans, Inter",
};

export const DEFAULT_CODE_FONT: DesktopThemeFontEntry = {
  preset: "JetBrains Mono",
  fallback: "Consolas, monospace",
};

export const DEFAULT_FONTS: DesktopThemeConfigV1["theme"]["fonts"] = {
  ui: DEFAULT_UI_FONT,
  code: DEFAULT_CODE_FONT,
};

export type DesktopThemePreset = {
  id: string;
  label: string;
  config: DesktopThemeConfigV1;
};

type RadixScale =
  | "blue"
  | "cyan"
  | "gray"
  | "green"
  | "iris"
  | "mauve"
  | "olive"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "sage"
  | "sand"
  | "slate";

type RadixStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

type RadixThemePresetOptions = {
  accentScale: RadixScale;
  accentStep?: RadixStep;
  codeThemeId: string;
  contrast?: number;
  fonts?: DesktopThemeConfigV1["theme"]["fonts"];
  grayScale?: RadixScale;
  inkScale?: RadixScale;
  inkStep?: RadixStep;
  opaqueWindows?: boolean;
  skillScale?: RadixScale;
  skillStep?: RadixStep;
  surfaceScale?: RadixScale;
  surfaceStep?: RadixStep;
  variant: DesktopThemeVariant;
};

const RADIX_LIGHT: Record<RadixScale, Record<string, string>> = {
  blue: radixColors.blue,
  cyan: radixColors.cyan,
  gray: radixColors.gray,
  green: radixColors.green,
  iris: radixColors.iris,
  mauve: radixColors.mauve,
  olive: radixColors.olive,
  orange: radixColors.orange,
  pink: radixColors.pink,
  purple: radixColors.purple,
  red: radixColors.red,
  sage: radixColors.sage,
  sand: radixColors.sand,
  slate: radixColors.slate,
};

const RADIX_DARK: Record<RadixScale, Record<string, string>> = {
  blue: radixColors.blueDark,
  cyan: radixColors.cyanDark,
  gray: radixColors.grayDark,
  green: radixColors.greenDark,
  iris: radixColors.irisDark,
  mauve: radixColors.mauveDark,
  olive: radixColors.oliveDark,
  orange: radixColors.orangeDark,
  pink: radixColors.pinkDark,
  purple: radixColors.purpleDark,
  red: radixColors.redDark,
  sage: radixColors.sageDark,
  sand: radixColors.sandDark,
  slate: radixColors.slateDark,
};

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 = {
  codeThemeId: "codepilotx",
  theme: {
    accent: "#0169cc",
    contrast: 40,
    fonts: DEFAULT_FONTS,
    ink: "#0d0d0d",
    opaqueWindows: true,
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#e02e2a",
      skill: "#751ed9",
    },
    surface: "#ffffff",
  },
  variant: "light",
};

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: "CodePilotX",
  theme: {
    accent: "#0169cc",
    contrast: 40,
    fonts: DEFAULT_FONTS,
    ink: "#fcfcfc",
    opaqueWindows: true,
    semanticColors: {
      diffAdded: "#00a240",
      diffRemoved: "#e02e2a",
      skill: "#b06dff",
    },
    surface: "#111111",
  },
  variant: "dark",
};

export const DEFAULT_DESKTOP_THEME_SETTINGS: DesktopThemeSettings = {
  mode: "light",
  activeThemeIds: {
    light: DEFAULT_LIGHT_THEME_ID,
    dark: DEFAULT_DARK_THEME_ID,
  },
  glassmorphismEnabled: true,
  pointerCursorEnabled: true,
  reduceMotion: "system",
  fontSizes: {
    code: 12,
    ui: 14,
  },
  customThemes: [],
  presetOverrides: {},
};

export const DESKTOP_THEME_PRESETS: DesktopThemePreset[] = [
  {
    id: DEFAULT_LIGHT_THEME_ID,
    label: "CodePilotX",
    config: DEFAULT_LIGHT_THEME,
  },
  {
    id: "light-absolutely",
    label: "Absolutely",
    config: createRadixThemePreset({
      accentScale: "orange",
      codeThemeId: "absolutely",
      grayScale: "sand",
      skillScale: "orange",
      variant: "light",
    }),
  },
  {
    id: "dark-absolutely",
    label: "Absolutely",
    config: {
      codeThemeId: "absolutely",
      theme: {
        accent: "#cc7d5e",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#f9f9f7",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#00c853",
          diffRemoved: "#ff5f38",
          skill: "#cc7d5e",
        },
        surface: "#2d2d2b",
      },
      variant: "dark",
    },
  },
  {
    id: "light-catppuccin",
    label: "Catppuccin",
    config: createRadixThemePreset({
      accentScale: "purple",
      codeThemeId: "catppuccin",
      grayScale: "mauve",
      skillScale: "purple",
      variant: "light",
    }),
  },
  {
    id: "dark-catppuccin",
    label: "Catppuccin",
    config: createRadixThemePreset({
      accentScale: "purple",
      codeThemeId: "catppuccin",
      grayScale: "mauve",
      skillScale: "purple",
      variant: "dark",
    }),
  },
  {
    id: "light-raycast",
    label: "Raycast",
    config: createRadixThemePreset({
      accentScale: "red",
      codeThemeId: "raycast",
      fonts: DEFAULT_FONTS,
      grayScale: "slate",
      skillScale: "pink",
      variant: "light",
    }),
  },
  {
    id: "dark-raycast",
    label: "Raycast",
    config: {
      codeThemeId: "raycast",
      theme: {
        accent: "#ff6363",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#fefefe",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#59d499",
          diffRemoved: "#ff6363",
          skill: "#cf2f98",
        },
        surface: "#101010",
      },
      variant: "dark",
    },
  },
  {
    id: "light-github",
    label: "GitHub",
    config: createRadixThemePreset({
      accentScale: "blue",
      codeThemeId: "github",
      fonts: DEFAULT_FONTS,
      grayScale: "gray",
      skillScale: "purple",
      variant: "light",
    }),
  },
  {
    id: "dark-github",
    label: "GitHub",
    config: createRadixThemePreset({
      accentScale: "blue",
      codeThemeId: "github",
      fonts: DEFAULT_FONTS,
      grayScale: "gray",
      skillScale: "purple",
      variant: "dark",
    }),
  },
  {
    id: "light-dracula",
    label: "Dracula",
    config: createRadixThemePreset({
      accentScale: "pink",
      codeThemeId: "dracula",
      grayScale: "mauve",
      skillScale: "pink",
      variant: "light",
    }),
  },
  {
    id: "dark-dracula",
    label: "Dracula",
    config: {
      codeThemeId: "dracula",
      theme: {
        accent: "#ff79c6",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#f8f8f2",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#50fa7b",
          diffRemoved: "#ff5555",
          skill: "#ff79c6",
        },
        surface: "#282a36",
      },
      variant: "dark",
    },
  },
  {
    id: "light-rose-pine",
    label: "Rose Pine",
    config: {
      codeThemeId: "rose-pine",
      theme: {
        accent: "#d7827e",
        contrast: 70,
        fonts: DEFAULT_FONTS,
        ink: "#575279",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#56949f",
          diffRemoved: "#797593",
          skill: "#907aa9",
        },
        surface: "#faf4ed",
      },
      variant: "light",
    },
  },
  {
    id: "dark-rose-pine",
    label: "Rose Pine",
    config: {
      codeThemeId: "rose-pine",
      theme: {
        accent: "#ea9a97",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#e0def4",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#9ccfd8",
          diffRemoved: "#908caa",
          skill: "#c4a7e7",
        },
        surface: "#232136",
      },
      variant: "dark",
    },
  },
  {
    id: DEFAULT_DARK_THEME_ID,
    label: "CodePilotX",
    config: DEFAULT_DARK_THEME,
  },
  {
    id: "light-material",
    label: "Material",
    config: createRadixThemePreset({
      accentScale: "cyan",
      codeThemeId: "material",
      grayScale: "sage",
      skillScale: "purple",
      variant: "light",
    }),
  },
  {
    id: "dark-material",
    label: "Material",
    config: {
      codeThemeId: "material",
      theme: {
        accent: "#80cbc4",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#eeffff",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#c3e88d",
          diffRemoved: "#f07178",
          skill: "#c792ea",
        },
        surface: "#212121",
      },
      variant: "dark",
    },
  },
  {
    id: "dark-everforest",
    label: "Everforest",
    config: {
      codeThemeId: "everforest",
      theme: {
        accent: "#a7c080",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#d3c6aa",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#a7c080",
          diffRemoved: "#e67e80",
          skill: "#d699b6",
        },
        surface: "#2d353b",
      },
      variant: "dark",
    },
  },
  {
    id: "dark-lobster",
    label: "Lobster",
    config: {
      codeThemeId: "lobster",
      theme: {
        accent: "#ff5c5c",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#e4e4e7",
        opaqueWindows: false,
        semanticColors: {
          diffAdded: "#22c55e",
          diffRemoved: "#ff5c5c",
          skill: "#3b82f6",
        },
        surface: "#111827",
      },
      variant: "dark",
    },
  },
  {
    id: "dark-linear",
    label: "Linear",
    config: {
      codeThemeId: "linear",
      theme: {
        accent: "#606acc",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#e3e4e6",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#69c967",
          diffRemoved: "#ff7e78",
          skill: "#c2a1ff",
        },
        surface: "#0f0f11",
      },
      variant: "dark",
    },
  },
  {
    id: "dark-night-owl",
    label: "Night Owl",
    config: {
      codeThemeId: "night-owl",
      theme: {
        accent: "#44596b",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#d6deeb",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#c5e478",
          diffRemoved: "#ef5350",
          skill: "#c792ea",
        },
        surface: "#011627",
      },
      variant: "dark",
    },
  },
  {
    id: "dark-tokyo-night",
    label: "Tokyo Night",
    config: {
      codeThemeId: "tokyo-night",
      theme: {
        accent: "#3d59a1",
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: "#a9b1d6",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#449dab",
          diffRemoved: "#914c54",
          skill: "#9d7cd8",
        },
        surface: "#1a1b26",
      },
      variant: "dark",
    },
  },
  {
    id: "light-vscode-plus",
    label: "VSCode Plus",
    config: createRadixThemePreset({
      accentScale: "blue",
      codeThemeId: "vscode-plus",
      grayScale: "slate",
      skillScale: "blue",
      variant: "light",
    }),
  },
  {
    id: "dark-vscode-plus",
    label: "VSCode Plus",
    config: createRadixThemePreset({
      accentScale: "blue",
      codeThemeId: "vscode-plus",
      grayScale: "slate",
      skillScale: "blue",
      skillStep: 11,
      surfaceStep: 2,
      variant: "dark",
    }),
  },
  {
    id: "light-terminal-green",
    label: "Terminal Green",
    config: createRadixThemePreset({
      accentScale: "green",
      codeThemeId: "codepilotx",
      grayScale: "sage",
      skillScale: "green",
      variant: "light",
    }),
  },
  {
    id: "dark-terminal-green",
    label: "Terminal Green",
    config: createRadixThemePreset({
      accentScale: "green",
      codeThemeId: "codepilotx",
      grayScale: "sage",
      skillScale: "green",
      surfaceStep: 2,
      variant: "dark",
    }),
  },
  {
    id: "light-iris-focus",
    label: "Iris Focus",
    config: createRadixThemePreset({
      accentScale: "iris",
      codeThemeId: "catppuccin",
      grayScale: "slate",
      skillScale: "iris",
      variant: "light",
    }),
  },
  {
    id: "dark-iris-focus",
    label: "Iris Focus",
    config: createRadixThemePreset({
      accentScale: "iris",
      codeThemeId: "catppuccin",
      grayScale: "slate",
      skillScale: "iris",
      surfaceStep: 2,
      variant: "dark",
    }),
  },
];

function createRadixThemePreset(
  options: RadixThemePresetOptions,
): DesktopThemeConfigV1 {
  const {
    accentScale,
    accentStep = 9,
    codeThemeId,
    contrast = 40,
    fonts = DEFAULT_FONTS,
    grayScale = "slate",
    inkScale = grayScale,
    inkStep = 12,
    opaqueWindows = true,
    skillScale = accentScale,
    skillStep = options.variant === "dark" ? 11 : 9,
    surfaceScale = grayScale,
    surfaceStep = 1,
    variant,
  } = options;

  return {
    codeThemeId,
    theme: {
      accent: radixColor(variant, accentScale, accentStep),
      contrast,
      fonts,
      ink: radixColor(variant, inkScale, inkStep),
      opaqueWindows,
      semanticColors: {
        diffAdded: radixColor(variant, "green", variant === "dark" ? 11 : 9),
        diffRemoved: radixColor(variant, "red", variant === "dark" ? 11 : 9),
        skill: radixColor(variant, skillScale, skillStep),
      },
      surface: radixColor(variant, surfaceScale, surfaceStep),
    },
    variant,
  };
}

function radixColor(
  variant: DesktopThemeVariant,
  scale: RadixScale,
  step: RadixStep,
): string {
  const palette = variant === "dark" ? RADIX_DARK : RADIX_LIGHT;
  return palette[scale][`${scale}${step}`];
}

export function getDesktopThemeForVariant(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  return getDesktopThemeForSelection(settings, variant);
}

export function getDesktopThemeForSelection(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  const themeId = getDesktopThemeIdForVariant(settings, variant);
  return (
    getDesktopThemeEntry(settings, themeId)?.config ?? getDefaultTheme(variant)
  );
}

export function getDesktopThemeIdForVariant(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): string {
  const candidateId = settings.activeThemeIds[variant];
  const candidate = getDesktopThemeEntry(settings, candidateId);
  if (candidate?.config.variant === variant) {
    return candidate.id;
  }
  return getDefaultThemeId(variant);
}

export function getDesktopThemeEntry(
  settings: DesktopThemeSettings,
  themeId: string,
): DesktopThemePreset | DesktopThemeCustomTheme | null {
  const preset = DESKTOP_THEME_PRESETS.find((item) => item.id === themeId);
  if (preset) {
    return {
      ...preset,
      config: settings.presetOverrides[preset.id] ?? preset.config,
    };
  }
  return settings.customThemes.find((item) => item.id === themeId) ?? null;
}

export function isBuiltinDesktopThemeId(themeId: string): boolean {
  return DESKTOP_THEME_PRESETS.some((item) => item.id === themeId);
}

export function createDesktopCustomTheme(
  config: DesktopThemeConfigV1,
  label: string,
  existingThemes: DesktopThemeCustomTheme[],
  sourcePresetId?: string,
): DesktopThemeCustomTheme {
  const normalizedLabel = label.trim() || config.codeThemeId || "Custom Theme";
  const baseId = `custom:${config.variant}:${slugifyThemeId(normalizedLabel)}`;
  return {
    id: uniqueCustomThemeId(baseId, existingThemes),
    label: normalizedLabel,
    config,
    ...(sourcePresetId ? { sourcePresetId } : {}),
  };
}

export function normalizeDesktopThemeSettings(
  value: unknown,
): DesktopThemeSettings {
  if (!isRecord(value)) {
    return DEFAULT_DESKTOP_THEME_SETTINGS;
  }

  const customThemes = normalizeDesktopCustomThemes(value.customThemes);
  const presetOverrides = normalizeDesktopPresetOverrides(
    value.presetOverrides,
  );
  const activeThemeIds = isRecord(value.activeThemeIds)
    ? normalizeActiveThemeIds(value.activeThemeIds, customThemes)
    : migrateLegacyActiveThemeIds(value.themes, presetOverrides);

  return {
    mode: isDesktopThemeMode(value.mode) ? value.mode : "light",
    activeThemeIds,
    glassmorphismEnabled:
      typeof value.glassmorphismEnabled === "boolean"
        ? value.glassmorphismEnabled
        : true,
    pointerCursorEnabled:
      typeof value.pointerCursorEnabled === "boolean"
        ? value.pointerCursorEnabled
        : true,
    reduceMotion: normalizeDesktopReduceMotion(value.reduceMotion),
    fontSizes: normalizeDesktopThemeFontSizes(value.fontSizes),
    customThemes,
    presetOverrides,
  };
}

function normalizeDesktopReduceMotion(
  value: unknown,
): DesktopThemeSettings["reduceMotion"] {
  return value === "system" || value === "on" || value === "off"
    ? value
    : DEFAULT_DESKTOP_THEME_SETTINGS.reduceMotion;
}

export function normalizeDesktopThemeConfig(
  value: unknown,
  variant: DesktopThemeVariant,
  fallback: DesktopThemeConfigV1 = variant === "dark"
    ? DEFAULT_DARK_THEME
    : DEFAULT_LIGHT_THEME,
): DesktopThemeConfigV1 {
  if (!isRecord(value) || !isRecord(value.theme)) {
    return fallback;
  }

  const theme = value.theme;
  const fonts = isRecord(theme.fonts) ? theme.fonts : {};
  const semanticColors = isRecord(theme.semanticColors)
    ? theme.semanticColors
    : {};
  const accent = normalizeHexColor(theme.accent, fallback.theme.accent);

  return {
    codeThemeId: isNonEmptyString(value.codeThemeId)
      ? value.codeThemeId
      : fallback.codeThemeId,
    theme: {
      accent,
      contrast: normalizeContrast(theme.contrast, fallback.theme.contrast),
      fonts: {
        code: {
          ...normalizeDesktopThemeFontEntry(
            fonts.code,
            fallback.theme.fonts.code,
          ),
          fallback: DEFAULT_CODE_FONT.fallback,
        },
        ui: {
          ...normalizeDesktopThemeFontEntry(fonts.ui, fallback.theme.fonts.ui),
          fallback: DEFAULT_UI_FONT.fallback,
        },
      },
      ink: normalizeHexColor(theme.ink, fallback.theme.ink),
      opaqueWindows:
        typeof theme.opaqueWindows === "boolean"
          ? theme.opaqueWindows
          : fallback.theme.opaqueWindows,
      semanticColors: {
        diffAdded: normalizeHexColor(
          semanticColors.diffAdded,
          fallback.theme.semanticColors.diffAdded,
        ),
        diffRemoved: normalizeHexColor(
          semanticColors.diffRemoved,
          fallback.theme.semanticColors.diffRemoved,
        ),
        skill: normalizeHexColor(
          semanticColors.skill,
          fallback.theme.semanticColors.skill,
        ),
      },
      surface: normalizeHexColor(theme.surface, fallback.theme.surface),
    },
    variant,
  };
}

export function isDesktopThemeMode(value: unknown): value is DesktopThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function isDesktopThemeVariant(
  value: unknown,
): value is DesktopThemeVariant {
  return value === "light" || value === "dark";
}

function normalizeDesktopCustomThemes(
  value: unknown,
): DesktopThemeCustomTheme[] {
  if (!Array.isArray(value)) return [];

  const normalizedThemes: DesktopThemeCustomTheme[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.config)) continue;
    const configValue = item.config;
    if (!isDesktopThemeVariant(configValue.variant)) continue;

    const config = normalizeDesktopThemeConfig(
      configValue,
      configValue.variant,
      getDefaultTheme(configValue.variant),
    );
    const label = isNonEmptyString(item.label)
      ? item.label.trim()
      : config.codeThemeId;
    const sourcePresetId =
      isNonEmptyString(item.sourcePresetId) &&
      isBuiltinDesktopThemeId(item.sourcePresetId)
        ? item.sourcePresetId
        : undefined;
    const rawId = isNonEmptyString(item.id)
      ? item.id.trim()
      : `custom:${config.variant}:${slugifyThemeId(label)}`;
    const baseId = rawId.startsWith(`custom:${config.variant}:`)
      ? rawId
      : `custom:${config.variant}:${slugifyThemeId(rawId)}`;

    normalizedThemes.push({
      id: uniqueCustomThemeId(baseId, normalizedThemes),
      label,
      config,
      ...(sourcePresetId ? { sourcePresetId } : {}),
    });
  }

  return normalizedThemes;
}

function normalizeDesktopPresetOverrides(
  value: unknown,
): Record<string, DesktopThemeConfigV1> {
  if (!isRecord(value)) return {};

  const overrides: Record<string, DesktopThemeConfigV1> = {};
  for (const preset of DESKTOP_THEME_PRESETS) {
    const overrideValue = value[preset.id];
    if (!isRecord(overrideValue)) continue;
    overrides[preset.id] = normalizeDesktopThemeConfig(
      overrideValue,
      preset.config.variant,
      preset.config,
    );
  }
  return overrides;
}

function normalizeActiveThemeIds(
  value: Record<string, unknown>,
  customThemes: DesktopThemeCustomTheme[],
): Record<DesktopThemeVariant, string> {
  return {
    light: normalizeActiveThemeId(value.light, "light", customThemes),
    dark: normalizeActiveThemeId(value.dark, "dark", customThemes),
  };
}

function normalizeActiveThemeId(
  value: unknown,
  variant: DesktopThemeVariant,
  customThemes: DesktopThemeCustomTheme[],
): string {
  if (typeof value !== "string") return getDefaultThemeId(variant);
  const preset = DESKTOP_THEME_PRESETS.find(
    (item) => item.id === value && item.config.variant === variant,
  );
  if (preset) return preset.id;
  const customTheme = customThemes.find(
    (item) => item.id === value && item.config.variant === variant,
  );
  return customTheme?.id ?? getDefaultThemeId(variant);
}

function migrateLegacyActiveThemeIds(
  value: unknown,
  presetOverrides: Record<string, DesktopThemeConfigV1>,
): Record<DesktopThemeVariant, string> {
  const themes = isRecord(value) ? value : {};
  return {
    light: migrateLegacyThemeId(themes.light, "light", presetOverrides),
    dark: migrateLegacyThemeId(themes.dark, "dark", presetOverrides),
  };
}

function migrateLegacyThemeId(
  value: unknown,
  variant: DesktopThemeVariant,
  presetOverrides: Record<string, DesktopThemeConfigV1>,
): string {
  if (!isRecord(value)) return getDefaultThemeId(variant);
  const config = normalizeDesktopThemeConfig(
    value,
    variant,
    getDefaultTheme(variant),
  );
  const matchingPreset = DESKTOP_THEME_PRESETS.find(
    (preset) =>
      preset.config.variant === variant && themesEqual(preset.config, config),
  );
  if (matchingPreset) return matchingPreset.id;

  const themeId = getDefaultThemeId(variant);
  presetOverrides[themeId] = config;
  return themeId;
}

function getDefaultThemeId(variant: DesktopThemeVariant): string {
  return variant === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
}

function getDefaultTheme(variant: DesktopThemeVariant): DesktopThemeConfigV1 {
  return variant === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}

function themesEqual(
  left: DesktopThemeConfigV1,
  right: DesktopThemeConfigV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueCustomThemeId(
  baseId: string,
  existingThemes: DesktopThemeCustomTheme[],
): string {
  const usedIds = new Set([
    ...DESKTOP_THEME_PRESETS.map((item) => item.id),
    ...existingThemes.map((item) => item.id),
  ]);
  if (!usedIds.has(baseId)) return baseId;

  let index = 2;
  let candidate = `${baseId}-${index}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }
  return candidate;
}

function slugifyThemeId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "theme";
}

function normalizeContrast(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeDesktopThemeFontEntry(
  value: unknown,
  fallback: DesktopThemeFontEntry,
): DesktopThemeFontEntry {
  if (typeof value === "string") {
    return {
      preset: value.trim(),
      fallback: fallback.fallback,
    };
  }
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    preset: isNonEmptyString(value.preset)
      ? value.preset.trim()
      : fallback.preset,
    fallback: isNonEmptyString(value.fallback)
      ? value.fallback.trim()
      : fallback.fallback,
  };
}

export function exportDesktopThemeConfig(config: DesktopThemeConfigV1): {
  codeThemeId: string;
  theme: DesktopThemeConfigV1["theme"];
  variant: string;
} {
  return {
    codeThemeId: config.codeThemeId,
    theme: config.theme,
    variant: config.variant,
  };
}

function normalizeDesktopThemeFontSizes(
  value: unknown,
): DesktopThemeSettings["fontSizes"] {
  const fontSizes = isRecord(value) ? value : {};
  return {
    code: normalizeFontSize(fontSizes.code, 12, 10, 20),
    ui: normalizeFontSize(fontSizes.ui, 14, 11, 20),
  };
}

function normalizeFontSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
