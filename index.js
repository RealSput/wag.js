const parser = require("@webassemblyjs/wast-parser");
const fetch = require('node-fetch');
const vctr = require('./vctr');
const fs = require("fs");

let add_stack = (arr) => {
    arr.read_top((index) => {
        if (index > 1) {
            let top_counter = arr.array[index - 1];
            top_counter.add_to(arr.array[index - 2])
        }
    })
}

let c_to_wat = async (code) => {
  let r = await fetch(
    "https://wasmexplorer-service.herokuapp.com/service.php",
    {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        "sec-ch-ua":
          '"Google Chrome";v="105", "Not)A;Brand";v="8", "Chromium";v="105"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
      },
      referrer: "https://mbebenita.github.io/",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: `input=${encodeURIComponent(
        code
      )}&action=cpp2wast&options=-std%3Dc%2B%2B11%20-Os`,
      method: "POST",
      mode: "cors",
      credentials: "omit",
    }
  );
  r = await r.text();
  /*
extern "C" {
  extern void add_object(int x_position, int y_position, int id);
}
  */
  return r;
};

function wat_to_spwn(code) {
  let memory = `let _M = vctr.create(10); _M.display(50, 50);`;
  const stack = `let _S = vctr.create(10); _S.display(15, 15);`;

  let res = [`let _E = {};`];
  let num_args = {};
  let import_funcs = {};
  const ast = parser.parse(code);

  const resolveArgs = (a) => {
    if (a) {
      return a
        .map((x) => {
          if (x.instrArgs) resolveArgs(x.instrArgs);
          switch (x.type) {
            case "Instr":
              let r = process(x, true, false);
              res.push(r);
              return null;
              break;
            case "NumberLiteral":
              return { type: x.type, value: x.value };
              break;
            case "FloatLiteral":
              return { type: x.type, value: x.value };
              break;
            case "Identifier":
              return !isNaN(x.value)
                ? { value: "_" + x.value }
                : { value: x.value };
              break;
            case "CallInstruction":
              res.push(
                `_S.push(${check_num(x.index.value).replaceAll('.', '_')}([${"_S.pop(), "
                  .repeat(num_args[check_num(x.index.value).replaceAll('.', '_')])
                  .slice(0, -2)}].reverse()));`
              );
              break;
            case "ValtypeLiteral":
              return x;
              break;
            default:
              console.log("Unknown keyword:", x.type);
              break;
          }
        })
        .filter((x) => x !== null);
    }
  };

  let check_num = (x) => (!isNaN(x) ? "_" + x : x);
  let current_fn = null;
  let cfn_args_ln = null;

  let queried = null;

  let func_types = {};

  const process = (ast, isSingle = false, push = true) => {
    let unused_ids = 0;
    if (!isSingle) {
      if (queried) {
        res.push(queried);
        queried = null;
      }
      ast.body[0].fields.forEach((x, i) => {
        switch (x.type) {
          case "Memory":
            memory = `let _M = Array(${x.limits.min * 65536});`;
            break;
          case "Func":
            // console.log(x);
            let signature = x.type == "Signature" ? x : x.signature;

            if (signature.value) {
              signature.params = func_types[x.signature.value].params.map(
                (x, i) => (x.id ? x : { ...x, id: i })
              );
            } else {
              signature.params = signature.params.map((x, i) =>
                x.id ? x : { ...x, id: i }
              );
            }

            res.push(
              `let ${check_num(x.name.value).replaceAll('.', '_')} = (${signature.params
                .map((x) => check_num(x.id).replaceAll('.', '_'))
                .join(", ")}) => {`
            );
            current_fn = x.name.value;
            signature.params = signature.params.map((x) =>
              !x.id ? unused_ids.toString() : x.id
            );
            unused_ids++;
            cfn_args_ln = signature.params;
            x.body.forEach((z) => {
              process(z, true);
            });
            res.push("};");
            break;
          case "ModuleExport":
            if (x.descr.exportType == "Func") {
              queried = `_E['${x.name}'] = ${check_num(x.descr.id.value)};`;
            } else if (x.descr.exportType == "Memory") {
              res.push(`_E['${x.name}'] = _M;`);
            } else {
              queried = `_E['${x.name}'] = ${check_num(x.descr.id.value)};`;
            }
            break;
          case "Table":
            // x.limits.min
            res.push(`_T = Array(${x.limits.min});`);
            break;
          case "ModuleImport":
            if (x.descr.signature.value) {
              x.descr.signature = func_types[x.descr.signature.value];
            };

            x.descr.id.value = check_num(x.descr.id.value).replaceAll('.', '_')
            num_args[x.descr.id.value] = x.descr.signature.params.length;
            res.push(
              `let ${x.descr.id.value} = import_map["${x.module}"]["${x.name}"];`
            );
            break;
          case "Data":
            let offset = x.offset.args[0].value;
            let data = x.init.values
              .map((x) => String.fromCharCode(x))
              .join("");
            res.push(`_M[${offset}] = "${data}";`);
            break;
          case "TypeInstruction":
            func_types[x.id.value] = x.functype;
            break;
          default:
            console.log("Unknown keyword:", x.type);
            break;
        }
        if (i == ast.body[0].fields.length - 1 && queried) {
          res.push(queried);
        }
      });
    } else {
      let full = (ast.object ? ast.object + "." : "") + ast.id;
      ast.args = resolveArgs(ast.args);

      let localGet = (ast) => {
        if (ast.args[0].type == "NumberLiteral") {
          let isInt = !isNaN(ast.args[0].value)
            ? "_" + ast.args[0].value
            : ast.args[0].value;
          if (push) res.push(`_S.push(${isInt.replaceAll('.', '_')});`);
          return `_S.push(${isInt})`;
        } else if (ast.args[0].type == "FloatLiteral") {
          let val = cfn_args_ln[ast.args[0].value];
          val = !isNaN(val) ? "_" + val : val;
          if (push) res.push(`_S.push(${val.replaceAll('.', '_')});`);
          return `_S.push(${val.replaceAll('.', '_')})`;
        } else {
          let isInt = !isNaN(ast.args[0].value)
            ? "_" + ast.args[0].value
            : ast.args[0].value;
          if (push) res.push(`_S.push(${isInt});`);
          return `_S.push(${isInt.replaceAll('.', '_')});`;
        }
      };

      if (ast.instrArgs) ast.instrArgs = resolveArgs(ast.instrArgs);
      switch (full) {
        case "local.get":
          return localGet(ast);
          break;
        case "get_local": // polyfill
          return localGet(ast);
          break;
        case "i32.const":
          if (push) res.push(`_S.push(${ast.args[0].value});`);
          return `_S.push(${ast.args[0].value});`;
          break;
        case "i32.add":
          if (push) res.push(`add_stack(_S);`);
          return `add_stack(_S);`;
          break;
        case "i32.mul":
          if (push) res.push(`_S.push(pop_second() * _S.pop());`);
          return `_S.push(pop_second() * _S.pop());`;
          break;
        case "i32.lt":
          if (push) res.push(`_S.push(1 if pop_second() < _S.pop() else 0);`);
          return `_S.push(1 if pop_second() < _S.pop() else 0);`;
          break;
        case "i32.store":
          // console.log(ast);
          let offset = ast.namedArgs
            ? ast.namedArgs.offset.value
            : `pop_second()`;
          res.push(`_M[${offset}] = _S.pop();`);
          break;
        case "i32.load":
          let off = ast.namedArgs ? ast.namedArgs.offset.value : `pop_second()`;
          if (push) res.push(`_S.push(_M[${off} + _S.pop()]);`);
          return `_S.push(_M[${off} + _S.pop()]);`;
          break;
        case "i32.sub":
          if (push) res.push(`_S.push(pop_second() - _S.pop());`);
          return `_S.push(pop_second() - _S.pop());`;
          break;
        case "i32.eqz":
          if (push) res.push(`_S.push((_S.pop()) == 0 as @number);`);
          return `_S.push((_S.pop()) == 0 as @number);`;
          break;
        case "f32.const":
          if (push) res.push(`_S.push(${ast.args[0].value});`);
          return `_S.push(${ast.args[0].value});`;
          break;
        case "f32.add":
          if (push) res.push(`_S.push(_S.pop() + _S.pop());`);
          return `_S.push(_S.pop() + _S.pop());`;
          break;
        case "f32.sub":
          if (push) res.push(`_S.push(pop_second() - _S.pop());`);
          return `_S.push(pop_second() - _S.pop());`;
          break;
        case "f32.lt":
          if (push) res.push(`_S.push(1 if pop_second() < _S.pop() else 0);`);
          return `_S.push(1 if pop_second() < _S.pop() else 0);`;
          break;
        case "f64.const":
          if (push) res.push(`_S.push(${ast.args[0].value});`);
          return `_S.push(${ast.args[0].value});`;
          break;
        case "f64.add":
          if (push) res.push(`_S.push(_S.pop() + _S.pop());`);
          return `_S.push(_S.pop() + _S.pop());`;
          break;
        case "f64.sub":
          if (push) res.push(`_S.push(pop_second() - _S.pop());`);
          return `_S.push(pop_second() - _S.pop());`;
          break;
        case "f64.lt":
          if (push) res.push(`_S.push(1 if pop_second() < _S.pop() else 0);`);
          return `_S.push(1 if pop_second() < _S.pop() else 0);`;
          break;
        case "drop":
          if (push) res.push(`_S.pop();`);
          return `_S.pop();`;
          break;
        case "call":
          if (push)
            res.push(
              `_S.push(${check_num(ast.index.value).replaceAll('.', '_')}([${"_S.pop(), "
                .repeat(num_args[check_num(ast.index.value).replaceAll('.', '_')])
                .slice(0, -2)}].reverse()));`
            );
          return `_S.push(${check_num(ast.index.value).replaceAll('.', '_')}([${"_S.pop(), "
            .repeat(num_args[check_num(ast.index.value).replaceAll('.', '_')])
            .slice(0, -2)}].reverse()));`
          break;
        case "local":
          if (push) res.push(`let ${ast.args[0].value};`);
          return `let ${ast.args[0].value};`;
          break;
        case "tee_local":
          res.push(`${check_num(ast.args[0].value).replaceAll('.', '_')} = _S.pop();`);
          break;
        case "local.tee":
          res.push(`${check_num(ast.args[0].value).replaceAll('.', '_')} = _S.pop();`);
          break;
        case "if":
          if (ast.test.length > 0) resolveArgs(ast.test);
          if (push) {
            res.push(`if (_S.pop() == 1) { `);
            ast.consequent.forEach((x) => process(x, true, push));
            res.push(`}`);
            if (ast.alternate.length > 0) {
              res.push(`else {`);
              ast.alternate.forEach((x) => process(x, true, push));
              res.push(`};`);
            }
          } else if (!push && consequent.length > 0) {
            let res2 = [];
            ast.consequent.forEach((x) => process(x, true, push));
            res2.push(`}`);
            if (ast.alternate.length > 0) {
              res2.push(`else {`);
              ast.alternate.forEach((x) => process(x, true, push));
              res2.push(`};`);
            }
            return res2.join("\n");
          }
          break;
        case "block":
          if (push) {
            res.push(`${ast.label.value} = () {`);
            ast.instr.forEach((x) => process(x, true, push));
            res.push(`};`, `${ast.label.value}();`);
          }
          break;
        case "br_if":
          // WORK IN PROGRESS, NOT FINISHED
          if (push) res.push(`if (_S.pop() == 1) { return };`);

          break;
        default:
          console.log("Unknown instruction: " + full);
          break;
      }
    }
  };

  process(ast);
  res.push(`_E;`);
  return (
    `${stack} ${memory} ${res.join(" ")}`
  );
}

let compile_c = (c) => (async () => eval(wat_to_spwn(await c_to_wat(c))))();

module.exports = { compile_c, compile }
