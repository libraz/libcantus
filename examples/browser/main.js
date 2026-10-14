// Bundle this file with a tool that targets es2022 or later (top-level await in the package).
import { detectChordBest } from '@libraz/libcantus-wasm';

const chord = detectChordBest([60, 64, 67]);
document.getElementById('out').textContent = JSON.stringify(chord, null, 2);
