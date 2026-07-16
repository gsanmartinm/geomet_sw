/**
 * GeoMet V1 — Evaluador de Fórmulas para Variables Calculadas
 *
 * Parser/evaluador propio (sin eval()/Function()) para fórmulas del tipo
 * "[CUS] / [CUT]" o "([CUT] - 0.2) * 1000", usadas por el panel "Variables
 * Calculadas" (Filtros & Secciones) para generar atributos nuevos en función
 * de los ya cargados (Modelo de Bloques, Sondajes, Muestras Metalúrgicas).
 *
 * Por qué un parser propio y no eval()/Function() + reemplazo de texto:
 * los nombres reales de atributos suelen tener espacios, puntos, paréntesis
 * o "%" (ej. "Ext. Cu Ripios Sol(%)"), lo que rompe cualquier estrategia de
 * sustituir texto directo en una expresión JS. Acá las variables se escriben
 * entre corchetes — [Ext. Cu Ripios Sol(%)] — así el nombre completo, con
 * cualquier carácter, se captura de forma inequívoca sin tener que
 * sanitizarlo ni adivinar dónde termina.
 *
 * Gramática soportada (precedencia estándar, potencia asociativa a derecha):
 *   expr   := term (('+' | '-') term)*
 *   term   := pow (('*' | '/') pow)*
 *   pow    := unary ('^' pow)?
 *   unary  := ('+' | '-') unary | atom
 *   atom   := NUMBER | '[' NOMBRE ']' | '(' expr ')'
 *
 * Propagación de nulos: evaluate() devuelve `null` (no `NaN`/`Infinity`) en
 * cuanto CUALQUIER variable de entrada es nula o el resultado queda
 * indefinido (ej. división por cero) — el llamador decide cómo representar
 * "sin dato" en el array/objeto de salida (-999 para Bloques/Muestras, null
 * para Sondajes, ver app.js).
 */

// ==========================================
// TOKENIZER
// ==========================================
function tokenize(formula) {
  const tokens = [];
  let i = 0;
  const n = formula.length;

  while (i < n) {
    const c = formula[i];

    if (/\s/.test(c)) { i++; continue; }

    if (c === '[') {
      const end = formula.indexOf(']', i + 1);
      if (end === -1) {
        throw new Error(`Falta el corchete de cierre "]" para la variable que empieza en la posición ${i + 1}.`);
      }
      const name = formula.slice(i + 1, end).trim();
      if (!name) {
        throw new Error(`Nombre de variable vacío en la posición ${i + 1}. Usá [NombreDelAtributo].`);
      }
      tokens.push({ type: 'VAR', value: name });
      i = end + 1;
      continue;
    }

    if (/[0-9.]/.test(c)) {
      let j = i;
      let seenDot = false;
      while (j < n && (/[0-9]/.test(formula[j]) || (formula[j] === '.' && !seenDot))) {
        if (formula[j] === '.') seenDot = true;
        j++;
      }
      const numStr = formula.slice(i, j);
      const num = parseFloat(numStr);
      if (isNaN(num)) {
        throw new Error(`Número inválido: "${numStr}".`);
      }
      tokens.push({ type: 'NUM', value: num });
      i = j;
      continue;
    }

    if (c === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
    if ('+-*/^'.includes(c)) { tokens.push({ type: 'OP', value: c }); i++; continue; }

    throw new Error(`Carácter no reconocido: "${c}" en la posición ${i + 1}. Para referirte a un atributo usá [Nombre].`);
  }

  tokens.push({ type: 'EOF', value: null });
  return tokens;
}

// ==========================================
// PARSER (recursive descent) -> AST
// ==========================================
function parse(formula) {
  if (typeof formula !== 'string' || formula.trim() === '') {
    throw new Error('La fórmula no puede estar vacía.');
  }

  const tokens = tokenize(formula);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function describeToken(t) {
    if (t.type === 'EOF') return 'el final de la fórmula';
    return `"${t.value}"`;
  }

  function parseExpr() {
    let node = parseTerm();
    while (peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      node = { type: 'binop', op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parsePow();
    while (peek().type === 'OP' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      node = { type: 'binop', op, left: node, right: parsePow() };
    }
    return node;
  }

  function parsePow() {
    const node = parseUnary();
    if (peek().type === 'OP' && peek().value === '^') {
      next();
      return { type: 'binop', op: '^', left: node, right: parsePow() }; // asociativo a derecha
    }
    return node;
  }

  function parseUnary() {
    if (peek().type === 'OP' && (peek().value === '-' || peek().value === '+')) {
      const op = next().value;
      const node = parseUnary();
      return op === '-' ? { type: 'neg', node } : node;
    }
    return parseAtom();
  }

  function parseAtom() {
    const t = peek();
    if (t.type === 'NUM') { next(); return { type: 'num', value: t.value }; }
    if (t.type === 'VAR') { next(); return { type: 'var', name: t.value }; }
    if (t.type === 'LPAREN') {
      next();
      const node = parseExpr();
      if (peek().type !== 'RPAREN') {
        throw new Error(`Falta un paréntesis de cierre ")" cerca de ${describeToken(peek())}.`);
      }
      next();
      return node;
    }
    throw new Error(`Fórmula inválida cerca de ${describeToken(t)}. Se esperaba un número, una variable [Nombre] o un paréntesis.`);
  }

  const ast = parseExpr();
  if (peek().type !== 'EOF') {
    throw new Error(`Símbolo inesperado: ${describeToken(peek())}. ¿Falta un operador entre dos términos?`);
  }
  return ast;
}

// ==========================================
// UTILIDADES SOBRE EL AST
// ==========================================
/**
 * Recolecta los nombres de todas las variables [Nombre] referenciadas en la
 * fórmula, para poder validarlas contra los atributos disponibles de la capa
 * ANTES de recorrer millones de filas.
 */
function collectVarNames(ast, out) {
  out = out || new Set();
  if (!ast) return out;
  if (ast.type === 'var') out.add(ast.name);
  else if (ast.type === 'binop') { collectVarNames(ast.left, out); collectVarNames(ast.right, out); }
  else if (ast.type === 'neg') collectVarNames(ast.node, out);
  return out;
}

/**
 * Evalúa el AST para UNA fila/registro. `lookup(varName)` debe devolver un
 * número finito, o `null`/`undefined`/`NaN` si ese registro no tiene dato
 * para esa variable — el llamador es responsable de traducir la convención
 * de "sin dato" de su capa (-999 en Bloques/Muestras, null en Sondajes) a
 * ese contrato antes de llamar a evaluate().
 *
 * Devuelve un número finito, o `null` si cualquier variable de entrada era
 * nula, o si la operación no está definida (ej. división por cero).
 */
function evaluate(ast, lookup) {
  switch (ast.type) {
    case 'num':
      return ast.value;

    case 'var': {
      const raw = lookup(ast.name);
      if (raw === null || raw === undefined || (typeof raw === 'number' && isNaN(raw))) return null;
      return raw;
    }

    case 'neg': {
      const v = evaluate(ast.node, lookup);
      return v === null ? null : -v;
    }

    case 'binop': {
      const l = evaluate(ast.left, lookup);
      if (l === null) return null;
      const r = evaluate(ast.right, lookup);
      if (r === null) return null;

      let result;
      switch (ast.op) {
        case '+': result = l + r; break;
        case '-': result = l - r; break;
        case '*': result = l * r; break;
        case '/': result = (r === 0) ? null : l / r; break;
        case '^': result = Math.pow(l, r); break;
        default: return null;
      }
      if (result === null) return null;
      return isFinite(result) ? result : null;
    }

    default:
      return null;
  }
}

const FormulaEval = { parse, evaluate, collectVarNames };

if (typeof window !== 'undefined') window.FormulaEval = FormulaEval;
if (typeof module !== 'undefined') module.exports = FormulaEval;
