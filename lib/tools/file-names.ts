/* ---------------------------------------------------------------------------
   File names Windows refuses or mangles.

   `CON`, `NUL.txt`, `COM1.csv`… are devices, not files: created through
   the long-path API they exist but Explorer cannot open or delete them, and
   older tools write to the device. A name that ends with a dot or a space
   is silently cut by Win32 (`report.` becomes `report`), so the file the
   agent was told about is not the one on the disk. And the bidi controls
   (U+202E…) make `<U+202E>gnp.exe` DISPLAY as `exe.png`.

   Pure: shared by the browser (attachments) and the server (Write).
--------------------------------------------------------------------------- */

/** A Windows device name, with or without an extension. */
export const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)\s*(\.|$)/i;

/* Written by code point: the characters themselves are invisible in the source. */
const cp = (...codes: number[]) => String.fromCharCode(...codes);

/** The invisible characters that reorder how a name is displayed. */
export const BIDI_CONTROLS = new RegExp(`[${cp(0x061c, 0x200e, 0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, "g");

/** Why this last path segment cannot be a file name on Windows, or `null`. */
export function windowsNameProblem(name: string): string | null {
  if (WINDOWS_RESERVED.test(name)) return `"${name}" is a reserved device name on Windows`;
  if (/[. ]$/.test(name) && name !== "." && name !== "..") return `"${name}" ends with a dot or a space, which Windows drops`;
  return null;
}
