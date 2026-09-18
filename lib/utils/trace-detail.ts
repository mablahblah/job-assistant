// How long a value written into a Trace row's detail may be, and the cut that
// enforces it. A rule about the Trace table rather than about any one step, so
// every step that writes a detail shares this instead of holding its own copy.
//
// The longest real job title measured is 131 characters and the longest real
// company name is 50, so 200 fits every genuine value while still cutting a
// description a collector bug put in the wrong field, or a thrown message no
// driver promises to keep short.
export const MAX_DETAIL_LENGTH = 200;

// The front of the value survives, because that is the part that identifies
// what the row is about.
export function truncateDetail(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? value.slice(0, MAX_DETAIL_LENGTH) : value;
}
