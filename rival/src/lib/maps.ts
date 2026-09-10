import { Linking, Platform } from 'react-native';

// Opens a free-text place in the phone's own maps app.
//
// This is a SEARCH, not a pin. Sessions store whatever someone typed ("meadow
// park", "the usual spot"), because pinning a real address would mean an
// address-autocomplete service billed per keystroke. A recognisable name lands
// on the place; a vague one lands on a search results page — which is still
// more useful than text you have to retype into another app.
export function openInMaps(place: string) {
  const q = encodeURIComponent(place.trim());
  if (!q) return;
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  Linking.openURL(url).catch(() => {});
}
