// Build flavour: the desktop and Android app. The player's own clock sets the
// day, and the first run asks for a callsign. Android runs these same files.
export const BUILD = { desktop: true, android: /Android/.test(navigator.userAgent), call: '' };
