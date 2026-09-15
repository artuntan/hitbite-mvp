/**
 * RainbowKit, re-skinned in HitBite's tokens.
 *
 * RainbowKit ships an opinionated look that has nothing to do with the rest of this app, so the
 * connect control is rebuilt from `ui/button.tsx` (see `connect-button.tsx`) and the parts we do
 * not own — the wallet-picker modal, the account modal, the chain modal — are re-coloured here.
 *
 * Every value is a `var(--token)` reference rather than a literal. Two reasons:
 *
 *  1. The app switches theme by putting `.dark` on `<html>` (next-themes). RainbowKit's own
 *     `{ lightMode, darkMode }` form compiles to a `prefers-color-scheme` media query, which would
 *     ignore an explicit light/dark choice and leave the modal in the wrong theme. A single theme
 *     whose values are custom properties inherits `.dark` like everything else does.
 *  2. When the founders replace the placeholder accent (BUILD_PROMPT 7.1), the modal changes with
 *     the rest of the app rather than being one more place to remember.
 *
 * One constraint to respect when editing: RainbowKit runs every value through a sanitiser that
 * deletes `: ; { } < / >`. `var(--x)` survives it; a literal `rgb(0 0 0 / 0.3)` would be silently
 * corrupted, which is why the shadow entries point at tokens instead of inlining the shadow.
 */

import { lightTheme, type Theme } from "@rainbow-me/rainbowkit";

const base = lightTheme();

export const hitbiteRainbowKitTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: "var(--accent)",
    accentColorForeground: "var(--accent-on)",
    actionButtonBorder: "var(--border)",
    actionButtonBorderMobile: "var(--border)",
    actionButtonSecondaryBackground: "var(--surface-sunken)",
    closeButton: "var(--muted)",
    closeButtonBackground: "var(--surface-sunken)",
    connectButtonBackground: "var(--surface)",
    connectButtonBackgroundError: "var(--danger)",
    connectButtonInnerBackground: "var(--surface-sunken)",
    connectButtonText: "var(--ink)",
    connectButtonTextError: "var(--paper)",
    connectionIndicator: "var(--success)",
    downloadBottomCardBackground: "var(--surface-sunken)",
    downloadTopCardBackground: "var(--surface)",
    error: "var(--danger)",
    generalBorder: "var(--border)",
    generalBorderDim: "var(--border)",
    menuItemBackground: "var(--surface-sunken)",
    modalBackground: "var(--surface)",
    modalBorder: "var(--border)",
    modalText: "var(--ink)",
    modalTextDim: "var(--muted)",
    modalTextSecondary: "var(--muted)",
    profileAction: "var(--surface)",
    profileActionHover: "var(--surface-sunken)",
    profileForeground: "var(--surface-sunken)",
    selectedOptionBorder: "var(--accent)",
    standby: "var(--warning)",
  },
  fonts: {
    // next/font sets --font-plex-sans on <html>; the fallbacks match globals.css.
    body: "var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif",
  },
  radii: {
    // Matches `rounded-md` on buttons and `rounded-lg` on cards.
    actionButton: "0.375rem",
    connectButton: "0.375rem",
    menuButton: "0.375rem",
    modal: "0.5rem",
    modalMobile: "0.75rem",
  },
  shadows: {
    ...base.shadows,
    connectButton: "var(--shadow-raised)",
    dialog: "var(--shadow-overlay)",
    profileDetailsAction: "var(--shadow-raised)",
    selectedOption: "var(--shadow-raised)",
    selectedWallet: "var(--shadow-raised)",
    walletLogo: "var(--shadow-raised)",
  },
};
