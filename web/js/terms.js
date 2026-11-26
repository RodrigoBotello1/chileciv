// Words for the map being shown. The same code serves the Santiago Metropolitan Region map (a "state" is a
// provincia, the whole map is la región) and the Chile map (a "state" is a región, the whole map is Chile).
// The page picks one with <html data-map="rm|chile">; it is read once, synchronously, at import time.
// Nation phrases are whole phrases because dropping the article ("la región" -> "Chile") cannot be done word by word.

const WORDS = {
  rm: {
    state: "provincia", states: "provincias", State: "Provincia", States: "Provincias",
    nation: "la región", Nation: "La región",
    ofNation: "de la región", inNation: "en la región",
    nationShort: "región", NationShort: "Región",
    nationName: "Región Metropolitana", theNationName: "la Región Metropolitana",
    nationFull: "Región Metropolitana de Santiago", theNationFull: "la Región Metropolitana de Santiago",
    regional: "regional",
    outsideLands: "Valparaíso, O'Higgins y Argentina",
  },
  chile: {
    state: "región", states: "regiones", State: "Región", States: "Regiones",
    nation: "Chile", Nation: "Chile",
    ofNation: "de Chile", inNation: "en Chile",
    nationShort: "Chile", NationShort: "Chile",
    nationName: "Chile", theNationName: "Chile",
    nationFull: "Chile", theNationFull: "Chile",
    regional: "nacional",
    outsideLands: "Argentina, Bolivia y Perú",
  },
};

const map = (typeof document !== "undefined" && document.documentElement?.dataset?.map) || "rm";

export const MAP_ID = WORDS[map] ? map : "rm";
export const T = WORDS[MAP_ID];
