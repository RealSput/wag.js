# wag.js
wa-spwn, except rewritten for G.js + is runtime

# What is this?
This basically compiles WASM to a G.js result. If you don't know what [G.js](https://github.com/RealSput/g.js) is, it's basically SPWN except a JS library.
You can also compile C to a G.js result with this using the `compile_c` function.

# Show an example.
```js
const wag = require('./wag');
// WASM to G.js
let wat = `(module
    ;; add(a, b) returns a+b
    (func $add (export "add") (param $a i32) (param $b i32) (result i32)
        (i32.add (local.get $a) (local.get $b))
    )
)`;

let exports = wag.compile(wat);
exports.add(5, 10);

// C to G.js
let c_program = `int add(int a, int b) {
  return a + b;
}`

let exports = wag.compile_c(c_program);
console.log(exports); // exported function should be shown here

console.log($.getLevelString()) // prints level string
```
