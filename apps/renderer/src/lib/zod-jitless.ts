import { z } from 'zod';

// The page's Content-Security-Policy refuses eval, as it should. Zod asks whether it may compile
// its checks with `new Function("")` at its first parse of an object: the throw is caught, but
// the browser reports the refusal in the console all the same (#61). Told to run without
// compiling, zod never asks.
z.config({ jitless: true });
