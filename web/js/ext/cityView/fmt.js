// Number formatting for the City View. format.js already rolls a value over to the next unit (999.6 mil reads 1 M,
// never 1000 mil), so these are the shared helpers under the names the City View imports.
export { compact, money, yieldValue, popShort } from "../../format.js";
