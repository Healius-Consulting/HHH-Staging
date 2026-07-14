const DEFAULT_PRIMARY = '#0f766e';

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

export interface TenantTheme {
  primary: string;
  primaryHover: string;
  primaryStrong: string;
  primarySoft: string;
  primaryMuted: string;
  onPrimary: string;
  secondary: string;
  secondaryHover: string;
  secondarySoft: string;
  onSecondary: string;
  sidebar: string;
  sidebarHover: string;
  sidebarBorder: string;
  focusRing: string;
  surfaceTint: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normaliseHex(input: string) {
  const value = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${value.slice(1).split('').map(character => character.repeat(2)).join('')}`;
  return DEFAULT_PRIMARY;
}

function hexToRgb(hex: string): Rgb {
  const value = normaliseHex(hex).slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  if (hue < 0) hue += 360;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

function hslToHex({ h, s, l }: Hsl) {
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = ((h % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(section % 2 - 1));
  const match = lightness - chroma / 2;
  const [red, green, blue] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return `#${[red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(hex: string) {
  const channels = Object.values(hexToRgb(hex)).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readableText(background: string) {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#172033') ? '#ffffff' : '#172033';
}

export function deriveTenantTheme(primaryInput: string): TenantTheme {
  const primary = normaliseHex(primaryInput);
  const base = rgbToHsl(hexToRgb(primary));
  const secondaryHue = (base.h + 34) % 360;
  const secondarySaturation = clamp(base.s * 0.72, 34, 62);
  const secondaryLightness = clamp(base.l, 34, 44);
  const secondary = hslToHex({ h: secondaryHue, s: secondarySaturation, l: secondaryLightness });
  const rgb = hexToRgb(primary);

  return {
    primary,
    primaryHover: hslToHex({ ...base, l: base.l > 55 ? base.l - 8 : base.l + 6 }),
    primaryStrong: hslToHex({ ...base, s: clamp(base.s + 4, 0, 100), l: clamp(base.l - 13, 16, 38) }),
    primarySoft: hslToHex({ h: base.h, s: clamp(base.s * 0.48, 18, 62), l: 96 }),
    primaryMuted: hslToHex({ h: base.h, s: clamp(base.s * 0.58, 22, 68), l: 88 }),
    onPrimary: readableText(primary),
    secondary,
    secondaryHover: hslToHex({ h: secondaryHue, s: secondarySaturation, l: clamp(secondaryLightness - 7, 24, 48) }),
    secondarySoft: hslToHex({ h: secondaryHue, s: clamp(secondarySaturation * 0.5, 18, 46), l: 96 }),
    onSecondary: readableText(secondary),
    sidebar: hslToHex({ h: base.h, s: clamp(base.s * 0.34, 18, 34), l: 15 }),
    sidebarHover: hslToHex({ h: base.h, s: clamp(base.s * 0.38, 20, 38), l: 21 }),
    sidebarBorder: hslToHex({ h: base.h, s: clamp(base.s * 0.3, 16, 32), l: 27 }),
    focusRing: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`,
    surfaceTint: hslToHex({ h: base.h, s: clamp(base.s * 0.36, 14, 42), l: 98 }),
  };
}

export function tenantThemeVariables(primary: string) {
  const theme = deriveTenantTheme(primary);
  return {
    '--tenant-primary': theme.primary,
    '--tenant-primary-hover': theme.primaryHover,
    '--tenant-primary-strong': theme.primaryStrong,
    '--tenant-primary-soft': theme.primarySoft,
    '--tenant-primary-muted': theme.primaryMuted,
    '--tenant-on-primary': theme.onPrimary,
    '--tenant-secondary': theme.secondary,
    '--tenant-secondary-hover': theme.secondaryHover,
    '--tenant-secondary-soft': theme.secondarySoft,
    '--tenant-on-secondary': theme.onSecondary,
    '--tenant-sidebar': theme.sidebar,
    '--tenant-sidebar-hover': theme.sidebarHover,
    '--tenant-sidebar-border': theme.sidebarBorder,
    '--tenant-focus-ring': theme.focusRing,
    '--tenant-surface-tint': theme.surfaceTint,
  } as Record<`--${string}`, string>;
}

export function brandSwatchStyle(primary: string) {
  const theme = deriveTenantTheme(primary);
  return { backgroundColor: theme.primary, color: theme.onPrimary };
}
