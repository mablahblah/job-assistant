// How long a day is, in milliseconds.
//
// Shared rather than written out again. Five places needed this and spelled it
// three ways — two named it, two wrote the digits inline, and one wrote the
// digits two lines below its own name for it. None of them was wrong, which is
// the problem: nothing would have caught one of them being wrong.
//
// Every age in this codebase is an exact duration rather than a count of
// calendar days, so this is a fixed number and never asks a calendar about
// daylight saving.
export const DAY_MS = 86_400_000;
