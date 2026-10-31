// Audience-facing speech never reads out internal control-panel instructions or
// measurement bookkeeping. Event times and useful traffic restrictions remain.
export function germanBrandingAllowed(text: string) {
  return !/\b(?:d(?:ö|oe|o)rr?schuck|dörşuk|ahd\s*(?:radio|webradio))\b/iu.test(text);
}

export function naturalRadioText(text: string) {
  return text
    .replace(/\b(?:Messstand|Abrufstand|Messzeit|Abrufzeit|Datenstand|Stand)\s*:?\s*\d{1,2}(?::\d{2})?(?:\s*Uhr(?:\s*\d{1,2})?)?\s*[.,;]?\s*/giu, "")
    .replace(/[^.!?\n]*(?:Dashboard|Radio-Panel|radyo panelimizden)[^.!?\n]*[.!?]?/giu, "")
    .replace(/(?:Die Wetterdaten kommen vom Deutschen Wetterdienst über Bright Sky|Wetterdaten:\s*Deutscher Wetterdienst,?\s*über Bright Sky|Quelle ist die Autobahn GmbH)\.?\s*/giu, "")
    .replace(/[ \t]+/g, " ").replace(/ +\n/g, "\n").trim();
}
