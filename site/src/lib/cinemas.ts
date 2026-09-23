/** A cinema as the UI needs it. Screens are formats SEEN there before, never a
 *  promise for a particular date. */
export interface Cinema {
  code: string;
  name: string;
  screens: string[];
}
